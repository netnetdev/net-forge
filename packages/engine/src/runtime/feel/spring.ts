/**
 * Damped springs for game feel: camera follow, FOV punch, knockback
 * offsets, UI pops. `frequency` is the natural frequency in Hz and
 * `damping` the damping ratio (1 = critically damped, no overshoot; below 1
 * it wobbles). Integrated with fixed sub-steps, so any frame rate is stable.
 */
export interface SpringOptions {
  readonly frequency?: number;
  readonly damping?: number;
}

/**
 * Advance one spring axis toward `target` by `dt` seconds with the exact
 * solution of the damped oscillator, so it is stable at any stiffness and
 * frame rate. `omega` is the natural frequency in rad/s, `zeta` the damping
 * ratio. Returns [value, velocity].
 */
export function stepSpring(value: number, velocity: number, target: number, omega: number, zeta: number, dt: number): [number, number] {
  if (dt <= 0 || omega <= 0) return [value, velocity];
  const y0 = value - target;
  const v0 = velocity;
  const t = dt;
  if (Math.abs(zeta - 1) < 1e-4) {
    const e = Math.exp(-omega * t);
    const c = v0 + omega * y0;
    return [target + (y0 + c * t) * e, (v0 - omega * t * c) * e];
  }
  if (zeta < 1) {
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const e = Math.exp(-zeta * omega * t);
    const co = Math.cos(wd * t);
    const si = Math.sin(wd * t);
    const y = e * (y0 * co + ((v0 + zeta * omega * y0) / wd) * si);
    const v = e * (v0 * co - ((zeta * omega * v0 + omega * omega * y0) / wd) * si);
    return [target + y, v];
  }
  const s = Math.sqrt(zeta * zeta - 1);
  const r1 = -omega * (zeta - s);
  const r2 = -omega * (zeta + s);
  const c1 = (v0 - r2 * y0) / (r1 - r2);
  const c2 = y0 - c1;
  const e1 = Math.exp(r1 * t);
  const e2 = Math.exp(r2 * t);
  return [target + c1 * e1 + c2 * e2, c1 * r1 * e1 + c2 * r2 * e2];
}

export class Spring {
  value: number;
  velocity = 0;
  target: number;
  frequency: number;
  damping: number;

  constructor(value = 0, opts: SpringOptions = {}) {
    this.value = value;
    this.target = value;
    this.frequency = opts.frequency ?? 4;
    this.damping = opts.damping ?? 1;
  }

  /** Add velocity (an impulse). */
  kick(velocity: number): void {
    this.velocity += velocity;
  }

  /** Jump to a value with no motion. */
  snap(value: number): void {
    this.value = this.target = value;
    this.velocity = 0;
  }

  step(dt: number): number {
    if (dt <= 0) return this.value;
    const [x, v] = stepSpring(this.value, this.velocity, this.target, this.frequency * Math.PI * 2, this.damping, dt);
    this.value = x;
    this.velocity = v;
    return x;
  }

  /** At rest within `eps` of the target. */
  settled(eps = 1e-3): boolean {
    return Math.abs(this.value - this.target) < eps && Math.abs(this.velocity) < eps;
  }
}

/** Three springs sharing settings (a position or offset). */
export class Spring3 {
  readonly x: Spring;
  readonly y: Spring;
  readonly z: Spring;
  constructor(x = 0, y = 0, z = 0, opts: SpringOptions = {}) {
    this.x = new Spring(x, opts);
    this.y = new Spring(y, opts);
    this.z = new Spring(z, opts);
  }
  setTarget(x: number, y: number, z: number): void {
    this.x.target = x;
    this.y.target = y;
    this.z.target = z;
  }
  snap(x: number, y: number, z: number): void {
    this.x.snap(x);
    this.y.snap(y);
    this.z.snap(z);
  }
  step(dt: number): void {
    this.x.step(dt);
    this.y.step(dt);
    this.z.step(dt);
  }
}
