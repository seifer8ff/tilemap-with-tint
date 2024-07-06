/* eslint-disable no-unused-vars */
import { Container, Bounds } from "@pixi/display";
import {
    Texture,
    Renderer,
    Matrix,
    Rectangle,
    groupD8,
    DRAW_MODES,
} from "@pixi/core";
import { TileRenderer } from "./TileRenderer";
import { settings } from "./settings";
import { CanvasTileRenderer } from "./CanvasTileRenderer";

import type { BaseTexture } from "@pixi/core";
import type { IDestroyOptions } from "@pixi/display";
import type { TilemapGeometry } from "./TilemapShader";

enum POINT_STRUCT {
    U,
    V,
    X,
    Y,
    TILE_WIDTH,
    TILE_HEIGHT,
    ROTATE,
    ANIM_X,
    ANIM_Y,
    TEXTURE_INDEX,
    ANIM_COUNT_X,
    ANIM_COUNT_Y,
    ANIM_DIVISOR,
    ALPHA,
    TINT_R,
    TINT_G,
    TINT_B,
    TINT_A,
}

export const POINT_STRUCT_SIZE = Object.keys(POINT_STRUCT).length / 2;

/**
 * A rectangular tilemap implementation that renders a predefined set of tile textures.
 *
 * The {@link Tilemap.tileset tileset} of a tilemap defines the list of base-textures that can be painted in the
 * tilemap. A texture is identified using its base-texture's index into the this list, i.e. changing the base-texture
 * at a given index in the tileset modifies the paint of all tiles pointing to that index.
 *
 * The size of the tileset is limited by the texture units supported by the client device. The minimum supported
 * value is 8, as defined by the WebGL 1 specification. `gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS`) can be used
 * to extract this limit. {@link CompositeTilemap} can be used to get around this limit by layering multiple tilemap
 * instances.
 *
 * @example
 * import { Tilemap } from '@pixi/tilemap';
 * import { Loader } from '@pixi/loaders';
 *
 * // Add the spritesheet into your loader!
 * Loader.shared.add('atlas', 'assets/atlas.json');
 *
 * // Make the tilemap once the tileset assets are available.
 * Loader.shared.load(function onTilesetLoaded()
 * {
 *      // The base-texture is shared between all the tile textures.
 *      const tilemap = new Tilemap([Texture.from('grass.png').baseTexture])
 *          .tile('grass.png', 0, 0)
 *          .tile('grass.png', 100, 100)
 *          .tile('brick_wall.png', 0, 100);
 * });
 */
export class Tilemap extends Container {
    shadowColor = new Float32Array([0.0, 0.0, 0.0, 0.5]);
    _globalMat: Matrix = null;

    /**
     * The tile animation frame.
     *
     * @see CompositeTilemap.tileAnim
     */
    public tileAnim: [number, number] = null;

    /**
     * This is the last uploaded size of the tilemap geometry.
     * @ignore
     */
    modificationMarker = 0;

    /** @ignore */
    offsetX = 0;

    /** @ignore */
    offsetY = 0;

    /** @ignore */
    compositeParent = false;

    /**
     * The list of base-textures being used in the tilemap.
     *
     * This should not be shuffled after tiles have been added into this tilemap. Usually, only tile textures
     * should be added after tiles have been added into the map.
     */
    protected tileset: Array<BaseTexture>;

    /**
     * The local bounds of the tilemap itself. This does not include DisplayObject children.
     */
    protected readonly tilemapBounds = new Bounds();

    /** Flags whether any animated tile was added. */
    protected hasAnimatedTile = false;

    /** The interleaved geometry of the tilemap. */
    private pointsBuf: Array<number> = [];

    /**
     * @param tileset - The tileset to use for the tilemap. This can be reset later with {@link Tilemap.setTileset}. The
     *      base-textures in this array must not be duplicated.
     */
    constructor(tileset: BaseTexture | Array<BaseTexture>) {
        super();
        this.setTileset(tileset);
    }

    /**
     * @returns The tileset of this tilemap.
     */
    getTileset(): Array<BaseTexture> {
        return this.tileset;
    }

