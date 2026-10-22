/**
 * PhysicsWorld: a deterministic wrapper over a Rapier world for games that
 * want real rigid bodies (dynamic, kinematic, static), collision layers,
 * triggers, raycasts and shape casts, CCD projectiles, impulses, joints and
 * a polished kinematic character motor, with snapshot/restore for netcode
 * reconciliation and a bit-exact state hash for determinism checks.
 *
 * Determinism: the same Rapier build on both sides
 * (@dimforge/rapier3d-deterministic-compat), ids assigned by the wrapper in
 * creation order, every loop in BodyId order, events sorted, no clocks and
 * no randomness. Stepping the same calls on two worlds, or on a world and
 * its restored snapshot, gives bit-identical states.
 */
import RAPIER from "@dimforge/rapier3d-deterministic-compat";
import type {
  Collider,
  ImpulseJoint,
  KinematicCharacterController,
  RigidBody,
  Shape,
  World as RapierWorld,
} from "@dimforge/rapier3d-deterministic-compat";
import type { Vec3 } from "../api.js";
import { approach2, initialCharacterState, resolveCharacter } from "./character.js";
import { BitHash } from "./hash.js";
import { ALL_LAYERS, Layer, collisionGroups, queryGroups } from "./layers.js";
import type {
  BodyDesc,
  BodyId,
  BodyType,
  CharacterDesc,
  CharacterInput,
  CharacterReport,
  CharacterState,
  JointDesc,
  JointId,
  KnockbackOptions,
  PhysicsEvent,
  PhysicsEventType,
  PhysicsStepResult,
  QueryOptions,
  Quat,
  RayHit,
  ResolvedCharacterDesc,
  ShapeDesc,
  ShapeHit,
} from "./types.js";

export interface PhysicsOptions {
  /** m/s². Default [0, -20, 0] (game gravity, snappier than 9.81). */
  readonly gravity?: Vec3;
  /** Fixed steps per second. Default 30. */
  readonly tickRate?: number;
}

const BODY_TYPES: readonly BodyType[] = ["dynamic", "kinematic", "static"];
const EVENT_RANK: Record<PhysicsEventType, number> = { "contact.start": 0, "contact.end": 1, "trigger.enter": 2, "trigger.exit": 3 };
const SNAPSHOT_MAGIC = 0x4e4e5048; // "NNPH"
const SNAPSHOT_FORMAT = 1;
const BTN_JUMP = 1;
const BTN_DASH = 2;
const NEUTRAL: CharacterInput = { moveX: 0, moveZ: 0 };

interface CharRec {
  readonly desc: ResolvedCharacterDesc;
  state: CharacterState;
  kcc: KinematicCharacterController;
}

interface BodyRec {
  readonly id: BodyId;
  readonly handle: number;
  readonly collider: number;
  readonly type: BodyType;
  readonly layer: number;
  readonly mask: number;
  readonly sensor: boolean;
  readonly userData: number;
  char: CharRec | null;
}

interface Meta {
  v: number;
  tick: number;
  tickRate: number;
  gravity: [number, number, number];
  nextBody: number;
  nextJoint: number;
  dirty: boolean;
  forced: number[];
  bodies: [id: number, handle: number, collider: number, type: number, layer: number, mask: number, sensor: number, userData: number][];
  chars: [id: number, desc: ResolvedCharacterDesc, state: CharacterState][];
  joints: [id: number, handle: number][];
}

const v3 = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const vec = (v: Vec3) => ({ x: v[0], y: v[1], z: v[2] });

function checkVec(name: string, v: Vec3): void {
  if (!Number.isFinite(v[0]) || !Number.isFinite(v[1]) || !Number.isFinite(v[2])) {
    throw new RangeError(`engine-sim physics: ${name} must be three finite numbers, got [${v.join(", ")}]`);
  }
}

function shapeOf(s: ShapeDesc): Shape {
  if ("box" in s) return new RAPIER.Cuboid(s.box[0], s.box[1], s.box[2]);
  if ("sphere" in s) return new RAPIER.Ball(s.sphere);
  if ("capsule" in s) return new RAPIER.Capsule(s.capsule[0], s.capsule[1]);
  return new RAPIER.Cylinder(s.cylinder[0], s.cylinder[1]);
}

function colliderDescOf(s: ShapeDesc): RAPIER.ColliderDesc {
  const pos = (n: number, what: string) => {
    if (!(Number.isFinite(n) && n > 0)) throw new RangeError(`engine-sim physics: ${what} must be a positive number, got ${n}`);
    return n;
  };
  if ("box" in s) return RAPIER.ColliderDesc.cuboid(pos(s.box[0], "box x"), pos(s.box[1], "box y"), pos(s.box[2], "box z"));
  if ("sphere" in s) return RAPIER.ColliderDesc.ball(pos(s.sphere, "sphere radius"));
  if ("capsule" in s) return RAPIER.ColliderDesc.capsule(pos(s.capsule[0], "capsule halfHeight"), pos(s.capsule[1], "capsule radius"));
  return RAPIER.ColliderDesc.cylinder(pos(s.cylinder[0], "cylinder halfHeight"), pos(s.cylinder[1], "cylinder radius"));
}

