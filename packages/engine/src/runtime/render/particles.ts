import {
  AdditiveBlending,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  NormalBlending,
  PlaneGeometry,
} from "three/webgpu";
import type { Node, Object3D, UniformNode } from "three/webgpu";
import {
  cameraProjectionMatrix,
  clamp,
  exp,
  float,
  hash,
  instanceIndex,
  instancedBufferAttribute,
  length,
  max,
  mix,
  modelViewMatrix,
  normalize,
  positionGeometry,
  pow,
  smoothstep,
  step,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

import type { ParticleBurstOptions as FeelBurstOptions, ParticleSink } from "../feel/types.js";

export type { ParticleSink };

/** The feel kit's burst options plus the renderer's extras (all optional). */
export interface ParticleBurstOptions extends FeelBurstOptions {
  readonly dirY?: number;
  /** Mean speed, m/s. */
  readonly speed?: number;
  /** Cone spread 0..1 (1 = sphere). */
  readonly spread?: number;
  /** Birth size, m (overrides `scale`). */
  readonly size?: number;
}

/** What a particle look (an art style's) reads, per fragment. */
export interface ParticleShadeInput {
  /** Age over life, 0..1. */
  readonly t: Node<"float">;
  /** Quad uv, 0..1 (v runs along the velocity stretch). */
  readonly uv: Node<"vec2">;
  /** The burst colour (linear; the additive pool carries a bloom boost of 2.2). */
  readonly color: Node<"vec3">;
  /** A stable 0..1 per particle. */
  readonly seed: Node<"float">;
  /** The pool: "add" (sparks, bursts, embers, magic) or "alpha" (smoke, dust). */
  readonly blend: "add" | "alpha";
}

export interface ParticleShadeOutput {
  readonly color: Node<"vec3">;
  readonly opacity: Node<"float">;
  /** Blend the pool this way instead of its own ("alpha" draws flat, opaque shapes). */
  readonly blend?: "add" | "alpha";
}

/**
 * A particle look: every particle's shape and colour, plus an optional
 * size curve over its life (a pop, a shrink). The default is soft round
 * glows; an art style brings its own (the toon style draws stars, streaks
 * and puffs).
 */
export interface ParticleShade {
  shade(p: ParticleShadeInput): ParticleShadeOutput;
  /** Size multiplier over life (vertex stage). */
  size?(t: Node<"float">, seed: Node<"float">, blend: "add" | "alpha"): Node<"float">;
}

export type ParticlePresetName = "sparks" | "burst" | "embers" | "smoke" | "hitSpark" | "dust" | "magic" | "kill" | "bigKill";

export interface ParticlePreset {
  readonly blend: "add" | "alpha";
  readonly count: number;
  /** Speed range, m/s. */
  readonly speed: readonly [number, number];
  /** Cone half-angle around the direction, 0..1 (1 = full sphere). */
  readonly spread: number;
  /** Default direction (unit-ish); the sphere when spread is 1. */
  readonly dir: readonly [number, number, number];
  /** Lifetime range, s. */
  readonly life: readonly [number, number];
  /** Billboard size at birth and death, m. */
  readonly size: readonly [number, number];
  /** Gravity, m/s^2 (negative floats up). */
  readonly gravity: number;
  /** Linear drag, 1/s. */
  readonly drag: number;
  readonly color: number;
  /** Stretch along velocity (0 = round dot). */
  readonly stretch: number;
  /** Spawn position jitter radius, m. */
  readonly jitter: number;
}

export const PARTICLE_PRESETS: Readonly<Record<ParticlePresetName, ParticlePreset>> = {
  sparks: { blend: "add", count: 14, speed: [5, 11], spread: 0.55, dir: [0, 1, 0], life: [0.25, 0.5], size: [0.12, 0.02], gravity: 14, drag: 2, color: 0xffc070, stretch: 1.6, jitter: 0.05 },
  burst: { blend: "add", count: 18, speed: [2, 6], spread: 1, dir: [0, 1, 0], life: [0.35, 0.7], size: [0.26, 0.04], gravity: 9, drag: 2.5, color: 0xb59cff, stretch: 0.4, jitter: 0.15 },
  embers: { blend: "add", count: 6, speed: [0.3, 1.2], spread: 0.35, dir: [0, 1, 0], life: [1.2, 2.4], size: [0.1, 0.0], gravity: -0.8, drag: 0.6, color: 0xff9a3c, stretch: 0, jitter: 0.4 },
  smoke: { blend: "alpha", count: 6, speed: [0.4, 1.4], spread: 0.6, dir: [0, 1, 0], life: [0.8, 1.5], size: [0.5, 1.6], gravity: -1.2, drag: 1.5, color: 0x3a3a44, stretch: 0, jitter: 0.25 },
  hitSpark: { blend: "add", count: 8, speed: [6, 12], spread: 0.35, dir: [0, 0.3, 1], life: [0.1, 0.22], size: [0.14, 0.03], gravity: 6, drag: 5, color: 0xfff0c0, stretch: 2.4, jitter: 0.02 },
  dust: { blend: "alpha", count: 8, speed: [0.6, 2], spread: 0.25, dir: [0, 0.15, 0], life: [0.4, 0.8], size: [0.25, 0.7], gravity: 1, drag: 3, color: 0x6b6458, stretch: 0, jitter: 0.2 },
  kill: { blend: "add", count: 10, speed: [2.5, 6], spread: 0.8, dir: [0, 1, 0], life: [0.35, 0.65], size: [0.22, 0.03], gravity: 12, drag: 2, color: 0xb59cff, stretch: 0.6, jitter: 0.15 },
  bigKill: { blend: "add", count: 34, speed: [3, 9], spread: 1, dir: [0, 1, 0], life: [0.5, 1.0], size: [0.38, 0.05], gravity: 9, drag: 1.8, color: 0xffc070, stretch: 0.5, jitter: 0.4 },
  magic: { blend: "add", count: 16, speed: [0.5, 2.5], spread: 1, dir: [0, 1, 0], life: [0.6, 1.2], size: [0.16, 0.02], gravity: -2.5, drag: 1.2, color: 0x7ad7ff, stretch: 0.2, jitter: 0.3 },
};

/**
 * A ring of `capacity` particle slots. Allocation never iterates live
 * particles: the oldest slot is simply overwritten. Records which slot
 * ranges changed since the last flush so only those bytes are uploaded.
 */
export class ParticleRing {
  head = 0;
  private dirty: [number, number][] = [];
  /** Slots written so far (stats). */
  written = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("ParticleRing: capacity must be a positive integer");
  }

  /** Take `n` slots (n is clamped to capacity). Returns the slot indices in write order. */
  alloc(n: number): number[] {
    const count = Math.min(Math.max(0, Math.floor(n)), this.capacity);
    const out: number[] = [];
    if (count === 0) return out;
    const start = this.head;
    for (let i = 0; i < count; i++) out.push((start + i) % this.capacity);
    this.head = (start + count) % this.capacity;
    this.written += count;
    const end = start + count;
    if (end <= this.capacity) this.mark(start, count);
    else {
      this.mark(start, this.capacity - start);
      this.mark(0, end - this.capacity);
    }
    return out;
  }

  private mark(start: number, count: number): void {
    const last = this.dirty[this.dirty.length - 1];
    if (last && last[0] + last[1] === start) last[1] += count;
    else this.dirty.push([start, count]);
  }

  /** Merged dirty slot ranges [start, count], sorted, and clears them. */
  flush(): [number, number][] {
    if (this.dirty.length === 0) return [];
    const r = this.dirty.slice().sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const [s, c] of r) {
      const m = merged[merged.length - 1];
      if (m && s <= m[0] + m[1]) m[1] = Math.max(m[1], s + c - m[0]);
      else merged.push([s, c]);
    }
    this.dirty = [];
    // Overlap cap: never more than the whole buffer.
    return merged.map(([s, c]) => [s, Math.min(c, this.capacity - s)]);
  }
}