    /**
     * Define the tileset used by the tilemap.
     *
     * @param tileset - The list of textures to use in the tilemap. If a base-texture (not array) is passed, it will
     *  be wrapped into an array. This should not contain any duplicates.
     */
    setTileset(tileset: BaseTexture | Array<BaseTexture> = []): this {
        if (!Array.isArray(tileset)) {
            tileset = [tileset];
        }
        for (let i = 0; i < tileset.length; i++) {
            if ((tileset[i] as unknown as Texture).baseTexture) {
                tileset[i] = (tileset[i] as unknown as Texture).baseTexture;
            }
        }

        this.tileset = tileset;

        return this;
    }

    /**  Clears all the tiles added into this tilemap. */
    clear(): this {
        this.pointsBuf.length = 0;
        this.modificationMarker = 0;
        this.tilemapBounds.clear();
        this.hasAnimatedTile = false;

        return this;
    }

    /**
     * Adds a tile that paints the given texture at (x, y).
     *
     * @param tileTexture - The tiling texture to render.
     * @param x - The local x-coordinate of the tile's position.
     * @param y - The local y-coordinate of the tile's position.
     * @param options - Additional tile options.
     * @param [options.u=texture.frame.x] - The x-coordinate of the texture in its base-texture's space.
     * @param [options.v=texture.frame.y] - The y-coordinate of the texture in its base-texture's space.
     * @param [options.tileWidth=texture.orig.width] - The local width of the tile.
     * @param [options.tileHeight=texture.orig.height] - The local height of the tile.
     * @param [options.animX=0] - For animated tiles, this is the "offset" along the x-axis for adjacent
     *      animation frame textures in the base-texture.
     * @param [options.animY=0] - For animated tiles, this is the "offset" along the y-axis for adjacent
     *      animation frames textures in the base-texture.
     * @param [options.rotate=0]
     * @param [options.animCountX=1024] - For animated tiles, this is the number of animation frame textures
     *      per row.
     * @param [options.animCountY=1024] - For animated tiles, this is the number of animation frame textures
     *      per column.
     * @param [options.animDivisor=1] - For animated tiles, this is the animation duration of each frame
     * @param [options.alpha=1] - Tile alpha
     * @return This tilemap, good for chaining.
     */
    tile(
        tileTexture: number | string | Texture | BaseTexture,
        x: number,
        y: number,
        options: {
            u?: number;
            v?: number;
            tileWidth?: number;
            tileHeight?: number;
            animX?: number;
            animY?: number;
            rotate?: number;
            animCountX?: number;
            animCountY?: number;
            animDivisor?: number;
            alpha?: number;
            tint?: [number, number, number, number];
        } = {}
    ): this {
        let baseTexture: BaseTexture;
        let textureIndex = -1;

        if (typeof tileTexture === "number") {
            textureIndex = tileTexture;
            baseTexture = this.tileset[textureIndex];
        } else {
            let texture: Texture | BaseTexture;

            if (typeof tileTexture === "string") {
                texture = Texture.from(tileTexture);
            } else {
                texture = tileTexture;
            }

            const textureList = this.tileset;

            for (let i = 0; i < textureList.length; i++) {
                if (textureList[i] === texture.castToBaseTexture()) {
                    textureIndex = i;
                    break;
                }
            }

            if ("baseTexture" in texture) {
                options.u = options.u ?? texture.frame.x;
                options.v = options.v ?? texture.frame.y;
                options.tileWidth = options.tileWidth ?? texture.orig.width;
                options.tileHeight = options.tileHeight ?? texture.orig.height;
            }

            baseTexture = texture.castToBaseTexture();
        }

        if (!baseTexture || textureIndex < 0) {
            console.error(
                "The tile texture was not found in the tilemap tileset."
            );

            return this;
        }

        const {
            u = 0,
            v = 0,
            tileWidth = baseTexture.realWidth,
            tileHeight = baseTexture.realHeight,
            animX = 0,
            animY = 0,
            rotate = 0,
            animCountX = 1024,
            animCountY = 1024,
            animDivisor = 1,
            alpha = 1,
            tint = [255, 255, 255, 1],
        } = options;

        const pb = this.pointsBuf;

        this.hasAnimatedTile = this.hasAnimatedTile || animX > 0 || animY > 0;

        pb.push(u);
        pb.push(v);
        pb.push(x);
        pb.push(y);
        pb.push(tileWidth);
        pb.push(tileHeight);
        pb.push(rotate);
        pb.push(animX | 0);
        pb.push(animY | 0);
        pb.push(textureIndex);
        pb.push(animCountX);
        pb.push(animCountY);
        pb.push(animDivisor);
        pb.push(alpha);

        pb.push(tint[0]);
        pb.push(tint[1]);
        pb.push(tint[2]);
        pb.push(tint[3]);

        this.tilemapBounds.addFramePad(
            x,
            y,
            x + tileWidth,
            y + tileHeight,
            0,
            0
        );

        return this;
    }

