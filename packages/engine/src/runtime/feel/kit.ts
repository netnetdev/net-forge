/**
 * FeelKit: the game-feel kit of game-runtime.md §13 behind one-liners a
 * template calls from game events:
 *
 *   const feel = new FeelKit({ camera: rig, particles, project, preset: "default" });
 *   const { now, dt } = feel.tick(performance.now());   // hit-stop aware render clock
 *   feel.hit({ id, x, y, z, amount, dirX, dirZ });       // flash, knockback, number, sound, a touch of shake
 *   feel.kill({ x, y, z, big });                          // burst, shake, hit-stop when big
 *   feel.hurt(12);                                        // shake, stop, rumble, `hurtPulse` for a vignette
 *   feel.update(dt);                                      // once per frame, after the events
 *
 * Nothing here needs three.js: the camera is any TraumaTarget (a CameraRig,
 * or the kit's own Trauma), particles any ParticleSink, and world to screen
 * an injected projector.
 */
import { FeelAudio, Footsteps } from "./audio.js";
import type { Surface } from "./audio.js";
import { FeelClock } from "./clock.js";
import type { ClockTick } from "./clock.js";
import { HitFlash } from "./flash.js";
import { KnockbackOffsets } from "./knockback.js";
import { DamageNumbers } from "./numbers.js";
import { Rumble } from "./rumble.js";
import { Trauma } from "./trauma.js";
import { Tweens } from "./tween.js";
import type { ParticleSink, Projector, TraumaTarget } from "./types.js";

/** Tunables for every one-liner. Pick a named preset or override fields. */
export interface FeelPreset {
  /** Trauma per hit, and the most hits may add in one frame (a nova through 50 enemies is one kick). */
  readonly hitTrauma: number;
  readonly hitTraumaPerFrame: number;
  readonly killTrauma: number;
  readonly bigKillTrauma: number;
  /** Hurt trauma at a hit of 10% max health; scales with damage up to 2x. */
  readonly hurtTrauma: number;
  readonly bigKillStopMs: number;
  readonly hurtStopMs: number;
  readonly levelUpStopMs: number;
  /** Visual knockback strength (m of offset) of a normal and a big hit. */
  readonly knockback: number;
  readonly bigKnockback: number;
  readonly flashSeconds: number;
  /** FOV punches, degrees (negative zooms in). */
  readonly bigKillPunch: number;
  readonly hurtPunch: number;
  readonly levelUpPunch: number;
  readonly dashPunch: number;
  readonly landTrauma: number;
  /** Rumble [strong, weak, ms]. */
  readonly hurtRumble: readonly [number, number, number];
  readonly bigKillRumble: readonly [number, number, number];
  readonly landRumble: readonly [number, number, number];
  /** Particle counts for kill bursts. */
  readonly killParticles: number;
  readonly bigKillParticles: number;
  /** Most damage numbers started per frame. */
  readonly numbersPerFrame: number;
}

export type FeelPresetName = "subtle" | "default" | "heavy";

export const FEEL_PRESETS: Readonly<Record<FeelPresetName, FeelPreset>> = {
  subtle: {
    hitTrauma: 0.01, hitTraumaPerFrame: 0.04, killTrauma: 0.015, bigKillTrauma: 0.3, hurtTrauma: 0.3,
    bigKillStopMs: 35, hurtStopMs: 20, levelUpStopMs: 30, knockback: 0.12, bigKnockback: 0.25, flashSeconds: 0.07,
    bigKillPunch: 1.5, hurtPunch: 1, levelUpPunch: -2, dashPunch: 1.5, landTrauma: 0.12,
    hurtRumble: [0.35, 0.2, 90], bigKillRumble: [0.4, 0.25, 120], landRumble: [0.15, 0.1, 60],
    killParticles: 5, bigKillParticles: 18, numbersPerFrame: 8,
  },
  default: {
    hitTrauma: 0.02, hitTraumaPerFrame: 0.08, killTrauma: 0.03, bigKillTrauma: 0.5, hurtTrauma: 0.45,
    bigKillStopMs: 55, hurtStopMs: 35, levelUpStopMs: 45, knockback: 0.2, bigKnockback: 0.4, flashSeconds: 0.09,
    bigKillPunch: 3, hurtPunch: 2, levelUpPunch: -4, dashPunch: 3, landTrauma: 0.2,
    hurtRumble: [0.6, 0.35, 120], bigKillRumble: [0.7, 0.4, 160], landRumble: [0.25, 0.15, 70],
    killParticles: 8, bigKillParticles: 28, numbersPerFrame: 12,
  },
  heavy: {
    hitTrauma: 0.035, hitTraumaPerFrame: 0.14, killTrauma: 0.05, bigKillTrauma: 0.75, hurtTrauma: 0.6,
    bigKillStopMs: 85, hurtStopMs: 55, levelUpStopMs: 70, knockback: 0.32, bigKnockback: 0.6, flashSeconds: 0.12,
    bigKillPunch: 5, hurtPunch: 3, levelUpPunch: -6, dashPunch: 4.5, landTrauma: 0.32,
    hurtRumble: [0.85, 0.5, 160], bigKillRumble: [1, 0.6, 220], landRumble: [0.4, 0.25, 90],
    killParticles: 12, bigKillParticles: 40, numbersPerFrame: 16,
  },
};

