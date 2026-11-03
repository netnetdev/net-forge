import { describe, expect, it } from "vitest";
import type { CompiledTowerGame } from "../src/rules/tower.js";
import { boardRoads, compileBoard, Q, roadPoint, tileKey, waveSpawns } from "../src/rules/tower.js";

/**
 * Multi-path (parallel lanes) for the tower-defense genre.
 *
 * A board declares either a single `path` (unchanged) or `paths` (1..4 roads).
 * `compileBoard` produces a `roads[]` with per-road `cum`/`length`, a union
 * `road` tile set, and keeps `path`/`cum`/`length` as back-compat aliases of
 * road 0. `roadPoint(b, d, i)` positions a creep on road `i`.
 */

const SINGLE = { size: [18, 12] as const, path: [[0, 6] as const, [17, 6] as const], blocked: [] as const };
const MULTI = {
  size: [18, 12] as const,
  paths: [
    [[0, 3] as const, [17, 3] as const],
    [[0, 9] as const, [17, 9] as const],
  ] as const,
  blocked: [] as const,
};

describe("tower multi-path: boardRoads normalization", () => {
  it("wraps a single `path` into one road", () => {
    expect(boardRoads(SINGLE)).toEqual([SINGLE.path]);
  });
  it("returns `paths` as-is when given", () => {
    expect(boardRoads(MULTI)).toEqual(MULTI.paths);
  });
  it("prefers `paths` over `path` if both somehow appear", () => {
    expect(boardRoads({ path: SINGLE.path, paths: MULTI.paths })).toEqual(MULTI.paths);
  });
});

describe("tower multi-path: compileBoard back-compat (single path unchanged)", () => {
  const b = compileBoard(SINGLE);
  it("yields exactly one road", () => {
    expect(b.roads.length).toBe(1);
  });
  it("keeps path/cum/length as aliases of road 0", () => {
    expect(b.path).toEqual(b.roads[0]!.path);
    expect(b.cum).toEqual(b.roads[0]!.cum);
    expect(b.length).toBe(b.roads[0]!.length);
  });
  it("computes length as the Manhattan run in Q units", () => {
    expect(b.length).toBe(17 * Q); // [0,6]->[17,6] is 17 tiles
  });
  it("fills the road tile set along the run", () => {
    expect(b.road.has(tileKey(0, 6))).toBe(true);
    expect(b.road.has(tileKey(9, 6))).toBe(true);
    expect(b.road.has(tileKey(17, 6))).toBe(true);
    expect(b.road.has(tileKey(9, 5))).toBe(false);
  });
});

describe("tower multi-path: compileBoard with two lanes", () => {
  const b = compileBoard(MULTI);
  it("compiles one road per declared path", () => {
    expect(b.roads.length).toBe(2);
  });
  it("gives each road its own length", () => {
    expect(b.roads[0]!.length).toBe(17 * Q);
    expect(b.roads[1]!.length).toBe(17 * Q);
  });
  it("unions every lane's tiles into `road` (build-blocking)", () => {
    expect(b.road.has(tileKey(5, 3))).toBe(true); // lane 0
    expect(b.road.has(tileKey(5, 9))).toBe(true); // lane 1
    expect(b.road.has(tileKey(5, 6))).toBe(false); // between lanes: buildable
  });
  it("still aliases path/length to road 0", () => {
    expect(b.path).toEqual(b.roads[0]!.path);
    expect(b.length).toBe(b.roads[0]!.length);
  });
});

describe("tower multi-path: roadPoint positions creeps per lane", () => {
  const b = compileBoard(MULTI);
  it("places a creep at d=0 on its own lane", () => {
    const p0 = roadPoint(b, 0, 0);
    const p1 = roadPoint(b, 0, 1);
    expect(p0.qx).toBe(p1.qx); // both enter at the west edge, x = 0.5 tiles
    expect(p0.qy).not.toBe(p1.qy); // on different rows
    expect(p0.qy).toBe(3 * Q + Q / 2); // lane 0 at y=3
    expect(p1.qy).toBe(9 * Q + Q / 2); // lane 1 at y=9
  });
  it("advances along the correct lane", () => {
    const mid = roadPoint(b, 8 * Q, 1); // 8 tiles along lane 1
    expect(mid.qx).toBe(8 * Q + Q / 2);
    expect(mid.qy).toBe(9 * Q + Q / 2);
  });
  it("defaults to road 0 when no index is given (back-compat call site)", () => {
    expect(roadPoint(b, 0)).toEqual(roadPoint(b, 0, 0));
  });
  it("clamps an out-of-range index to road 0 rather than crashing", () => {
    expect(roadPoint(b, 0, 9)).toEqual(roadPoint(b, 0, 0));
  });
});

describe("tower multi-path: waveSpawns routes each group onto its lane", () => {
  // Minimal CompiledTowerGame: waveSpawns only reads `groups`.
  const g = {
    groups: [
      { type: 0, from: 1, until: 20, every: 1, count: 3, grow: 0, gap: 1, delay: 0, lane: 0 },
      { type: 1, from: 1, until: 20, every: 1, count: 2, grow: 0, gap: 1, delay: 0, lane: 1 },
    ],
  } as unknown as CompiledTowerGame;

  it("stamps each spawned creep with its group's lane", () => {
    const spawns = waveSpawns(g, 1, 30);
    expect(spawns.filter((s) => s.path === 0).length).toBe(3); // lane 0 group
    expect(spawns.filter((s) => s.path === 1).length).toBe(2); // lane 1 group
  });

  it("defaults lane 0 when a group declares none", () => {
    const g1 = { groups: [{ type: 0, from: 1, until: 5, every: 1, count: 2, grow: 0, gap: 1, delay: 0, lane: 0 }] } as unknown as CompiledTowerGame;
    expect(waveSpawns(g1, 1, 30).every((s) => s.path === 0)).toBe(true);
  });
});
