/**
 * Footstep and impact audio hooks: named cues with a
 * throttle, a voice limit, pitch and gain variation, stereo pan from the
 * screen and distance falloff. Every cue has a procedural synth recipe by
 * default (no audio files); `addBuffer` swaps in a real CC0 sample later
 * under the same name. WebAudio is created on the first user gesture.
 */
import { seededRandom } from "./noise.js";

export interface SynthRecipe {
  readonly wave: OscillatorType | "noise";
  /** Start and end frequency, Hz. */
  readonly f0: number;
  readonly f1: number;
  readonly ms: number;
  readonly gain: number;
}

export interface CueOptions {
  /** Least time between two plays of this cue, ms. Default 40. */
  readonly minGapMs?: number;
  /** Random pitch spread, as a fraction (0.08 = plus or minus 8%). Default 0.06. */
  readonly pitchVar?: number;
  /** Random gain spread, fraction. Default 0.1. */
  readonly gainVar?: number;
  /** Most voices of this cue at once. Default 4. */
  readonly voices?: number;
}

export interface PlayOptions {
  /** Pitch multiplier (on top of the random variation). */
  readonly pitch?: number;
  /** Gain multiplier. */
  readonly gain?: number;
  /** Stereo pan -1..1 (wins over screenX). */
  readonly pan?: number;
  /** Pan from a screen x position in pixels and the screen width. */
  readonly screenX?: number;
  readonly width?: number;
  /** Distance from the listener, m (inverse falloff past refDistance, silent past maxDistance). */
  readonly distance?: number;
}

/** The built-in cues every template can use by name. */
export const DEFAULT_CUES: Readonly<Record<string, SynthRecipe & CueOptions>> = {
  hit: { wave: "square", f0: 420, f1: 140, ms: 60, gain: 0.35, minGapMs: 45, voices: 3 },
  impact: { wave: "noise", f0: 900, f1: 200, ms: 90, gain: 0.5, minGapMs: 50, voices: 3 },
  kill: { wave: "triangle", f0: 900, f1: 300, ms: 70, gain: 0.4, minGapMs: 60, voices: 3 },
  bigKill: { wave: "sawtooth", f0: 160, f1: 40, ms: 260, gain: 0.8, minGapMs: 120, voices: 2 },
  hurt: { wave: "sawtooth", f0: 220, f1: 70, ms: 180, gain: 0.9, minGapMs: 120, voices: 1 },
  levelUp: { wave: "triangle", f0: 520, f1: 1040, ms: 260, gain: 0.8, minGapMs: 200, voices: 1, pitchVar: 0 },
  pick: { wave: "sine", f0: 660, f1: 990, ms: 90, gain: 0.6, minGapMs: 80, voices: 2 },
  coin: { wave: "sine", f0: 1320, f1: 1980, ms: 70, gain: 0.35, minGapMs: 35, voices: 3 },
  dash: { wave: "noise", f0: 2400, f1: 500, ms: 140, gain: 0.45, minGapMs: 100, voices: 1 },
  land: { wave: "noise", f0: 500, f1: 120, ms: 110, gain: 0.55, minGapMs: 120, voices: 1 },
  step: { wave: "noise", f0: 700, f1: 180, ms: 45, gain: 0.22, minGapMs: 90, voices: 2, pitchVar: 0.1 },
};

/**
 * The DOM-free decision core: may a cue start now? Per-cue gap and voice
 * cap, and a global voice cap.
 */
export class CueGate {
  private readonly last = new Map<string, number>();
  private readonly playing: { name: string; until: number }[] = [];

  constructor(public maxVoices = 16) {}

  allow(name: string, nowMs: number, durationMs: number, minGapMs: number, cueVoices: number): boolean {
    for (let i = this.playing.length - 1; i >= 0; i--) if ((this.playing[i]?.until ?? 0) <= nowMs) this.playing.splice(i, 1);
    const last = this.last.get(name);
    if (last !== undefined && nowMs - last < minGapMs) return false;
    if (this.playing.length >= this.maxVoices) return false;
    let mine = 0;
    for (const p of this.playing) if (p.name === name) mine++;
    if (mine >= cueVoices) return false;
    this.last.set(name, nowMs);
    this.playing.push({ name, until: nowMs + durationMs });
    return true;
  }

  get voices(): number {
    return this.playing.length;
  }
}

/** Gain for a source `distance` m away (inverse falloff, 0 past maxDistance). */
export function distanceGain(distance: number, refDistance = 6, maxDistance = 40, rolloff = 1): number {
  if (!(distance > refDistance)) return 1;
  if (distance >= maxDistance) return 0;
  return refDistance / (refDistance + rolloff * (distance - refDistance));
}

export interface FeelAudioOptions {
  /** Master gain 0..1. Default 0.18. */
  readonly master?: number;
  /** Most voices at once across all cues. Default 16. */
  readonly voices?: number;
  readonly refDistance?: number;
  readonly maxDistance?: number;
  /** Build the context (tests pass a fake). Default `new AudioContext()`. */
  readonly context?: () => AudioContext;
  /** Clock in ms (tests). Default performance.now. */
  readonly now?: () => number;
  /** Seed for pitch and gain variation. */
  readonly seed?: number;
}

