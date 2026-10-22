import type { StepperAdvance } from "./api.js";

/**
 * Fixed-timestep accumulator (Glenn Fiedler, "Fix Your Timestep!").
 * Pure: no timers, no clock. The client feeds it frame deltas from
 * requestAnimationFrame, the room server feeds it from its own loop, and
 * both run `step` exactly `ticks` times per advance.
 */
export class FixedStepper {
  readonly tickRate: number;
  readonly tickMs: number;
  /** Cap on ticks per advance; extra time is dropped (tab was hidden, GC pause). */
  readonly maxTicksPerAdvance: number;
  private accumulator = 0;

  constructor(tickRate: number, maxTicksPerAdvance = 8) {
    if (!(tickRate > 0 && tickRate <= 240)) throw new RangeError(`tickRate out of range: ${tickRate}`);
    this.tickRate = tickRate;
    this.tickMs = 1000 / tickRate;
    this.maxTicksPerAdvance = Math.max(1, Math.floor(maxTicksPerAdvance));
  }

  /** Add `elapsedMs` of wall time; returns how many ticks to run and the render alpha. */
  advance(elapsedMs: number): StepperAdvance {
    this.accumulator += Math.max(0, elapsedMs);
    let ticks = Math.floor(this.accumulator / this.tickMs);
    let dropped = 0;
    if (ticks > this.maxTicksPerAdvance) {
      dropped = ticks - this.maxTicksPerAdvance;
      ticks = this.maxTicksPerAdvance;
    }
    this.accumulator -= (ticks + dropped) * this.tickMs;
    return { ticks, alpha: this.accumulator / this.tickMs, dropped };
  }

  /** Forget accumulated time (e.g. after the tab becomes visible again). */
  reset(): void {
    this.accumulator = 0;
  }
}
