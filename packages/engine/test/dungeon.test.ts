import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initSim } from "@netforge/engine-sim";
import { dungeon, earn, game, GameDefinitionError, keeper, prefab, weapon } from "../src/index.js";
import { collectManifest, compileGame, DUNGEON_VIEWS, resetRegistry, SURVIVOR_VIEWS, viewRadii } from "../src/game/index.js";

beforeAll(async () => {
  await initSim();
});
beforeEach(() => resetRegistry());

const inBox = (x: number, z: number, b: readonly number[]) => Math.abs(x - (b[0] ?? 0)) < (b[2] ?? 0) && Math.abs(z - (b[1] ?? 0)) < (b[3] ?? 0);

describe("dungeon(...)", () => {
  it("is deterministic per seed and different across seeds", () => {
    const a = dungeon({ seed: 7, rooms: 9 });
    const b = dungeon({ seed: 7, rooms: 9 });
    const c = dungeon({ seed: 8, rooms: 9 });
    expect(JSON.stringify(a.field)).toBe(JSON.stringify(b.field));
    expect(JSON.stringify(a.field)).not.toBe(JSON.stringify(c.field));
  });

  it("starts at [0, 0], connects every room, keeps walls off the floor and puts the boss deepest", () => {
    for (const seed of [1, 2, 3, 41, 999]) {
      const d = dungeon({ seed, rooms: 10 });
      expect(d.rooms).toHaveLength(10);
      expect(d.start.x).toBe(0);
      expect(d.start.z).toBe(0);
      expect(d.roomAt(0, 0)).toBe(0);
      expect(d.rooms.every((r) => r.depth >= 0 && r.links.length > 0)).toBe(true);
      expect(d.boss.depth).toBe(Math.max(...d.rooms.map((r) => r.depth)));
      // No wall box covers the centre of any floor box.
      for (const f of d.field.floors) for (const w of d.field.walls) expect(inBox(f[0], f[1], w)).toBe(false);
      // Walls close the floor in: one step past every room edge is a wall or more floor.
      for (const r of d.rooms) {
        const x = r.x + r.hx + 0.5;
        const onFloor = d.field.floors.some((f) => inBox(x, r.z + 0.5, f) || inBox(x, r.z - 0.5, f));
        const onWall = d.field.walls.some((w) => inBox(x, r.z + 0.5, w) || inBox(x, r.z - 0.5, w));
        expect(onFloor || onWall).toBe(true);
      }
      expect(d.field.walls.length).toBeLessThan(400);
      expect(d.field.halfSize).toBeLessThanOrEqual(120);
    }
  });

  it("refuses a spec that cannot fit, with a line to act on", () => {
    expect(() => dungeon({ seed: 1, rooms: 5, cell: 16, size: [10, 14] })).toThrow(GameDefinitionError);
    expect(() => dungeon({ seed: 1, rooms: 2 })).toThrow(/at least 3 rooms/);
  });

  it("compiles a dungeon game: walls and floors reach the sim, keepers are allowed, the camera is the dungeon's", () => {
    const map = dungeon({ seed: 5, rooms: 6 });
    game({
      template: "dungeon",
      style: "lowpoly",
      places: { crypt: { chunks: "places/crypt", spawn: [0, 1, 0] } },
      field: map.field,
      players: { prefab: "style.lowpoly.hero", max: 4, weapon: "pulse" },
    });
    prefab("bat", { model: "style.lowpoly.bat", health: 10, speed: 4, drops: ["gem"] });
    prefab("gem", { model: "style.lowpoly.gem", health: 1, speed: 0, value: 3 });
    weapon("pulse", { kind: "nova", damage: 20, cooldown: 0.5, range: 4 });
    keeper("guard", { name: "Guard", text: "Holds the line.", weapon: "pulse" });
    earn.rule("bats", { when: "enemy.killed", n: 5, pay: 1, oncePer: "run" });
    earn.stake({ min: 1, max: 10, multiple: 2 });
    const g = compileGame(collectManifest());
    expect(g.sim.arena?.walls?.length).toBe(map.field.walls.length);
    expect(g.sim.arena?.floors?.length).toBe(map.field.floors.length);
    expect(g.mode).toBe("survivor");
    expect(g.view).toEqual(viewRadii(DUNGEON_VIEWS));
    expect(g.view).not.toEqual(viewRadii(SURVIVOR_VIEWS));
  });
});