function normalize(v: Vec3): Vec3 {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (!(l > 1e-12)) throw new RangeError("engine-sim physics: direction must be a non-zero vector");
  return [v[0] / l, v[1] / l, v[2] / l];
}

function configureKcc(world: RapierWorld, d: ResolvedCharacterDesc): KinematicCharacterController {
  const kcc = world.createCharacterController(d.offset);
  kcc.setUp({ x: 0, y: 1, z: 0 });
  kcc.setMaxSlopeClimbAngle((d.maxSlopeClimb * Math.PI) / 180);
  kcc.setMinSlopeSlideAngle((d.minSlopeSlide * Math.PI) / 180);
  if (d.stepHeight > 0) kcc.enableAutostep(d.stepHeight, d.stepWidth, d.stepOverDynamic);
  else kcc.disableAutostep();
  if (d.snapToGround > 0) kcc.enableSnapToGround(d.snapToGround);
  else kcc.disableSnapToGround();
  kcc.setApplyImpulsesToDynamicBodies(d.pushBodies);
  kcc.setCharacterMass(d.mass);
  kcc.setSlideEnabled(true);
  return kcc;
}

/** Build a physics world. Requires `await initSim()` first (it loads the Rapier WebAssembly). */
export function createPhysics(opts: PhysicsOptions = {}): PhysicsWorld {
  const tickRate = opts.tickRate ?? 30;
  if (!Number.isInteger(tickRate) || tickRate < 1 || tickRate > 240) {
    throw new RangeError(`engine-sim physics: tickRate must be an integer 1..240, got ${tickRate}`);
  }
  const g = opts.gravity ?? [0, -20, 0];
  checkVec("gravity", g);
  let raw: RapierWorld;
  try {
    raw = new RAPIER.World(vec(g));
  } catch (e) {
    throw new Error(`engine-sim physics: call \`await initSim()\` before createPhysics (${e instanceof Error ? e.message : String(e)})`);
  }
  return new PhysicsWorld(raw, tickRate, [g[0], g[1], g[2]]);
}

/** Rebuild a world from `snapshot()` bytes. Stepping it gives exactly what the original would have. */
export function restorePhysics(bytes: Uint8Array): PhysicsWorld {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || view.getUint32(0) !== SNAPSHOT_MAGIC) throw new Error("engine-sim physics: not a physics snapshot");
  if (view.getUint32(4) !== SNAPSHOT_FORMAT) throw new Error(`engine-sim physics: unsupported snapshot format ${view.getUint32(4)}`);
  const len = view.getUint32(8);
  let json = "";
  for (let i = 0; i < len; i++) json += String.fromCharCode(bytes[12 + i] ?? 0);
  const meta = JSON.parse(json) as Meta;
  const raw = RAPIER.World.restoreSnapshot(bytes.subarray(12 + len));
  const w = new PhysicsWorld(raw, meta.tickRate, meta.gravity);
  w["load"](meta);
  return w;
}

export class PhysicsWorld {
  /** Seconds per step. */
  readonly dt: number;
  private readonly queue: RAPIER.EventQueue;
  private readonly bodies = new Map<BodyId, BodyRec>();
  private readonly byCollider = new Map<number, BodyId>();
  private readonly joints = new Map<JointId, number>();
  private readonly forced = new Set<BodyId>();
  private pending: PhysicsEvent[] = [];
  private nextBody = 1;
  private nextJoint = 1;
  private dirty = true;
  private ticks = 0;
  private destroyed = false;

  /** @internal Use `createPhysics` or `restorePhysics`. */
  constructor(
    private readonly raw: RapierWorld,
    readonly tickRate: number,
    readonly gravity: Vec3,
  ) {
    this.dt = 1 / tickRate;
    raw.timestep = this.dt;
    raw.gravity = vec(gravity);
    this.queue = new RAPIER.EventQueue(true);
  }

  /** Steps taken so far. */
  get tick(): number {
    return this.ticks;
  }

  /** Live bodies, characters included. */
  get bodyCount(): number {
    return this.bodies.size;
  }

  // ------------------------------------------------------------ bodies

