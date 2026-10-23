/**
 * Client-side physics dressing on engine-sim's PhysicsWorld (Rapier, the
 * same build the server runs): chunks that fly off killed enemies and
 * bounce off the floor and pillars, and a scatter of rocks and stumps
 * the keepers shove around and novas blast away.
 *
 * Presentation only. None of it feeds back into the authoritative sim, so
 * it never needs to match the server or other players exactly; every
 * client drives the props from the same interpolated keeper positions, so
 * what they see agrees closely anyway.
 */
import { Color, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from "three/webgpu";
import type { BufferGeometry, Material, Scene } from "three/webgpu";
import { CylinderGeometry, DodecahedronGeometry } from "three/webgpu";
import { Layer, createPhysics } from "@netforge/engine-sim";
import type { BodyId, PhysicsWorld, ResolvedSimConfig } from "@netforge/engine-sim";

const HZ = 60;
const MAX_CHUNKS = 220;
const MAX_STEPS = 4;
const CHUNK_LIFE = 2.2;

interface Chunk {
  id: BodyId;
  life: number;
  max: number;
  size: number;
  color: Color;
}

interface Prop {
  id: BodyId;
  barrel: boolean;
  /** Last speed, for impact thuds. */
  speed: number;
}

/** Seeded PRNG so every client scatters the props in the same places. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An art style's own drawing of a debris shape (the voxel style's cube chunks, rocks and stumps); null keeps the primitive. */
export type DebrisShape = (name: "chunk" | "rock" | "stump") => { readonly geometry: BufferGeometry; readonly material: Material } | null;

function instanced(geometry: BufferGeometry, color: number, capacity: number, emissive = 0x000000, styled?: ReturnType<DebrisShape>): InstancedMesh {
  const material = styled?.material ?? new MeshStandardMaterial({ color, roughness: 0.75, flatShading: true, emissive, emissiveIntensity: 0.6 });
  const mesh = new InstancedMesh(styled?.geometry ?? geometry, material, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const white = new Color(1, 1, 1);
  for (let i = 0; i < capacity; i++) mesh.setColorAt(i, white);
  return mesh;
}

export class PhysicsDressing {
  readonly physics: PhysicsWorld;
  private readonly chunks: Chunk[] = [];
  private readonly props: Prop[] = [];
  private readonly keepers = new Map<number, BodyId>();
  private readonly chunkMesh: InstancedMesh;
  private readonly crateMesh: InstancedMesh;
  private readonly barrelMesh: InstancedMesh;
  private acc = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly random = rng(0xe3b1);
  /** Impacts this frame (world position and speed), for thud sounds. */
  readonly impacts: { x: number; y: number; z: number; speed: number }[] = [];
  /** Effects fired so far (playtest checks). */
  readonly counts = { chunks: 0, blasts: 0 };

  constructor(scene: Scene, config: ResolvedSimConfig, opts: { props?: boolean; shape?: DebrisShape } = {}) {
    this.physics = createPhysics({ gravity: [0, -24, 0], tickRate: HZ });
    const P = this.physics;
    const h = config.arena.halfExtent;
    const wall = config.arena.wallHeight;
    P.addStaticBox([h + 1, 0.5, h + 1], [0, -0.5, 0], { friction: 0.8, layer: Layer.Level });
    P.addStaticBox([h + 1, wall, 0.5], [0, wall, h + 0.5], { layer: Layer.Level });
    P.addStaticBox([h + 1, wall, 0.5], [0, wall, -h - 0.5], { layer: Layer.Level });
    P.addStaticBox([0.5, wall, h + 1], [h + 0.5, wall, 0], { layer: Layer.Level });
    P.addStaticBox([0.5, wall, h + 1], [-h - 0.5, wall, 0], { layer: Layer.Level });
    for (const pl of config.arena.pillars) {
      P.addBody({ type: "static", shape: { cylinder: [pl.height / 2, pl.radius] }, position: [pl.x, pl.height / 2, pl.z], layer: Layer.Level, friction: 0.6 });
    }

    // Props: crates and barrels around the pillars and in the open, the same scatter on every client.
    const props = rng(0x51f7);
    const spots: [number, number][] = [];
    for (const pl of config.arena.pillars) {
      for (let k = 0; k < 3; k++) {
        const a = props() * Math.PI * 2;
        const d = pl.radius + 1.2 + props() * 1.5;
        spots.push([pl.x + Math.cos(a) * d, pl.z + Math.sin(a) * d]);
      }
    }
    for (let k = 0; k < 14; k++) {
      const a = props() * Math.PI * 2;
      const d = 6 + props() * (h - 12);
      spots.push([Math.cos(a) * d, Math.sin(a) * d]);
    }
    if (opts.props === false) spots.length = 0;
    for (const [x, z] of spots) {
      const barrel = props() < 0.4;
      const yaw = props() * Math.PI;
      const id = P.addBody({
        type: "dynamic",
        shape: barrel ? { cylinder: [0.45, 0.35] } : { box: [0.4, 0.4, 0.4] },
        position: [x, barrel ? 0.45 : 0.4, z],
        rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
        density: 40,
        friction: 0.7,
        restitution: 0.15,
        linearDamping: 0.4,
        angularDamping: 0.6,
        layer: Layer.Prop,
        mask: Layer.Level | Layer.Prop | Layer.Player | Layer.Debris,
      });
      this.props.push({ id, barrel, speed: 0 });
    }

    this.chunkMesh = instanced(new DodecahedronGeometry(1, 0), 0xffffff, MAX_CHUNKS, 0, opts.shape?.("chunk"));
    // One family with the field's stone and the Nature Kit stumps: loose rocks and cut stumps, not crates and barrels.
    this.crateMesh = instanced(new DodecahedronGeometry(0.5), 0x5e5246, Math.max(1, this.props.length), 0, opts.shape?.("rock"));
    this.barrelMesh = instanced(new CylinderGeometry(0.33, 0.38, 0.9, 7), 0x4e3a28, Math.max(1, this.props.length), 0, opts.shape?.("stump"));
    scene.add(this.chunkMesh, this.crateMesh, this.barrelMesh);
  }

  /** Keepers push props: one kinematic capsule per player, moved to where it is drawn. */
  keeper(owner: number, x: number, y: number, z: number, up: boolean): void {
    let id = this.keepers.get(owner);
    if (id === undefined) {
      id = this.physics.addBody({ type: "kinematic", shape: { capsule: [0.5, 0.4] }, position: [x, y, z], layer: Layer.Player, mask: Layer.Prop | Layer.Debris });
      this.keepers.set(owner, id);
    }
    this.physics.setKinematicTarget(id, [x, up ? y : -5, z]);
  }

  /** Forget keepers not seen this frame. */
  keepOnly(owners: ReadonlySet<number>): void {
    for (const [owner, id] of this.keepers) {
      if (owners.has(owner)) continue;
      this.physics.removeBody(id);
      this.keepers.delete(owner);
    }
  }

  /** Chunks off a killed enemy, thrown along the push direction. */
  shatter(x: number, z: number, radius: number, color: Color, count: number, dirX = 0, dirZ = 0): void {
    const P = this.physics;
    this.counts.chunks += count;
    for (let i = 0; i < count; i++) {
      if (this.chunks.length >= MAX_CHUNKS) this.retire(0);
      const size = radius * (0.22 + this.random() * 0.25);
      const a = this.random() * Math.PI * 2;
      const sp = 2 + this.random() * 3.5;
      const id = P.addBody({
        type: "dynamic",
        shape: { box: [size, size, size] },
        position: [x + Math.cos(a) * radius * 0.5, radius + 0.2 + this.random() * radius, z + Math.sin(a) * radius * 0.5],
        density: 8,
        friction: 0.6,
        restitution: 0.35,
        angularDamping: 0.3,
        linearVelocity: [Math.cos(a) * sp + dirX * 5, 3.5 + this.random() * 4, Math.sin(a) * sp + dirZ * 5],
        angularVelocity: [(this.random() - 0.5) * 18, (this.random() - 0.5) * 18, (this.random() - 0.5) * 18],
        layer: Layer.Debris,
        mask: Layer.Level | Layer.Prop,
      });
      const life = CHUNK_LIFE * (0.7 + this.random() * 0.6);
      this.chunks.push({ id, life, max: life, size, color });
    }
  }

  /** A blast (nova) shoves props and chunks out of `radius`. */
  blast(x: number, z: number, radius: number, strength: number): void {
    const P = this.physics;
    this.counts.blasts++;
    const hits = P.overlap({ cylinder: [1.5, radius] }, [x, 1.5, z], { mask: Layer.Prop | Layer.Debris });
    for (const id of hits) P.applyKnockback(id, [x, 0, z], strength, { lift: strength * 0.35 });
  }

  private retire(i: number): void {
    const c = this.chunks[i];
    if (!c) return;
    this.physics.removeBody(c.id);
    this.chunks[i] = this.chunks[this.chunks.length - 1] as Chunk;
    this.chunks.pop();
  }

  update(dt: number): void {
    this.impacts.length = 0;
    this.acc = Math.min(this.acc + dt, MAX_STEPS / HZ);
    while (this.acc >= 1 / HZ) {
      this.acc -= 1 / HZ;
      this.physics.step();
    }
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i] as Chunk;
      c.life -= dt;
      if (c.life <= 0) this.retire(i);
    }
    // Draw.
    const P = this.physics;
    let n = 0;
    for (const c of this.chunks) {
      const [x, y, z] = P.position(c.id);
      const [qx, qy, qz, qw] = P.rotation(c.id);
      const k = Math.min(1, c.life / (c.max * 0.35));
      this.p.set(x, y, z);
      this.q.set(qx, qy, qz, qw);
      this.s.setScalar(c.size * 1.25 * k);
      this.m.compose(this.p, this.q, this.s);
      this.chunkMesh.setMatrixAt(n, this.m);
      this.chunkMesh.setColorAt(n, c.color);
      n++;
    }
    this.chunkMesh.count = n;
    this.chunkMesh.instanceMatrix.needsUpdate = true;
    if (this.chunkMesh.instanceColor) this.chunkMesh.instanceColor.needsUpdate = true;
    let crates = 0;
    let barrels = 0;
    this.s.setScalar(1);
    for (const prop of this.props) {
      const [x, y, z] = P.position(prop.id);
      const [vx, vy, vz] = P.velocity(prop.id);
      const speed = Math.hypot(vx, vy, vz);
      if (prop.speed - speed > 3) this.impacts.push({ x, y, z, speed: prop.speed - speed });
      prop.speed = speed;
      const [qx, qy, qz, qw] = P.rotation(prop.id);
      this.p.set(x, y, z);
      this.q.set(qx, qy, qz, qw);
      this.m.compose(this.p, this.q, this.s);
      if (prop.barrel) this.barrelMesh.setMatrixAt(barrels++, this.m);
      else this.crateMesh.setMatrixAt(crates++, this.m);
    }
    this.crateMesh.count = crates;
    this.barrelMesh.count = barrels;
    this.crateMesh.instanceMatrix.needsUpdate = true;
    this.barrelMesh.instanceMatrix.needsUpdate = true;
  }

  get liveChunks(): number {
    return this.chunks.length;
  }
}
