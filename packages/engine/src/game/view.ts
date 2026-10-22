/**
 * What a player can see: the ground footprint of a template's camera, as
 * the sim's view radii (engine-sim ViewRules). The spawn director spawns
 * just outside it, straggler recycling measures against it, and the
 * playtest counts enemies inside it as "on screen".
 *
 * The footprint is the camera's screen rectangle projected onto the ground
 * plane: a trapezoid, short toward the camera and long away from it. The
 * union over the screen shapes a template supports (landscape monitors,
 * portrait phones) is what "off screen" must clear.
 */

/** A fixed top-down follow camera (yaw 0: it sits on +z and looks toward -z). */
export interface CameraView {
  /** Distance from the focus point, m. */
  readonly distance: number;
  /** Elevation angle above the ground, radians. */
  readonly pitch: number;
  /** Vertical field of view, degrees. */
  readonly fov: number;
  /** Width / height of the screen. */
  readonly aspect: number;
  /** Height of the focus point above the ground, m. */
  readonly focusHeight?: number;
}

/**
 * EMBERWATCH's camera (client/scene.ts: distance 17 landscape, 24 portrait,
 * fov 50, pitch 0.98, focus 0.5 m up) on a 16:9 and a 21:9 monitor and a
 * 9:19.5 phone. Change these with the scene's rig. (Round 1 playtest: 20%
 * closer than the first cut's 21 and 30, so the hero reads.)
 */
export const SURVIVOR_VIEWS: readonly CameraView[] = [
  { distance: 17, pitch: 0.98, fov: 50, aspect: 16 / 9, focusHeight: 0.5 },
  { distance: 17, pitch: 0.98, fov: 50, aspect: 21 / 9, focusHeight: 0.5 },
  { distance: 24, pitch: 0.98, fov: 50, aspect: 9 / 19.5, focusHeight: 0.5 },
];

/**
 * The dungeon crawl's camera (template-dungeon client/scene.ts: distance 13
 * landscape, 18 portrait, fov 50, pitch 1.02): closer than the field's, so
 * a room fills the screen and the next one is out of sight.
 */
export const DUNGEON_VIEWS: readonly CameraView[] = [
  { distance: 13, pitch: 1.02, fov: 50, aspect: 16 / 9, focusHeight: 0.5 },
  { distance: 13, pitch: 1.02, fov: 50, aspect: 21 / 9, focusHeight: 0.5 },
  { distance: 18, pitch: 1.02, fov: 50, aspect: 9 / 19.5, focusHeight: 0.5 },
];

/** The camera views a template's client draws with (the spawn director and the playtest's "on screen" use them). */
export function viewsFor(template: string): readonly CameraView[] {
  return template === "dungeon" ? DUNGEON_VIEWS : SURVIVOR_VIEWS;
}

/** Farthest a footprint may reach (the camera can see the horizon on very flat pitches), m. */
const HORIZON = 80;

/** The four ground corners of the camera's view, relative to the focus point's ground position [x, z]. */
export function footprint(v: CameraView): [number, number][] {
  const h = v.focusHeight ?? 0;
  const s = Math.sin(v.pitch);
  const c = Math.cos(v.pitch);
  const cy = h + s * v.distance;
  const cz = c * v.distance;
  const t = Math.tan(((v.fov / 2) * Math.PI) / 180);
  const out: [number, number][] = [];
  for (const [nx, ny] of [
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    // dir = forward + nx * tan * aspect * right + ny * tan * up, with
    // forward (0, -s, -c), right (1, 0, 0), up (0, c, -s).
    const dx = nx * t * v.aspect;
    const dy = -s + ny * t * c;
    const dz = -c - ny * t * s;
    if (dy < -1e-6) {
      const k = cy / -dy;
      const gx = dx * k;
      const gz = cz + dz * k;
      const len = Math.hypot(gx, gz);
      if (len <= HORIZON) {
        out.push([gx, gz]);
        continue;
      }
    }
    // Above the horizon (or very far): clamp along the ray's ground direction.
    const len = Math.hypot(dx, dz) || 1;
    out.push([(dx / len) * HORIZON, cz + (dz / len) * HORIZON]);
  }
  return out;
}

/** Distance from the origin to the edge of a convex polygon along heading `a` (radians from +x toward +z). */
function exitDistance(poly: readonly (readonly [number, number])[], a: number): number {
  const ux = Math.cos(a);
  const uz = Math.sin(a);
  let best = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as readonly [number, number];
    const q = poly[(i + 1) % poly.length] as readonly [number, number];
    const ex = q[0] - p[0];
    const ez = q[1] - p[1];
    const den = ux * ez - uz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = (p[0] * ez - p[1] * ex) / den;
    const s = (p[0] * uz - p[1] * ux) / den;
    if (t > 0 && s >= -1e-9 && s <= 1 + 1e-9) best = Math.max(best, t);
  }
  return best;
}

/** View radii (engine-sim ViewRules) for the union of several camera views, at `n` evenly spaced headings. */
export function viewRadii(views: readonly CameraView[], n = 32): number[] {
  const polys = views.map(footprint);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let r = 0;
    for (const p of polys) r = Math.max(r, exitDistance(p, a));
    out.push(Math.round(Math.max(4, r) * 100) / 100);
  }
  return out;
}

/** Radius at a heading of a radii table (linear between samples). */
export function radiusAt(radii: readonly number[], a: number): number {
  const n = radii.length;
  let t = (a / (Math.PI * 2)) * n;
  t = ((t % n) + n) % n;
  const i = Math.floor(t);
  const f = t - i;
  const r0 = radii[i % n] ?? 0;
  const r1 = radii[(i + 1) % n] ?? 0;
  return r0 + (r1 - r0) * f;
}

/** True when (dx, dz) from a player is inside a radii table. */
export function insideView(radii: readonly number[], dx: number, dz: number): boolean {
  const r = radiusAt(radii, Math.atan2(dz, dx));
  return dx * dx + dz * dz < r * r;
}
