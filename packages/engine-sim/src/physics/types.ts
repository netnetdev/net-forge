import type { Vec3 } from "../api.js";

/** A stable id for one body in a PhysicsWorld (u32, assigned in creation order, never reused). */
export type BodyId = number;
/** A stable id for one joint. */
export type JointId = number;
/** Quaternion [x, y, z, w]. */
export type Quat = readonly [x: number, y: number, z: number, w: number];

export type BodyType = "dynamic" | "kinematic" | "static";

/** Collision shapes. Capsules and cylinders stand along +y. */
export type ShapeDesc =
  | { readonly box: Vec3 }
  | { readonly sphere: number }
  | { readonly capsule: readonly [halfHeight: number, radius: number] }
  | { readonly cylinder: readonly [halfHeight: number, radius: number] };

export interface BodyDesc {
  readonly type: BodyType;
  readonly shape: ShapeDesc;
  readonly position?: Vec3;
  readonly rotation?: Quat;
  /** Total mass, kg. Overrides `density`. */
  readonly mass?: number;
  /** kg/m³. Default 1. */
  readonly density?: number;
  /** Default 0.5. */
  readonly friction?: number;
  /** 0 (dead) to 1 (perfect bounce). Default 0. */
  readonly restitution?: number;
  readonly linearDamping?: number;
  readonly angularDamping?: number;
  /** Default 1. */
  readonly gravityScale?: number;
  /** One `Layer` bit. Default `Layer.Prop`. */
  readonly layer?: number;
  /** `Layer` bits this body collides with. Default every layer. */
  readonly mask?: number;
  /** A trigger volume: reports enter and exit, never pushes anything. */
  readonly sensor?: boolean;
  /** Continuous collision detection: fast bodies (projectiles) never tunnel through thin walls. */
  readonly ccd?: boolean;
  /** Keep the body upright (no rotation from contacts). */
  readonly lockRotations?: boolean;
  /** Initial velocities. */
  readonly linearVelocity?: Vec3;
  readonly angularVelocity?: Vec3;
  /** Any number the game wants back from queries and events (e.g. a NetId). Default 0. */
  readonly userData?: number;
}

export type PhysicsEventType = "contact.start" | "contact.end" | "trigger.enter" | "trigger.exit";

/** A contact or trigger change during one step. `a < b`; for triggers one of them is the sensor. */
export interface PhysicsEvent {
  readonly type: PhysicsEventType;
  readonly a: BodyId;
  readonly b: BodyId;
}

export interface RayHit {
  readonly body: BodyId;
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly distance: number;
}

export interface ShapeHit {
  readonly body: BodyId;
  /** Distance travelled along the cast direction before touching. */
  readonly distance: number;
  /** Contact point on the hit body. */
  readonly point: Vec3;
  /** Surface normal of the hit body at the contact. */
  readonly normal: Vec3;
}

export interface QueryOptions {
  /** `Layer` bits to look at. Default every layer. */
  readonly mask?: number;
  /** Bodies to ignore (e.g. the shooter). */
  readonly exclude?: readonly BodyId[];
  /** Include trigger volumes. Default false. */
  readonly includeSensors?: boolean;
}

export type JointKind = "fixed" | "ball" | "hinge" | "slider";

export interface JointDesc {
  readonly kind: JointKind;
  readonly a: BodyId;
  readonly b: BodyId;
  /** Anchor in body a's local frame. Default origin. */
  readonly anchorA?: Vec3;
  /** Anchor in body b's local frame. Default origin. */
  readonly anchorB?: Vec3;
  /** Hinge or slider axis (local). Default +y. */
  readonly axis?: Vec3;
}

export interface KnockbackOptions {
  /** Upward velocity added, m/s. Default 0. */
  readonly lift?: number;
  /** Divide the velocity change by the body's mass (heavy bodies move less). Default false: every mass gets `strength` m/s. */
  readonly byMass?: boolean;
}

// ------------------------------------------------------------ characters

