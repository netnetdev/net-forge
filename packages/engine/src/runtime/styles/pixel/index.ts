/**
 * The pixel art style (game-runtime.md §10). The scene renders into a
 * low-resolution target, one pixel of it per sprite texel at the camera's
 * focus, and every pixel goes to the screen as a hard square block: no
 * filtering, no blur, one pixel scale for the whole picture. The colour is
 * then snapped to the style's 16-colour palette (the library build snaps
 * the sprites to the same one) with a 4x4 ordered dither, so lit 3D ground,
 * walls and effects read as one piece of pixel art with the sprites.
 *
 * Sprites (render/sprite.ts) are resized by `spriteScale` here each frame,
 * so a sprite texel is exactly one low-resolution pixel.
 */
import { PerspectiveCamera, RenderPipeline, Vector2, Vector3 } from "three/webgpu";
import type { Node } from "three/webgpu";
import { dot, float, floor, fract, length, mix, mrt, output, pass, renderOutput, screenUV, smoothstep, uniform, vec2, vec3, vec4 } from "three/tsl";
import { SPRITE_TEXEL, spriteScale } from "../../render/sprite.js";
import type { StyleContext, StyleKit, StyleSession } from "../kit.js";

/**
 * The pixel style's palette (DawnBringer 16). The asset library's
 * manifest/pixel.json carries the same list; its test keeps them equal.
 */
export const PIXEL_PALETTE: readonly string[] = [
  "#140c1c",
  "#442434",
  "#30346d",
  "#4e4a4e",
  "#854c30",
  "#346524",
  "#d04648",
  "#757161",
  "#597dce",
  "#d27d2c",
  "#8595a1",
  "#6daa2c",
  "#d2aa99",
  "#6dc2ca",
  "#dad45e",
  "#deeed6",
];

export interface PixelStyleOptions {
  /** Sprite texels (and so screen pixels of the low-res picture) per metre at the focus. Default 1 / SPRITE_TEXEL (16). */
  readonly texelsPerMetre?: number;
  /** Dither on the world's band edges, in light (0..1). Default 0.025. */
  readonly dither?: number;
  /** Sprite saturation before the palette snap. Default 1.25. */
  readonly saturation?: number;
  /** Light levels the world steps through: two dark field tones, then the light pools. Default [0.08, 0.14, 0.3, 0.52, 0.82]. */
  readonly bands?: readonly number[];
  /** Fewest low-res rows, so a tiny window stays legible. Default 120. */
  readonly minRows?: number;
}

/**
 * The integer block size (screen pixels per low-res pixel) that puts
 * `texelsPerMetre` low-res rows on each metre of a view `viewMetres` tall.
 */
export function pixelBlock(bufferHeight: number, viewMetres: number, texelsPerMetre: number, minRows = 120): number {
  const rows = Math.max(minRows, viewMetres * texelsPerMetre);
  return Math.max(1, Math.round(bufferHeight / rows));
}

/** Height in metres the camera sees at the ground point it looks at (perspective cameras; orthographic: its frustum). */
export function viewMetres(camera: PerspectiveCamera | { isOrthographicCamera?: boolean; top?: number; bottom?: number; zoom?: number }, forward: Vector3, position: Vector3): number {
  const cam = camera as PerspectiveCamera & { isOrthographicCamera?: boolean; top: number; bottom: number };
  if (cam.isOrthographicCamera) return (cam.top - cam.bottom) / (cam.zoom || 1);
  const down = Math.max(0.15, -forward.y);
  const dist = Math.max(1, position.y / down);
  return 2 * dist * Math.tan(((cam.fov || 50) * Math.PI) / 360);
}