  /** Add a body. Returns its BodyId (creation order, never reused). */
  addBody(desc: BodyDesc): BodyId {
    this.alive();
    const pos = desc.position ?? [0, 0, 0];
    checkVec("position", pos);
    const typeIdx = BODY_TYPES.indexOf(desc.type);
    if (typeIdx < 0) throw new RangeError(`engine-sim physics: body type must be dynamic, kinematic or static, got ${String(desc.type)}`);
    let bd =
      desc.type === "dynamic"
        ? RAPIER.RigidBodyDesc.dynamic()
        : desc.type === "kinematic"
          ? RAPIER.RigidBodyDesc.kinematicPositionBased()
          : RAPIER.RigidBodyDesc.fixed();
    bd = bd.setTranslation(pos[0], pos[1], pos[2]);
    if (desc.rotation) bd = bd.setRotation({ x: desc.rotation[0], y: desc.rotation[1], z: desc.rotation[2], w: desc.rotation[3] });
    if (desc.linearDamping !== undefined) bd = bd.setLinearDamping(desc.linearDamping);
    if (desc.angularDamping !== undefined) bd = bd.setAngularDamping(desc.angularDamping);
    if (desc.gravityScale !== undefined) bd = bd.setGravityScale(desc.gravityScale);
    if (desc.ccd) bd = bd.setCcdEnabled(true);
    if (desc.lockRotations) bd = bd.lockRotations();
    if (desc.linearVelocity) bd = bd.setLinvel(desc.linearVelocity[0], desc.linearVelocity[1], desc.linearVelocity[2]);
    if (desc.angularVelocity) bd = bd.setAngvel(vec(desc.angularVelocity));
    const layer = desc.layer ?? Layer.Prop;
    const mask = desc.mask ?? ALL_LAYERS;
    let cd = colliderDescOf(desc.shape)
      .setFriction(desc.friction ?? 0.5)
      .setRestitution(desc.restitution ?? 0)
      .setCollisionGroups(collisionGroups(layer, mask))
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    if (desc.mass !== undefined) cd = cd.setMass(desc.mass);
    else cd = cd.setDensity(desc.density ?? 1);
    if (desc.sensor) cd = cd.setSensor(true).setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
    const rb = this.raw.createRigidBody(bd);
    const col = this.raw.createCollider(cd, rb);
    return this.register(rb, col, desc.type, layer, mask, desc.sensor === true, desc.userData ?? 0, null);
  }

  /** Sugar: a static box (level geometry) on `Layer.Level`. */
  addStaticBox(halfExtents: Vec3, position: Vec3, opts: Omit<BodyDesc, "type" | "shape" | "position"> = {}): BodyId {
    return this.addBody({ layer: Layer.Level, ...opts, type: "static", shape: { box: halfExtents }, position });
  }

  /** Sugar: a trigger volume on `Layer.Trigger` (reports enter and exit, pushes nothing). */
  addTrigger(shape: ShapeDesc, position: Vec3, opts: Omit<BodyDesc, "type" | "shape" | "position" | "sensor"> = {}): BodyId {
    return this.addBody({ layer: Layer.Trigger, ...opts, type: "static", shape, position, sensor: true });
  }

  removeBody(id: BodyId): void {
    const rec = this.rec(id);
    const rb = this.raw.getRigidBody(rec.handle);
    if (rec.char) this.raw.removeCharacterController(rec.char.kcc);
    this.raw.removeRigidBody(rb);
    this.bodies.delete(id);
    this.byCollider.delete(rec.collider);
    this.forced.delete(id);
    this.dirty = true;
  }

  has(id: BodyId): boolean {
    return this.bodies.has(id);
  }

  userData(id: BodyId): number {
    return this.rec(id).userData;
  }

  bodyType(id: BodyId): BodyType {
    return this.rec(id).type;
  }

  /** Every live BodyId, ascending. */
  bodyIds(): BodyId[] {
    return [...this.bodies.keys()];
  }

  position(id: BodyId): Vec3 {
    return v3(this.body(id).translation());
  }

  rotation(id: BodyId): Quat {
    const r = this.body(id).rotation();
    return [r.x, r.y, r.z, r.w];
  }

  velocity(id: BodyId): Vec3 {
    const rec = this.rec(id);
    if (rec.char) return [rec.char.state.vx, rec.char.state.vy, rec.char.state.vz];
    return v3(this.body(id).linvel());
  }

  angularVelocity(id: BodyId): Vec3 {
    return v3(this.body(id).angvel());
  }

  mass(id: BodyId): number {
    const rec = this.rec(id);
    return rec.char ? rec.char.desc.mass : this.body(id).mass();
  }

  /** Teleport a body (or a character). */
  setPosition(id: BodyId, p: Vec3): void {
    checkVec("position", p);
    const rec = this.rec(id);
    const rb = this.body(id);
    rb.setTranslation(vec(p), true);
    if (rec.type === "kinematic") rb.setNextKinematicTranslation(vec(p));
    if (rec.char) {
      rec.char.state.x = p[0];
      rec.char.state.y = p[1];
      rec.char.state.z = p[2];
    }
    this.raw.propagateModifiedBodyPositionsToColliders();
    this.dirty = true;
  }

  setRotation(id: BodyId, q: Quat): void {
    const rb = this.body(id);
    const r = { x: q[0], y: q[1], z: q[2], w: q[3] };
    rb.setRotation(r, true);
    if (this.rec(id).type === "kinematic") rb.setNextKinematicRotation(r);
    this.raw.propagateModifiedBodyPositionsToColliders();
    this.dirty = true;
  }

