import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshStandardNodeMaterial,
} from "three/webgpu";
import type { BufferGeometry, Material, MeshStandardMaterial, Node, Object3D } from "three/webgpu";
import {
  abs,
  clamp,
  cos,
  float,
  floor,
  max,
  instancedBufferAttribute,
  materialEmissive,
  positionGeometry,
  select,
  sin,
  uniform,
  varying,
  vec3,
} from "three/tsl";
import { billboardWorld, isSprite } from "./sprite.js";

export interface CrowdMotionOptions {
  /** Vertical hop per step at full speed, m. Default 0.12. */
  readonly bob?: number;
  /** Side-to-side roll per step at full speed, radians. Default 0.18. */
  readonly waddle?: number;
  /** Forward lean at full speed, radians. Default 0.16. */
  readonly lean?: number;
  /** Squash on a hit (0..1 of height). Default 0.32. */
  readonly squash?: number;
  /** Steps per second at a standstill and per m/s of speed. Default [1.2, 0.9]. */
  readonly cadence?: readonly [number, number];
  /** Speed (m/s) treated as "full speed". Default 4. */
  readonly fullSpeed?: number;
  /** Idle breathing scale amplitude. Default 0.03. */
  readonly breathe?: number;
  /** Emissive added at full hit flash. Default 2.5. */
  readonly flash?: number;
  /** Draw as camera-facing sprites (render/sprite.ts): no roll or lean, mirrored to face the way they walk. Default: from the geometry. */
  readonly billboard?: boolean;
}

/** The per-instance attributes a crowd-motion material reads. */
export interface CrowdAttributes {
  /** x, y, z, yaw. */
  readonly xform: InstancedBufferAttribute;
  /** phase (0..1), speed (m/s), hit (0..1 squash), flash (0..1 emissive). */
  readonly anim: InstancedBufferAttribute;
  /** uniform scale, unused x3. */
  readonly extra: InstancedBufferAttribute;
}

type MotionMaterial = Material & { positionNode: Node | null; emissiveNode?: Node | null };

/**
 * Vertex animation for crowds without skeletons: bob, waddle, forward
 * lean and step cadence from each instance's speed, a squash-and-stretch on
 * hit, a hit flash, idle breathing. Applied to an existing node material
 * (positionNode, emissiveNode); geometry stands on y = 0 and faces -z.
 */
export function applyCrowdMotion(material: MotionMaterial, attrs: CrowdAttributes, time: Node<"float">, opts: CrowdMotionOptions = {}): MotionMaterial {
  const o = {
    bob: 0.12,
    waddle: 0.18,
    lean: 0.16,
    squash: 0.32,
    cadence: [1.2, 0.9] as readonly [number, number],
    fullSpeed: 4,
    breathe: 0.03,
    flash: 2.5,
    ...opts,
  };
  const X = instancedBufferAttribute<"vec4">(attrs.xform, "vec4");
  const A = instancedBufferAttribute<"vec4">(attrs.anim, "vec4");
  const E = instancedBufferAttribute<"vec4">(attrs.extra, "vec4");
  const speed = A.y;
  const amp = clamp(speed.div(o.fullSpeed), 0, 1);
  const cadence = float(o.cadence[0]).add(speed.mul(o.cadence[1]));
  const ph = A.x.mul(6.2832).add(float(time).mul(cadence).mul(6.2832));
  const s = sin(ph);
  const breath = sin(float(time).mul(2.1).add(A.x.mul(6.2832))).mul(o.breathe).mul(float(1).sub(amp));
  const hit = A.z;
  const sy = float(1).add(breath).add(s.mul(0.06).mul(amp)).sub(hit.mul(o.squash));
  const sxz = float(1).add(hit.mul(o.squash * 0.5)).sub(breath.mul(0.5));
  const g = positionGeometry;
  const px = g.x.mul(sxz);
  const py = g.y.mul(sy);
  const pz = g.z.mul(sxz);
  // Roll about the forward axis (waddle), then pitch forward (lean): the top moves toward -z.
  const roll = s.mul(o.waddle).mul(amp);
  const cr = cos(roll);
  const sr = sin(roll);
  const rx = px.mul(cr).sub(py.mul(sr));
  const ry = px.mul(sr).add(py.mul(cr));
  const lean = amp.mul(o.lean).add(hit.mul(-0.25));
  const cl = cos(lean);
  const sl = sin(lean);
  const ly = ry.mul(cl).add(pz.mul(sl));
  const lz = pz.mul(cl).sub(ry.mul(sl));
  const scale = E.x;
  const bob = abs(s).mul(o.bob).mul(amp);
  if (opts.billboard) {
    // A sprite keeps its bob and squash; it faces the camera and turns to the side it walks toward (yaw -pi/2 is +x).
    const flip = select(sin(X.w).greaterThan(0.05), float(-1), float(1));
    // Whole multiples only (an elite's 1.5 draws at 2): one sprite texel stays one picture pixel.
    const whole = max(float(1), floor(scale.add(0.5)));
    material.positionNode = billboardWorld(vec3(X.x, X.y.add(bob), X.z), px.mul(whole), py.mul(whole), flip);
    if ("emissiveNode" in material) material.emissiveNode = materialEmissive.add(vec3(varying(A.w)).mul(o.flash));
    return material;
  }
  const cy = cos(X.w);
  const syaw = sin(X.w);
  const wx = rx.mul(cy).add(lz.mul(syaw)).mul(scale);
  const wz = rx.mul(syaw).negate().add(lz.mul(cy)).mul(scale);
  material.positionNode = vec3(wx.add(X.x), ly.mul(scale).add(X.y).add(bob), wz.add(X.z));
  if ("emissiveNode" in material) material.emissiveNode = materialEmissive.add(vec3(varying(A.w)).mul(o.flash));
  return material;
}

