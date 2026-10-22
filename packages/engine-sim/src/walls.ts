/**
 * Walls and floors: a dungeon's level (ArenaConfig.walls, .floors).
 *
 * Players meet the walls as Rapier cuboids (world.ts buildLevel). Enemies,
 * bolts and spawns are resolved here by hand, like pillars are, because
 * the crowd never goes through Rapier. When the level declares floors,
 * enemies also steer on a flow field: a breadth-first distance from every
 * player who is up, over a 1 m grid of walkable cells, rebuilt every few
 * ticks, so a chaser behind a wall walks round through the doors instead
 * of pressing into the stone.
 *
 * Everything is a pure function of the world's config and state at a tick,
 * so the server and a predicting client agree.
 */
import type { WallBox } from "./api.js";
import type { InternalWorld } from "./world.js";

const EMPTY: readonly WallBox[] = [];

/** The level's wall boxes (none for a plain arena). */
export const wallsOf = (w: InternalWorld): readonly WallBox[] => w.config.arena.walls ?? EMPTY;

/** True when a circle at (x, z) of radius r overlaps any wall. */
export function inWall(walls: readonly WallBox[], x: number, z: number, r: number): boolean {
  for (const b of walls) {
    const dx = Math.abs(x - b.x) - b.hx;
    const dz = Math.abs(z - b.z) - b.hz;
    if (dx >= r || dz >= r) continue;
    if (dx <= 0 || dz <= 0) return true;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

/** True when the circle at (x, z) of radius r lies on some floor rectangle (its centre inside it, with r of margin where it can). */
export function onFloor(floors: readonly WallBox[], x: number, z: number, r: number): boolean {
  for (const f of floors) {
    const mx = Math.min(r, f.hx * 0.5);
    const mz = Math.min(r, f.hz * 0.5);
    if (Math.abs(x - f.x) <= f.hx - mx && Math.abs(z - f.z) <= f.hz - mz) return true;
  }
  return false;
}

/**
 * Push a circle out of every wall it overlaps. Returns the new centre and
 * the push normal of the last wall met (0, 0 when nothing was in the way).
 */
export function pushOutOfWalls(walls: readonly WallBox[], x: number, z: number, r: number): [x: number, z: number, nx: number, nz: number] {
  let nx = 0;
  let nz = 0;
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;
    for (const b of walls) {
      const ox = x - b.x;
      const oz = z - b.z;
      const ax = Math.abs(ox);
      const az = Math.abs(oz);
      if (ax >= b.hx + r || az >= b.hz + r) continue;
      // Nearest point on the box to the centre.
      const cx = Math.max(-b.hx, Math.min(b.hx, ox));
      const cz = Math.max(-b.hz, Math.min(b.hz, oz));
      const dx = ox - cx;
      const dz = oz - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > 1e-12) {
        if (d2 >= r * r) continue;
        const d = Math.sqrt(d2);
        x = b.x + cx + (dx / d) * r;
        z = b.z + cz + (dz / d) * r;
        nx = dx / d;
        nz = dz / d;
      } else if (b.hx - ax < b.hz - az) {
        // Centre inside the box: out through the nearest face.
        const s = ox >= 0 ? 1 : -1;
        x = b.x + s * (b.hx + r);
        nx = s;
        nz = 0;
      } else {
        const s = oz >= 0 ? 1 : -1;
        z = b.z + s * (b.hz + r);
        nx = 0;
        nz = s;
      }
      moved = true;
    }
    if (!moved) break;
  }
  return [x, z, nx, nz];
}

/**
 * The first hit of a moving circle of radius r on a wall: the segment from
 * (x0, z0) along (dx, dz), as a fraction 0..1, or -1 when it meets none.
 * A box grown by r, slab method.
 */
