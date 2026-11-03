import { beforeEach, describe, expect, it } from "vitest";
import { campaign, earn, game, prefab, tower, towerBoard, waves } from "../src/index.js";
import { collectManifest, resetRegistry } from "../src/api/registry.js";
import { Q, towerGenre } from "../src/rules/tower.js";

/** Towers, waves, economy shared by every map in these tests. */
function shared() {
  game({
    template: "tower-defense",
    style: "lowpoly",
    places: { floor: { chunks: "places/moor", spawn: [0, 0, 0] } },
    players: { prefab: "style.lowpoly.worker", max: 4 },
  });
  prefab("mob", { model: "style.lowpoly.slime_green", health: 10, speed: 2, value: 3, damage: 1 });
  tower("gun", { model: "style.lowpoly.turret", kind: "bolt", cost: 30, damage: 10, rate: 2, range: 3 });
  waves({ total: 3, groups: [{ prefab: "mob", count: 5, grow: 1, gap: 0.5 }] });
  earn.rule("cleared", { when: "wave.cleared", n: 1, pay: 1, oncePer: "run" });
  earn.stake({ min: 1, max: 10, multiple: 2 });
}

const g = () => towerGenre(collectManifest()).game;

beforeEach(() => resetRegistry());

describe("tower map roster", () => {
  it("a single unnamed board is a roster of one (back-compat)", () => {
    shared();
    towerBoard({ size: [18, 12], path: [[0, 6], [17, 6]], lives: 20, gold: 120 });
    const game = g();
    expect(game.roster.map((r) => r.id)).toEqual(["main"]);
    expect(game.roster[0]!.board.length).toBe(game.board.length); // active board is roster[0]
    expect(game.modes).toEqual([]);
  });

  it("keeps several named boards in declared order, the run on the first", () => {
    shared();
    towerBoard("harbour", { size: [18, 12], path: [[0, 6], [17, 6]], lives: 20, gold: 120 }); // 17 tiles
    towerBoard("crypt", { size: [18, 12], path: [[0, 3], [8, 3], [8, 11]], lives: 15, gold: 100 }); // 15 tiles
    const game = g();
    expect(game.roster.map((r) => r.id)).toEqual(["harbour", "crypt"]);
    expect(game.board.length).toBe(17 * Q); // first board (harbour) is active
    expect(game.roster[1]!.board.length).toBe(16 * Q);
  });

  it("a campaign order reorders the roster and the active board", () => {
    shared();
    towerBoard("harbour", { size: [18, 12], path: [[0, 6], [17, 6]], lives: 20, gold: 120 }); // 17
    towerBoard("crypt", { size: [18, 12], path: [[0, 3], [8, 3], [8, 11]], lives: 15, gold: 100 }); // 15
    campaign({ order: ["crypt", "harbour"], modes: [{ id: "normal" }, { id: "hard", lives: 10, health: 0.18 }] });
    const game = g();
    expect(game.roster.map((r) => r.id)).toEqual(["crypt", "harbour"]);
    expect(game.board.length).toBe(16 * Q); // crypt is now first/active
    expect(game.modes.map((m) => m.id)).toEqual(["normal", "hard"]);
    expect(game.modes[1]).toMatchObject({ lives: 10, health: 0.18 });
  });

  it("rejects a campaign order that names a board that was not declared", () => {
    shared();
    towerBoard("harbour", { size: [18, 12], path: [[0, 6], [17, 6]], lives: 20, gold: 120 });
    campaign({ order: ["harbour", "ghost_town"] });
    expect(() => g()).toThrow(/ghost_town/);
  });
});