function hex(c: string): Vector3 {
  const n = parseInt(c.slice(1), 16);
  return new Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** 4x4 Bayer threshold, 0..1, for an integer pixel cell. */
function bayer4(cell: Node<"vec2">): Node<"float"> {
  const b2 = (a: Node<"vec2">) => {
    const f = floor(a);
    return fract(dot(f, vec2(0.5, f.y.mul(0.75))));
  };
  return b2(cell.mul(0.5)).mul(0.25).add(b2(cell));
}

/** Nearest palette colour (weighted RGB), by a chain of compares. */
function nearest(c: Node<"vec3">, palette: readonly Vector3[]): Node<"vec3"> {
  const w = vec3(0.3, 0.59, 0.11);
  let best: Node<"vec3"> = vec3(palette[0] ?? new Vector3());
  let bestD: Node<"float"> = float(1e9);
  for (const p of palette) {
    const d = c.sub(vec3(p));
    const dist = dot(d.mul(d), w);
    const closer = dist.lessThan(bestD);
    best = closer.select(vec3(p), best);
    bestD = closer.select(dist, bestD);
  }
  return best;
}

class PixelSession implements StyleSession {
  private readonly pipeline: RenderPipeline;
  private readonly scenePass;
  private readonly low = uniform(new Vector2(320, 180));
  private readonly buffer = new Vector2();
  private readonly forward = new Vector3();
  private readonly position = new Vector3();
  private block = 0;

  constructor(
    private readonly ctx: StyleContext,
    private readonly opts: Required<PixelStyleOptions>,
  ) {
    this.pipeline = new RenderPipeline(ctx.renderer);
    this.pipeline.outputColorTransform = false;
    this.scenePass = pass(ctx.scene, ctx.camera);
    // Sprites tag themselves (render/sprite.ts SPRITE_MRT); everything else is the 3D world.
    this.scenePass.setMRT(mrt({ output, sprite: float(0) }));
    const color = this.scenePass.getTextureNode("output");
    const spriteTag = this.scenePass.getTextureNode("sprite");
    // One sample at the centre of the low-res pixel under this screen pixel: hard square blocks.
    const cell = floor(screenUV.mul(this.low));
    const at = cell.add(0.5).div(this.low);
    let c = color.sample(at).rgb;
    // The stack's hurt pulse, in low-res pixel steps (no vignette: it would ring the field).
    const post = ctx.post;
    if (post) {
      const d = length(at.sub(0.5)).mul(1.414);
      const hurtEdge = smoothstep(0.45, 1.15, d).mul(post.hurt).mul(0.85);
      c = mix(c, c.mul(vec3(1.25, 0.35, 0.3)).add(vec3(0.22, 0, 0)), hurtEdge);
    }
    const toned = renderOutput(vec4(c, 1)).rgb;
    const luma = dot(toned, vec3(0.299, 0.587, 0.114));
    // Sprites: their own palette colours, a little more saturated, no dither.
    const vivid = mix(vec3(luma), toned, this.opts.saturation);
    const sprite = nearest(vivid, PIXEL_PALETTE.map(hex));
    // The world: a few flat light bands. The dark field is two calm, mossy tones; light pools step up
    // in at most three warm bands; the band edges get a light ordered dither.
    const chroma = toned.div(luma.max(0.02));
    const l = luma.add(bayer4(cell).sub(0.5).mul(this.opts.dither));
    const bands = this.opts.bands;
    let level: Node<"float"> = float(bands[0] ?? 0.08);
    for (let i = 1; i < bands.length; i++) {
      const lo = bands[i - 1] ?? 0;
      const hi = bands[i] ?? 1;
      level = l.greaterThan((lo + hi) / 2).select(float(hi), level);
    }
    const lit = level.greaterThan(bands[1] ?? 0.16);
    const fieldTint = vec3(0.86, 1, 0.9);
    const hue = lit.select(mix(vec3(1), chroma, 1.15), mix(fieldTint, chroma, 0.25));
    const world = hue.mul(level).min(vec3(1));
    this.pipeline.outputNode = vec4(spriteTag.sample(at).r.greaterThan(0.5).select(sprite, world), 1);
  }

  /** Fit the block size to the canvas and the camera's view, and resize the sprites to match. */
  private fit(): void {
    const { renderer, camera } = this.ctx;
    renderer.getDrawingBufferSize(this.buffer);
    camera.getWorldDirection(this.forward);
    camera.getWorldPosition(this.position);
    const metres = viewMetres(camera as PerspectiveCamera, this.forward, this.position);
    const block = pixelBlock(this.buffer.y, metres, this.opts.texelsPerMetre, this.opts.minRows);
    if (block !== this.block) {
      this.block = block;
      this.scenePass.setResolutionScale(1 / block);
    }
    // The same float steps PassNode takes, so the sampled cells match its target exactly.
    const w = Math.max(1, Math.floor(this.buffer.x * (1 / block)));
    const h = Math.max(1, Math.floor(this.buffer.y * (1 / block)));
    this.low.value.set(w, h);
    // A sprite texel is one low-res pixel at the focus.
    spriteScale.value = metres / h / SPRITE_TEXEL;
  }

  render(): void {
    this.fit();
    this.pipeline.render();
  }

  dispose(): void {
    spriteScale.value = 1;
    this.pipeline.dispose();
  }
}

/** The pixel style with its options. */
export function createPixelStyle(o: PixelStyleOptions = {}): StyleKit {
  const opts: Required<PixelStyleOptions> = { texelsPerMetre: o.texelsPerMetre ?? 1 / SPRITE_TEXEL, dither: o.dither ?? 0.025, saturation: o.saturation ?? 1.25, bands: o.bands ?? [0.08, 0.14, 0.3, 0.52, 0.82], minRows: o.minRows ?? 120 };
  return { id: "pixel", attach: (ctx) => new PixelSession(ctx, opts) };
}

export const pixelKit: StyleKit = createPixelStyle();