export function segmentWalls(walls: readonly WallBox[], x0: number, z0: number, dx: number, dz: number, r: number): number {
  let best = -1;
  for (const b of walls) {
    const hx = b.hx + r;
    const hz = b.hz + r;
    let t0 = 0;
    let t1 = 1;
    const ox = x0 - b.x;
    const oz = z0 - b.z;
    if (Math.abs(dx) < 1e-12) {
      if (ox < -hx || ox > hx) continue;
    } else {
      let a = (-hx - ox) / dx;
      let c = (hx - ox) / dx;
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-12) {
      if (oz < -hz || oz > hz) continue;
    } else {
      let a = (-hz - oz) / dz;
      let c = (hz - oz) / dz;
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
      if (t0 > t1) continue;
    }
    if (best < 0 || t0 < best) best = t0;
  }
  return best;
}

// ------------------------------------------------------------ flow field

/** Grid cell size, m. */
export const NAV_CELL = 1;
/** Ticks between flow-field rebuilds. */
const NAV_EVERY = 6;
/** How close to a wall or pillar a cell centre may be and still be walked, m: the crowd's grid and the big bodies' grid. */
const NAV_CLEAR = 0.45;
const NAV_CLEAR_WIDE = 1.4;
/** Enemies at least this big (radius, m) path on the wide grid, so a boss is never led into a gap it cannot fit. */
export const NAV_WIDE_RADIUS = 0.9;
const UNREACHED = 0x7fffffff;

interface Nav {
  /** Cells per side. */
  readonly n: number;
  /** World coordinate of cell 0's lower edge. */
  readonly origin: number;
  readonly walk: Uint8Array;
  readonly dist: Int32Array;
  readonly queue: Int32Array;
  /** The tick the field was last built for (-1: never). */
  at: number;
}

const NAVS = new WeakMap<InternalWorld, Nav>();
const WIDE = new WeakMap<InternalWorld, Nav>();

function buildNav(w: InternalWorld, clear: number): Nav | null {
  const floors = w.config.arena.floors;
  if (!floors || floors.length === 0) return null;
  const half = w.config.arena.halfExtent;
  const n = Math.max(1, Math.ceil((half * 2) / NAV_CELL));
  const origin = -half;
  const walk = new Uint8Array(n * n);
  const walls = w.config.arena.walls ?? EMPTY;
  const pillars = w.config.arena.pillars;
  for (let j = 0; j < n; j++) {
    const z = origin + (j + 0.5) * NAV_CELL;
    for (let i = 0; i < n; i++) {
      const x = origin + (i + 0.5) * NAV_CELL;
      if (!onFloor(floors, x, z, 0)) continue;
      if (inWall(walls, x, z, clear)) continue;
      let blocked = false;
      for (const p of pillars) if ((x - p.x) ** 2 + (z - p.z) ** 2 < (p.radius + clear) ** 2) blocked = true;
      if (!blocked) walk[j * n + i] = 1;
    }
  }
  return { n, origin, walk, dist: new Int32Array(n * n).fill(UNREACHED), queue: new Int32Array(n * n), at: -1 };
}

function navOf(w: InternalWorld, wide = false): Nav | null {
  const map = wide ? WIDE : NAVS;
  let nav = map.get(w);
  if (nav === undefined) {
    const built = buildNav(w, wide ? NAV_CLEAR_WIDE : NAV_CLEAR);
    if (!built) return null;
    nav = built;
    map.set(w, nav);
  }
  return nav;
}

/** True when the level has floors (enemies steer on the flow field). */
export function hasNav(w: InternalWorld): boolean {
  return (w.config.arena.floors?.length ?? 0) > 0;
}

function cellOf(nav: Nav, x: number, z: number): number {
  const i = Math.floor((x - nav.origin) / NAV_CELL);
  const j = Math.floor((z - nav.origin) / NAV_CELL);
  if (i < 0 || j < 0 || i >= nav.n || j >= nav.n) return -1;
  return j * nav.n + i;
}

/** The walkable cell at (x, z), or the first walkable one within two cells (a player hugging a wall), or -1. */
function walkableNear(nav: Nav, x: number, z: number): number {
  const c = cellOf(nav, x, z);
  if (c < 0) return -1;
  if (nav.walk[c] === 1) return c;
  const ci = c % nav.n;
  const cj = (c - ci) / nav.n;
  for (let ring = 1; ring <= 2; ring++) {
    for (let dj = -ring; dj <= ring; dj++) {
      for (let di = -ring; di <= ring; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= nav.n || j >= nav.n) continue;
        if (nav.walk[j * nav.n + i] === 1) return j * nav.n + i;
      }
    }
  }
  return -1;
}

