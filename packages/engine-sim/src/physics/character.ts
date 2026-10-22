import { Layer } from "./layers.js";
import type { CharacterDesc, CharacterState, ResolvedCharacterDesc } from "./types.js";

const finite = (name: string, v: number, min = -Infinity): number => {
  if (!Number.isFinite(v) || v < min) throw new RangeError(`engine-sim physics: character ${name} must be a finite number >= ${min}, got ${v}`);
  return v;
};
const ticks = (name: string, v: number): number => {
  if (!Number.isInteger(v) || v < 0 || v > 65535) throw new RangeError(`engine-sim physics: character ${name} must be an integer 0..65535, got ${v}`);
  return v;
};

/** Fill a character description with defaults and validate it. */
export function resolveCharacter(d: CharacterDesc): ResolvedCharacterDesc {
  const r: ResolvedCharacterDesc = {
    position: d.position,
    radius: d.radius ?? 0.4,
    halfHeight: d.halfHeight ?? 0.5,
    layer: d.layer ?? Layer.Player,
    mask: d.mask ?? Layer.Level | Layer.Prop | Layer.Enemy | Layer.Player | Layer.Trigger,
    offset: d.offset ?? 0.02,
    maxSlopeClimb: d.maxSlopeClimb ?? 45,
    minSlopeSlide: d.minSlopeSlide ?? 50,
    stepHeight: d.stepHeight ?? 0.35,
    stepWidth: d.stepWidth ?? 0.2,
    stepOverDynamic: d.stepOverDynamic ?? false,
    snapToGround: d.snapToGround ?? 0.3,
    maxSpeed: d.maxSpeed ?? 6,
    groundAccel: d.groundAccel ?? 60,
    groundDecel: d.groundDecel ?? 80,
    airAccel: d.airAccel ?? 18,
    airDecel: d.airDecel ?? 4,
    jumpVelocity: d.jumpVelocity ?? 7,
    jumpCut: d.jumpCut ?? 0.45,
    gravityScale: d.gravityScale ?? 1,
    terminalVelocity: d.terminalVelocity ?? 40,
    coyoteTicks: d.coyoteTicks ?? 5,
    jumpBufferTicks: d.jumpBufferTicks ?? 5,
    dashTicks: d.dashTicks ?? 0,
    dashSpeed: d.dashSpeed ?? 18,
    dashCooldownTicks: d.dashCooldownTicks ?? 30,
    dashBufferTicks: d.dashBufferTicks ?? 5,
    dashInvulnerable: d.dashInvulnerable ?? true,
    pushBodies: d.pushBodies ?? true,
    mass: d.mass ?? 80,
    userData: d.userData ?? 0,
  };
  for (const k of ["radius", "halfHeight", "offset"] as const) finite(k, r[k], 1e-4);
  for (const k of ["maxSlopeClimb", "minSlopeSlide", "stepHeight", "stepWidth", "snapToGround", "maxSpeed", "groundAccel", "groundDecel", "airAccel", "airDecel", "jumpVelocity", "jumpCut", "gravityScale", "terminalVelocity", "dashSpeed", "mass"] as const) {
    finite(k, r[k], 0);
  }
  for (const k of ["coyoteTicks", "jumpBufferTicks", "dashTicks", "dashCooldownTicks", "dashBufferTicks"] as const) ticks(k, r[k]);
  return r;
}

export function initialCharacterState(d: ResolvedCharacterDesc): CharacterState {
  const [x, y, z] = d.position;
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: false,
    coyote: 0,
    jumpBuffer: 0,
    jumping: false,
    dashTicks: 0,
    dashCooldown: 0,
    dashBuffer: 0,
    dashX: 0,
    dashZ: 0,
    facingX: 0,
    facingZ: -1,
    invulnerable: false,
    buttons: 0,
    groundNormalX: 0,
    groundNormalY: 1,
    groundNormalZ: 0,
  };
}

/** Move `v` toward `target` by at most `maxDelta` (as a 2D vector). */
export function approach2(vx: number, vz: number, tx: number, tz: number, maxDelta: number): [number, number] {
  const dx = tx - vx;
  const dz = tz - vz;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d <= maxDelta || d < 1e-12) return [tx, tz];
  const k = maxDelta / d;
  return [vx + dx * k, vz + dz * k];
}
