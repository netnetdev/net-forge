import { PerspectiveCamera, Vector3 } from "three/webgpu";
import type { Camera } from "three/webgpu";
import { Spring, stepSpring } from "./feel/spring.js";
import { Trauma } from "./feel/trauma.js";
import type { TraumaOptions } from "./feel/trauma.js";
import { damp } from "./interpolate.js";

export interface CameraRigOptions {
  readonly distance?: number;
  readonly height?: number;
  readonly minPitch?: number;
  readonly maxPitch?: number;
  /** Follow stiffness, 1/s. Higher is tighter (a critically damped spring, no overshoot). */
  readonly follow?: number;
  /** Seconds of target velocity the camera looks ahead by (camera lead, §13). */
  readonly lead?: number;
  /** Largest look-ahead, m. Default 6 (a teleport never flings the camera). */
  readonly leadMax?: number;
  /** How fast the look-ahead itself settles, 1/s (0 = instant). Default 10. */
  readonly leadSmoothing?: number;
  /** The target may move this far (m, ground plane) before the camera follows. Default 0. */
  readonly deadZone?: number;
  readonly fov?: number;
  /** Trauma shake tuning (maxOffset in m, maxRoll in rad, decay per second). */
  readonly shake?: TraumaOptions;
  /** FOV punch spring: frequency Hz and damping ratio. Default 4 Hz, 0.55. */
  readonly punchFrequency?: number;
  readonly punchDamping?: number;
  /**
   * Keep the visible ground inside these bounds (world x/z, m): near a wall
   * the camera stops instead of showing the void past it. Pass the play
   * field plus however much dressed outside ground should show.
   */
  readonly bounds?: GroundBounds | null;
  /** Height of the ground plane the bounds apply to. Default 0. */
  readonly groundY?: number;
}

/** A rectangle on the ground plane. */
export interface GroundBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Square bounds around the origin: a field of half size `half` plus `margin` of outside ground. */
export function fieldBounds(half: number, margin = 0): GroundBounds {
  const h = half + margin;
  return { minX: -h, maxX: h, minZ: -h, maxZ: h };
}

const CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
const _a = new Vector3();
const _b = new Vector3();

/**
 * The ground a camera sees: the box around where its four corner rays meet
 * the plane y = `groundY`. A ray at or above the horizon counts as reaching
 * `reach` m out along the ground. The camera's matrices must be current.
 */