  setLinearVelocity(id: BodyId, v: Vec3): void {
    checkVec("velocity", v);
    const rec = this.rec(id);
    if (rec.char) {
      rec.char.state.vx = v[0];
      rec.char.state.vy = v[1];
      rec.char.state.vz = v[2];
      return;
    }
    this.body(id).setLinvel(vec(v), true);
  }

  setAngularVelocity(id: BodyId, v: Vec3): void {
    checkVec("angular velocity", v);
    this.body(id).setAngvel(vec(v), true);
  }

  /** An instant change of momentum (N·s). Characters take it as a velocity change of impulse / mass. */
  applyImpulse(id: BodyId, impulse: Vec3): void {
    checkVec("impulse", impulse);
    const rec = this.rec(id);
    if (rec.char) {
      const m = rec.char.desc.mass;
      rec.char.state.vx += impulse[0] / m;
      rec.char.state.vy += impulse[1] / m;
      rec.char.state.vz += impulse[2] / m;
      if (impulse[1] > 0) rec.char.state.grounded = false;
      return;
    }
    this.body(id).applyImpulse(vec(impulse), true);
  }

  /** A force (N) applied during the next step only. */
  applyForce(id: BodyId, force: Vec3): void {
    checkVec("force", force);
    const rec = this.rec(id);
    if (rec.type !== "dynamic") return;
    this.body(id).addForce(vec(force), true);
    this.forced.add(id);
  }

  /**
   * Knock a body away from a point: a horizontal velocity change of
   * `strength` m/s (plus `lift` upward). With `byMass` the change is divided
   * by the body's mass, so heavy bodies barely move. Works on characters.
   */
  applyKnockback(id: BodyId, from: Vec3, strength: number, opts: KnockbackOptions = {}): void {
    const p = this.position(id);
    let dx = p[0] - from[0];
    let dz = p[2] - from[2];
    const l = Math.sqrt(dx * dx + dz * dz);
    if (l > 1e-9) {
      dx /= l;
      dz /= l;
    } else {
      dx = 0;
      dz = -1;
    }
    const lift = opts.lift ?? 0;
    const m = this.mass(id);
    const k = opts.byMass ? 1 / Math.max(1e-6, m) : 1;
    const rec = this.rec(id);
    if (rec.type !== "dynamic" && !rec.char) return;
    // An impulse of m * dv gives exactly dv.
    this.applyImpulse(id, [dx * strength * k * m, lift * k * m, dz * strength * k * m]);
  }

  /** Move a kinematic body to this pose over the next step (it pushes dynamic bodies on the way). */
  setKinematicTarget(id: BodyId, p: Vec3, q?: Quat): void {
    const rec = this.rec(id);
    if (rec.type !== "kinematic" || rec.char) throw new Error(`engine-sim physics: body ${id} is not a plain kinematic body`);
    checkVec("position", p);
    const rb = this.body(id);
    rb.setNextKinematicTranslation(vec(p));
    if (q) rb.setNextKinematicRotation({ x: q[0], y: q[1], z: q[2], w: q[3] });
  }

  wake(id: BodyId): void {
    this.body(id).wakeUp();
  }

  sleep(id: BodyId): void {
    this.body(id).sleep();
  }

  isSleeping(id: BodyId): boolean {
    return this.body(id).isSleeping();
  }

  // ------------------------------------------------------------ joints

  addJoint(desc: JointDesc): JointId {
    const a = this.body(desc.a);
    const b = this.body(desc.b);
    const anchorA = vec(desc.anchorA ?? [0, 0, 0]);
    const anchorB = vec(desc.anchorB ?? [0, 0, 0]);
    const axis = vec(normalize(desc.axis ?? [0, 1, 0]));
    const ident = { x: 0, y: 0, z: 0, w: 1 };
    const data =
      desc.kind === "fixed"
        ? RAPIER.JointData.fixed(anchorA, ident, anchorB, ident)
        : desc.kind === "ball"
          ? RAPIER.JointData.spherical(anchorA, anchorB)
          : desc.kind === "hinge"
            ? RAPIER.JointData.revolute(anchorA, anchorB, axis)
            : RAPIER.JointData.prismatic(anchorA, anchorB, axis);
    const j: ImpulseJoint = this.raw.createImpulseJoint(data, a, b, true);
    const id = this.nextJoint++;
    this.joints.set(id, j.handle);
    return id;
  }

  removeJoint(id: JointId): void {
    const h = this.joints.get(id);
    if (h === undefined) return;
    this.raw.removeImpulseJoint(this.raw.getImpulseJoint(h), true);
    this.joints.delete(id);
  }

  // ------------------------------------------------------------ characters

