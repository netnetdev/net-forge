import type { Camera, Scene } from "three/webgpu";
import type { RendererHandle } from "../renderer.js";
import { Atmosphere } from "./atmosphere.js";
import { GroundDecals, GroundRings } from "./decals.js";
import { LightingRig } from "./lighting.js";
import { GpuParticles } from "./particles.js";
import { PostFX } from "./post.js";
import type { GradePreset, LightingPreset, AtmospherePreset, LookPreset } from "./presets.js";
import { browserHints, detectTier, QualityManager } from "./quality.js";
import type { QualityTier } from "./quality.js";
import { styleKit } from "../styles/index.js";
import type { StyleKit, StyleSession } from "../styles/kit.js";

export interface RenderStackOptions {
  /** Look preset: lighting, fog, sky and grade together. Default "night". */
  readonly preset?: LookPreset;
  /** The game's art style (game({ style }), or a template's ?style=). Its kit (runtime/styles) brings its look, post stages and session; low-poly and unknown names draw the stack's own picture. */
  readonly style?: string;
  /** "auto" detects from the device. Default "auto". */
  readonly quality?: QualityTier | "auto";
  readonly bloom?: boolean;
  /** Toon outline (medium and high tiers only). Default false. */
  readonly outline?: boolean;
  /** Dynamic resolution (default true). */
  readonly dynamicResolution?: boolean;
  /** Half-size of the shadowed square around the focus, m. Default 26. */
  readonly shadowExtent?: number;
  readonly lighting?: Partial<LightingPreset>;
  readonly atmosphere?: Partial<AtmospherePreset>;
  readonly grade?: Partial<GradePreset>;
  /** GPU particle slots (default from the tier). */
  readonly particles?: number;
  /** Build the particle system (an art style swaps in its own, e.g. the voxel style's cubes). Default GpuParticles. */
  readonly makeParticles?: (scene: Scene, capacity: number) => GpuParticles;
  readonly decals?: number;
  /** Library id to URL, for an art style's own textures (the template's LibraryClient.url). */
  readonly resolve?: (id: string) => string | null;
}

export interface RenderStack {
  readonly lighting: LightingRig;
  readonly atmosphere: Atmosphere;
  readonly post: PostFX;
  readonly particles: GpuParticles;
  readonly decals: GroundDecals;
  readonly rings: GroundRings;
  readonly quality: QualityManager;
  /** The art style drawing the frame (its kit is registered in runtime/styles), or null for the runtime's own low-poly look. */
  readonly style: string | null;
  /** That style's kit (world builders for the template), or null. */
  readonly kit: StyleKit | null;
  /** The style attached to this renderer (its surfaces, its state), or null. */
  readonly session: StyleSession | null;
  /** Seconds of render time accumulated by `frame` (drives particles and decals). */
  readonly time: number;
  /**
   * Per frame: advance effect time by `dt` (already hit-stop scaled), move
   * the shadow to the focus, step dynamic resolution, draw. Returns true
   * when the pixel ratio changed (call your resize).
   */
  frame(dt: number, focus: { x: number; y: number; z: number }, realNowMs?: number): boolean;
  resize(width: number, height: number): void;
  setPreset(preset: LookPreset): void;
  setQuality(tier: QualityTier): void;
  dispose(): void;
}

/**
 * Everything a template needs for a good-looking frame, in one call:
 * lighting with a following shadow, fog and sky, bloom and grade, GPU
 * particles, decals and shockwave rings, quality tiers and dynamic
 * resolution. Replace `renderer.render(scene, camera)` with `stack.frame(...)`.
 */