/**
 * Rebuild the flow field from `targets` (the positions of players who are
 * up) when it is stale: every NAV_EVERY ticks, on the tick grid, so every
 * side rebuilds on the same ticks.
 */
export function updateFlow(w: InternalWorld, targets: readonly (readonly [number, number])[]): void {
  fill(w, navOf(w), targets);
  fill(w, navOf(w, true), targets);
}

function fill(w: InternalWorld, nav: Nav | null, targets: readonly (readonly [number, number])[]): void {
  if (!nav) return;
  const due = w.tick - (w.tick % NAV_EVERY);
  if (nav.at === due) return;
  nav.at = due;
  const { n, walk, dist, queue } = nav;
  dist.fill(UNREACHED);
  let head = 0;
  let tail = 0;
  for (const [x, z] of targets) {
    const c = walkableNear(nav, x, z);
    if (c < 0 || dist[c] === 0) continue;
    dist[c] = 0;
    queue[tail++] = c;
  }
  while (head < tail) {
    const c = queue[head++] as number;
    const d = (dist[c] as number) + 1;
    const i = c % n;
    // Four neighbours; diagonals are taken when reading the field.
    if (i > 0 && walk[c - 1] === 1 && (dist[c - 1] as number) > d) {
      dist[c - 1] = d;
      queue[tail++] = c - 1;
    }
    if (i < n - 1 && walk[c + 1] === 1 && (dist[c + 1] as number) > d) {
      dist[c + 1] = d;
      queue[tail++] = c + 1;
    }
    if (c >= n && walk[c - n] === 1 && (dist[c - n] as number) > d) {
      dist[c - n] = d;
      queue[tail++] = c - n;
    }
    if (c < n * (n - 1) && walk[c + n] === 1 && (dist[c + n] as number) > d) {
      dist[c + n] = d;
      queue[tail++] = c + n;
    }
  }
}

/** Scratch for flowDir's answer (no allocation per enemy). */
export const flowOut = { x: 0, z: 0 };

/**
 * The unit direction down the flow field from (x, z) into `flowOut`: toward
 * the neighbouring cell (eight of them; a diagonal only when both sides
 * are open) nearest a player. False when the cell is unreached or already
 * a player's.
 */
export function flowDir(w: InternalWorld, x: number, z: number, radius = 0): boolean {
  // A big body follows the wide grid while it is on it, else the crowd's.
  if (radius >= NAV_WIDE_RADIUS && flowOn(navOf(w, true), x, z)) return true;
  return flowOn(navOf(w), x, z);
}

function flowOn(nav: Nav | null, x: number, z: number): boolean {
  if (!nav || nav.at < 0) return false;
  const c = walkableNear(nav, x, z);
  if (c < 0) return false;
  const here = nav.dist[c] as number;
  if (here === UNREACHED || here === 0) return false;
  const { n, walk, dist } = nav;
  const ci = c % n;
  const cj = (c - ci) / n;
  let best = here;
  let bi = -1;
  let bj = -1;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      if (di === 0 && dj === 0) continue;
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const k = j * n + i;
      if (walk[k] !== 1) continue;
      // No corner cutting: a diagonal needs both orthogonal cells open.
      if (di !== 0 && dj !== 0 && (walk[cj * n + i] !== 1 || walk[j * n + ci] !== 1)) continue;
      const d = (dist[k] as number) + (di !== 0 && dj !== 0 ? 0.4 : 0);
      if (d < best) {
        best = d;
        bi = i;
        bj = j;
      }
    }
  }
  if (bi < 0) return false;
  const tx = nav.origin + (bi + 0.5) * NAV_CELL - x;
  const tz = nav.origin + (bj + 0.5) * NAV_CELL - z;
  const len = Math.hypot(tx, tz);
  if (len < 1e-6) return false;
  flowOut.x = tx / len;
  flowOut.z = tz / len;
  return true;
}
