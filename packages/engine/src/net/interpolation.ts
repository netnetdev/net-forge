// Interpolation of remote entities ~100 ms in the past, and the client's
// estimate of the server's clock that decides "the past".

import { dequantizeValues, interpolateField, type EntitySchema } from './schema.js';
import type { QEntity } from './snapshot.js';

export interface InterpolatedEntity {
  readonly id: number;
  readonly kind: number;
  readonly owner: number;
  readonly values: readonly number[];
}

/**
 * Tracks server time from snapshot arrivals. The offset (server ms minus
 * local ms) is taken from the freshest-looking arrival, eased toward later
 * samples so jitter does not make the render time jump.
 */
export class ServerClock {
  private offset: number | null = null;

  constructor(private readonly tickMs: number) {}

  observe(tick: number, localMs: number): void {
    const sample = tick * this.tickMs - localMs;
    if (this.offset === null || Math.abs(sample - this.offset) > 250) {
      this.offset = sample;
      return;
    }
    // Earlier-than-expected arrivals mean lower latency: move fast toward them.
    // Late ones are jitter: move slowly.
    const k = sample > this.offset ? 0.2 : 0.02;
    this.offset += (sample - this.offset) * k;
  }

  /** Estimated server tick (fractional) at local time. */
  serverTick(localMs: number): number {
    return this.offset === null ? 0 : (localMs + this.offset) / this.tickMs;
  }

  get ready(): boolean {
    return this.offset !== null;
  }
}

interface Frame {
  readonly tick: number;
  readonly entities: ReadonlyMap<number, QEntity>;
}

export class InterpolationBuffer {
  private readonly frames: Frame[] = [];

  constructor(
    private readonly schema: EntitySchema,
    private readonly capacity = 32,
  ) {}

  push(tick: number, entities: ReadonlyMap<number, QEntity>): void {
    const last = this.frames[this.frames.length - 1];
    if (last && tick <= last.tick) return;
    this.frames.push({ tick, entities });
    while (this.frames.length > this.capacity) this.frames.shift();
  }

  /**
   * Entities at a fractional render tick. Entities present only in the
   * newer frame pop in; ones only in the older frame are held until gone.
   * Past the newest frame we hold the newest state (no extrapolation).
   */
  sample(renderTick: number, exclude?: number): InterpolatedEntity[] {
    const n = this.frames.length;
    if (n === 0) return [];
    let i = n - 1;
    while (i > 0 && (this.frames[i]?.tick ?? 0) > renderTick) i--;
    const a = this.frames[i];
    const b = this.frames[i + 1];
    if (!a) return [];
    if (!b || renderTick <= a.tick) return this.frameValues(a, exclude);
    const t = (renderTick - a.tick) / (b.tick - a.tick);
    const out: InterpolatedEntity[] = [];
    for (const eb of b.entities.values()) {
      if (eb.id === exclude) continue;
      const ea = a.entities.get(eb.id);
      const vb = dequantizeValues(this.schema, eb.q);
      if (!ea) {
        out.push({ id: eb.id, kind: eb.kind, owner: eb.owner, values: vb });
        continue;
      }
      const va = dequantizeValues(this.schema, ea.q);
      const values = this.schema.fields.map((f, k) => interpolateField(f, va[k] ?? 0, vb[k] ?? 0, t));
      out.push({ id: eb.id, kind: eb.kind, owner: eb.owner, values });
    }
    return out;
  }

  get newestTick(): number {
    return this.frames[this.frames.length - 1]?.tick ?? 0;
  }

  private frameValues(f: Frame, exclude?: number): InterpolatedEntity[] {
    const out: InterpolatedEntity[] = [];
    for (const e of f.entities.values()) {
      if (e.id === exclude) continue;
      out.push({ id: e.id, kind: e.kind, owner: e.owner, values: dequantizeValues(this.schema, e.q) });
    }
    return out;
  }
}
