/**
 * The PS1 frame: the scene draws into a small target (about 240 lines on
 * the short side of the screen, no anti-aliasing), then one full-screen pass
 * grades it, converts it to display colour, and quantises it to 15-bit
 * colour (5 bits a channel) through the console's 4x4 ordered dither,
 * sampling each low-res pixel as a crisp block. An optional faint scanline
 * darkens the last device row of each block.
 *
 * The internal resolution follows the canvas: lines = short side / k, where
 * k is the whole number of device pixels per block nearest to the target,
 * so every block is the same size on screen.
 */
import { RenderPipeline, Vector2, Vector3 } from "three/webgpu";
import type { Camera, Node, Scene, WebGPURenderer } from "three/webgpu";
import { dot, float, floor, fract, length, max, mix, pass, pow, renderOutput, screenUV, smoothstep, uniform, vec3, vec4 } from "three/tsl";
import type { PostFX } from "../../render/post.js";

export interface Ps1PipelineOptions {
  /** Target lines on the short side of the screen. Default 240. */
  readonly lines?: number;
  /** Colour levels per channel after quantising (31 = the PS1's 15-bit framebuffer). */
  readonly levels?: number;
  /** Ordered-dither strength in quantisation steps (1 = the console's matrix). */
  readonly dither?: number;
  /** Scanline darkening on the last device row of each block, 0..1. Default 0.1. */
  readonly scanline?: number;
}

/** The grade knobs the pipeline reads (the stack's PostFX uniforms when there is one). */
type Grade = Pick<PostFX, "exposure" | "contrast" | "saturation" | "shadowTint" | "highlightTint" | "vignette" | "hurt">;

/** 4x4 Bayer threshold in [0, 1) for an integer pixel coordinate. */
function bayer4(p: Node<"vec2">): Node<"float"> {
  const b2 = (a: Node<"vec2">): Node<"float"> => fract(a.x.mul(0.5).add(a.y.mul(a.y).mul(0.75)));
  return b2(floor(p.mul(0.5))).mul(0.25).add(b2(floor(p)));
}

export class Ps1Pipeline {
  readonly pipeline: RenderPipeline;
  /** Internal resolution in pixels (the vertex-snap grid). */
  readonly resolution = uniform(new Vector2(320, 240));
  /** Device pixels per low-res block (for the scanline). */
  readonly block = uniform(3);
  readonly levels = uniform(31);
  readonly dither = uniform(1);
  readonly scanline = uniform(0.1);
  private readonly grade: Grade;
  private readonly scenePass;
  private readonly lines: number;
  private readonly size = new Vector2();

  constructor(
    private readonly renderer: WebGPURenderer,
    scene: Scene,
    camera: Camera,
    post: PostFX | undefined,
    opts: Ps1PipelineOptions = {},
  ) {
    this.lines = opts.lines ?? 240;
    this.levels.value = opts.levels ?? 31;
    this.dither.value = opts.dither ?? 1;
    this.scanline.value = opts.scanline ?? 0.1;
    this.grade = post ?? {
      exposure: uniform(1),
      contrast: uniform(1),
      saturation: uniform(1),
      shadowTint: uniform(new Vector3(1, 1, 1)),
      highlightTint: uniform(new Vector3(1, 1, 1)),
      vignette: uniform(0.25),
      hurt: uniform(0),
    };
    this.pipeline = new RenderPipeline(renderer);
    this.pipeline.outputColorTransform = false;
    // No MSAA in the small target: hard polygon edges are part of the look.
    this.scenePass = pass(scene, camera, { samples: 0 });
    this.build();
  }

  private build(): void {
    const g = this.grade;
    const res = this.resolution;
    const color = this.scenePass.getTextureNode("output");
    // Sample the centre of the low-res pixel this screen pixel falls in: crisp blocks on any backend.
    const px = floor(screenUV.mul(res));
    const uv = px.add(0.5).div(res);
    let c: Node<"vec3"> = color.sample(uv).rgb;
    // The stack's grade, in linear light before tone mapping (same maths as PostFX).
    c = c.mul(g.exposure);
    const luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(luma), c, g.saturation);
    c = pow(max(c, vec3(1e-5)).div(0.18), vec3(g.contrast)).mul(0.18);
    c = c.mul(mix(g.shadowTint, g.highlightTint, smoothstep(0.0, 1.0, luma)));
    // Vignette and the hurt pulse on the block grid, so they step like the rest of the frame.
    const d = length(uv.sub(0.5)).mul(1.414);
    c = c.mul(float(1).sub(smoothstep(0.35, 1.05, d).mul(g.vignette)));
    const hurtEdge = smoothstep(0.45, 1.15, d).mul(g.hurt).mul(0.85);
    c = mix(c, c.mul(vec3(1.25, 0.35, 0.3)).add(vec3(0.22, 0.0, 0.0)), hurtEdge);
    // Tone map and convert to display colour once, then quantise in display space like the console's DAC.
    const display = renderOutput(vec4(c, 1)).rgb;
    const t = bayer4(px).sub(0.5).mul(this.dither);
    let q: Node<"vec3"> = floor(display.mul(this.levels).add(0.5).add(t)).div(this.levels);
    q = q.clamp(0, 1);
    // A faint scanline: the last device row of each block, only when blocks are 3+ device pixels tall.
    const row = fract(screenUV.y.mul(res.y));
    const lastRow = row.greaterThan(float(1).sub(float(1).div(max(this.block, float(1)))));
    const scan = lastRow.and(this.block.greaterThanEqual(3)).select(float(1).sub(this.scanline), float(1));
    this.pipeline.outputNode = vec4(q.mul(scan), 1);
    this.pipeline.needsUpdate = true;
  }

  /** Fit the small target to the canvas: whole device pixels per block, about `lines` on the short side. */
  private fit(): void {
    const s = this.renderer.getDrawingBufferSize(this.size);
    const { k, w, h } = blockGrid(s.x, s.y, this.lines);
    if (w !== this.resolution.value.x || h !== this.resolution.value.y) {
      this.resolution.value.set(w, h);
      this.block.value = k;
      // A hair over 1/k so floor(size x scale) lands on w and h exactly.
      this.scenePass.setResolutionScale((1 + 1e-4) / k);
    }
  }

  render(): void {
    this.fit();
    this.pipeline.render();
  }

  dispose(): void {
    this.pipeline.dispose();
    this.scenePass.dispose();
  }
}

/** For tests: the block grid for a canvas size and a line target. */
export function blockGrid(width: number, height: number, lines: number): { k: number; w: number; h: number } {
  const short = Math.max(1, Math.min(width, height));
  const k = Math.max(1, Math.round(short / lines));
  return { k, w: Math.max(1, Math.floor(width / k)), h: Math.max(1, Math.floor(height / k)) };
}

