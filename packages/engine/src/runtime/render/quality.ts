/**
 * Quality tiers and dynamic resolution (game-runtime.md §5: "auto-detected
 * low, medium or high (shadows, post-processing, resolution scale) with
 * dynamic resolution to hold the frame rate"). The decision logic is pure
 * so it is tested in node; `QualityManager` applies it to a renderer.
 */

export type QualityTier = "low" | "medium" | "high";
export const QUALITY_TIERS: readonly QualityTier[] = ["low", "medium", "high"];

/** What a tier turns on. */
export interface QualitySettings {
  readonly tier: QualityTier;
  /** Shadow map size in texels; 0 turns shadows off. */
  readonly shadowMapSize: number;
  /** Post-processing (bloom, grade, FXAA) on at all. */
  readonly post: boolean;
  /** Bloom render-target scale (fraction of the canvas). */
  readonly bloomScale: number;
  /** The toon outline pass may run (still opt-in per game). */
  readonly outline: boolean;
  /** Most device pixels per CSS pixel the tier renders. */
  readonly maxPixelRatio: number;
  /** Lowest pixel ratio dynamic resolution may drop to. */
  readonly minPixelRatio: number;
  /** GPU particle pool size. */
  readonly particles: number;
}

const SETTINGS: Record<QualityTier, QualitySettings> = {
  low: { tier: "low", shadowMapSize: 0, post: false, bloomScale: 0.25, outline: false, maxPixelRatio: 1.25, minPixelRatio: 0.6, particles: 1024 },
  medium: { tier: "medium", shadowMapSize: 1024, post: true, bloomScale: 0.33, outline: true, maxPixelRatio: 1.5, minPixelRatio: 0.75, particles: 2048 },
  high: { tier: "high", shadowMapSize: 2048, post: true, bloomScale: 0.5, outline: true, maxPixelRatio: 2, minPixelRatio: 0.75, particles: 4096 },
};

export function qualitySettings(tier: QualityTier): QualitySettings {
  return SETTINGS[tier];
}

/** What the browser tells us about the device. Every field optional: missing reads as "unknown". */
export interface DeviceHints {
  readonly userAgent?: string;
  /** `matchMedia("(pointer: coarse)").matches`. */
  readonly coarsePointer?: boolean;
  readonly hardwareConcurrency?: number;
  /** `navigator.deviceMemory` (GB), Chrome only. */
  readonly deviceMemory?: number;
  readonly devicePixelRatio?: number;
  readonly backend?: "webgpu" | "webgl2";
  /** Screen width in CSS pixels. */
  readonly screenWidth?: number;
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini/i;

/**
 * Pick a tier from device hints. Phones and tablets start at medium (low on
 * weak or WebGL-only ones); desktops start at high unless the CPU is small.
 * Dynamic resolution then holds the frame rate within the tier.
 */
export function detectTier(h: DeviceHints): QualityTier {
  const mobile = h.coarsePointer === true || MOBILE_UA.test(h.userAgent ?? "");
  const cores = h.hardwareConcurrency ?? 4;
  const mem = h.deviceMemory ?? 8;
  if (mobile) {
    if (cores <= 4 || mem <= 3 || h.backend === "webgl2") return "low";
    return "medium";
  }
  if (cores <= 2 || mem <= 2) return "low";
  if (cores <= 4 || h.backend === "webgl2") return "medium";
  return "high";
}

/** Read the hints from the running browser (safe in node: returns {}). */
export function browserHints(backend?: "webgpu" | "webgl2"): DeviceHints {
  const g = globalThis as {
    navigator?: { userAgent?: string; hardwareConcurrency?: number; deviceMemory?: number };
    devicePixelRatio?: number;
    matchMedia?: (q: string) => { matches: boolean };
    screen?: { width?: number };
  };
  return {
    ...(g.navigator?.userAgent !== undefined ? { userAgent: g.navigator.userAgent } : {}),
    ...(g.matchMedia ? { coarsePointer: g.matchMedia("(pointer: coarse)").matches } : {}),
    ...(g.navigator?.hardwareConcurrency !== undefined ? { hardwareConcurrency: g.navigator.hardwareConcurrency } : {}),
    ...(g.navigator?.deviceMemory !== undefined ? { deviceMemory: g.navigator.deviceMemory } : {}),
    ...(g.devicePixelRatio !== undefined ? { devicePixelRatio: g.devicePixelRatio } : {}),
    ...(g.screen?.width !== undefined ? { screenWidth: g.screen.width } : {}),
    ...(backend ? { backend } : {}),
  };
}

export interface DynamicResolutionOptions {
  /** Frame budget, ms. Default 1000 / 60. */
  readonly budgetMs?: number;
  /** Step down when p95 exceeds budget x this. Default 1.26 (21 ms at 60 fps). */
  readonly overFactor?: number;
  /** Step up when p95 is under budget x this. Default 1.05 (17.5 ms at 60 fps). */
  readonly underFactor?: number;
  readonly step?: number;
  readonly min?: number;
  readonly max?: number;
  /** Minimum ms between changes. Default 2000. */
  readonly hysteresisMs?: number;
  /** Frames needed in the window before deciding. Default 120. */
  readonly minSamples?: number;
  /** Rolling window size. Default 240 frames. */
  readonly window?: number;
}

/**
 * Pixel-ratio controller: trades pixels for frame time. Push every frame's
 * interval; `update(now)` returns the new ratio when it changes, else null.
 * After a change the window restarts so the next decision sees the new cost.
 */
export class DynamicResolution {
  private readonly buf: Float64Array;
  private i = 0;
  private n = 0;
  private lastChange = -Infinity;
  ratio: number;
  readonly o: Required<DynamicResolutionOptions>;

