import { Container } from "@pixi/display";
import { Texture, Renderer, BaseTexture, Matrix } from "@pixi/core";
import { Tilemap } from "./Tilemap";
import { settings } from "./settings";
import { CanvasTileRenderer } from "./CanvasTileRenderer";

import type { TileRenderer } from "./TileRenderer";

/**
 * A tilemap composite that lazily builds tilesets layered into multiple tilemaps.
 *
 * The composite tileset is the concatenation of the individual tilesets used in the tilemaps. You can
 * preinitialized it by passing a list of tile textures to the constructor. Otherwise, the composite tilemap
 * is lazily built as you add more tiles with newer tile textures. A new tilemap is created once the last
 * tilemap has reached its limit (as set by {@link CompositeTilemap.texturesPerTilemap texturesPerTilemap}).
 *
 * @example
 * import { Application } from '@pixi/app';
 * import { CompositeTilemap } from '@pixi/tilemap';
 * import { Loader } from '@pixi/loaders';
 *
 * // Setup view & stage.
 * const app = new Application();
 *
 * document.body.appendChild(app.renderer.view);
 * app.stage.interactive = true;
 *
 * // Global reference to the tilemap.
 * let globalTilemap: CompositeTilemap;
 *
 * // Load the tileset spritesheet!
 * Loader.shared.load('atlas.json');
 *
 * // Initialize the tilemap scene when the assets load.
 * Loader.shared.load(function onTilesetLoaded()
 * {
 *      const tilemap = new CompositeTilemap();
 *
 *      // Setup the game level with grass and dungeons!
 *      for (let x = 0; x < 10; x++)
 *      {
 *          for (let y = 0; y < 10; y++)
 *          {
 *              tilemap.tile(
 *                  x % 2 === 0 && (x === y || x + y === 10) ? 'dungeon.png' : 'grass.png',
 *                  x * 100,
 *                  y * 100,
 *              );
 *          }
 *      }
 *
 *      globalTilemap = app.stage.addChild(tilemap);
 * });
 *
 * // Show a bomb at a random location whenever the user clicks!
 * app.stage.on('click', function onClick()
 * {
 *      if (!globalTilemap) return;
 *
 *      const x = Math.floor(Math.random() * 10);
 *      const y = Math.floor(Math.random() * 10);
 *
 *      globalTilemap.tile('bomb.png', x * 100, y * 100);
 * });
 */
export class CompositeTilemap extends Container {
    /** The hard limit on the number of tile textures used in each tilemap. */
    public readonly texturesPerTilemap: number;

    /**
     * The animation frame vector.
     *
     * Animated tiles have four parameters - `animX`, `animY`, `animCountX`, `animCountY`. The textures
     * of adjacent animation frames are at offset `animX` or `animY` of each other, with `animCountX` per
     * row and `animCountY` per column.
     *
     * The animation frame vector specifies which animation frame texture to use. If the x/y coordinate is
     * larger than the `animCountX` or `animCountY` for a specific tile, the modulus is taken.
     */
    public tileAnim: [number, number] = null;

    /** The last modified tilemap. */
    protected lastModifiedTilemap: Tilemap = null;

    private modificationMarker = 0;
    private shadowColor = new Float32Array([0.0, 0.0, 0.0, 0.5]);
    private _globalMat: Matrix = null;

    /**
     * @param tileset - A list of tile base-textures that will be used to eagerly initialized the layered
     *  tilemaps. This is only an performance optimization, and using {@link CompositeTilemap.tile tile}
     *  will work equivalently.
     */
    constructor(tileset?: Array<BaseTexture>) {
        super();

        this.tileset(tileset);
        this.texturesPerTilemap = settings.TEXTURES_PER_TILEMAP;
    }

