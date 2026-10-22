import {
  AdditiveBlending,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  NormalBlending,
  PlaneGeometry,
} from "three/webgpu";
import type { Object3D } from "three/webgpu";
import {
  abs,
  atan,
  clamp,
  cos,
  float,
  instancedBufferAttribute,
  length,
  max,
  mix,
  positionGeometry,
  pow,
  select,
  sin,
  smoothstep,
  step,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import { ParticleRing } from "./particles.js";
import type { DecalLook, RingLook } from "../styles/kit.js";

export type DecalKind = "scorch" | "splat" | "ring";
const DECAL_INDEX: Record<DecalKind, number> = { scorch: 0, splat: 1, ring: 2 };

export interface DecalOptions {
  /** Diameter, m. Default 1.6. */
  size?: number;
  color?: number;
  /** Seconds before it has faded out. Default 6. */
  life?: number;
  /** Peak opacity 0..1. Default 0.75. */
  opacity?: number;
  /** Rotation about y, radians (default random). */
  rotation?: number;
  /** Color multiplier above 1 makes it glow under bloom. Default 1. */
  glow?: number;
}

function quadGeometry(capacity: number): InstancedBufferGeometry {
  const quad = new PlaneGeometry(1, 1);
  const g = new InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute("position", quad.getAttribute("position"));
  g.setAttribute("uv", quad.getAttribute("uv"));
  g.instanceCount = capacity;
  return g;
}

function vec4Attr(capacity: number): InstancedBufferAttribute {
  const a = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  a.setUsage(DynamicDrawUsage);
  return a;
}

function upload(ring: ParticleRing, attrs: InstancedBufferAttribute[]): void {
  const ranges = ring.flush();
  if (ranges.length === 0) return;
  for (const a of attrs) {
    a.clearUpdateRanges();
    for (const [s, c] of ranges) a.addUpdateRange(s * 4, c * 4);
    a.needsUpdate = true;
  }
}

const hexRgb = (hex: number): [number, number, number] => {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  return [r * r, g * g, b * b];
};

/**
 * Ground decals (scorch marks, splats, rings) in one draw: flat quads on
 * the floor, shapes drawn procedurally in the fragment stage (no textures),
 * faded over their life. A ring buffer: the oldest decal is reused.
 */
export class GroundDecals {
  readonly time = uniform(0);
  readonly ring: ParticleRing;
  readonly mesh: Mesh;
  private readonly a: InstancedBufferAttribute;
  private readonly b: InstancedBufferAttribute;
  private readonly c: InstancedBufferAttribute;
  private readonly rand: () => number;
  /** Height above the floor, m. */
  floorY = 0.012;

  constructor(parent: Object3D, capacity = 256, random: () => number = Math.random, look?: DecalLook) {
    this.ring = new ParticleRing(capacity);
    this.rand = random;
    this.a = vec4Attr(capacity); // x, z, rotation, size
    this.b = vec4Attr(capacity); // t0, life, kind, opacity
    this.c = vec4Attr(capacity); // r, g, b, seed
    for (let i = 0; i < capacity; i++) this.b.array[i * 4 + 1] = 0;
    const A = instancedBufferAttribute<"vec4">(this.a, "vec4");
    const B = instancedBufferAttribute<"vec4">(this.b, "vec4");
    const C = instancedBufferAttribute<"vec4">(this.c, "vec4");
    const age = this.time.sub(B.x);
    const life = max(B.y, float(1e-4));
    const t = clamp(age.div(life), 0, 1);
    const alive = step(0, age).mul(step(age, life));
    const pop = smoothstep(0, 0.12, age).mul(0.25).add(0.75);
    const size = A.w.mul(pop).mul(alive);
    const cs = cos(A.z);
    const sn = sin(A.z);
    const cx = positionGeometry.x.mul(size);
    const cz = positionGeometry.y.mul(size);
    const mat = new MeshBasicNodeMaterial();
    mat.positionNode = vec3(A.x.add(cx.mul(cs)).sub(cz.mul(sn)), float(this.floorY), A.y.add(cx.mul(sn)).add(cz.mul(cs)));
    const p = uv().sub(0.5);
    const r = length(p).mul(2);
    const ang = atan(p.y, p.x).add(C.w);
    const scorchEdge = float(0.78).add(sin(ang.mul(7)).mul(0.1)).add(sin(ang.mul(13).add(1.7)).mul(0.05));
    const scorch = smoothstep(scorchEdge, scorchEdge.mul(0.35), r);
    const lobes = pow(max(sin(ang.mul(5)), float(0)), float(3));
    const splatEdge = float(0.5).add(lobes.mul(0.32)).add(sin(ang.mul(11).add(0.6)).mul(0.07));
    const splat = smoothstep(splatEdge, splatEdge.sub(0.07), r);
    const ringA = smoothstep(0.1, 0.0, abs(r.sub(0.82)));
    const shape = select(B.z.lessThan(0.5), scorch, select(B.z.lessThan(1.5), splat, ringA));
    const fade = float(1).sub(smoothstep(0.55, 1, t));
    mat.colorNode = vec4(C.xyz, 1);
    mat.opacityNode = shape.mul(fade).mul(B.w).mul(alive);
    // An art style's decal look replaces the shading (same quads, same draw).
    const styled = look?.({ uv: uv(), r, angle: ang, kind: B.z, t, color: C.xyz, shape, opacity: B.w.mul(alive) });
    if (styled) {
      mat.colorNode = vec4(styled.color, 1);
      mat.opacityNode = styled.opacity;
    }
    mat.transparent = true;
    mat.depthWrite = false;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    mat.blending = NormalBlending;
    mat.side = DoubleSide;
    this.mesh = new Mesh(quadGeometry(capacity), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.receiveShadow = false;
    this.mesh.name = "GroundDecals";
    parent.add(this.mesh);
  }

  /** Stamp a decal on the floor at (x, z). */
  add(kind: DecalKind, x: number, z: number, opts: DecalOptions = {}): void {
    const [s] = this.ring.alloc(1);
    if (s === undefined) return;
    const o = s * 4;
    const A = this.a.array as Float32Array;
    const B = this.b.array as Float32Array;
    const C = this.c.array as Float32Array;
    A[o] = x;
    A[o + 1] = z;
    A[o + 2] = opts.rotation ?? this.rand() * Math.PI * 2;
    A[o + 3] = opts.size ?? 1.6;
    B[o] = this.time.value;
    B[o + 1] = opts.life ?? 6;
    B[o + 2] = DECAL_INDEX[kind];
    B[o + 3] = opts.opacity ?? 0.75;
    const [r, g, b] = hexRgb(opts.color ?? (kind === "scorch" ? 0x0a0806 : 0x6a2c08));
    const glow = opts.glow ?? 1;
    C[o] = r * glow;
    C[o + 1] = g * glow;
    C[o + 2] = b * glow;
    C[o + 3] = this.rand() * 6.283;
  }

  update(timeSeconds: number): void {
    this.time.value = timeSeconds;
    upload(this.ring, [this.a, this.b, this.c]);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicNodeMaterial).dispose();
  }
}

export interface RingOptions {
  color?: number;
  /** Seconds to expand and fade. Default 0.32. */
  duration?: number;
  /** Brightness multiplier (bloom). Default 1.6. */
  glow?: number;
}

/**
 * Expanding shockwave rings on the floor (nova blasts, landings, dash
 * starts): one additive draw, pooled. Generalized from EMBERWATCH's rings.
 */
export class GroundRings {
  readonly time = uniform(0);
  readonly ring: ParticleRing;
  readonly mesh: Mesh;
  private readonly a: InstancedBufferAttribute;
  private readonly b: InstancedBufferAttribute;
  /** Rings fired so far (playtest checks). */
  fired = 0;

  constructor(parent: Object3D, capacity = 32, look?: RingLook) {
    this.ring = new ParticleRing(capacity);
    this.a = vec4Attr(capacity); // x, z, t0, radius
    this.b = vec4Attr(capacity); // r, g, b, duration
    for (let i = 0; i < capacity; i++) this.a.array[i * 4 + 2] = -1e6;
    const A = instancedBufferAttribute<"vec4">(this.a, "vec4");
    const B = instancedBufferAttribute<"vec4">(this.b, "vec4");
    const age = this.time.sub(A.z);
    const dur = max(B.w, float(1e-4));
    const t = clamp(age.div(dur), 0, 1);
    const alive = step(0, age).mul(step(age, dur));
    const ease = float(1).sub(pow(float(1).sub(t), float(3)));
    const scale = A.w.mul(mix(float(0.3), float(1), ease)).mul(2).mul(alive);
    const mat = new MeshBasicNodeMaterial();
    mat.positionNode = vec3(A.x.add(positionGeometry.x.mul(scale)), float(0.05), A.y.add(positionGeometry.y.mul(scale)));
    const r = length(uv().sub(0.5)).mul(2);
    const width = mix(float(0.22), float(0.06), t);
    const band = smoothstep(float(1).sub(width), float(0.97), r).mul(smoothstep(1.0, 0.97, r));
    const inner = smoothstep(0.2, 1, r).mul(0.18).mul(step(r, float(1)));
    mat.colorNode = vec4(B.xyz, 1);
    mat.opacityNode = band.add(inner).mul(float(1).sub(t)).mul(alive);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    const styled = look?.({ uv: uv(), r, t, alive, color: B.xyz });
    if (styled) {
      mat.colorNode = vec4(styled.color, 1);
      mat.opacityNode = styled.opacity;
      if (styled.blending) mat.blending = styled.blending === "add" ? AdditiveBlending : NormalBlending;
    }
    mat.side = DoubleSide;
    mat.fog = false;
    this.mesh = new Mesh(quadGeometry(capacity), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 15;
    this.mesh.name = "GroundRings";
    parent.add(this.mesh);
  }

  /** A ring at (x, z) reaching `radius` m. */
  fire(x: number, z: number, radius: number, opts: RingOptions = {}): void {
    const [s] = this.ring.alloc(1);
    if (s === undefined) return;
    this.fired++;
    const o = s * 4;
    const A = this.a.array as Float32Array;
    const B = this.b.array as Float32Array;
    A[o] = x;
    A[o + 1] = z;
    A[o + 2] = this.time.value;
    A[o + 3] = radius;
    const [r, g, b] = hexRgb(opts.color ?? 0xffb347);
    const glow = opts.glow ?? 1.6;
    B[o] = r * glow;
    B[o + 1] = g * glow;
    B[o + 2] = b * glow;
    B[o + 3] = opts.duration ?? 0.32;
  }

  update(timeSeconds: number): void {
    this.time.value = timeSeconds;
    upload(this.ring, [this.a, this.b]);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicNodeMaterial).dispose();
  }
}