    /** Changes the rotation of the last tile. */
    tileRotate(rotate: number): void {
        const pb = this.pointsBuf;

        pb[pb.length - (POINT_STRUCT_SIZE - POINT_STRUCT.TEXTURE_INDEX)] =
            rotate;
    }

    /** Changes the `animX`, `animCountX` of the last tile. */
    tileAnimX(offset: number, count: number): void {
        const pb = this.pointsBuf;

        pb[pb.length - (POINT_STRUCT_SIZE - POINT_STRUCT.ANIM_X)] = offset;
        pb[pb.length - (POINT_STRUCT_SIZE - POINT_STRUCT.ANIM_COUNT_X)] = count;
        // pb[pb.length - (POINT_STRUCT_SIZE - POINT_STRUCT.ANIM_DIVISOR)] = duration;
    }

    /** Changes the `animY`, `animCountY` of the last tile. */
    tileAnimY(offset: number, count: number): void {
        const pb = this.pointsBuf;

        pb[pb.length - (POINT_STRUCT_SIZE - POINT_STRUCT.ANIM_Y)] = offset;
        pb[pb.length - (POINT_STRUCT_SIZE - POINT_STRUCT.ANIM_COUNT_Y)] = count;
    }

    /** Changes the `animDivisor` value of the last tile. */
    tileAnimDivisor(divisor: number): void {
        const pb = this.pointsBuf;

        pb[pb.length - (POINT_STRUCT_SIZE - POINT_STRUCT.ANIM_DIVISOR)] =
            divisor;
    }

    tileAlpha(alpha: number): void {
        const pb = this.pointsBuf;

        pb[pb.length - (POINT_STRUCT_SIZE - POINT_STRUCT.ALPHA)] = alpha;
    }

    renderCanvas = (renderer: any): void => {
        const plugin = CanvasTileRenderer.getInstance(renderer);

        if (plugin && !plugin.dontUseTransform) {
            const wt = this.worldTransform;

            renderer.canvasContext.activeContext.setTransform(
                wt.a,
                wt.b,
                wt.c,
                wt.d,
                wt.tx * renderer.resolution,
                wt.ty * renderer.resolution
            );
        }

        this.renderCanvasCore(renderer);
    };

    renderCanvasCore(renderer: any): void {
        if (this.tileset.length === 0) return;
        const points = this.pointsBuf;
        const tileAnim =
            this.tileAnim ||
            (renderer.plugins.tilemap && renderer.plugins.tilemap.tileAnim);

        renderer.canvasContext.activeContext.fillStyle = "#000000";
        for (let i = 0, n = points.length; i < n; i += POINT_STRUCT_SIZE) {
            let x1 = points[i + POINT_STRUCT.U];
            let y1 = points[i + POINT_STRUCT.V];
            const x2 = points[i + POINT_STRUCT.X];
            const y2 = points[i + POINT_STRUCT.Y];
            const w = points[i + POINT_STRUCT.TILE_WIDTH];
            const h = points[i + POINT_STRUCT.TILE_HEIGHT];

            x1 += points[i + POINT_STRUCT.ANIM_X] * tileAnim[0];
            y1 += points[i + POINT_STRUCT.ANIM_Y] * tileAnim[1];

            const textureIndex = points[i + POINT_STRUCT.TEXTURE_INDEX];
            const alpha = points[i + POINT_STRUCT.ALPHA];

            const tintR = points[i + POINT_STRUCT.TINT_R] / 255;
            const tintG = points[i + POINT_STRUCT.TINT_G] / 255;
            const tintB = points[i + POINT_STRUCT.TINT_B] / 255;
            const tintA = points[i + POINT_STRUCT.TINT_A];

            // renderer.canvasContext.activeContext.globalAlpha = alpha * tintA;
            // renderer.canvasContext.activeContext.filter = `brightness(${
            //     tintR * 100
            // }%) contrast(${tintG * 100}%) saturate(${tintB * 100}%)`;

            // canvas does not work with rotate yet

            if (textureIndex >= 0 && this.tileset[textureIndex]) {
                renderer.canvasContext.activeContext.globalAlpha = alpha;
                renderer.canvasContext.activeContext.drawImage(
                    (this.tileset[textureIndex] as any).getDrawableSource(),
                    x1,
                    y1,
                    w,
                    h,
                    x2,
                    y2,
                    w,
                    h
                );
            } else {
                renderer.canvasContext.activeContext.globalAlpha = 0.5;
                renderer.canvasContext.activeContext.fillRect(x2, y2, w, h);
            }
            renderer.canvasContext.activeContext.globalAlpha = 1;
        }
    }

