/**
 * Hit flash: per-entity timers that read as 0..1 intensity, for instanced
 * crowds that tint an instance toward white (or any colour) on a hit.
 */
export class HitFlash {
  private readonly t = new Map<number, number>();
  /** Flashes triggered so far (playtest counters). */
  count = 0;

  /** `seconds`: how long a full flash lasts. */
  constructor(public seconds = 0.09) {}

  /** Start (or refresh) a flash on `id`; `strength` 0..1 scales its length. */
  trigger(id: number, strength = 1): void {
    const s = Math.max(0, Math.min(1, strength)) * this.seconds;
    if (s <= 0) return;
    this.count++;
    this.t.set(id, Math.max(this.t.get(id) ?? 0, s));
  }

  /** 0..1 flash intensity of `id` now. */
  value(id: number): number {
    const v = this.t.get(id);
    return v === undefined || this.seconds <= 0 ? 0 : Math.min(1, v / this.seconds);
  }

  /** Advance every flash; expired entries are pruned. */
  update(dt: number): void {
    if (dt <= 0) return;
    for (const [id, v] of this.t) {
      const n = v - dt;
      if (n <= 0) this.t.delete(id);
      else this.t.set(id, n);
    }
  }

  /** Live flashes (for tests and budgets). */
  get size(): number {
    return this.t.size;
  }

  clear(): void {
    this.t.clear();
  }
}

/** Colour multiplier for a flash: 1 at rest, 1 + boost at full flash (instance colours above 1 read as glowing white). */
export const flashMultiplier = (flash: number, boost = 2.5): number => 1 + Math.max(0, Math.min(1, flash)) * boost;

/**
 * Write a flashed instance colour into `out` at `offset` (rgb floats):
 * base colour mixed toward `tint` and boosted by the flash.
 */
export function flashColor(
  out: Float32Array | number[],
  offset: number,
  flash: number,
  base: readonly [number, number, number] = [1, 1, 1],
  tint: readonly [number, number, number] = [1, 1, 1],
  boost = 2.5,
): void {
  const f = Math.max(0, Math.min(1, flash));
  const m = 1 + f * boost;
  for (let i = 0; i < 3; i++) {
    const b = base[i] ?? 1;
    out[offset + i] = (b + ((tint[i] ?? 1) - b) * f) * m;
  }
}
