import { beforeAll, describe, expect, it } from "vitest";
import { addPlayer, createWorld, destroyWorld, entityPosition, initSim, inWall, pushOutOfWalls, segmentWalls, ringSpawnPoint, spawnEnemy, step } from "../src/index.js";
import type { InputCommand, SimConfig, WallBox } from "../src/index.js";
import { CONTENT_CONFIG } from "./helpers.js";

/**
 * Two rooms side by side, joined by a corridor at the top: room A on the
 * left (x -14..-2), room B on the right (x 2..14), both z -6..6, and the
 * corridor x -2..2, z 3..6. A wall fills x -2..2 below the corridor, so
 * an enemy in B at z = -4 has stone between it and a player in A at z = -4.
 */
const FLOORS: WallBox[] = [
  { x: -8, z: 0, hx: 6, hz: 6 },
  { x: 8, z: 0, hx: 6, hz: 6 },
  { x: 0, z: 4.5, hx: 2, hz: 1.5 },
];
const WALLS: WallBox[] = [
  { x: 0, z: -3, hx: 2, hz: 6 },
  { x: 0, z: 7, hx: 15, hz: 1 },
  { x: 0, z: -7, hx: 15, hz: 1 },
  { x: -15, z: 0, hx: 1, hz: 8 },
  { x: 15, z: 0, hx: 1, hz: 8 },
];

const CFG = {
  ...(CONTENT_CONFIG as unknown as SimConfig),
  arena: { halfExtent: 20, wallHeight: 3, pillars: [], spawn: [-8, 1, -4], walls: WALLS, floors: FLOORS },
  // Weapons off: the player only stands there (no weapon slot to fire).
  content: { ...(CONTENT_CONFIG as unknown as { content: object }).content, progression: { xpBase: 3, xpGrowth: 2, startWeapon: -1 } },
} as unknown as SimConfig;

const idle: InputCommand = { seq: 0, tick: 0, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 };

describe("walls and floors", () => {
  beforeAll(async () => {
    await initSim();
  });

  it("pushes circles out of boxes and sweeps segments into them", () => {
    const b: WallBox[] = [{ x: 0, z: 0, hx: 1, hz: 2 }];
    const [x, z] = pushOutOfWalls(b, 1.2, 0, 0.5);
    expect(x).toBeCloseTo(1.5, 6);
    expect(z).toBe(0);
    expect(inWall(b, 1.4, 0, 0.5)).toBe(true);
    expect(inWall(b, 1.6, 0, 0.5)).toBe(false);
    expect(segmentWalls(b, -5, 0, 10, 0, 0)).toBeCloseTo(0.4, 6);
    expect(segmentWalls(b, -5, 5, 10, 0, 0)).toBe(-1);
  });

  it("an enemy behind a wall walks round through the corridor and reaches the player", () => {
    const w = createWorld(CFG);
    addPlayer(w, 1, [-8, 1, -4]);
    const id = spawnEnemy(w, 0, 8, -4);
    let closest = Infinity;
    let entered = false;
    for (let t = 0; t < 30 * 20; t++) {
      step(w, new Map([[1, { ...idle, seq: t + 1, tick: t }]]));
      const p = entityPosition(w, id);
      if (!p) break;
      if (p[0] > -2 && p[0] < 2 && p[1] > 3) entered = true;
      closest = Math.min(closest, Math.hypot(p[0] + 8, p[1] + 4));
      expect(inWall(WALLS, p[0], p[1], 0.2)).toBe(false);
    }
    destroyWorld(w);
    expect(entered).toBe(true);
    expect(closest).toBeLessThan(1.5);
  });

  it("spawn points land on a floor, never in the rock", () => {
    const w = createWorld(CFG);
    addPlayer(w, 1, [-8, 1, -4]);
    let found = 0;
    for (let i = 0; i < 200; i++) {
      const p = ringSpawnPoint(w, -8, -4, 3 + (i % 12), 0.35);
      if (!p) continue;
      found++;
      const [x, z] = p;
      expect(FLOORS.some((f) => Math.abs(x - f.x) <= f.hx && Math.abs(z - f.z) <= f.hz)).toBe(true);
      expect(inWall(WALLS, x, z, 0.35)).toBe(false);
    }
    expect(found).toBeGreaterThan(50);
    destroyWorld(w);
  });
});

describe("big bodies", () => {
  beforeAll(async () => {
    await initSim();
  });

  it("a boss-sized enemy (radius 1.5) finds its way through a 6 m corridor", () => {
    const floors: WallBox[] = [
      { x: -10, z: 0, hx: 7, hz: 7 },
      { x: 10, z: 0, hx: 7, hz: 7 },
      { x: 0, z: 4, hx: 3, hz: 3 },
    ];
    const walls: WallBox[] = [
      { x: 0, z: -4, hx: 3, hz: 4 },
      { x: 0, z: 8, hx: 18, hz: 1 },
      { x: 0, z: -8, hx: 18, hz: 1 },
      { x: -18, z: 0, hx: 1, hz: 9 },
      { x: 18, z: 0, hx: 1, hz: 9 },
    ];
    const cfg = { ...CFG, arena: { halfExtent: 20, wallHeight: 3, pillars: [], spawn: [-14, 1, -5], walls, floors } } as unknown as SimConfig;
    const w = createWorld(cfg);
    addPlayer(w, 1, [-15, 1, -6]);
    // Type 2 in the helpers' content is the boss (radius 1.6).
    const id = spawnEnemy(w, 2, 12, -5);
    let closest = Infinity;
    for (let t = 0; t < 30 * 30; t++) {
      step(w, new Map([[1, { ...idle, seq: t + 1, tick: t }]]));
      const p = entityPosition(w, id);
      if (!p) break;
      closest = Math.min(closest, Math.hypot(p[0] + 15, p[1] + 6));
    }
    destroyWorld(w);
    expect(closest).toBeLessThan(3);
  });
});