export function groundFootprint(camera: Camera, groundY = 0, reach = 400): GroundBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const origin = _a.setFromMatrixPosition(camera.matrixWorld);
  const ox = origin.x;
  const oy = origin.y;
  const oz = origin.z;
  for (const [x, y] of CORNERS) {
    const p = _b.set(x, y, 0.5).unproject(camera);
    let dx = p.x - ox;
    const dy = p.y - oy;
    let dz = p.z - oz;
    let t: number;
    if (dy < -1e-6 && oy > groundY) t = (groundY - oy) / dy;
    else {
      // Above the horizon: as far as `reach` along the ground.
      const flat = Math.hypot(dx, dz) || 1;
      dx /= flat;
      dz /= flat;
      t = reach;
    }
    const gx = ox + dx * t;
    const gz = oz + dz * t;
    if (gx < minX) minX = gx;
    if (gx > maxX) maxX = gx;
    if (gz < minZ) minZ = gz;
    if (gz > maxZ) maxZ = gz;
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * How far to move a view so `seen` stays inside `bounds`, per axis: zero
 * when it already fits, the overshoot when it pokes out of one side, and
 * centring when it is wider than the bounds.
 */
export function boundsShift(seen: GroundBounds, bounds: GroundBounds): { x: number; z: number } {
  const axis = (lo: number, hi: number, min: number, max: number): number => {
    if (hi - lo >= max - min) return (min + max) / 2 - (lo + hi) / 2;
    if (lo < min) return min - lo;
    if (hi > max) return max - hi;
    return 0;
  };
  return { x: axis(seen.minX, seen.maxX, bounds.minX, bounds.maxX), z: axis(seen.minZ, seen.maxZ, bounds.minZ, bounds.maxZ) };
}

type Resolved = { -readonly [K in keyof Omit<CameraRigOptions, "shake" | "bounds">]-?: NonNullable<CameraRigOptions[K]> } & { shake: TraumaOptions };

/**
 * Third-person orbit-follow camera with the camera parts of the feel kit:
 * critically damped follow, smoothed and clamped lead, a dead zone, trauma
 * shake and FOV punches. `yaw` matches the sim's convention (0 looks down
 * -z), so the input layer can send the camera's yaw as the character's
 * facing. Shake is applied as a per-frame `offset` and `roll` on top of the
 * computed pose, so it never accumulates drift.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  yaw = 0;
  pitch = 0.45;
  /** Trauma shake (add with `addTrauma`). */
  readonly trauma: Trauma;
  /** This frame's shake offset (world, m) and roll (rad). */
  readonly offset = new Vector3();
  roll = 0;
  private readonly focus = new Vector3();
  private readonly focusVel = new Vector3();
  private readonly lastTarget = new Vector3();
  private readonly vel = new Vector3();
  private readonly leadVec = new Vector3();
  private readonly fovSpring: Spring;
  private initialised = false;
  private readonly o: Resolved;
  private bounds: GroundBounds | null;
  /** This frame's clamp shift (m, ground plane): non-zero while the bounds hold the camera back. */
  readonly clampShift = { x: 0, z: 0 };

  constructor(aspect: number, opts: CameraRigOptions = {}) {
    this.o = {
      distance: 9,
      height: 1.2,
      minPitch: -0.2,
      maxPitch: 1.35,
      follow: 12,
      lead: 0.15,
      leadMax: 6,
      leadSmoothing: 10,
      deadZone: 0,
      fov: 60,
      punchFrequency: 4,
      punchDamping: 0.55,
      groundY: 0,
      ...opts,
      shake: opts.shake ?? {},
    };
    this.bounds = opts.bounds ?? null;
    this.camera = new PerspectiveCamera(this.o.fov, aspect, 0.1, 500);
    this.trauma = new Trauma({ maxOffset: 0.6, maxRoll: 0.035, ...this.o.shake });
    this.fovSpring = new Spring(0, { frequency: this.o.punchFrequency, damping: this.o.punchDamping });
  }

  /** Camera distance from the focus, m (e.g. pull back on a portrait phone). */
  setDistance(metres: number): void {
    this.o.distance = metres;
  }

  /** Keep the visible ground inside `bounds` (null lets the camera follow anywhere). */
  setBounds(bounds: GroundBounds | null): void {
    this.bounds = bounds;
  }

  /** The point the camera looks at (after follow and lead). */
  get target(): Readonly<Vector3> {
    return this.focus;
  }

  /** Apply look input (radians). */
  look(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = Math.min(this.o.maxPitch, Math.max(this.o.minPitch, this.pitch + dPitch));
  }

  /** Add trauma 0..1 (game feel, §13): the shake is trauma squared, so small hits barely move it. */
  addTrauma(amount: number): void {
    this.trauma.add(amount);
  }

  /** The classic shake: about `amplitude` m of shake held for `seconds`, then fading. */
  shake(amplitude: number, seconds: number): void {
    this.trauma.add(this.trauma.traumaFor(amplitude));
    this.trauma.sustain(seconds * 0.5);
  }

  /** Kick the field of view by `degrees` (negative zooms in) and spring back. */
  punch(degrees: number): void {
    this.fovSpring.value = Math.max(-20, Math.min(20, this.fovSpring.value + degrees));
  }

  /** Current FOV offset from the punch spring, degrees. */
  get fovKick(): number {
    return this.fovSpring.value;
  }

  /**
   * Follow `target`. `dt` is the (hit-stop scaled) frame delta; pass
   * `realDt` so shake and punches keep moving during a hit-stop.
   */
  update(target: Vector3, dt: number, realDt: number = dt): void {
    if (!this.initialised) {
      this.focus.copy(target);
      this.lastTarget.copy(target);
      this.initialised = true;
    }
    if (dt > 0) {
      this.vel.subVectors(target, this.lastTarget).divideScalar(dt);
      this.lastTarget.copy(target);
      // Lead: velocity times lead seconds, clamped, then smoothed.
      let lx = this.vel.x * this.o.lead;
      let lz = this.vel.z * this.o.lead;
      const len = Math.hypot(lx, lz);
      if (len > this.o.leadMax) {
        lx *= this.o.leadMax / len;
        lz *= this.o.leadMax / len;
      }
      const k = this.o.leadSmoothing > 0 ? damp(this.o.leadSmoothing, dt) : 1;
      this.leadVec.x += (lx - this.leadVec.x) * k;
      this.leadVec.z += (lz - this.leadVec.z) * k;
    }
    let goalX = target.x + this.leadVec.x;
    let goalZ = target.z + this.leadVec.z;
    const goalY = target.y + this.o.height;
    if (this.o.deadZone > 0) {
      const dx = goalX - this.focus.x;
      const dz = goalZ - this.focus.z;
      const d = Math.hypot(dx, dz);
      if (d <= this.o.deadZone) {
        goalX = this.focus.x;
        goalZ = this.focus.z;
      } else {
        const s = (d - this.o.deadZone) / d;
        goalX = this.focus.x + dx * s;
        goalZ = this.focus.z + dz * s;
      }
    }
    if (dt > 0) {
      const w = 2 * this.o.follow;
      [this.focus.x, this.focusVel.x] = stepSpring(this.focus.x, this.focusVel.x, goalX, w, 1, dt);
      [this.focus.y, this.focusVel.y] = stepSpring(this.focus.y, this.focusVel.y, goalY, w, 1, dt);
      [this.focus.z, this.focusVel.z] = stepSpring(this.focus.z, this.focusVel.z, goalZ, w, 1, dt);
    }

    // Shake and punch run on real time.
    this.trauma.update(realDt);
    this.fovSpring.step(realDt);
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    // Camera right is (cos yaw, 0, -sin yaw); shake moves it sideways and up.
    this.offset.set(cy * this.trauma.x, this.trauma.y, -sy * this.trauma.x);
    this.roll = this.trauma.roll;

    const cp = Math.cos(this.pitch);
    const d = this.o.distance;
    this.camera.position.set(
      this.focus.x + sy * cp * d + this.offset.x,
      this.focus.y + Math.sin(this.pitch) * d + this.offset.y,
      this.focus.z + cy * cp * d + this.offset.z,
    );
    this.camera.lookAt(this.focus.x + this.offset.x, this.focus.y + this.offset.y, this.focus.z + this.offset.z);
    this.clampShift.x = 0;
    this.clampShift.z = 0;
    if (this.bounds) {
      // Clamp on the un-shaken pose, so a shake near a wall still shakes.
      this.camera.position.sub(this.offset);
      this.camera.updateMatrixWorld();
      const shift = boundsShift(groundFootprint(this.camera, this.o.groundY), this.bounds);
      this.clampShift.x = shift.x;
      this.clampShift.z = shift.z;
      this.camera.position.add(this.offset);
      this.camera.position.x += shift.x;
      this.camera.position.z += shift.z;
    }
    if (this.roll !== 0) this.camera.rotateZ(this.roll);
    const fov = this.o.fov + this.fovSpring.value;
    if (Math.abs(this.camera.fov - fov) > 1e-4) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