    private vbId = 0;
    private vb: TilemapGeometry = null;
    private vbBuffer: ArrayBuffer = null;
    private vbArray: Float32Array = null;
    private vbInts: Uint32Array = null;

    private destroyVb(): void {
        if (this.vb) {
            this.vb.destroy();
            this.vb = null;
        }
    }

    render(renderer: Renderer): void {
        const plugin = (renderer.plugins as any).tilemap;
        const shader = plugin.getShader();

        renderer.batch.setObjectRenderer(plugin);
        this._globalMat = shader.uniforms.projTransMatrix;
        renderer.globalUniforms.uniforms.projectionMatrix
            .copyTo(this._globalMat)
            .append(this.worldTransform);

        shader.uniforms.shadowColor = this.shadowColor;
        shader.uniforms.animationFrame = this.tileAnim || plugin.tileAnim;

        this.renderWebGLCore(renderer, plugin);
    }

    renderWebGLCore(renderer: Renderer, plugin: TileRenderer): void {
        const points = this.pointsBuf;

        if (points.length === 0) return;
        const rectsCount = points.length / POINT_STRUCT_SIZE;

        const shader = plugin.getShader();
        const textures = this.tileset;

        if (textures.length === 0) return;

        plugin.bindTileTextures(renderer, textures);
        renderer.shader.bind(shader, false);

        // lost context! recover!
        let vb = this.vb;

        if (!vb) {
            vb = plugin.createVb();
            this.vb = vb;
            this.vbId = (vb as any).id;
            this.vbBuffer = null;
            this.modificationMarker = 0;
        }

        plugin.checkIndexBuffer(rectsCount, vb);
        const boundCountPerBuffer = settings.TEXTILE_UNITS;

        const vertexBuf = vb.getBuffer("aVertexPosition");
        // if layer was changed, re-upload vertices
        const vertices = rectsCount * vb.vertPerQuad;

        if (vertices === 0) return;
        if (this.modificationMarker !== vertices) {
            this.modificationMarker = vertices;
            const vs = vb.stride * vertices;

            if (!this.vbBuffer || this.vbBuffer.byteLength < vs) {
                // !@#$ happens, need resize
                let bk = vb.stride;

                while (bk < vs) {
                    bk *= 2;
                }
                this.vbBuffer = new ArrayBuffer(bk);
                this.vbArray = new Float32Array(this.vbBuffer);
                this.vbInts = new Uint32Array(this.vbBuffer);
                vertexBuf.update(this.vbBuffer);
            }

            const arr = this.vbArray;
            // const ints = this.vbInts;
            // upload vertices!
            let sz = 0;
            // let tint = 0xffffffff;
            let textureId = 0;
            let shiftU: number = this.offsetX;
            let shiftV: number = this.offsetY;

            // let tint = 0xffffffff;
            // const tint = -1;

            for (let i = 0; i < points.length; i += POINT_STRUCT_SIZE) {
                const eps = 0.5;

                if (this.compositeParent) {
                    const textureIndex = points[i + POINT_STRUCT.TEXTURE_INDEX];

                    if (boundCountPerBuffer > 1) {
                        // TODO: what if its more than 4?
                        textureId = textureIndex >> 2;
                        shiftU = this.offsetX * (textureIndex & 1);
                        shiftV = this.offsetY * ((textureIndex >> 1) & 1);
                    } else {
                        textureId = textureIndex;
                        shiftU = 0;
                        shiftV = 0;
                    }
                }
                const x = points[i + POINT_STRUCT.X];
                const y = points[i + POINT_STRUCT.Y];
                const w = points[i + POINT_STRUCT.TILE_WIDTH];
                const h = points[i + POINT_STRUCT.TILE_HEIGHT];
                const u = points[i + POINT_STRUCT.U] + shiftU;
                const v = points[i + POINT_STRUCT.V] + shiftV;
                let rotate = points[i + POINT_STRUCT.ROTATE];

                const animX = points[i + POINT_STRUCT.ANIM_X];
                const animY = points[i + POINT_STRUCT.ANIM_Y];
                const animWidth = points[i + POINT_STRUCT.ANIM_COUNT_X] || 1024;
                const animHeight =
                    points[i + POINT_STRUCT.ANIM_COUNT_Y] || 1024;

                const animXEncoded = animX + animWidth * 2048;
                const animYEncoded = animY + animHeight * 2048;
                const animDivisor = points[i + POINT_STRUCT.ANIM_DIVISOR];
                const alpha = points[i + POINT_STRUCT.ALPHA];
                const tintR = points[i + POINT_STRUCT.TINT_R] / 255;
                const tintG = points[i + POINT_STRUCT.TINT_G] / 255;
                const tintB = points[i + POINT_STRUCT.TINT_B] / 255;
                const tintA = points[i + POINT_STRUCT.TINT_A] / 1;

                let u0: number;
                let v0: number;
                let u1: number;
                let v1: number;
                let u2: number;
                let v2: number;
                let u3: number;
                let v3: number;

                if (rotate === 0) {
                    u0 = u;
                    v0 = v;
                    u1 = u + w;
                    v1 = v;
                    u2 = u + w;
                    v2 = v + h;
                    u3 = u;
                    v3 = v + h;
                } else {
                    let w2 = w / 2;
                    let h2 = h / 2;

                    if (rotate % 4 !== 0) {
                        w2 = h / 2;
                        h2 = w / 2;
                    }
                    const cX = u + w2;
                    const cY = v + h2;

                    rotate = groupD8.add(rotate, groupD8.NW);
                    u0 = cX + w2 * groupD8.uX(rotate);
                    v0 = cY + h2 * groupD8.uY(rotate);

                    rotate = groupD8.add(rotate, 2); // rotate 90 degrees clockwise
                    u1 = cX + w2 * groupD8.uX(rotate);
                    v1 = cY + h2 * groupD8.uY(rotate);

                    rotate = groupD8.add(rotate, 2);
                    u2 = cX + w2 * groupD8.uX(rotate);
                    v2 = cY + h2 * groupD8.uY(rotate);

                    rotate = groupD8.add(rotate, 2);
                    u3 = cX + w2 * groupD8.uX(rotate);
                    v3 = cY + h2 * groupD8.uY(rotate);
                }

                // these are in the order defined in POINT_STRUCT enum
                arr[sz++] = x;
                arr[sz++] = y;
                arr[sz++] = u0;
                arr[sz++] = v0;
                arr[sz++] = u + eps;
                arr[sz++] = v + eps;
                arr[sz++] = u + w - eps;
                arr[sz++] = v + h - eps;
                arr[sz++] = animXEncoded;
                arr[sz++] = animYEncoded;
                arr[sz++] = textureId;
                arr[sz++] = animDivisor;
                arr[sz++] = alpha;
                // arr[sz++] = tintR;
                // arr[sz++] = tintG;
                // arr[sz++] = tintB;
                // arr[sz++] = tintA;

                arr[sz++] = x + w;
                arr[sz++] = y;
                arr[sz++] = u1;
                arr[sz++] = v1;
                arr[sz++] = u + eps;
                arr[sz++] = v + eps;
                arr[sz++] = u + w - eps;
                arr[sz++] = v + h - eps;
                arr[sz++] = animXEncoded;
                arr[sz++] = animYEncoded;
                arr[sz++] = textureId;
                arr[sz++] = animDivisor;
                arr[sz++] = alpha;
                // arr[sz++] = tintR;
                // arr[sz++] = tintG;
                // arr[sz++] = tintB;
                // arr[sz++] = tintA;

                arr[sz++] = x + w;
                arr[sz++] = y + h;
                arr[sz++] = u2;
                arr[sz++] = v2;
                arr[sz++] = u + eps;
                arr[sz++] = v + eps;
                arr[sz++] = u + w - eps;
                arr[sz++] = v + h - eps;
                arr[sz++] = animXEncoded;
                arr[sz++] = animYEncoded;
                arr[sz++] = textureId;
                arr[sz++] = animDivisor;
                arr[sz++] = alpha;
                // arr[sz++] = tintR;
                // arr[sz++] = tintG;
                // arr[sz++] = tintB;
                // arr[sz++] = tintA;

                arr[sz++] = x;
                arr[sz++] = y + h;
                arr[sz++] = u3;
                arr[sz++] = v3;
                arr[sz++] = u + eps;
                arr[sz++] = v + eps;
                arr[sz++] = u + w - eps;
                arr[sz++] = v + h - eps;
                arr[sz++] = animXEncoded;
                arr[sz++] = animYEncoded;
                arr[sz++] = textureId;
                arr[sz++] = animDivisor;
                arr[sz++] = alpha;
                // arr[sz++] = tintR;
                // arr[sz++] = tintG;
                // arr[sz++] = tintB;
                // arr[sz++] = tintA;
            }

            vertexBuf.update(arr);
        }

        (renderer.geometry as any).bind(vb, shader);
        renderer.geometry.draw(DRAW_MODES.TRIANGLES, rectsCount * 6, 0);
    }