class Pool {
  readonly ring: ParticleRing;
  readonly mesh: Mesh;
  readonly spawn: InstancedBufferAttribute;
  readonly vel: InstancedBufferAttribute;
  readonly params: InstancedBufferAttribute;
  readonly color: InstancedBufferAttribute;

  constructor(capacity: number, blend: "add" | "alpha", time: UniformNode<"float", number>, look?: ParticleShade) {
    this.ring = new ParticleRing(capacity);
    const quad = new PlaneGeometry(1, 1);
    const g = new InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute("position", quad.getAttribute("position"));
    g.setAttribute("uv", quad.getAttribute("uv"));
    g.instanceCount = capacity;
    const mk = () => {
      const a = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.spawn = mk();
    this.vel = mk();
    this.params = mk();
    this.color = mk();
    // Every slot starts dead: born far in the past with zero life.
    for (let i = 0; i < capacity; i++) this.spawn.array[i * 4 + 3] = -1e6;

    const sp = instancedBufferAttribute<"vec4">(this.spawn, "vec4");
    const ve = instancedBufferAttribute<"vec4">(this.vel, "vec4");
    const pa = instancedBufferAttribute<"vec4">(this.params, "vec4");
    const co = instancedBufferAttribute<"vec4">(this.color, "vec4");
    const age = time.sub(sp.w);
    const life = max(ve.w, float(1e-4));
    const t = clamp(age.div(life), 0, 1);
    const alive = step(0, age).mul(step(age, life));
    const k = max(pa.w, float(1e-3));
    const decay = exp(k.negate().mul(age));
    const f = float(1).sub(decay).div(k);
    const g2 = pa.z;
    const p = sp.xyz.add(ve.xyz.mul(f)).add(vec3(0, g2.mul(age).mul(age).mul(-0.5), 0));
    const pc = vec3(p.x, max(p.y, float(0.02)), p.z);
    const seed = hash(instanceIndex);
    const curve = look?.size?.(t, seed, blend);
    const size = (curve ? mix(pa.x, pa.y, t).mul(curve) : mix(pa.x, pa.y, t)).mul(alive);
    const view = modelViewMatrix.mul(vec4(pc, 1));
    const velNow = ve.xyz.mul(decay).add(vec3(0, g2.mul(age).negate(), 0));
    const viewAhead = modelViewMatrix.mul(vec4(pc.add(velNow.mul(0.05)), 1));
    const vv = viewAhead.xy.sub(view.xy).mul(20);
    const vl = length(vv);
    const along = normalize(vv.add(vec2(1e-5, 1e-4)));
    // Right-handed with `along` so the quad keeps front-facing winding (a mirrored basis is back-face culled).
    const perp = vec2(along.y, along.x.negate());
    const stretch = float(1).add(co.w.mul(vl).mul(0.06));
    const corner = positionGeometry.xy;
    const offset = along.mul(corner.y.mul(size).mul(stretch)).add(perp.mul(corner.x.mul(size)));
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = cameraProjectionMatrix.mul(vec4(view.xy.add(offset), view.z, 1));
    const vt = varying(t);
    const valive = varying(alive);
    let drawBlend = blend;
    if (look) {
      const out = look.shade({ t: vt, uv: uv(), color: varying(co.xyz), seed: varying(seed), blend });
      mat.colorNode = vec4(out.color, 1);
      mat.opacityNode = out.opacity.mul(valive);
      drawBlend = out.blend ?? blend;
    } else {
      const d = length(uv().sub(0.5)).mul(2);
      const soft = blend === "add" ? pow(smoothstep(1, 0, d), float(1.6)) : smoothstep(1, 0.2, d);
      const fade = blend === "add" ? float(1).sub(vt.mul(vt)) : float(1).sub(vt).mul(smoothstep(0, 0.15, vt));
      const alpha = soft.mul(fade).mul(valive);
      mat.colorNode = vec4(co.xyz.mul(float(1).sub(vt.mul(0.45))), 1);
      mat.opacityNode = blend === "add" ? alpha : alpha.mul(0.6);
    }
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = drawBlend === "add" ? AdditiveBlending : NormalBlending;
    mat.fog = false;
    this.mesh = new Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = blend === "add" ? 20 : 10;
    this.mesh.name = `GpuParticles.${blend}`;
  }

  upload(): void {
    const ranges = this.ring.flush();
    if (ranges.length === 0) return;
    for (const a of [this.spawn, this.vel, this.params, this.color]) {
      a.clearUpdateRanges();
      for (const [s, c] of ranges) a.addUpdateRange(s * 4, c * 4);
      a.needsUpdate = true;
    }
  }
}

export interface GpuParticlesOptions {
  /** Slots per blend pool (additive and alpha). Default 4096. */
  readonly capacity?: number;
  /** Random source (tests pass a seeded one). */
  readonly random?: () => number;
  /** The particle look (an art style's); default soft round glows. */
  readonly look?: ParticleShade;
}

/**
 * Pooled GPU particles: one draw for every additive particle on screen
 * (and one for alpha-blended smoke and dust). The CPU writes only the
 * spawn slots of a burst; the vertex stage computes motion (velocity, drag,
 * gravity, a floor clamp), billboarding, velocity stretch, size and fade.
 */
export class GpuParticles implements ParticleSink {
  readonly time = uniform(0);
  private readonly pools: Record<"add" | "alpha", Pool>;
  private readonly rand: () => number;
  /** Bursts requested so far (playtest checks). */
  bursts = 0;

