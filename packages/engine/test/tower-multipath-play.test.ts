import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initSim } from "@netforge/engine-sim";
import { earn, game, prefab, tower, towerBoard, waves } from "../src/index.js";
import { collectManifest, resetRegistry } from "../src/api/registry.js";
import { playRules } from "../src/rules/harness.js";
import { towerGenre } from "../src/rules/tower.js";

/** A real two-lane tower-defense game, declared through the public API. */
function twoLane() {
  game({
    template: "tower-defense",
    style: "lowpoly",
    places: { floor: { chunks: "places/moor", spawn: [0, 0, 0] } },
    players: { prefab: "style.lowpoly.worker", max: 4 },
  });
  towerBoard({
    size: [18, 12],
    paths: [
      [[0, 3], [17, 3]],
      [[0, 9], [17, 9]],
    ],
    lives: 40,
    gold: 600,
    prep: 3,
    breather: 2,
  });
  prefab("mob", { model: "style.lowpoly.slime_green", health: 18, speed: 2, value: 5, damage: 1 });
  tower("gun", { model: "style.lowpoly.turret", kind: "bolt", cost: 40, damage: 9, rate: 2, range: 3 });
  waves({
    total: 4,
    groups: [
      { prefab: "mob", lane: 0, count: 5, grow: 2, gap: 0.6 },
      { prefab: "mob", lane: 1, from: 1, count: 5, grow: 2, gap: 0.6 },
    ],
  });
  earn.rule("cleared", { when: "wave.cleared", n: 1, pay: 1, oncePer: "run" });
  earn.stake({ min: 1, max: 10, multiple: 2 });
  return collectManifest();
}

beforeAll(async () => {
  await initSim();
});
beforeEach(() => resetRegistry());

describe("tower multi-path: a two-lane game compiles and plays", () => {
  it("compiles two roads and routes each group to its lane", () => {
    const g = towerGenre(twoLane()).game;
    expect(g.board.roads.length).toBe(2);
    expect(g.board.roads[0]!.length).toBe(17 * 256);
    expect(g.board.roads[1]!.length).toBe(17 * 256);
    expect(g.groups.map((x) => x.lane).sort()).toEqual([0, 1]);
  });

  it("plays end-to-end with bots: waves advance, creeps die, no softlock", () => {
    const m = twoLane();
    const genre = towerGenre(m);
    const { report } = playRules(genre, m, { ticks: 30 * 150, bots: 2, seed: 3 });
    expect(report.softlock).toBe(false);
    expect(report.kills).toBeGreaterThan(0); // creeps on both lanes were shot
    expect(report.wave).toBeGreaterThanOrEqual(2); // the run progressed through waves
    expect(report.failed).toEqual([]); // referee checks pass on a two-lane board
  });
});