export interface HitEvent {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly amount: number;
  /** Entity id (flash, knockback and number merging key on it). */
  readonly id?: number;
  readonly big?: boolean;
  /** Direction the hit pushes, in the ground plane. */
  readonly dirX?: number;
  readonly dirZ?: number;
  /** Damage-number colour key. */
  readonly kind?: string;
}

export interface KillEvent {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly big?: boolean;
  readonly id?: number;
  /** Burst tint 0xRRGGBB. */
  readonly color?: number;
  /** Particle preset name. Default "kill" or "bigKill". */
  readonly particles?: string;
  readonly dirX?: number;
  readonly dirZ?: number;
}

export interface FeelKitOptions {
  readonly preset?: FeelPresetName | (Partial<FeelPreset> & { readonly base?: FeelPresetName });
  /** Where shake and punches go (a CameraRig). Default: the kit's own `trauma`, which a template applies itself. */
  readonly camera?: TraumaTarget;
  readonly particles?: ParticleSink | null;
  /** World to screen, for damage numbers and sound panning. */
  readonly project?: Projector;
  /** Screen width in px for panning (read each call). */
  readonly screenWidth?: () => number;
  /** Damage numbers: an existing pool, a host element to build one in, or null for none. Default: document.body in a browser. */
  readonly numbers?: DamageNumbers | HTMLElement | null;
  readonly audio?: FeelAudio | null;
  readonly rumble?: Rumble | null;
  readonly clock?: FeelClock;
}

