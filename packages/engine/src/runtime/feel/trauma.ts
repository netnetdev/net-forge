import { valueNoise1 } from "./noise.js";

export interface TraumaOptions {
  /** Trauma lost per second (1 = a full hit fades in one second). Default 1.4. */
  readonly decay?: number;
  /** shake = trauma ^ exponent. 2 or 3 reads best. Default 2. */
  readonly exponent?: number;
  /** Offset at full shake, in world units (m). Default 0.6. */
  readonly maxOffset?: number;
  /** Roll at full shake, radians. Default 0.04. */
  readonly maxRoll?: number;
  /** Noise frequency, Hz. Default 16. */
  readonly frequency?: number;
  /** Noise seed (same seed, same shake). Default 1. */
  readonly seed?: number;
}

/**
 * Trauma screen shake: hits add trauma 0..1, it decays linearly, and the
 * shake is trauma squared, so small hits barely move the camera and big
 * ones kick hard. Offsets come from smooth seeded noise, so the shake is
 * fluid rather than jittery and never uses Math.random.
 */
export class Trauma {
  /** Current trauma 0..1. */
  value = 0;
  /** This frame's offsets (m) and roll (rad); zero when calm. */
  x = 0;
  y = 0;
  roll = 0;
  /** Trauma adds so far (playtest counters). */
  adds = 0;
  private time = 0;
  private hold = 0;
  private readonly o: Required<TraumaOptions>;

  constructor(opts: TraumaOptions = {}) {
    this.o = { decay: 1.4, exponent: 2, maxOffset: 0.6, maxRoll: 0.04, frequency: 16, seed: 1, ...opts };
  }

  get options(): Readonly<Required<TraumaOptions>> {
    return this.o;
  }

  /** Add trauma (the total is clamped to 0..1). */
  add(amount: number): void {
    if (!(amount > 0)) return;
    this.adds++;
    this.value = Math.min(1, this.value + amount);
  }

  /** Same as `add`: lets a bare Trauma stand in for a CameraRig as a TraumaTarget. */
  addTrauma(amount: number): void {
    this.add(amount);
  }

  /** Keep the current trauma from decaying for `seconds` (the classic shake(amplitude, seconds) maps here). */
  sustain(seconds: number): void {
    this.hold = Math.max(this.hold, seconds);
  }

  /** The shake factor, trauma ^ exponent. */
  get shake(): number {
    return Math.pow(this.value, this.o.exponent);
  }

  update(dt: number): void {
    if (dt > 0) {
      this.time += dt;
      if (this.hold > 0) this.hold = Math.max(0, this.hold - dt);
      else this.value = Math.max(0, this.value - this.o.decay * dt);
    }
    const s = this.shake;
    if (s === 0) {
      this.x = this.y = this.roll = 0;
      return;
    }
    const t = this.time * this.o.frequency;
    const seed = this.o.seed;
    this.x = this.o.maxOffset * s * valueNoise1(t, seed);
    this.y = this.o.maxOffset * s * valueNoise1(t, seed + 101);
    this.roll = this.o.maxRoll * s * valueNoise1(t, seed + 202);
  }

  /** Back to calm. */
  reset(): void {
    this.value = 0;
    this.hold = 0;
    this.x = this.y = this.roll = 0;
  }

  /** Trauma that gives a shake of about `amplitude` world units. */
  traumaFor(amplitude: number): number {
    if (!(amplitude > 0)) return 0;
    return Math.min(1, Math.pow(amplitude / this.o.maxOffset, 1 / this.o.exponent));
  }
}
