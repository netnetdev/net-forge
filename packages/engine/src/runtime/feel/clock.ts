/**
 * The render clock: hit-stop and slow motion for the DRAWN world only.
 * The netcode never pauses; the clock returns a render time `now` that
 * runs behind real time while frozen or slowed, then catches up smoothly so
 * the world never jumps. `now` never runs ahead of real time.
 */
export interface FeelClockOptions {
  /** Milliseconds over which accumulated lag eases back to zero. Default 200. */
  readonly catchUpMs?: number;
  /** Most the drawn world may fall behind (keeps interpolation buffers valid). Default 400. */
  readonly maxLagMs?: number;
  /** Clamp on one frame's real delta (tab switches). Default 100. */
  readonly maxFrameMs?: number;
}

export interface ClockTick {
  /** Time to draw the world at (ms, same base as `realNow`). */
  readonly now: number;
  /** Scaled frame delta in seconds (0 while frozen). */
  readonly dt: number;
  /** Unscaled frame delta in seconds (UI, shake and audio run on this). */
  readonly realDt: number;
  /** The time scale this frame (0 frozen, below 1 slowed, above 1 catching up). */
  readonly timeScale: number;
}

const nowMs = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class FeelClock {
  /** Hit-stops requested so far (playtest counters). */
  stops = 0;
  /** Slow-motion requests so far. */
  slows = 0;
  private frozenUntil = 0;
  private lag = 0;
  private lastReal = 0;
  private slowScale = 1;
  private slowUntil = 0;
  private slowEaseMs = 0;
  private readonly o: Required<FeelClockOptions>;

  constructor(opts: FeelClockOptions = {}) {
    this.o = { catchUpMs: 200, maxLagMs: 400, maxFrameMs: 100, ...opts };
  }

  /** Freeze the drawn world for `ms`. Longer stops win; they do not stack. */
  hitStop(ms: number, realNow: number = this.lastReal || nowMs()): void {
    if (!(ms > 0)) return;
    this.stops++;
    this.frozenUntil = Math.max(this.frozenUntil, realNow + ms);
  }

  /** Slow the drawn world to `scale` (0..1) for `ms`, then ease back to full speed over `easeMs`. */
  slowMo(scale: number, ms: number, easeMs = 200, realNow: number = this.lastReal || nowMs()): void {
    if (!(ms > 0)) return;
    this.slows++;
    const s = Math.min(1, Math.max(0.01, scale));
    // The deeper slow wins while both are active.
    if (realNow < this.slowUntil + this.slowEaseMs) this.slowScale = Math.min(this.slowScale, s);
    else this.slowScale = s;
    this.slowUntil = Math.max(this.slowUntil, realNow + ms);
    this.slowEaseMs = Math.max(0, easeMs);
  }

  /** Current slow-motion scale (1 when none). */
  private slowAt(realNow: number): number {
    if (realNow < this.slowUntil) return this.slowScale;
    if (this.slowEaseMs > 0 && realNow < this.slowUntil + this.slowEaseMs) {
      const t = (realNow - this.slowUntil) / this.slowEaseMs;
      const e = t * t * (3 - 2 * t);
      return this.slowScale + (1 - this.slowScale) * e;
    }
    return 1;
  }

  /** Advance with the frame's real time. */
  tick(realNow: number = nowMs()): ClockTick {
    const realDt = this.lastReal === 0 ? 1000 / 60 : Math.max(0, Math.min(this.o.maxFrameMs, realNow - this.lastReal));
    this.lastReal = realNow;
    if (realNow < this.frozenUntil) {
      this.lag = Math.min(this.o.maxLagMs, this.lag + realDt);
      return { now: realNow - this.lag, dt: 0, realDt: realDt / 1000, timeScale: 0 };
    }
    const scale = this.slowAt(realNow);
    if (scale < 1) {
      const lagged = Math.min(this.o.maxLagMs, this.lag + realDt * (1 - scale));
      const drawn = realDt - (lagged - this.lag);
      this.lag = lagged;
      return { now: realNow - this.lag, dt: drawn / 1000, realDt: realDt / 1000, timeScale: realDt > 0 ? drawn / realDt : 1 };
    }
    // Catch up over ~catchUpMs so the world never jumps.
    const catchUp = Math.min(this.lag, this.lag * Math.min(1, realDt / this.o.catchUpMs) + 0.5);
    this.lag = Math.max(0, this.lag - catchUp);
    const drawn = realDt + catchUp;
    return { now: realNow - this.lag, dt: drawn / 1000, realDt: realDt / 1000, timeScale: realDt > 0 ? drawn / realDt : 1 };
  }

  /** True while a hit-stop holds the drawn world. */
  get stopped(): boolean {
    return this.lastReal < this.frozenUntil;
  }

  /** Milliseconds the drawn world is behind real time. */
  get lagMs(): number {
    return this.lag;
  }
}

/** The name templates already use (template-survivor's RenderClock): same class. */
export { FeelClock as RenderClock };
