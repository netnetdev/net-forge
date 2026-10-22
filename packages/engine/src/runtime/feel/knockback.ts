import { stepSpring } from "./spring.js";

/**
 * Client-side visual knockback and squash per entity. The authoritative
 * sim moves the entity; this adds a springy offset and a squash-stretch on
 * top of the interpolated position, so a hit reads instantly even ~100 ms
 * in the past. Read `get(id)` each frame and add it when drawing.
 */
export interface KnockbackOptions {
  /** Offset spring frequency, Hz. Default 7. */
  readonly frequency?: number;
  /** Offset damping ratio (below 1 wobbles back). Default 0.5. */
  readonly damping?: number;
  /** Largest offset, m. Default 0.6. */
  readonly maxOffset?: number;
  /** Squash per unit of strength (0 disables). Default 0.35. */
  readonly squash?: number;
}

export interface KnockbackSample {
  /** Offset to add to the drawn position, m. */
  x: number;
  z: number;
  /** Scale to multiply the drawn scale by (squash on y, bulge on x and z). */
  sx: number;
  sy: number;
  sz: number;
}

interface Entry {
  x: number;
  z: number;
  vx: number;
  vz: number;
  s: number;
  vs: number;
}

const REST: Readonly<KnockbackSample> = Object.freeze({ x: 0, z: 0, sx: 1, sy: 1, sz: 1 });

export class KnockbackOffsets {
  private readonly m = new Map<number, Entry>();
  private readonly out: KnockbackSample = { x: 0, z: 0, sx: 1, sy: 1, sz: 1 };
  private readonly o: Required<KnockbackOptions>;
  /** Kicks so far (playtest counters). */
  kicks = 0;

  constructor(opts: KnockbackOptions = {}) {
    this.o = { frequency: 7, damping: 0.5, maxOffset: 0.6, squash: 0.35, ...opts };
  }

  /** Shove `id` along (dirX, dirZ) with `strength` (about metres of peak offset). */
  kick(id: number, dirX: number, dirZ: number, strength = 1): void {
    if (!(strength > 0)) return;
    const len = Math.hypot(dirX, dirZ);
    const nx = len > 1e-6 ? dirX / len : 0;
    const nz = len > 1e-6 ? dirZ / len : 0;
    let e = this.m.get(id);
    if (!e) {
      e = { x: 0, z: 0, vx: 0, vz: 0, s: 0, vs: 0 };
      this.m.set(id, e);
    }
    this.kicks++;
    // A peak offset of about `strength` for this spring: v0 = strength * omega (scaled for damping).
    const v = strength * this.o.frequency * Math.PI * 2 * 0.6;
    e.vx += nx * v;
    e.vz += nz * v;
    e.vs += this.o.squash * strength * 30;
  }

  /** This frame's offset and scale for `id` (a shared object: read it before the next call). */
  get(id: number): Readonly<KnockbackSample> {
    const e = this.m.get(id);
    if (!e) return REST;
    const o = this.out;
    o.x = e.x;
    o.z = e.z;
    const s = Math.max(-0.5, Math.min(0.5, e.s));
    o.sy = 1 - s;
    o.sx = o.sz = 1 + s * 0.5;
    return o;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const w = this.o.frequency * Math.PI * 2;
    const z = this.o.damping;
    const max = this.o.maxOffset;
    for (const [id, e] of this.m) {
      [e.x, e.vx] = stepSpring(e.x, e.vx, 0, w, z, dt);
      [e.z, e.vz] = stepSpring(e.z, e.vz, 0, w, z, dt);
      [e.s, e.vs] = stepSpring(e.s, e.vs, 0, w * 1.6, 0.35, dt);
      const len = Math.hypot(e.x, e.z);
      if (len > max) {
        e.x *= max / len;
        e.z *= max / len;
      }
      if (Math.abs(e.x) + Math.abs(e.z) + Math.abs(e.s) < 1e-3 && Math.abs(e.vx) + Math.abs(e.vz) + Math.abs(e.vs) < 1e-2) this.m.delete(id);
    }
  }

  /** Entities still moving. */
  get size(): number {
    return this.m.size;
  }

  clear(): void {
    this.m.clear();
  }
}
