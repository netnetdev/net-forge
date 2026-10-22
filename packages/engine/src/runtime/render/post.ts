import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  Color,
  NeutralToneMapping,
  RenderPipeline,
  Vector2,
  Vector3,
} from "three/webgpu";
import type { Camera, Node, Scene, ToneMapping, WebGPURenderer } from "three/webgpu";
import {
  abs,
  dot,
  float,
  length,
  max,
  mix,
  perspectiveDepthToViewZ,
  pass,
  pow,
  renderOutput,
  screenUV,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import type BloomNode from "three/addons/tsl/display/BloomNode.js";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import { resolveLook } from "./presets.js";
import type { GradePreset, LookPreset } from "./presets.js";
import type { QualityTier } from "./quality.js";
import type { StylePost, StylePostInput } from "../styles/kit.js";

export interface PostFXOptions {
  readonly preset?: LookPreset;
  readonly overrides?: Partial<GradePreset>;
  /** Bloom on (default true). */
  readonly bloom?: boolean;
  /** Toon outline from depth edges (default false). */
  readonly outline?: boolean;
  /** FXAA on the final image (default true; turn off when the scene pass is multisampled). */
  readonly fxaa?: boolean;
  /** Post-processing at all. Off renders straight to the canvas (still tone mapped once by the renderer). Default true. */
  readonly enabled?: boolean;
  /** Bloom render-target scale. Default 0.5. */
  readonly bloomScale?: number;
  /** An art style's post stages (runtime/styles): scene-pass setup, an HDR stage before bloom, a colour stage before the grade, a display stage after tone mapping. */
  readonly style?: StylePost;
}

function toneMappingOf(name: GradePreset["toneMapping"]): ToneMapping {
  return name === "agx" ? AgXToneMapping : name === "neutral" ? NeutralToneMapping : ACESFilmicToneMapping;
}

/**
 * The post stack: scene pass (HDR) -> bloom -> optional depth outline ->
 * color grade (exposure, contrast, saturation, split tone, vignette, hurt
 * pulse) -> tone mapping and sRGB (once, via renderOutput) -> FXAA.
 *
 * Tone mapping is the renderer's (`renderer.toneMapping`), so the same
 * curve applies whether post is on (here, in renderOutput) or off
 * (renderer.render to the canvas). Every knob is a uniform.
 */
export class PostFX {
  readonly pipeline: RenderPipeline;
  /** Extra exposure multiplier inside the grade (the preset's exposure is renderer.toneMappingExposure). */
  readonly exposure = uniform(1);
  readonly contrast = uniform(1);
  readonly saturation = uniform(1);
  readonly shadowTint = uniform(new Vector3(1, 1, 1));
  readonly highlightTint = uniform(new Vector3(1, 1, 1));
  readonly vignette = uniform(0.3);
  /** 0..1: the game drives this when the player is hurt (red edge pulse). */
  readonly hurt = uniform(0);
  readonly outlineColor = uniform(new Color(0x06080c));
  /** Outline thickness in pixels. */
  readonly outlineThickness = uniform(1.25);
  /** Relative depth jump that counts as an edge. */
  readonly outlineThreshold = uniform(0.012);
  readonly outlineStrength = uniform(0.85);
  private readonly texel = uniform(new Vector2(1 / 1280, 1 / 720));
  private readonly near = uniform(0.1);
  private readonly far = uniform(500);
  private bloomNode: BloomNode | null = null;
  private bloomOn: boolean;
  private outlineOn: boolean;
  private fxaaOn: boolean;
  private bloomScale: number;
  private grade: GradePreset;
  private style: StylePost | null;
  enabled: boolean;

  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly scene: Scene,
    private readonly camera: Camera,
    opts: PostFXOptions = {},
  ) {
    this.pipeline = new RenderPipeline(renderer);
    this.pipeline.outputColorTransform = false;
    this.bloomOn = opts.bloom ?? true;
    this.outlineOn = opts.outline ?? false;
    this.fxaaOn = opts.fxaa ?? true;
    this.enabled = opts.enabled ?? true;
    this.bloomScale = opts.bloomScale ?? 0.5;
    this.style = opts.style ?? null;
    this.grade = { ...resolveLook(opts.preset).grade, ...opts.overrides };
    this.applyGrade();
    this.build();
  }

  /** Bloom strength, radius and threshold uniforms (null while bloom is off). */
  get bloom(): BloomNode | null {
    return this.bloomNode;
  }

  setPreset(preset: LookPreset, overrides: Partial<GradePreset> = {}): void {
    this.grade = { ...resolveLook(preset).grade, ...overrides };
    this.applyGrade();
  }

  private applyGrade(): void {
    const g = this.grade;
    this.renderer.toneMapping = toneMappingOf(g.toneMapping);
    // Exposure lives on the renderer so it applies with post on or off.
    this.renderer.toneMappingExposure = g.exposure;
    this.exposure.value = 1;
    this.contrast.value = g.contrast;
    this.saturation.value = g.saturation;
    this.shadowTint.value.set(...g.shadowTint);
    this.highlightTint.value.set(...g.highlightTint);
    this.vignette.value = g.vignette;
    if (this.bloomNode) {
      this.bloomNode.strength.value = g.bloomStrength;
      this.bloomNode.radius.value = g.bloomRadius;
      this.bloomNode.threshold.value = g.bloomThreshold;
    }
  }

  /** Toggle stages; rebuilds the node graph only when something changed. */
  configure(o: { bloom?: boolean; outline?: boolean; fxaa?: boolean; bloomScale?: number; enabled?: boolean }): void {
    const next = {
      bloom: o.bloom ?? this.bloomOn,
      outline: o.outline ?? this.outlineOn,
      fxaa: o.fxaa ?? this.fxaaOn,
      bloomScale: o.bloomScale ?? this.bloomScale,
    };
    if (o.enabled !== undefined) this.enabled = o.enabled;
    const changed = next.bloom !== this.bloomOn || next.outline !== this.outlineOn || next.fxaa !== this.fxaaOn;
    this.bloomOn = next.bloom;
    this.outlineOn = next.outline;
    this.fxaaOn = next.fxaa;
    if (next.bloomScale !== this.bloomScale) {
      this.bloomScale = next.bloomScale;
      this.bloomNode?.setResolutionScale(this.bloomScale);
    }
    if (changed) this.build();
  }

  /** Apply a quality tier: low turns post off; medium drops bloom resolution; outline needs medium+. */
  setQuality(tier: QualityTier, outlineWanted = this.outlineOn): void {
    if (tier === "low") this.configure({ enabled: false });
    else this.configure({ enabled: true, bloomScale: tier === "high" ? 0.5 : 0.33, outline: outlineWanted });
  }

  get stages(): { enabled: boolean; bloom: boolean; outline: boolean; fxaa: boolean } {
    return { enabled: this.enabled, bloom: this.bloomOn, outline: this.outlineOn, fxaa: this.fxaaOn };
  }

  /** Swap the art style's post stages (runtime/styles) and rebuild the graph. */
  setStyle(style: StylePost | null): void {
    this.style = style;
    this.build();
  }

  private build(): void {
    const scenePass = pass(this.scene, this.camera);
    this.style?.scenePass?.(scenePass);
    const sceneColor = scenePass.getTextureNode("output");
    const styleInput: StylePostInput = { color: sceneColor, depth: scenePass.getTextureNode("depth"), texel: this.texel, near: this.near, far: this.far };
    const color: Node<"vec4"> = this.style?.scene ? this.style.scene(styleInput) : sceneColor;
    let hdr: Node<"vec4"> = color;
    this.bloomNode = null;
    if (this.bloomOn) {
      const g = this.grade;
      const b = bloom(color, g.bloomStrength, g.bloomRadius, g.bloomThreshold);
      b.setResolutionScale(this.bloomScale);
      this.bloomNode = b;
      hdr = color.add(b);
    }
    let rgb = vec4(hdr).rgb;
    if (this.outlineOn) {
      const depth = scenePass.getTextureNode("depth");
      const viewZ = (dx: number, dy: number) =>
        perspectiveDepthToViewZ(depth.sample(screenUV.add(this.texel.mul(vec2(dx, dy)).mul(this.outlineThickness))).x, this.near, this.far);
      const c = viewZ(0, 0);
      const diff = abs(viewZ(1, 0).sub(c)).add(abs(viewZ(-1, 0).sub(c))).add(abs(viewZ(0, 1).sub(c))).add(abs(viewZ(0, -1).sub(c)));
      const rel = diff.div(max(abs(c), float(0.001)));
      const edge = smoothstep(this.outlineThreshold, this.outlineThreshold.mul(2.5), rel).mul(this.outlineStrength);
      rgb = mix(rgb, vec3(this.outlineColor as unknown as Node<"vec3">), edge);
    }
    if (this.style?.color) rgb = this.style.color(rgb, scenePass);
    // Grade in linear HDR, before tone mapping.
    let c = rgb.mul(this.exposure);
    const luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(luma), c, this.saturation);
    c = pow(max(c, vec3(1e-5)).div(0.18), vec3(this.contrast)).mul(0.18);
    const tone = smoothstep(0.0, 1.0, luma);
    c = c.mul(mix(this.shadowTint, this.highlightTint, tone));
    const d = length(screenUV.sub(0.5)).mul(1.414);
    const v = smoothstep(0.35, 1.05, d);
    c = c.mul(float(1).sub(v.mul(this.vignette)));
    const hurtEdge = smoothstep(0.45, 1.15, d).mul(this.hurt).mul(0.85);
    c = mix(c, c.mul(vec3(1.25, 0.35, 0.3)).add(vec3(0.22, 0.0, 0.0)), hurtEdge);
    let out: Node<"vec4"> = renderOutput(vec4(c, 1));
    if (this.style?.display) out = this.style.display(out, styleInput);
    this.pipeline.outputNode = this.fxaaOn ? fxaa(out) : out;
    this.pipeline.needsUpdate = true;
  }

  /** Call when the canvas size changes (CSS pixels times pixel ratio handled inside). */
  setSize(width: number, height: number): void {
    const pr = this.renderer.getPixelRatio();
    this.texel.value.set(1 / Math.max(1, width * pr), 1 / Math.max(1, height * pr));
  }

  /** Draw the frame: through the stack, or straight to the canvas when disabled. */
  render(): void {
    const cam = this.camera as Camera & { near?: number; far?: number };
    if (cam.near !== undefined) this.near.value = cam.near;
    if (cam.far !== undefined) this.far.value = cam.far;
    if (this.enabled) this.pipeline.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.pipeline.dispose();
  }
}