const realNowMs = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class FeelKit {
  readonly preset: FeelPreset;
  readonly clock: FeelClock;
  readonly flash: HitFlash;
  readonly knock: KnockbackOffsets;
  /** The kit's own shake when no camera is given (apply trauma.x/y/roll yourself). */
  readonly trauma: Trauma;
  readonly tweens = new Tweens();
  readonly numbers: DamageNumbers | null;
  readonly audio: FeelAudio | null;
  readonly rumble: Rumble | null;
  readonly footsteps: Footsteps | null;
  particles: ParticleSink | null;
  /** 0..1, jumps to 1 on hurt and fades: drive a red vignette with it. */
  hurtPulse = 0;
  /** Effects fired so far (playtest counters). */
  readonly counts = { hits: 0, kills: 0, bigKills: 0, hurts: 0, levelUps: 0, lands: 0, dashes: 0 };
  /** Where shake and punches go. Assignable, so a template can build the kit before its camera. */
  camera: TraumaTarget;
  /** World to screen for numbers and panning. Assignable for the same reason. */
  project: Projector | undefined;
  private readonly width: () => number;
  private frameTrauma = 0;
  private frameNumbers = 0;
  private stepSpeed = 0;
  private stepGrounded = true;

  constructor(opts: FeelKitOptions = {}) {
    const p = opts.preset ?? "default";
    this.preset = typeof p === "string" ? FEEL_PRESETS[p] : { ...FEEL_PRESETS[p.base ?? "default"], ...p };
    this.clock = opts.clock ?? new FeelClock();
    this.flash = new HitFlash(this.preset.flashSeconds);
    this.knock = new KnockbackOffsets();
    this.trauma = new Trauma();
    this.camera = opts.camera ?? this.trauma;
    this.particles = opts.particles ?? null;
    this.project = opts.project;
    this.width = opts.screenWidth ?? (() => (typeof innerWidth !== "undefined" ? innerWidth : 0));
    const hasDom = typeof document !== "undefined";
    if (opts.numbers === null) this.numbers = null;
    else if (opts.numbers instanceof DamageNumbers) this.numbers = opts.numbers;
    else if (opts.numbers !== undefined) this.numbers = new DamageNumbers(opts.numbers);
    else this.numbers = hasDom && document.body ? new DamageNumbers(document.body) : null;
    this.audio = opts.audio === undefined ? new FeelAudio() : opts.audio;
    this.rumble = opts.rumble === undefined ? new Rumble() : opts.rumble;
    const audio = this.audio;
    this.footsteps = audio ? new Footsteps((pitch, gain) => void audio.play("step", { pitch, gain })) : null;
  }

  /** The render clock for this frame (hit-stop and slow motion aware). */
  tick(realNow: number = realNowMs()): ClockTick {
    return this.clock.tick(realNow);
  }

  private shake(amount: number): void {
    if (amount > 0) this.camera.addTrauma(amount);
  }
  private punch(deg: number): void {
    if (deg !== 0) this.camera.punch?.(deg);
  }
  private pan(x: number, y: number, z: number): { screenX?: number; width?: number } {
    if (!this.project) return {};
    const s = this.project(x, y, z);
    return { screenX: s.x, width: this.width() };
  }

  /** An enemy (or anything) took a hit. */
  hit(e: HitEvent): void {
    const P = this.preset;
    this.counts.hits++;
    if (e.id !== undefined) {
      this.flash.trigger(e.id);
      if (e.dirX !== undefined || e.dirZ !== undefined) this.knock.kick(e.id, e.dirX ?? 0, e.dirZ ?? 0, e.big ? P.bigKnockback : P.knockback);
    }
    if (this.numbers && this.project && this.frameNumbers < P.numbersPerFrame) {
      const s = this.project(e.x, e.y, e.z);
      if (s.onScreen) {
        this.frameNumbers++;
        this.numbers.add({ x: s.x, y: s.y, amount: e.amount, big: e.big === true, ...(e.id !== undefined ? { id: e.id } : {}), ...(e.kind ? { kind: e.kind } : {}) });
      }
    }
    this.audio?.impact(e.amount, this.pan(e.x, e.y, e.z));
    const room = P.hitTraumaPerFrame - this.frameTrauma;
    if (room > 0) {
      const t = Math.min(room, e.big ? P.hitTrauma * 3 : P.hitTrauma);
      this.frameTrauma += t;
      this.shake(t);
    }
  }

  /** Something died. Big kills (bosses, elites) stop time, punch the camera and rumble. */
  kill(e: KillEvent): void {
    const P = this.preset;
    this.counts.kills++;
    const big = e.big === true;
    this.particles?.burst(e.particles ?? (big ? "bigKill" : "kill"), e.x, e.y, e.z, {
      count: big ? P.bigKillParticles : P.killParticles,
      ...(e.color !== undefined ? { color: e.color } : {}),
      ...(e.dirX !== undefined ? { dirX: e.dirX } : {}),
      ...(e.dirZ !== undefined ? { dirZ: e.dirZ } : {}),
    });
    this.audio?.play(big ? "bigKill" : "kill", this.pan(e.x, e.y, e.z));
    if (!big) {
      const room = P.hitTraumaPerFrame - this.frameTrauma;
      if (room > 0) {
        const t = Math.min(room, P.killTrauma);
        this.frameTrauma += t;
        this.shake(t);
      }
      return;
    }
    this.counts.bigKills++;
    this.shake(P.bigKillTrauma);
    this.clock.hitStop(P.bigKillStopMs);
    this.punch(P.bigKillPunch);
    const [s, w, ms] = P.bigKillRumble;
    this.rumble?.pulse(s, w, ms);
  }

  /** The local player took `amount` damage (pass maxHealth to scale by how much it hurt). */
  hurt(amount: number, maxHealth = 100): void {
    if (!(amount > 0)) return;
    const P = this.preset;
    this.counts.hurts++;
    const k = Math.min(2, Math.max(0.5, amount / Math.max(1, maxHealth * 0.1)));
    this.shake(P.hurtTrauma * k);
    this.clock.hitStop(P.hurtStopMs);
    this.punch(P.hurtPunch);
    this.hurtPulse = 1;
    const [s, w, ms] = P.hurtRumble;
    this.rumble?.pulse(Math.min(1, s * k), Math.min(1, w * k), ms);
    this.audio?.play("hurt");
  }

  levelUp(): void {
    this.counts.levelUps++;
    this.clock.hitStop(this.preset.levelUpStopMs);
    this.punch(this.preset.levelUpPunch);
    this.audio?.play("levelUp");
  }

  /** Landed from a jump or fall; `intensity` 0..1 (fall speed over a hard landing's). */
  land(intensity = 1): void {
    const k = Math.max(0, Math.min(1, intensity));
    if (k <= 0.05) return;
    this.counts.lands++;
    this.shake(this.preset.landTrauma * k);
    const [s, w, ms] = this.preset.landRumble;
    this.rumble?.pulse(s * k, w * k, ms);
    this.audio?.play("land", { gain: 0.5 + 0.5 * k });
  }

  dash(): void {
    this.counts.dashes++;
    this.punch(this.preset.dashPunch);
    this.audio?.play("dash");
  }

  /** The local character's ground speed this frame (m/s); steps play at a cadence from it during `update`. */
  footstep(speed: number, grounded = true, surface?: Surface): void {
    this.stepSpeed = speed;
    this.stepGrounded = grounded;
    if (surface && this.footsteps) this.footsteps.surface = surface;
  }

  /** Advance every effect; call once per frame after the frame's events, with the clock's dt. */
  update(dt: number, realDt: number = dt): void {
    this.flash.update(dt);
    this.knock.update(dt);
    this.numbers?.update(dt);
    this.tweens.tick(realDt);
    if (this.camera === this.trauma) this.trauma.update(realDt);
    this.footsteps?.update(dt, this.stepSpeed, this.stepGrounded);
    this.hurtPulse = Math.max(0, this.hurtPulse - realDt * 2.5);
    this.frameTrauma = 0;
    this.frameNumbers = 0;
  }
}
