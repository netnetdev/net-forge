/**
 * dungeon(...): a procedural dungeon floor from a seed
 * ("dungeon layouts can be generated from a seed on both sides").
 *
 * Rooms sit on a grid of cells, grown from the start room as a random
 * tree, with a few extra doors that make loops. Neighbouring rooms are
 * joined by straight corridors. The result is the `field` a dungeon game
 * passes to game({ field }) (walls and floors as boxes, the start room at
 * [0, 0] where players spawn) and the rooms with their depth from the
 * start, so a system can wake encounters room by room.
 *
 * Pure and deterministic: the same spec gives the same dungeon on the room
 * server, in the client and in the playtest, with nothing downloaded.
 */
import { z } from "zod";
import { GameDefinitionError } from "./schemas.js";

export const dungeonSchema = z
  .object({
    /** Any whole number: a different seed is a different dungeon. */
    seed: z.number().int().min(0).max(0xffffffff),
    /** Rooms on the floor, the start and the boss room included. */
    rooms: z.number().int().min(3, "a dungeon has at least 3 rooms").max(20, "20 rooms is the cap (a run should end in about 10 minutes)"),
    /** Grid cell size in metres: room spacing. Default 24. */
    cell: z.number().int().min(16).max(32).default(24),
    /** Room side in metres, [smallest, largest]. Default [12, 18]. Kept at least 4 m under the cell. */
    size: z.tuple([z.number().int().min(8).max(28), z.number().int().min(8).max(28)]).default([12, 18]),
    /** Corridor width in metres (even). Default 4. */
    corridor: z.number().int().min(2).max(8).default(4),
    /** Extra doors beyond the tree, for loops. Default 2. */
    loops: z.number().int().min(0).max(8).default(2),
  })
  .strict();

export type DungeonSpec = z.input<typeof dungeonSchema>;

/** A box on the ground: [x, z, halfX, halfZ], m. */
export type Box = [x: number, z: number, hx: number, hz: number];

export interface DungeonRoom {
  /** 0 is the start room. */
  readonly id: number;
  /** Centre, m. */
  readonly x: number;
  readonly z: number;
  /** Half sizes, m. */
  readonly hx: number;
  readonly hz: number;
  /** Doors from the start room (0 for the start). */
  readonly depth: number;
  /** Rooms this one has a corridor to. */
  readonly links: readonly number[];
}

export interface DungeonLayout {
  /** Pass to game({ field }). */
  readonly field: { readonly halfSize: number; readonly pillars: [number, number, number][]; readonly walls: Box[]; readonly floors: Box[] };
  readonly rooms: readonly DungeonRoom[];
  /** The start room (id 0, centred on [0, 0]). */
  readonly start: DungeonRoom;
  /** The deepest room: where the boss waits. */
  readonly boss: DungeonRoom;
  /** The room holding (x, z), or -1 in a corridor. */
  roomAt(x: number, z: number): number;
}

