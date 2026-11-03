import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initSim } from "@netforge/engine-sim";
import { earn, game, prefab, tower, towerBoard, waves } from "../src/index.js";
import { collectManifest, resetRegistry } from "../src/api/registry.js";
import { playRules } from "../src/rules/harness.js";
import { towerGenre } from "../src/rules/tower.js";

function base() {
  game({
    template: "tower-defense",
    style: "lowpoly",
    places: { floor: { chunks: "places/moor", spawn: [0, 0, 0] } },
    players: { prefab: "style.lowpoly.worker", max: 4 },
  });
  towerBoard({ size: [18, 12], path: [[0, 6], [17, 6]], lives: 30, gold: 1500, prep: 3, breather: 2 });
  prefab("mob", { model: "style.lowpoly.slime_green", health: 16, speed: 1.6, value: 5, damage: 1 });
  earn.rule("cleared", { when: "wave.cleared", n: 1, pay: 1, oncePer: "run" });
  earn.stake({ min: 1, max: 10, multiple: 2 });
  waves({ total: 4, groups: [{ prefab: "mob", count: 5, grow: 2, gap: 0.5 }] });
}

beforeAll(async () => {
  await initSim();
});
beforeEach(() => resetRegistry());

describe("tower upgrade trees: compile", () => {
  it("compiles a branching tower into its branches with correct tier stats", () => {
    base();
    tower("multi", {
      model: "style.lowpoly.turret",
      kind: "bolt",
      cost: 40,
      damage: 8,
      rate: 1,
      range: 3,
      branches: [
        { name: "Cannon", tiers: [{ cost: 30, damage: 16 }, { cost: 60, damage: 30 }] },
        { name: "Gatling", tiers: [{ cost: 30, rate: 2 }, { cost: 60, rate: 3 }] },
      ],
    });
    const t = towerGenre(collectManifest()).game.towers[0]!;
    expect(t.branches.map((b) => b.name)).toEqual(["Cannon", "Gatling"]);
    expect(t.branches[0]!.cumStats[0]!.damage).toBe(8); // base
    expect(t.branches[0]!.cumStats[1]!.damage).toBe(16); // Cannon tier 1
    expect(t.branches[0]!.cumStats[2]!.damage).toBe(30);
    expect(t.branches[1]!.cumStats[1]!.rate).toBe(2); // Gatling tier 1
    expect(t.branches[0]!.cost).toEqual([30, 60]);
    // Back-compat aliases point at branch 0.
    expect(t.levels).toEqual(t.branches[0]!.cumStats);
    expect(t.upgradeCost).toEqual(t.branches[0]!.cost);
  });

  it("compiles a plain `levels` tower as a single branch", () => {
    base();
    tower("gun", { model: "style.lowpoly.turret", kind: "bolt", cost: 40, damage: 8, rate: 1, range: 3, levels: [{ cost: 30, damage: 16 }] });
    const t = towerGenre(collectManifest()).game.towers[0]!;
    expect(t.branches.length).toBe(1);
    expect(t.branches[0]!.cumStats[1]!.damage).toBe(16);
  });
});

describe("tower upgrade trees: a branching tower plays", () => {
  it("plays end-to-end with bots, no softlock", () => {
    base();
    tower("multi", {
      model: "style.lowpoly.turret",
      kind: "bolt",
      cost: 40,
      damage: 10,
      rate: 2,
      range: 4,
      branches: [
        { name: "Cannon", tiers: [{ cost: 30, damage: 20 }, { cost: 60, damage: 40 }] },
        { name: "Gatling", tiers: [{ cost: 30, rate: 3 }, { cost: 60, rate: 4 }] },
      ],
    });
    const m = collectManifest();
    const { report } = playRules(towerGenre(m), m, { ticks: 30 * 150, bots: 2, seed: 7 });
    expect(report.softlock).toBe(false);
    expect(report.kills).toBeGreaterThan(0);
    expect(report.wave).toBeGreaterThanOrEqual(2);
    expect(report.failed).toEqual([]);
  });
});