interface Cue {
  recipe: SynthRecipe;
  buffer: AudioBuffer | null;
  minGapMs: number;
  pitchVar: number;
  gainVar: number;
  voices: number;
}

export class FeelAudio {
  muted = false;
  /** Cues actually started (playtest counters). */
  played = 0;
  readonly gate: CueGate;
  private ctx: AudioContext | null = null;
  private masterNode: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private masterGain: number;
  private readonly cues = new Map<string, Cue>();
  private readonly unlocked: ((ctx: AudioContext) => void)[] = [];
  private readonly rnd: () => number;
  private readonly o: { refDistance: number; maxDistance: number; context: (() => AudioContext) | undefined; now: () => number };

  constructor(opts: FeelAudioOptions = {}) {
    this.masterGain = opts.master ?? 0.18;
    this.gate = new CueGate(opts.voices ?? 16);
    this.rnd = seededRandom(opts.seed ?? 7);
    this.o = {
      refDistance: opts.refDistance ?? 6,
      maxDistance: opts.maxDistance ?? 40,
      context: opts.context,
      now: opts.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now())),
    };
    for (const [name, c] of Object.entries(DEFAULT_CUES)) this.define(name, c, c);
  }

  /** Start WebAudio (call from a user gesture; browsers block audio before one). Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => undefined);
      return;
    }
    try {
      const make = this.o.context ?? (typeof AudioContext !== "undefined" ? () => new AudioContext() : undefined);
      if (!make) return;
      this.ctx = make();
      this.masterNode = this.ctx.createGain();
      this.masterNode.gain.value = this.masterGain;
      this.masterNode.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
      this.masterNode = null;
      return;
    }
    const ctx = this.ctx;
    for (const fn of this.unlocked.splice(0)) fn(ctx);
  }

  /** Run `fn` with the AudioContext once audio is unlocked (now, if it already is). */
  whenUnlocked(fn: (ctx: AudioContext) => void): void {
    if (this.ctx) fn(this.ctx);
    else this.unlocked.push(fn);
  }

  /** The AudioContext, once unlocked (music and other buses hang off it). */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Unlock on the first pointer or key press on `target` (default window). */
  unlockOnGesture(target?: EventTarget): void {
    const t = target ?? (typeof window !== "undefined" ? window : undefined);
    if (!t) return;
    const go = () => this.unlock();
    t.addEventListener("pointerdown", go, { once: true });
    t.addEventListener("keydown", go, { once: true });
    t.addEventListener("touchstart", go, { once: true });
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  get master(): number {
    return this.masterGain;
  }
  set master(v: number) {
    this.masterGain = Math.max(0, Math.min(1, v));
    if (this.masterNode) this.masterNode.gain.value = this.masterGain;
  }

  /** Define or replace a cue's synth recipe and options. */
  define(name: string, recipe: SynthRecipe, opts: CueOptions = {}): void {
    const prev = this.cues.get(name);
    this.cues.set(name, {
      recipe,
      buffer: prev?.buffer ?? null,
      minGapMs: opts.minGapMs ?? prev?.minGapMs ?? 40,
      pitchVar: opts.pitchVar ?? prev?.pitchVar ?? 0.06,
      gainVar: opts.gainVar ?? prev?.gainVar ?? 0.1,
      voices: opts.voices ?? prev?.voices ?? 4,
    });
  }

  /**
   * Use a real sample for a cue (an AudioBuffer, or a URL fetched and decoded once audio is unlocked).
   * `opts.gain` is the sample's level before the master gain (default: the cue's synth level).
   */
  async addBuffer(name: string, source: AudioBuffer | string, opts: CueOptions & { readonly gain?: number } = {}): Promise<void> {
    let buffer: AudioBuffer;
    if (typeof source === "string") {
      if (!this.ctx) this.unlock();
      const ctx = this.ctx;
      if (!ctx || typeof fetch === "undefined") return;
      const data = await (await fetch(source)).arrayBuffer();
      buffer = await ctx.decodeAudioData(data);
    } else buffer = source;
    const prev = this.cues.get(name);
    const base: SynthRecipe = prev?.recipe ?? { wave: "sine", f0: 440, f1: 440, ms: buffer.duration * 1000, gain: 1 };
    const recipe: SynthRecipe = opts.gain !== undefined ? { ...base, gain: opts.gain } : base;
    this.define(name, recipe, opts);
    const cue = this.cues.get(name);
    if (cue) cue.buffer = buffer;
  }

  has(name: string): boolean {
    return this.cues.has(name);
  }

  /** Play a cue. Returns false when muted, locked, unknown, throttled or out of voices. */
  play(name: string, opts: PlayOptions = {}): boolean {
    const cue = this.cues.get(name);
    if (!cue || this.muted) return false;
    const ctx = this.ctx;
    const master = this.masterNode;
    if (!ctx || !master) return false;
    let gain = cue.recipe.gain * (opts.gain ?? 1) * (1 + (this.rnd() * 2 - 1) * cue.gainVar);
    if (opts.distance !== undefined) gain *= distanceGain(opts.distance, this.o.refDistance, this.o.maxDistance);
    if (gain <= 0.001) return false;
    const ms = cue.buffer ? cue.buffer.duration * 1000 : cue.recipe.ms;
    if (!this.gate.allow(name, this.o.now(), ms, cue.minGapMs, cue.voices)) return false;
    const pitch = (opts.pitch ?? 1) * (1 + (this.rnd() * 2 - 1) * cue.pitchVar);
    let pan = opts.pan;
    if (pan === undefined && opts.screenX !== undefined && opts.width !== undefined && opts.width > 0) pan = (opts.screenX / opts.width) * 2 - 1;
    try {
      this.voice(ctx, master, cue, gain, pitch, Math.max(-1, Math.min(1, pan ?? 0)));
    } catch {
      return false;
    }
    this.played++;
    return true;
  }

  /** An impact scaled by damage (bigger hits are louder and lower). */
  impact(damage: number, opts: PlayOptions = {}): boolean {
    const k = Math.min(1, Math.max(0, Math.log10(1 + Math.max(0, damage)) / 2));
    return this.play("impact", { ...opts, gain: (opts.gain ?? 1) * (0.5 + k * 0.7), pitch: (opts.pitch ?? 1) * (1.2 - k * 0.5) });
  }

  private voice(ctx: AudioContext, master: GainNode, cue: Cue, gain: number, pitch: number, pan: number): void {
    const t = ctx.currentTime;
    const g = ctx.createGain();
    let out: AudioNode = g;
    if (pan !== 0 && typeof ctx.createStereoPanner === "function") {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      out = p;
    }
    out.connect(master);
    if (cue.buffer) {
      const src = ctx.createBufferSource();
      src.buffer = cue.buffer;
      src.playbackRate.value = pitch;
      g.gain.setValueAtTime(gain, t);
      src.connect(g);
      src.start(t);
      return;
    }
    const r = cue.recipe;
    const dur = r.ms / 1000;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    if (r.wave === "noise") {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(ctx);
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 1.2;
      f.frequency.setValueAtTime(r.f0 * pitch, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(20, r.f1 * pitch), t + dur);
      src.connect(f).connect(g);
      src.start(t);
      src.stop(t + dur + 0.02);
      return;
    }
    const o = ctx.createOscillator();
    o.type = r.wave;
    o.frequency.setValueAtTime(r.f0 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, r.f1 * pitch), t + dur);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;
    const len = Math.floor(ctx.sampleRate * 0.5);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    const rnd = seededRandom(99);
    for (let i = 0; i < len; i++) d[i] = rnd() * 2 - 1;
    this.noise = b;
    return b;
  }
}