/** mulberry32: a small seeded PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const evenIn = (rnd: () => number, lo: number, hi: number) => {
  const a = Math.ceil(lo / 2);
  const b = Math.floor(hi / 2);
  return 2 * (a + Math.floor(rnd() * (b - a + 1)));
};

/** Build a dungeon floor from a spec. Throws GameDefinitionError with readable lines on a bad spec. */
export function dungeon(spec: DungeonSpec): DungeonLayout {
  const parsed = dungeonSchema.safeParse(spec);
  if (!parsed.success) throw new GameDefinitionError("dungeon(...)", parsed.error.issues.map((i) => `${i.path.join(".") || "spec"}: ${i.message}`));
  const s = parsed.data;
  const [lo, hi] = s.size[0] <= s.size[1] ? s.size : [s.size[1], s.size[0]];
  if (hi > s.cell - 4) throw new GameDefinitionError("dungeon(...)", [`size ${hi} m does not fit a ${s.cell} m cell with walls between rooms: keep size under cell - 4`]);
  if (s.corridor > lo - 2) throw new GameDefinitionError("dungeon(...)", [`a ${s.corridor} m corridor is wider than the smallest room's wall allows: keep corridor at most size[0] - 2`]);
  const rnd = prng(s.seed);
  // A square grid big enough to grow in; the start is its middle cell, so the floor stays near [0, 0].
  const g = Math.max(3, Math.ceil(Math.sqrt(s.rooms)) + 2);
  const mid = Math.floor(g / 2);
  const key = (i: number, j: number) => j * g + i;
  const cells: [number, number][] = [[mid, mid]];
  const index = new Map<number, number>([[key(mid, mid), 0]]);
  const links: Set<number>[] = [new Set()];
  const DIRS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  let guard = 0;
  while (cells.length < s.rooms && guard++ < 10_000) {
    // Grow from a random room, leaning toward the newest so the floor reaches out rather than balling up.
    const from = rnd() < 0.5 ? cells.length - 1 : Math.floor(rnd() * cells.length);
    const [ci, cj] = cells[from] as [number, number];
    const [di, dj] = DIRS[Math.floor(rnd() * 4)] as readonly [number, number];
    const ni = ci + di;
    const nj = cj + dj;
    if (ni < 0 || nj < 0 || ni >= g || nj >= g || index.has(key(ni, nj))) continue;
    const id = cells.length;
    cells.push([ni, nj]);
    index.set(key(ni, nj), id);
    links.push(new Set([from]));
    links[from]?.add(id);
  }
  // Loops: a few extra doors between neighbours that are not joined yet.
  for (let k = 0, tries = 0; k < s.loops && tries < 200; tries++) {
    const a = Math.floor(rnd() * cells.length);
    const [ai, aj] = cells[a] as [number, number];
    const [di, dj] = DIRS[Math.floor(rnd() * 4)] as readonly [number, number];
    const b = index.get(key(ai + di, aj + dj));
    if (b === undefined || links[a]?.has(b)) continue;
    links[a]?.add(b);
    links[b]?.add(a);
    k++;
  }
  // Depth from the start (breadth first).
  const depth = new Array<number>(cells.length).fill(-1);
  depth[0] = 0;
  const queue = [0];
  for (let h = 0; h < queue.length; h++) {
    const a = queue[h] as number;
    for (const b of links[a] ?? []) {
      if (depth[b] !== -1) continue;
      depth[b] = (depth[a] ?? 0) + 1;
      queue.push(b);
    }
  }
  // Rooms: centred in their cells (so corridors run straight), even sizes on whole metres.
  const rooms: DungeonRoom[] = cells.map(([i, j], id) => {
    const w = id === 0 ? hi : evenIn(rnd, lo, hi);
    const d = id === 0 ? hi : evenIn(rnd, lo, hi);
    return { id, x: (i - mid) * s.cell, z: (j - mid) * s.cell, hx: w / 2, hz: d / 2, depth: depth[id] ?? 0, links: [...(links[id] ?? [])].sort((a, b) => a - b) };
  });
  const floors: Box[] = rooms.map((r) => [r.x, r.z, r.hx, r.hz]);
  const half = s.corridor / 2;
  for (const a of rooms) {
    for (const bi of a.links) {
      if (bi < a.id) continue;
      const b = rooms[bi] as DungeonRoom;
      if (a.z === b.z) {
        const [l, r] = a.x < b.x ? [a, b] : [b, a];
        const x0 = l.x + l.hx;
        const x1 = r.x - r.hx;
        floors.push([(x0 + x1) / 2, a.z, (x1 - x0) / 2 + 0.5, half]);
      } else {
        const [l, r] = a.z < b.z ? [a, b] : [b, a];
        const z0 = l.z + l.hz;
        const z1 = r.z - r.hz;
        floors.push([a.x, (z0 + z1) / 2, half, (z1 - z0) / 2 + 0.5]);
      }
    }
  }
  // Walls: every 1 m cell next to the floor that is not floor, merged into boxes.
  let ext = 0;
  for (const [x, z, hx, hz] of floors) ext = Math.max(ext, Math.abs(x) + hx, Math.abs(z) + hz);
  const n = Math.ceil(ext) + 2;
  const size = 2 * n;
  const floor = new Uint8Array(size * size);
  for (const [x, z, hx, hz] of floors) {
    for (let j = Math.floor(z - hz + n); j < Math.ceil(z + hz + n); j++) {
      for (let i = Math.floor(x - hx + n); i < Math.ceil(x + hx + n); i++) {
        if (i >= 0 && j >= 0 && i < size && j < size) floor[j * size + i] = 1;
      }
    }
  }
  const wall = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      if (floor[j * size + i] === 1) continue;
      let near = false;
      for (let dj = -1; dj <= 1 && !near; dj++) {
        for (let di = -1; di <= 1; di++) {
          const a = i + di;
          const b = j + dj;
          if (a >= 0 && b >= 0 && a < size && b < size && floor[b * size + a] === 1) {
            near = true;
            break;
          }
        }
      }
      if (near) wall[j * size + i] = 1;
    }
  }
  // Merge: maximal runs along x per row, then runs with the same ends stacked down the rows.
  const walls: Box[] = [];
  let open = new Map<string, [number, number, number]>();
  for (let j = 0; j <= size; j++) {
    const next = new Map<string, [number, number, number]>();
    for (let i = 0; j < size && i < size; i++) {
      if (wall[j * size + i] !== 1) continue;
      let i1 = i;
      while (i1 + 1 < size && wall[j * size + i1 + 1] === 1) i1++;
      const k = `${i}:${i1}`;
      const prev = open.get(k);
      next.set(k, prev ? [prev[0], prev[1], prev[2]] : [i, i1, j]);
      if (prev) open.delete(k);
      i = i1;
    }
    for (const [i0, i1, j0] of open.values()) walls.push([(i0 + i1 + 1) / 2 - n, (j0 + j) / 2 - n, (i1 - i0 + 1) / 2, (j - j0) / 2]);
    open = next;
  }
  const halfSize = Math.max(20, Math.min(120, n + 1));
  let boss = rooms[0] as DungeonRoom;
  for (const r of rooms) if (r.depth > boss.depth || (r.depth === boss.depth && r.id > boss.id)) boss = r;
  return {
    field: { halfSize, pillars: [], walls, floors },
    rooms,
    start: rooms[0] as DungeonRoom,
    boss,
    roomAt(x: number, z: number): number {
      for (const r of rooms) if (Math.abs(x - r.x) <= r.hx && Math.abs(z - r.z) <= r.hz) return r.id;
      return -1;
    },
  };
}