  constructor(initial: number, opts: DynamicResolutionOptions = {}) {
    this.o = {
      budgetMs: 1000 / 60,
      overFactor: 1.26,
      underFactor: 1.05,
      step: 0.25,
      min: 0.75,
      max: 2,
      hysteresisMs: 2000,
      minSamples: 120,
      window: 240,
      ...opts,
    };
    this.buf = new Float64Array(this.o.window);
    this.ratio = Math.min(this.o.max, Math.max(this.o.min, initial));
  }

  push(frameMs: number): void {
    this.buf[this.i] = frameMs;
    this.i = (this.i + 1) % this.buf.length;
    this.n = Math.min(this.n + 1, this.buf.length);
  }

  p95(): number {
    if (this.n === 0) return 0;
    const a = Array.from(this.buf.subarray(0, this.n)).sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.floor(0.95 * (a.length - 1)))] ?? 0;
  }

  /** Clamp the ratio range (a tier change). Returns the new ratio if it moved. */
  setRange(min: number, max: number): number | null {
    (this.o as { min: number }).min = min;
    (this.o as { max: number }).max = max;
    const next = Math.min(max, Math.max(min, this.ratio));
    if (next === this.ratio) return null;
    this.ratio = next;
    return next;
  }

  private lastCheck = -Infinity;

  update(now: number): number | null {
    if (this.n < this.o.minSamples || now - this.lastChange < this.o.hysteresisMs) return null;
    // The p95 sorts the whole window: look at it at most twice a second, not every frame.
    if (now - this.lastCheck < Math.min(500, this.o.hysteresisMs)) return null;
    this.lastCheck = now;
    const p95 = this.p95();
    let next = this.ratio;
    if (p95 > this.o.budgetMs * this.o.overFactor && this.ratio > this.o.min) next = Math.max(this.o.min, this.ratio - this.o.step);
    else if (p95 < this.o.budgetMs * this.o.underFactor && this.ratio < this.o.max) next = Math.min(this.o.max, this.ratio + this.o.step);
    if (next === this.ratio) return null;
    this.ratio = next;
    this.lastChange = now;
    this.n = 0;
    this.i = 0;
    return next;
  }
}

export interface QualityTarget {
  setPixelRatio(ratio: number): void;
}

/**
 * Holds the tier and the dynamic resolution for one renderer. Listeners
 * (lighting, post, particles) re-read `settings` on `onChange`.
 */
export class QualityManager {
  settings: QualitySettings;
  readonly dynamic: DynamicResolution;
  private readonly listeners: ((s: QualitySettings) => void)[] = [];
  private last = 0;

  constructor(
    private readonly target: QualityTarget,
    tier: QualityTier,
    opts: { devicePixelRatio?: number; dynamic?: boolean; budgetMs?: number } = {},
  ) {
    this.settings = qualitySettings(tier);
    const dpr = opts.devicePixelRatio ?? 1;
    const max = Math.min(dpr, this.settings.maxPixelRatio);
    this.dynamic = new DynamicResolution(max, {
      min: Math.min(max, this.settings.minPixelRatio),
      max,
      ...(opts.budgetMs !== undefined ? { budgetMs: opts.budgetMs } : {}),
    });
    this.enabled = opts.dynamic ?? true;
    this.dpr = dpr;
    target.setPixelRatio(this.dynamic.ratio);
  }

  /** Dynamic resolution on (default). */
  enabled: boolean;
  private readonly dpr: number;

  get tier(): QualityTier {
    return this.settings.tier;
  }

  get pixelRatio(): number {
    return this.dynamic.ratio;
  }

  onChange(fn: (s: QualitySettings) => void): void {
    this.listeners.push(fn);
  }

  setTier(tier: QualityTier): void {
    this.settings = qualitySettings(tier);
    const max = Math.min(this.dpr, this.settings.maxPixelRatio);
    const moved = this.dynamic.setRange(Math.min(max, this.settings.minPixelRatio), max);
    if (moved !== null) this.target.setPixelRatio(moved);
    for (const l of this.listeners) l(this.settings);
  }

  /** Call once per frame with the real time (ms). Returns true when the pixel ratio changed (resize needed). */
  frame(now: number): boolean {
    if (this.last !== 0) this.dynamic.push(now - this.last);
    this.last = now;
    if (!this.enabled) return false;
    const next = this.dynamic.update(now);
    if (next === null) return false;
    this.target.setPixelRatio(next);
    return true;
  }
}
