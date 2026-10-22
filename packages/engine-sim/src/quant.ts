import { POSITION_SCALE, VELOCITY_SCALE, YAW_UNITS } from "./api.js";

const TAU = Math.PI * 2;

/** Metres → fixed-point position units. */
export const qPos = (m: number): number => Math.round(m * POSITION_SCALE);
export const dqPos = (q: number): number => q / POSITION_SCALE;
export const snapPos = (m: number): number => Math.round(m * POSITION_SCALE) / POSITION_SCALE;

/**
 * Snap upward. Character heights use this: rounding down could leave the
 * capsule inside the controller's contact offset, and Rapier's controller
 * then spends the next move only depenetrating (the character sticks).
 */
export const snapPosUp = (m: number): number => Math.ceil(m * POSITION_SCALE - 1e-9) / POSITION_SCALE;

export const qVel = (v: number): number => Math.round(v * VELOCITY_SCALE);
export const dqVel = (q: number): number => q / VELOCITY_SCALE;
export const snapVel = (v: number): number => Math.round(v * VELOCITY_SCALE) / VELOCITY_SCALE;

/** Radians → u16 turn (0..65535). */
export const qYaw = (rad: number): number => {
  const u = Math.round((rad / TAU) * YAW_UNITS) % YAW_UNITS;
  return u < 0 ? u + YAW_UNITS : u;
};
export const dqYaw = (u: number): number => (u / YAW_UNITS) * TAU;
export const snapYaw = (rad: number): number => dqYaw(qYaw(rad));

/** -1..1 → int8 -127..127. Non-finite becomes 0. */
export const qAxis = (v: number): number => {
  if (!Number.isFinite(v)) return 0;
  return Math.round(Math.max(-1, Math.min(1, v)) * 127);
};
export const dqAxis = (q: number): number => q / 127;