/** A kinematic character (capsule on Rapier's character controller). All fields optional except where noted. */
export interface CharacterDesc {
  readonly position: Vec3;
  readonly radius?: number;
  /** Half-height of the capsule's cylinder, m. */
  readonly halfHeight?: number;
  /** Default `Layer.Player`. */
  readonly layer?: number;
  /** Layers the character collides with. Default Level | Prop | Enemy | Player | Trigger (triggers report it, never block it). */
  readonly mask?: number;
  /** Controller skin, m. Default 0.02. */
  readonly offset?: number;
  /** Steepest walkable slope, degrees. Default 45. */
  readonly maxSlopeClimb?: number;
  /** Slopes steeper than this slide the character down, degrees. Default 50. */
  readonly minSlopeSlide?: number;
  /** Auto-step height and minimum free width on top, m. Height 0 disables steps. Default 0.35 / 0.2. */
  readonly stepHeight?: number;
  readonly stepWidth?: number;
  /** Climb steps onto dynamic bodies too. Default false. */
  readonly stepOverDynamic?: boolean;
  /** Keep contact with the ground going down small drops, m. 0 disables. Default 0.3. */
  readonly snapToGround?: number;
  /** Top ground speed, m/s. Default 6. */
  readonly maxSpeed?: number;
  /** Ground acceleration toward the stick and deceleration with no stick, m/s². Default 60 / 80. */
  readonly groundAccel?: number;
  readonly groundDecel?: number;
  /** Air control: acceleration and deceleration in the air, m/s². Default 18 / 4. */
  readonly airAccel?: number;
  readonly airDecel?: number;
  /** Jump take-off speed, m/s. Default 7. */
  readonly jumpVelocity?: number;
  /** Releasing jump while rising multiplies upward speed by this (variable jump height). 1 disables. Default 0.45. */
  readonly jumpCut?: number;
  /** Multiplies the world's gravity. Default 1. */
  readonly gravityScale?: number;
  /** Fastest fall, m/s. Default 40. */
  readonly terminalVelocity?: number;
  /** Ticks after leaving a ledge during which a jump still works. Default 5. */
  readonly coyoteTicks?: number;
  /** Ticks a jump press is remembered before landing. Default 5. */
  readonly jumpBufferTicks?: number;
  /** Dash: duration in ticks (0 disables), speed m/s, cooldown ticks, input buffer ticks, invulnerable while dashing. */
  readonly dashTicks?: number;
  readonly dashSpeed?: number;
  readonly dashCooldownTicks?: number;
  readonly dashBufferTicks?: number;
  readonly dashInvulnerable?: boolean;
  /** Push dynamic bodies the character walks into. Default true. */
  readonly pushBodies?: boolean;
  /** Mass used when pushing, kg. Default 80. */
  readonly mass?: number;
  readonly userData?: number;
}

export type ResolvedCharacterDesc = Required<Omit<CharacterDesc, "position">> & { readonly position: Vec3 };

/** One tick of character input. Move is in world space (x right, z toward the camera), -1..1. */
export interface CharacterInput {
  readonly moveX: number;
  readonly moveZ: number;
  /** Held. Pressed edges are found inside the motor. */
  readonly jump?: boolean;
  readonly dash?: boolean;
}

/** A character's whole motor state: plain numbers, serialized in snapshots. */
export interface CharacterState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  /** Coyote ticks left. */
  coyote: number;
  /** Buffered jump ticks left. */
  jumpBuffer: number;
  /** Rising from a jump that can still be cut. */
  jumping: boolean;
  dashTicks: number;
  dashCooldown: number;
  dashBuffer: number;
  dashX: number;
  dashZ: number;
  /** Last horizontal move direction (dash with no stick goes this way). Starts facing -z. */
  facingX: number;
  facingZ: number;
  invulnerable: boolean;
  /** Last held buttons: 1 jump, 2 dash. */
  buttons: number;
  groundNormalX: number;
  groundNormalY: number;
  groundNormalZ: number;
}

export interface CharacterReport {
  readonly id: BodyId;
  readonly grounded: boolean;
  readonly landed: boolean;
  readonly jumped: boolean;
  readonly dashed: boolean;
  readonly hitCeiling: boolean;
  readonly groundNormal: Vec3;
}

export interface PhysicsStepResult {
  /** world tick after the step. */
  readonly tick: number;
  readonly events: readonly PhysicsEvent[];
  /** One report per character, in BodyId order. */
  readonly characters: readonly CharacterReport[];
}