    /**
     * @internal
     * @ignore
     */
    isModified(anim: boolean): boolean {
        if (
            this.modificationMarker !== this.pointsBuf.length ||
            (anim && this.hasAnimatedTile)
        ) {
            return true;
        }

        return false;
    }

    /**
     * This will pull forward the modification marker.
     *
     * @internal
     * @ignore
     */
    clearModify(): void {
        this.modificationMarker = this.pointsBuf.length;
    }

    /** @override */
    protected _calculateBounds(): void {
        const { minX, minY, maxX, maxY } = this.tilemapBounds;

        this._bounds.addFrame(this.transform, minX, minY, maxX, maxY);
    }

    /** @override */
    public getLocalBounds(rect?: Rectangle): Rectangle {
        // we can do a fast local bounds if the sprite has no children!
        if (this.children.length === 0) {
            return this.tilemapBounds.getRectangle(rect);
        }

        return super.getLocalBounds.call(this, rect);
    }

    /** @override */
    destroy(options?: IDestroyOptions): void {
        super.destroy(options);
        this.destroyVb();
    }

    /**
     * Deprecated signature for {@link Tilemap.tile tile}.
     *
     * @deprecated Since @pixi/tilemap 3.
     */
    addFrame(
        texture: Texture | string | number,
        x: number,
        y: number,
        animX: number,
        animY: number
    ): boolean {
        this.tile(texture, x, y, {
            animX,
            animY,
        });

        return true;
    }

    /**
     * Deprecated signature for {@link Tilemap.tile tile}.
     *
     * @deprecated Since @pixi/tilemap 3.
     */
    // eslint-disable-next-line max-params
    addRect(
        textureIndex: number,
        u: number,
        v: number,
        x: number,
        y: number,
        tileWidth: number,
        tileHeight: number,
        animX = 0,
        animY = 0,
        rotate = 0,
        animCountX = 1024,
        animCountY = 1024,
        animDivisor = 1,
        alpha = 1,
        tint: [number, number, number, number] = [255, 255, 255, 1]
    ): this {
        return this.tile(textureIndex, x, y, {
            u,
            v,
            tileWidth,
            tileHeight,
            animX,
            animY,
            rotate,
            animCountX,
            animCountY,
            animDivisor,
            alpha,
            tint,
        });
    }
}