    /**
     * This will preinitialize the tilesets of the layered tilemaps.
     *
     * If used after a tilemap has been created (or a tile added), this will overwrite the tile textures of the
     * existing tilemaps. Passing the tileset to the constructor instead is the best practice.
     *
     * @param tileTextures - The list of tile textures that make up the tileset.
     */
    tileset(tileTextures: Array<BaseTexture>): this {
        if (!tileTextures) {
            tileTextures = [];
        }

        const texPerChild = this.texturesPerTilemap;
        const len1 = this.children.length;
        const len2 = Math.ceil(tileTextures.length / texPerChild);

        for (let i = 0; i < Math.min(len1, len2); i++) {
            (this.children[i] as Tilemap).setTileset(
                tileTextures.slice(i * texPerChild, (i + 1) * texPerChild)
            );
        }
        for (let i = len1; i < len2; i++) {
            const tilemap = new Tilemap(
                tileTextures.slice(i * texPerChild, (i + 1) * texPerChild)
            );

            tilemap.compositeParent = true;
            tilemap.offsetX = settings.TEXTILE_DIMEN;
            tilemap.offsetY = settings.TEXTILE_DIMEN;

            // TODO: Don't use children
            this.addChild(tilemap);
        }

        return this;
    }

    /** Clears the tilemap composite. */
    clear(): this {
        for (let i = 0; i < this.children.length; i++) {
            (this.children[i] as Tilemap).clear();
        }

        this.modificationMarker = 0;

        return this;
    }

    /** Changes the rotation of the last added tile. */
    tileRotate(rotate: number): this {
        if (this.lastModifiedTilemap) {
            this.lastModifiedTilemap.tileRotate(rotate);
        }

        return this;
    }

    /** Changes `animX`, `animCountX` of the last added tile. */
    tileAnimX(offset: number, count: number): this {
        if (this.lastModifiedTilemap) {
            this.lastModifiedTilemap.tileAnimX(offset, count);
        }

        return this;
    }

    /** Changes `animY`, `animCountY` of the last added tile. */
    tileAnimY(offset: number, count: number): this {
        if (this.lastModifiedTilemap) {
            this.lastModifiedTilemap.tileAnimY(offset, count);
        }

        return this;
    }

    /** Changes `tileAnimDivisor` value of the last added tile. */
    tileAnimDivisor(divisor: number): this {
        if (this.lastModifiedTilemap) {
            this.lastModifiedTilemap.tileAnimDivisor(divisor);
        }

        return this;
    }

    /**
     * Adds a tile that paints the given tile texture at (x, y).
     *
     * @param tileTexture - The tile texture. You can pass an index into the composite tilemap as well.
     * @param x - The local x-coordinate of the tile's location.
     * @param y - The local y-coordinate of the tile's location.
     * @param options - Additional options to pass to {@link Tilemap.tile}.
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
     * @param [options.animDivisor=1] - For animated tiles, this is the animation duration each frame
     * @param [options.alpha=1] - Tile alpha
     * @param [options.tint=[255, 255, 255, 1]] - Tile tint [r, g, b, a]
     * @return This tilemap, good for chaining.
     */
    tile(
        tileTexture: Texture | string | number,
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
        let tilemap: Tilemap = null;
        const children = this.children;

        this.lastModifiedTilemap = null;

        if (typeof tileTexture === "number") {
            const childIndex = (tileTexture / this.texturesPerTilemap) >> 0;
            let tileIndex = 0;

            tilemap = children[childIndex] as Tilemap;

            if (!tilemap) {
                tilemap = children[0] as Tilemap;

                // Silently fail if the tilemap doesn't exist
                if (!tilemap) return this;

                tileIndex = 0;
            } else {
                tileIndex = tileTexture % this.texturesPerTilemap;
            }

            tilemap.tile(tileIndex, x, y, options);
        } else {
            if (typeof tileTexture === "string") {
                tileTexture = Texture.from(tileTexture);
            }

            // Probe all tilemaps to find which tileset contains the base-texture.
            for (let i = 0; i < children.length; i++) {
                const child = children[i] as Tilemap;
                const tex = child.getTileset();

                for (let j = 0; j < tex.length; j++) {
                    if (tex[j] === tileTexture.baseTexture) {
                        tilemap = child;
                        break;
                    }
                }

                if (tilemap) {
                    break;
                }
            }

            // If no tileset contains the base-texture, attempt to add it.
            if (!tilemap) {
                // Probe the tilemaps to find one below capacity. If so, add the texture into that tilemap.
                for (let i = children.length - 1; i >= 0; i--) {
                    const child = children[i] as Tilemap;

                    if (child.getTileset().length < this.texturesPerTilemap) {
                        tilemap = child;
                        child.getTileset().push(tileTexture.baseTexture);
                        break;
                    }
                }

                // Otherwise, create a new tilemap initialized with that tile texture.
                if (!tilemap) {
                    tilemap = new Tilemap(tileTexture.baseTexture);
                    tilemap.compositeParent = true;
                    tilemap.offsetX = settings.TEXTILE_DIMEN;
                    tilemap.offsetY = settings.TEXTILE_DIMEN;

                    this.addChild(tilemap);
                }
            }

            tilemap.tile(tileTexture, x, y, options);
        }

        this.lastModifiedTilemap = tilemap;

        return this;
    }