export function createRenderStack(handle: RendererHandle, scene: Scene, camera: Camera, opts: RenderStackOptions = {}): RenderStack {
  const { renderer } = handle;
  const preset = opts.preset ?? "night";
  const tier: QualityTier = opts.quality === undefined || opts.quality === "auto" ? detectTier(browserHints(handle.backend)) : opts.quality;
  const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
  const quality = new QualityManager(renderer, tier, { devicePixelRatio: dpr, dynamic: opts.dynamicResolution ?? true });
  const s = quality.settings;
  // The art style: the one place the stack looks a style up. Its look and stack overrides sit under the template's own options.
  const kit = styleKit(opts.style);
  const overrides = (p: LookPreset) => {
    const look = kit?.look?.(p);
    const st = kit?.stack?.(p);
    const merge = <T extends object>(a: T | undefined, b: Partial<T> | undefined, c: Partial<T> | undefined): Partial<T> | undefined =>
      a || b || c ? { ...a, ...b, ...c } : undefined;
    return {
      lighting: merge(look?.lighting, st?.lighting, opts.lighting),
      atmosphere: merge(look?.atmosphere, st?.atmosphere, opts.atmosphere),
      grade: merge(look?.grade, st?.grade, opts.grade),
    };
  };
  const o = overrides(preset);
  const lighting = new LightingRig(renderer, scene, {
    preset,
    shadowMapSize: s.shadowMapSize,
    ...(o.lighting ? { overrides: o.lighting } : {}),
    ...(opts.shadowExtent !== undefined ? { shadowExtent: opts.shadowExtent } : {}),
  });
  const atmosphere = new Atmosphere(scene, { preset, ...(o.atmosphere ? { overrides: o.atmosphere } : {}) });
  const outlineWanted = (opts.outline ?? false) && kit?.outline !== false;
  // A style whose look lives in post keeps post on at the low tier, without bloom.
  const styledLow = (postOn: boolean) => kit?.needsPost === true && !postOn;
  const bloomWanted = opts.bloom ?? kit?.bloom ?? true;
  const post = new PostFX(renderer, scene, camera, {
    preset,
    bloom: bloomWanted && !styledLow(s.post),
    outline: outlineWanted && s.outline,
    enabled: s.post || styledLow(s.post),
    bloomScale: s.bloomScale,
    ...(o.grade ? { overrides: o.grade } : {}),
  });
  const session = kit?.attach?.({ handle, renderer, scene, camera, tier, preset, post, atmosphere, ...(opts.resolve ? { resolve: opts.resolve } : {}) }) ?? null;
  if (session?.post) post.setStyle(session.post);
  const particleCap = opts.particles ?? s.particles;
  const makeParticles = opts.makeParticles ?? kit?.stack?.(preset).makeParticles;
  const particles = makeParticles
    ? makeParticles(scene, particleCap)
    : new GpuParticles(scene, { capacity: particleCap, ...(session?.particles ? { look: session.particles } : {}) });
  const decals = new GroundDecals(scene, opts.decals ?? 256, Math.random, session?.decals);
  const rings = new GroundRings(scene, 32, session?.rings);
  quality.onChange((q) => {
    lighting.setShadowMapSize(q.shadowMapSize);
    post.setQuality(q.tier, outlineWanted && q.outline);
    if (kit?.needsPost) post.configure(styledLow(q.post) ? { enabled: true, bloom: false } : { bloom: bloomWanted });
    session?.setQuality?.(q.tier);
  });
  let time = 0;
  let w = 1;
  let h = 1;
  const stack: RenderStack = {
    lighting,
    atmosphere,
    post,
    particles,
    decals,
    rings,
    quality,
    style: kit?.id ?? null,
    kit,
    session,
    get time() {
      return time;
    },
    frame(dt, focus, realNowMs) {
      time += Math.max(0, dt);
      session?.frame?.((realNowMs ?? performance.now()) / 1000);
      lighting.follow(focus.x, focus.y, focus.z);
      particles.update(time);
      decals.update(time);
      rings.update(time);
      if (session?.render) session.render(() => post.render());
      else post.render();
      const changed = quality.frame(realNowMs ?? performance.now());
      if (changed) stack.resize(w, h);
      return changed;
    },
    resize(width, height) {
      w = Math.max(1, width);
      h = Math.max(1, height);
      renderer.setSize(w, h, false);
      post.setSize(w, h);
      const pr = renderer.getPixelRatio();
      session?.setSize?.(w * pr, h * pr);
    },
    setPreset(p) {
      const n = overrides(p);
      lighting.setPreset(p, n.lighting);
      atmosphere.setPreset(p, n.atmosphere);
      post.setPreset(p, n.grade);
      session?.setPreset?.(p);
    },
    setQuality(t) {
      quality.setTier(t);
    },
    dispose() {
      session?.dispose();
      particles.dispose();
      decals.dispose();
      rings.dispose();
      post.dispose();
      atmosphere.dispose();
      lighting.dispose();
    },
  };
  return stack;
}