  constructor(parent: Object3D, opts: GpuParticlesOptions = {}) {
    const cap = opts.capacity ?? 4096;
    this.rand = opts.random ?? Math.random;
    this.pools = { add: new Pool(cap, "add", this.time, opts.look), alpha: new Pool(Math.max(64, cap >> 2), "alpha", this.time, opts.look) };
    parent.add(this.pools.add.mesh, this.pools.alpha.mesh);
  }

  get meshes(): Mesh[] {
    return [this.pools.add.mesh, this.pools.alpha.mesh];
  }

  burst(preset: string, x: number, y: number, z: number, opts: ParticleBurstOptions = {}): void {
    const p = (PARTICLE_PRESETS as Record<string, ParticlePreset>)[preset] ?? PARTICLE_PRESETS.burst;
    this.bursts++;
    // A big kill is a large burst plus a ring of sparks and a puff of smoke.
    if (preset === "bigKill") {
      this.burst("sparks", x, y + 0.3, z, { count: 16, spread: 0.9, ...(opts.scale !== undefined ? { scale: opts.scale } : {}) });
      this.burst("smoke", x, y + 0.2, z, { count: 4 });
      this.bursts -= 2;
    }
    const pool = this.pools[p.blend];
    const slots = pool.ring.alloc(opts.count ?? p.count);
    const r = this.rand;
    let dx = opts.dirX ?? p.dir[0];
    let dy = opts.dirY ?? p.dir[1];
    let dz = opts.dirZ ?? p.dir[2];
    const dl = Math.hypot(dx, dy, dz);
    if (dl > 1e-6) {
      dx /= dl;
      dy /= dl;
      dz /= dl;
    } else {
      dy = 1;
    }
    const spread = Math.min(1, Math.max(0, opts.spread ?? p.spread));
    const sMul = opts.speed !== undefined ? opts.speed / ((p.speed[0] + p.speed[1]) / 2) : 1;
    const zMul = opts.size !== undefined ? opts.size / p.size[0] : (opts.scale ?? 1);
    const hex = opts.color ?? p.color;
    const cr = ((hex >> 16) & 255) / 255;
    const cg = ((hex >> 8) & 255) / 255;
    const cb = (hex & 255) / 255;
    // Linear-ish color for HDR blending: square approximates sRGB -> linear; additive gets a bloom boost.
    const boost = p.blend === "add" ? 2.2 : 1;
    const t0 = this.time.value;
    const sp = pool.spawn.array as Float32Array;
    const ve = pool.vel.array as Float32Array;
    const pa = pool.params.array as Float32Array;
    const co = pool.color.array as Float32Array;
    for (const s of slots) {
      // A direction inside the cone: random unit vector blended toward dir by (1 - spread).
      let ux = r() * 2 - 1;
      let uy = r() * 2 - 1;
      let uz = r() * 2 - 1;
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux = ux / ul;
      uy = uy / ul;
      uz = uz / ul;
      let vx = dx + (ux - dx) * spread;
      let vy = dy + (uy - dy) * spread;
      let vz = dz + (uz - dz) * spread;
      const vl = Math.hypot(vx, vy, vz) || 1;
      const speed = (p.speed[0] + (p.speed[1] - p.speed[0]) * r()) * sMul;
      vx = (vx / vl) * speed;
      vy = (vy / vl) * speed;
      vz = (vz / vl) * speed;
      const j = p.jitter;
      const o = s * 4;
      sp[o] = x + (r() * 2 - 1) * j;
      sp[o + 1] = y + (r() * 2 - 1) * j * 0.5;
      sp[o + 2] = z + (r() * 2 - 1) * j;
      sp[o + 3] = t0;
      ve[o] = vx;
      ve[o + 1] = vy;
      ve[o + 2] = vz;
      ve[o + 3] = p.life[0] + (p.life[1] - p.life[0]) * r();
      pa[o] = p.size[0] * zMul;
      pa[o + 1] = p.size[1] * zMul;
      pa[o + 2] = p.gravity;
      pa[o + 3] = p.drag;
      const shade = 0.85 + 0.3 * r();
      co[o] = cr * cr * boost * shade;
      co[o + 1] = cg * cg * boost * shade;
      co[o + 2] = cb * cb * boost * shade;
      co[o + 3] = p.stretch;
    }
  }

  /** Continuous emission helper: call per frame with a rate (particles/s) and dt. */
  emit(preset: string, x: number, y: number, z: number, rate: number, dt: number, opts: ParticleBurstOptions = {}): void {
    const want = rate * dt + this.carry;
    const n = Math.floor(want);
    this.carry = want - n;
    if (n > 0) this.burst(preset, x, y, z, { ...opts, count: n });
  }
  private carry = 0;

  /** Advance the particle clock (seconds) and upload this frame's spawn slots. */
  update(timeSeconds: number): void {
    this.time.value = timeSeconds;
    this.pools.add.upload();
    this.pools.alpha.upload();
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.removeFromParent();
      m.geometry.dispose();
      (m.material as MeshBasicNodeMaterial).dispose();
    }
  }
}