    renderCanvas(renderer: any): void {
        if (!this.visible || this.worldAlpha <= 0 || !this.renderable) {
            return;
        }

        const tilemapPlugin = CanvasTileRenderer.getInstance(renderer);

        if (tilemapPlugin && !tilemapPlugin.dontUseTransform) {
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

        const layers = this.children;

        for (let i = 0; i < layers.length; i++) {
            const layer = layers[i] as Tilemap;

            layer.tileAnim = this.tileAnim;
            layer.renderCanvasCore(renderer);
        }
    }

    render(renderer: Renderer): void {
        if (!this.visible || this.worldAlpha <= 0 || !this.renderable) {
            return;
        }

        const plugin = renderer.plugins.tilemap as TileRenderer;
        const shader = plugin.getShader();

        renderer.batch.setObjectRenderer(plugin);

        // TODO: dont create new array, please
        this._globalMat = shader.uniforms.projTransMatrix;
        renderer.globalUniforms.uniforms.projectionMatrix
            .copyTo(this._globalMat)
            .append(this.worldTransform);
        shader.uniforms.shadowColor = this.shadowColor;
        shader.uniforms.animationFrame = this.tileAnim || plugin.tileAnim;

        renderer.shader.bind(shader, false);

        const layers = this.children;

        for (let i = 0; i < layers.length; i++) {
            (layers[i] as Tilemap).renderWebGLCore(renderer, plugin);
        }
    }

    /**
     * @internal
     * @ignore
     */
    isModified(anim: boolean): boolean {
        const layers = this.children;

        if (this.modificationMarker !== layers.length) {
            return true;
        }
        for (let i = 0; i < layers.length; i++) {
            if ((layers[i] as Tilemap).isModified(anim)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @internal
     * @ignore
     */
    clearModify(): void {
        const layers = this.children;

        this.modificationMarker = layers.length;
        for (let i = 0; i < layers.length; i++) {
            (layers[i] as Tilemap).clearModify();
        }
    }

    /**
     * @deprecated Since @pixi/tilemap 3.
     * @see CompositeTilemap.tile
     */
    addFrame(
        texture: Texture | string | number,
        x: number,
        y: number,
        animX?: number,
        animY?: number,
        animWidth?: number,
        animHeight?: number,
        animDivisor?: number,
        alpha?: number
    ): this {
        return this.tile(texture, x, y, {
            animX,
            animY,
            animCountX: animWidth,
            animCountY: animHeight,
            animDivisor,
            alpha,
        });
    }

    /**
     * @deprecated @pixi/tilemap 3
     * @see CompositeTilemap.tile
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
        animX?: number,
        animY?: number,
        rotate?: number,
        animWidth?: number,
        animHeight?: number
    ): this {
        const childIndex: number =
            (textureIndex / this.texturesPerTilemap) >> 0;
        const textureId: number = textureIndex % this.texturesPerTilemap;

        if (
            this.children[childIndex] &&
            (this.children[childIndex] as Tilemap).getTileset()
        ) {
            this.lastModifiedTilemap = this.children[childIndex] as Tilemap;
            this.lastModifiedTilemap.addRect(
                textureId,
                u,
                v,
                x,
                y,
                tileWidth,
                tileHeight,
                animX,
                animY,
                rotate,
                animWidth,
                animHeight
            );
        } else {
            this.lastModifiedTilemap = null;
        }

        return this;
    }

    /**
     * Alias for {@link CompositeTilemap.tileset tileset}.
     *
     * @deprecated Since @pixi/tilemap 3.
     */
    setBitmaps = this.tileset;

    /**
     * @deprecated Since @pixi/tilemap 3.
     * @readonly
     * @see CompositeTilemap.texturesPerTilemap
     */
    get texPerChild(): number {
        return this.texturesPerTilemap;
    }
}
