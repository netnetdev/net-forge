/** Linear interpolation. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Interpolate angles along the shortest arc (radians). */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Frame-rate independent exponential smoothing factor for a rate in 1/s. */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