  /** Add a kinematic character (capsule) driven by `step(inputs)`. Returns its BodyId. */
  addCharacter(desc: CharacterDesc): BodyId {
    this.alive();
    checkVec("position", desc.position);
    const d = resolveCharacter(desc);
    const [x, y, z] = d.position;
    const rb = this.raw.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z));
    const col = this.raw.createCollider(
      RAPIER.ColliderDesc.capsule(d.halfHeight, d.radius)
        .setCollisionGroups(collisionGroups(d.layer, d.mask))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
        .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.DEFAULT),
      rb,
    );
    const char: CharRec = { desc: d, state: initialCharacterState(d), kcc: configureKcc(this.raw, d) };
    return this.register(rb, col, "kinematic", d.layer, d.mask, false, d.userData, char);
  }

  /** A copy of a character's motor state. */
  characterState(id: BodyId): CharacterState {
    const c = this.rec(id).char;
    if (!c) throw new Error(`engine-sim physics: body ${id} is not a character`);
    return { ...c.state };
  }

  /** Overwrite a character's motor state (netcode reconcile). Also moves its body. */
  setCharacterState(id: BodyId, s: CharacterState): void {
    const c = this.rec(id).char;
    if (!c) throw new Error(`engine-sim physics: body ${id} is not a character`);
    c.state = { ...s };
    const rb = this.body(id);
    rb.setTranslation({ x: s.x, y: s.y, z: s.z }, true);
    rb.setNextKinematicTranslation({ x: s.x, y: s.y, z: s.z });
    this.raw.propagateModifiedBodyPositionsToColliders();
    this.dirty = true;
  }

  isCharacter(id: BodyId): boolean {
    return this.rec(id).char !== null;
  }

  // ------------------------------------------------------------ step

  /**
   * Advance one fixed step: characters move first (BodyId order) with their
   * inputs (missing ones get no input), then Rapier integrates every body.
   * Events and character reports come back sorted.
   */
  step(inputs?: ReadonlyMap<BodyId, CharacterInput>): PhysicsStepResult {
    this.alive();
    this.flush();
    const reports: CharacterReport[] = [];
    for (const rec of this.bodies.values()) {
      if (rec.char) reports.push(this.moveCharacter(rec, rec.char, inputs?.get(rec.id) ?? NEUTRAL));
    }
    this.raw.step(this.queue);
    for (const id of this.forced) {
      const rec = this.bodies.get(id);
      if (rec) this.raw.getRigidBody(rec.handle).resetForces(false);
    }
    this.forced.clear();
    this.drain();
    this.ticks++;
    const events = this.pending.sort((x, y) => x.a - y.a || x.b - y.b || EVENT_RANK[x.type] - EVENT_RANK[y.type]);
    this.pending = [];
    return { tick: this.ticks, events, characters: reports };
  }

  private moveCharacter(rec: BodyRec, c: CharRec, input: CharacterInput): CharacterReport {
    const d = c.desc;
    const s = c.state;
    const dt = this.dt;
    const rb = this.raw.getRigidBody(rec.handle);
    const col = this.raw.getCollider(rec.collider);
    const t = rb.translation();
    s.x = t.x;
    s.y = t.y;
    s.z = t.z;

    const buttons = (input.jump ? BTN_JUMP : 0) | (input.dash ? BTN_DASH : 0);
    const pressed = buttons & ~s.buttons;
    s.buttons = buttons;
    if ((pressed & BTN_JUMP) !== 0) s.jumpBuffer = d.jumpBufferTicks + 1;
    if ((pressed & BTN_DASH) !== 0) s.dashBuffer = d.dashBufferTicks + 1;
    if (s.grounded) s.coyote = d.coyoteTicks + 1;

    let mx = Number.isFinite(input.moveX) ? input.moveX : 0;
    let mz = Number.isFinite(input.moveZ) ? input.moveZ : 0;
    const ml = Math.sqrt(mx * mx + mz * mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }
    if (ml > 1e-6) {
      const inv = 1 / Math.sqrt(mx * mx + mz * mz);
      s.facingX = mx * inv;
      s.facingZ = mz * inv;
    }

    let dashed = false;
    if (d.dashTicks > 0 && s.dashBuffer > 0 && s.dashCooldown === 0 && s.dashTicks === 0) {
      s.dashTicks = d.dashTicks;
      s.dashCooldown = d.dashCooldownTicks;
      s.dashBuffer = 0;
      s.dashX = s.facingX;
      s.dashZ = s.facingZ;
      dashed = true;
    }

    const wasGrounded = s.grounded;
    let jumped = false;
    if (s.dashTicks > 0) {
      s.vx = s.dashX * d.dashSpeed;
      s.vz = s.dashZ * d.dashSpeed;
      s.vy = Math.max(0, s.vy);
    } else {
      const tx = mx * d.maxSpeed;
      const tz = mz * d.maxSpeed;
      const steering = ml > 1e-6;
      const accel = s.grounded ? (steering ? d.groundAccel : d.groundDecel) : steering ? d.airAccel : d.airDecel;
      [s.vx, s.vz] = approach2(s.vx, s.vz, tx, tz, accel * dt);
      s.vy += this.gravity[1] * d.gravityScale * dt;
      if (s.vy < -d.terminalVelocity) s.vy = -d.terminalVelocity;
    }
    if (s.jumpBuffer > 0 && s.coyote > 0) {
      s.vy = d.jumpVelocity;
      s.jumpBuffer = 0;
      s.coyote = 0;
      s.jumping = true;
      s.grounded = false;
      jumped = true;
    }
    if (s.jumping && (buttons & BTN_JUMP) === 0 && s.vy > 0) {
      s.vy *= d.jumpCut;
      s.jumping = false;
    }
    if (s.vy <= 0) s.jumping = false;

    const want = { x: s.vx * dt, y: s.vy * dt, z: s.vz * dt };
    c.kcc.computeColliderMovement(col, want, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, collisionGroups(d.layer, d.mask));
    const m = c.kcc.computedMovement();
    let grounded = c.kcc.computedGrounded() && !jumped;
    let nx = 0;
    let ny = 1;
    let nz = 0;
    let bestY = -2;
    const n = c.kcc.numComputedCollisions();
    for (let i = 0; i < n; i++) {
      const hit = c.kcc.computedCollision(i);
      if (!hit) continue;
      // normal1 is the obstacle's surface normal at the contact (it points up on the floor).
      const cx = hit.normal1.x;
      const cy = hit.normal1.y;
      const cz = hit.normal1.z;
      if (cy > bestY) {
        bestY = cy;
        nx = cx;
        ny = cy;
        nz = cz;
      }
    }
    // Standing on a face steeper than maxSlopeClimb is sliding, not standing:
    // not grounded (no jump, no coyote) and velocity follows the slide so it builds.
    let sliding = false;
    if (grounded && bestY > -2 && ny < Math.cos((d.maxSlopeClimb * Math.PI) / 180) - 1e-4) {
      grounded = false;
      sliding = true;
    }
    let hitCeiling = false;
    if (s.vy > 0 && m.y < want.y * 0.5 - 1e-6) {
      s.vy = 0;
      s.jumping = false;
      hitCeiling = true;
    }
    if (grounded && s.vy < 0) s.vy = 0;
    if (sliding) {
      s.vx = m.x / dt;
      s.vy = Math.min(0, m.y / dt);
      s.vz = m.z / dt;
    }
    // Blocked sideways (a wall): keep only what actually moved, so velocity does not build up against it.
    if (s.dashTicks === 0 && !sliding) {
      if (Math.abs(m.x) + 1e-6 < Math.abs(want.x)) s.vx = m.x / dt;
      if (Math.abs(m.z) + 1e-6 < Math.abs(want.z)) s.vz = m.z / dt;
    }
    s.x = t.x + m.x;
    s.y = t.y + m.y;
    s.z = t.z + m.z;
    rb.setNextKinematicTranslation({ x: s.x, y: s.y, z: s.z });

    s.grounded = grounded;
    if (grounded) {
      s.groundNormalX = nx;
      s.groundNormalY = ny;
      s.groundNormalZ = nz;
    } else {
      s.groundNormalX = 0;
      s.groundNormalY = 1;
      s.groundNormalZ = 0;
    }
    if (s.coyote > 0) s.coyote--;
    if (s.jumpBuffer > 0) s.jumpBuffer--;
    if (s.dashTicks > 0) s.dashTicks--;
    else if (s.dashCooldown > 0) s.dashCooldown--;
    if (s.dashBuffer > 0) s.dashBuffer--;
    s.invulnerable = d.dashInvulnerable && s.dashTicks > 0;
    return {
      id: rec.id,
      grounded,
      landed: grounded && !wasGrounded,
      jumped,
      dashed,
      hitCeiling,
      groundNormal: [s.groundNormalX, s.groundNormalY, s.groundNormalZ],
    };
  }

  // ------------------------------------------------------------ queries

  /** The first body along a ray within `maxDist`, or null. */
  raycast(origin: Vec3, dir: Vec3, maxDist: number, opts: QueryOptions = {}): RayHit | null {
    this.alive();
    this.flush();
    checkVec("origin", origin);
    const d = normalize(dir);
    const hit = this.raw.castRayAndGetNormal(
      new RAPIER.Ray(vec(origin), vec(d)),
      maxDist,
      true,
      this.flags(opts),
      queryGroups(opts.mask ?? ALL_LAYERS),
      undefined,
      undefined,
      this.predicate(opts),
    );
    if (!hit) return null;
    const body = this.byCollider.get(hit.collider.handle);
    if (body === undefined) return null;
    const t = hit.timeOfImpact;
    return { body, distance: t, point: [origin[0] + d[0] * t, origin[1] + d[1] * t, origin[2] + d[2] * t], normal: v3(hit.normal) };
  }

  /** Every body along a ray within `maxDist`, nearest first (ties by BodyId). */
  raycastAll(origin: Vec3, dir: Vec3, maxDist: number, opts: QueryOptions = {}): RayHit[] {
    this.alive();
    this.flush();
    checkVec("origin", origin);
    const d = normalize(dir);
    const out: RayHit[] = [];
    this.raw.intersectionsWithRay(
      new RAPIER.Ray(vec(origin), vec(d)),
      maxDist,
      true,
      (hit) => {
        const body = this.byCollider.get(hit.collider.handle);
        if (body !== undefined) {
          const t = hit.timeOfImpact;
          out.push({ body, distance: t, point: [origin[0] + d[0] * t, origin[1] + d[1] * t, origin[2] + d[2] * t], normal: v3(hit.normal) });
        }
        return true;
      },
      this.flags(opts),
      queryGroups(opts.mask ?? ALL_LAYERS),
      undefined,
      undefined,
      this.predicate(opts),
    );
    return out.sort((a, b) => a.distance - b.distance || a.body - b.body);
  }

  /** Sweep a shape from `from` along `dir` up to `maxDist`; the first body it would touch, or null. */
  shapeCast(shape: ShapeDesc, from: Vec3, dir: Vec3, maxDist: number, opts: QueryOptions & { rotation?: Quat } = {}): ShapeHit | null {
    this.alive();
    this.flush();
    checkVec("from", from);
    const d = normalize(dir);
    const q = opts.rotation ?? [0, 0, 0, 1];
    const hit = this.raw.castShape(
      vec(from),
      { x: q[0], y: q[1], z: q[2], w: q[3] },
      vec(d),
      shapeOf(shape),
      0,
      maxDist,
      true,
      this.flags(opts),
      queryGroups(opts.mask ?? ALL_LAYERS),
      undefined,
      undefined,
      this.predicate(opts),
    );
    if (!hit) return null;
    const body = this.byCollider.get(hit.collider.handle);
    if (body === undefined) return null;
    return { body, distance: hit.time_of_impact, point: v3(hit.witness1), normal: v3(hit.normal1) };
  }

  /** Bodies overlapping a shape placed at `position`, ascending BodyId. */
  overlap(shape: ShapeDesc, position: Vec3, opts: QueryOptions & { rotation?: Quat } = {}): BodyId[] {
    this.alive();
    this.flush();
    checkVec("position", position);
    const q = opts.rotation ?? [0, 0, 0, 1];
    const out: BodyId[] = [];
    this.raw.intersectionsWithShape(
      vec(position),
      { x: q[0], y: q[1], z: q[2], w: q[3] },
      shapeOf(shape),
      (c) => {
        const body = this.byCollider.get(c.handle);
        if (body !== undefined) out.push(body);
        return true;
      },
      this.flags(opts),
      queryGroups(opts.mask ?? ALL_LAYERS),
      undefined,
      undefined,
      this.predicate(opts),
    );
    return out.sort((a, b) => a - b);
  }

  // ------------------------------------------------------------ state

  /**
   * A hash of every body's pose and velocity and every character's motor
   * state, over their raw float64 bits in BodyId order. Equal hashes mean
   * bit-identical worlds.
   */
  stateHash(): number {
    this.alive();
    const h = new BitHash().int(this.ticks).int(this.bodies.size);
    for (const rec of this.bodies.values()) {
      const rb = this.raw.getRigidBody(rec.handle);
      const t = rb.translation();
      const r = rb.rotation();
      const lv = rb.linvel();
      const av = rb.angvel();
      h.int(rec.id).num(t.x).num(t.y).num(t.z).num(r.x).num(r.y).num(r.z).num(r.w);
      h.num(lv.x).num(lv.y).num(lv.z).num(av.x).num(av.y).num(av.z).bool(rb.isSleeping());
      const c = rec.char?.state;
      if (c) {
        h.num(c.x).num(c.y).num(c.z).num(c.vx).num(c.vy).num(c.vz).bool(c.grounded).int(c.coyote).int(c.jumpBuffer).bool(c.jumping);
        h.int(c.dashTicks).int(c.dashCooldown).int(c.dashBuffer).num(c.dashX).num(c.dashZ).num(c.facingX).num(c.facingZ);
        h.bool(c.invulnerable).int(c.buttons).num(c.groundNormalX).num(c.groundNormalY).num(c.groundNormalZ);
      }
    }
    return h.value;
  }

  /** FNV-1a of `snapshot()` bytes (stricter than `stateHash`: includes contact caches and islands). */
  snapshotHash(): number {
    return new BitHash().bytes(this.snapshot()).value;
  }

  /**
   * The whole world as bytes: Rapier's own snapshot plus this wrapper's ids,
   * characters and joints. `restorePhysics(bytes)` rebuilds it. Take it
   * between steps.
   */
  snapshot(): Uint8Array {
    this.alive();
    const meta: Meta = {
      v: SNAPSHOT_FORMAT,
      tick: this.ticks,
      tickRate: this.tickRate,
      gravity: [this.gravity[0], this.gravity[1], this.gravity[2]],
      nextBody: this.nextBody,
      nextJoint: this.nextJoint,
      dirty: this.dirty,
      forced: [...this.forced].sort((a, b) => a - b),
      bodies: [...this.bodies.values()].map((r) => [r.id, r.handle, r.collider, BODY_TYPES.indexOf(r.type), r.layer, r.mask, r.sensor ? 1 : 0, r.userData]),
      chars: [...this.bodies.values()].flatMap((r) => (r.char ? [[r.id, r.char.desc, { ...r.char.state }] as Meta["chars"][number]] : [])),
      joints: [...this.joints.entries()],
    };
    const json = JSON.stringify(meta);
    const world = this.raw.takeSnapshot();
    const out = new Uint8Array(12 + json.length + world.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, SNAPSHOT_MAGIC);
    view.setUint32(4, SNAPSHOT_FORMAT);
    view.setUint32(8, json.length);
    for (let i = 0; i < json.length; i++) out[12 + i] = json.charCodeAt(i) & 0x7f;
    out.set(world, 12 + json.length);
    return out;
  }

  /** Free the Rapier memory. The world is unusable afterwards. */
  destroy(): void {
    if (this.destroyed) return;
    for (const rec of this.bodies.values()) if (rec.char) rec.char.kcc.free();
    this.queue.free();
    this.raw.free();
    this.destroyed = true;
  }

  // ------------------------------------------------------------ internals

  private load(meta: Meta): void {
    this.ticks = meta.tick;
    this.nextBody = meta.nextBody;
    this.nextJoint = meta.nextJoint;
    this.dirty = meta.dirty;
    const chars = new Map(meta.chars.map(([id, desc, state]) => [id, { desc, state }]));
    for (const [id, handle, collider, type, layer, mask, sensor, userData] of meta.bodies) {
      const c = chars.get(id);
      const char: CharRec | null = c ? { desc: c.desc, state: { ...c.state }, kcc: configureKcc(this.raw, c.desc) } : null;
      this.bodies.set(id, { id, handle, collider, type: BODY_TYPES[type] ?? "static", layer, mask, sensor: sensor === 1, userData, char });
      this.byCollider.set(collider, id);
    }
    for (const [id, handle] of meta.joints) this.joints.set(id, handle);
    for (const id of meta.forced) this.forced.add(id);
  }

  private register(rb: RigidBody, col: Collider, type: BodyType, layer: number, mask: number, sensor: boolean, userData: number, char: CharRec | null): BodyId {
    const id = this.nextBody++;
    this.bodies.set(id, { id, handle: rb.handle, collider: col.handle, type, layer, mask, sensor, userData, char });
    this.byCollider.set(col.handle, id);
    this.dirty = true;
    return id;
  }

  /**
   * Rapier's scene queries only see colliders after a step. When bodies were
   * added, removed or teleported since the last one, run a zero-length step
   * (nothing moves) so queries and characters see the current world. Its
   * events are kept for the next `step()` result.
   */
  private flush(): void {
    if (!this.dirty) return;
    this.raw.timestep = 0;
    this.raw.step(this.queue);
    this.raw.timestep = this.dt;
    this.drain();
    this.dirty = false;
  }

  private drain(): void {
    this.queue.drainCollisionEvents((h1, h2, started) => {
      const a = this.byCollider.get(h1);
      const b = this.byCollider.get(h2);
      if (a === undefined || b === undefined) return;
      const ra = this.bodies.get(a);
      const rbb = this.bodies.get(b);
      const trigger = (ra?.sensor ?? false) || (rbb?.sensor ?? false);
      const type: PhysicsEventType = trigger ? (started ? "trigger.enter" : "trigger.exit") : started ? "contact.start" : "contact.end";
      this.pending.push({ type, a: Math.min(a, b), b: Math.max(a, b) });
    });
  }

  private flags(opts: QueryOptions): number {
    return opts.includeSensors ? 0 : RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
  }

  private predicate(opts: QueryOptions): ((c: Collider) => boolean) | undefined {
    const ex = opts.exclude;
    if (!ex || ex.length === 0) return undefined;
    const set = new Set(ex);
    return (c) => {
      const id = this.byCollider.get(c.handle);
      return id === undefined || !set.has(id);
    };
  }

  private alive(): void {
    if (this.destroyed) throw new Error("engine-sim physics: world was destroyed");
  }

  private rec(id: BodyId): BodyRec {
    this.alive();
    const r = this.bodies.get(id);
    if (!r) throw new Error(`engine-sim physics: no body ${id}`);
    return r;
  }

  private body(id: BodyId): RigidBody {
    return this.raw.getRigidBody(this.rec(id).handle);
  }
}