/** Surfaces change a footstep's pitch and weight. */
export const SURFACES = {
  grass: { pitch: 0.85, gain: 0.8 },
  dirt: { pitch: 0.9, gain: 0.9 },
  stone: { pitch: 1.25, gain: 1 },
  wood: { pitch: 1.05, gain: 1 },
  metal: { pitch: 1.6, gain: 1.1 },
} as const;
export type Surface = keyof typeof SURFACES;

export interface FootstepOptions {
  /** Metres per step. Default 1.4. */
  readonly stride?: number;
  /** Most steps per second. Default 6. */
  readonly maxRate?: number;
  /** Below this speed (m/s) no steps play. Default 0.6. */
  readonly minSpeed?: number;
}

/**
 * Footstep cadence from speed: steps per second = speed / stride, with an
 * alternating left/right pitch. Calls `play(pitch, gain)` on each step.
 */
export class Footsteps {
  surface: Surface = "dirt";
  steps = 0;
  private phase = 0;
  private left = false;
  private readonly o: Required<FootstepOptions>;

  constructor(private readonly play: (pitch: number, gain: number) => void, opts: FootstepOptions = {}) {
    this.o = { stride: 1.4, maxRate: 6, minSpeed: 0.6, ...opts };
  }

  /** Advance by `dt` seconds at `speed` m/s. Returns the number of steps played. */
  update(dt: number, speed: number, grounded = true): number {
    if (dt <= 0) return 0;
    if (!grounded || speed < this.o.minSpeed) {
      // Next step lands soon after moving again, not a full stride later.
      this.phase = Math.min(this.phase, 0.7);
      return 0;
    }
    const rate = Math.min(this.o.maxRate, speed / this.o.stride);
    this.phase += rate * dt;
    let n = 0;
    while (this.phase >= 1) {
      this.phase -= 1;
      this.left = !this.left;
      const s = SURFACES[this.surface];
      const weight = Math.min(1.2, 0.6 + speed / 12);
      this.play(s.pitch * (this.left ? 1 : 0.92), s.gain * weight);
      this.steps++;
      n++;
    }
    return n;
  }
}