/** Copy a classic MeshStandardMaterial into a node material (so positionNode can be set). */
export function toNodeMaterial(m: MeshStandardMaterial): MeshStandardNodeMaterial {
  const n = new MeshStandardNodeMaterial();
  n.color.copy(m.color);
  n.emissive.copy(m.emissive);
  n.emissiveIntensity = m.emissiveIntensity;
  n.roughness = m.roughness;
  n.metalness = m.metalness;
  n.flatShading = m.flatShading;
  n.map = m.map;
  n.transparent = m.transparent;
  n.opacity = m.opacity;
  n.side = m.side;
  n.alphaTest = m.alphaTest;
  return n;
}

/**
 * An instanced crowd with procedural animation: one draw, per-instance
 * position, yaw, scale, phase, speed, hit squash and flash. Write instances
 * between `begin()` and `end(time)` each frame; only the written range uploads.
 */
export class AnimatedCrowd {
  readonly mesh: Mesh;
  readonly time = uniform(0);
  readonly attrs: CrowdAttributes;
  count = 0;

  constructor(
    geometry: BufferGeometry,
    material: MeshStandardMaterial | MeshStandardNodeMaterial,
    readonly capacity: number,
    opts: CrowdMotionOptions = {},
  ) {
    const g = new InstancedBufferGeometry();
    if (geometry.index) g.setIndex(geometry.index);
    for (const [name, a] of Object.entries(geometry.attributes)) g.setAttribute(name, a);
    g.instanceCount = 0;
    const mk = () => {
      const a = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.attrs = { xform: mk(), anim: mk(), extra: mk() };
    const mat = (material as { isNodeMaterial?: boolean }).isNodeMaterial ? (material as MeshStandardNodeMaterial) : toNodeMaterial(material as MeshStandardMaterial);
    applyCrowdMotion(mat, this.attrs, this.time, { billboard: isSprite(geometry), ...opts });
    this.mesh = new Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.mesh.name = "AnimatedCrowd";
  }

  begin(): void {
    this.count = 0;
  }

  /**
   * One instance. `phase` 0..1 desyncs steps (use a hash of the id),
   * `speed` m/s drives cadence and amplitude, `hit` 0..1 squashes,
   * `flash` 0..1 brightens.
   */
  push(x: number, y: number, z: number, yaw: number, phase: number, speed: number, hit = 0, flash = 0, scale = 1): void {
    if (this.count >= this.capacity) return;
    const o = this.count * 4;
    const X = this.attrs.xform.array as Float32Array;
    const A = this.attrs.anim.array as Float32Array;
    const E = this.attrs.extra.array as Float32Array;
    X[o] = x;
    X[o + 1] = y;
    X[o + 2] = z;
    X[o + 3] = yaw;
    A[o] = phase;
    A[o + 1] = speed;
    A[o + 2] = hit < 0 ? 0 : hit > 1 ? 1 : hit;
    A[o + 3] = flash < 0 ? 0 : flash > 1 ? 1 : flash;
    E[o] = scale;
    this.count++;
  }

  end(timeSeconds: number): void {
    this.time.value = timeSeconds;
    (this.mesh.geometry as InstancedBufferGeometry).instanceCount = this.count;
    for (const a of [this.attrs.xform, this.attrs.anim, this.attrs.extra]) {
      a.clearUpdateRanges();
      if (this.count > 0) a.addUpdateRange(0, this.count * 4);
      a.needsUpdate = true;
    }
  }

  addTo(parent: Object3D): this {
    parent.add(this.mesh);
    return this;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}
