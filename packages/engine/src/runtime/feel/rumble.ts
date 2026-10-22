/**
 * Controller rumble (Gamepad API dual-rumble) with a phone vibration
 * fallback, rate-limited so a swarm of hits is one buzz, not fifty.
 */
export interface RumbleActuator {
  playEffect?(type: string, params: { duration: number; strongMagnitude: number; weakMagnitude: number; startDelay?: number }): Promise<unknown>;
}
export interface GamepadLike {
  readonly connected?: boolean;
  readonly vibrationActuator?: RumbleActuator | null;
}
export interface NavigatorLike {
  getGamepads?(): readonly (GamepadLike | null)[];
  vibrate?(pattern: number | number[]): boolean;
}

export interface RumbleOptions {
  /** Least ms between pulses (a stronger pulse may still cut in). Default 70. */
  readonly minGapMs?: number;
  /** Use navigator.vibrate when no pad rumbles (phones). Default true. */
  readonly vibrateFallback?: boolean;
  readonly navigator?: NavigatorLike;
  readonly now?: () => number;
}

export class Rumble {
  enabled = true;
  /** Pulses sent (playtest counters). */
  pulses = 0;
  private last = -Infinity;
  private lastStrength = 0;
  private lastUntil = 0;
  private readonly o: { minGapMs: number; vibrateFallback: boolean; nav: () => NavigatorLike | undefined; now: () => number };

  constructor(opts: RumbleOptions = {}) {
    this.o = {
      minGapMs: opts.minGapMs ?? 70,
      vibrateFallback: opts.vibrateFallback ?? true,
      nav: () => opts.navigator ?? (typeof navigator !== "undefined" ? (navigator as unknown as NavigatorLike) : undefined),
      now: opts.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now())),
    };
  }

  /** Rumble connected pads: `strong` and `weak` motors 0..1 for `ms`. Returns whether anything was sent. */
  pulse(strong: number, weak = strong * 0.6, ms = 120): boolean {
    if (!this.enabled) return false;
    const s = Math.max(0, Math.min(1, strong));
    const w = Math.max(0, Math.min(1, weak));
    if (s === 0 && w === 0) return false;
    const now = this.o.now();
    const busy = now < this.lastUntil;
    const strength = Math.max(s, w);
    // Rate limit, unless this one is clearly stronger than the one playing.
    if (now - this.last < this.o.minGapMs && !(busy && strength > this.lastStrength * 1.5)) return false;
    const nav = this.o.nav();
    if (!nav) return false;
    let sent = false;
    try {
      for (const pad of nav.getGamepads?.() ?? []) {
        const act = pad?.vibrationActuator;
        if (!pad || pad.connected === false || !act?.playEffect) continue;
        void act.playEffect("dual-rumble", { duration: ms, strongMagnitude: s, weakMagnitude: w, startDelay: 0 }).catch(() => undefined);
        sent = true;
      }
      if (!sent && this.o.vibrateFallback && typeof nav.vibrate === "function" && strength >= 0.25) {
        sent = nav.vibrate(Math.round(ms * Math.min(1, strength + 0.2))) !== false;
      }
    } catch {
      return false;
    }
    if (sent) {
      this.pulses++;
      this.last = now;
      this.lastStrength = strength;
      this.lastUntil = now + ms;
    }
    return sent;
  }
}
