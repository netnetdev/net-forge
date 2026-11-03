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
  towerBoard({ size: [18, 12], path: [[0, 6], [17, 6]], lives: 20, gold: 2000, prep: 3, breather: 2 });
  earn.rule("cleared", { when: "wave.cleared", n: 1, pay: 1, oncePer: "run" });
  earn.stake({ min: 1, max: 10, multiple: 2 });
}

function run(ticks = 30 * 120, bots = 1, seed = 5) {
  const m = collectManifest();
  return playRules(towerGenre(m), m, { ticks, bots, seed }).report;
}

beforeAll(async () => {
  await initSim();
});
beforeEach(() => resetRegistry());

describe("tower enemy traits: flying needs anti-air", () => {
  it("a ground-only field cannot kill flying creeps (they all leak)", () => {
    base();
    prefab("wisp", { model: "style.lowpoly.ghost", health: 10, speed: 2, value: 3, flying: true });
    tower("gun", { model: "style.lowpoly.turret", kind: "bolt", cost: 30, damage: 20, rate: 3, range: 4 }); // air defaults false
    waves({ total: 3, groups: [{ prefab: "wisp", count: 6, grow: 2, gap: 0.5 }] });
    expect(run().kills).toBe(0);
  });

  it("an anti-air tower (air: true) shoots them down", () => {
    base();
    prefab("wisp", { model: "style.lowpoly.ghost", health: 10, speed: 2, value: 3, flying: true });
    tower("flak", { model: "style.lowpoly.turret", kind: "bolt", cost: 30, damage: 20, rate: 3, range: 4, air: true });
    waves({ total: 3, groups: [{ prefab: "wisp", count: 6, grow: 2, gap: 0.5 }] });
    expect(run().kills).toBeGreaterThan(0);
  });
});

describe("tower enemy traits: camo needs detection", () => {
  it("a normal tower cannot see camo creeps", () => {
    base();
    prefab("sneak", { model: "style.lowpoly.slime_green", health: 10, speed: 2, value: 3, camo: true });
    tower("gun", { model: "style.lowpoly.turret", kind: "bolt", cost: 30, damage: 20, rate: 3, range: 4 });
    waves({ total: 3, groups: [{ prefab: "sneak", count: 6, grow: 2, gap: 0.5 }] });
    expect(run().kills).toBe(0);
  });

  it("a detector tower (detect: true) reveals and kills them", () => {
    base();
    prefab("sneak", { model: "style.lowpoly.slime_green", health: 10, speed: 2, value: 3, camo: true });
    tower("radar", { model: "style.lowpoly.turret", kind: "bolt", cost: 30, damage: 20, rate: 3, range: 4, detect: true });
    waves({ total: 3, groups: [{ prefab: "sneak", count: 6, grow: 2, gap: 0.5 }] });
    expect(run().kills).toBeGreaterThan(0);
  });
});

describe("tower enemy traits: split spawns more creeps on death", () => {
  it("a splitting creep yields more kills than the same game without splitting", () => {
    base();
    prefab("spark", { model: "style.lowpoly.slime_green", health: 6, speed: 1.4, value: 2 });
    prefab("blob", { model: "style.lowpoly.orc_brute", health: 14, speed: 1, value: 4, split: { into: "spark", count: 2 } });
    tower("gun", { model: "style.lowpoly.turret", kind: "bolt", cost: 30, damage: 30, rate: 3, range: 5 });
    waves({ total: 3, groups: [{ prefab: "blob", count: 4, grow: 1, gap: 0.8 }] });
    const split = run(30 * 150, 1, 9).kills;

    resetRegistry();
    base();
    prefab("spark", { model: "style.lowpoly.slime_green", health: 6, speed: 1.4, value: 2 });
    prefab("blob", { model: "style.lowpoly.orc_brute", health: 14, speed: 1, value: 4 }); // no split
    tower("gun", { model: "style.lowpoly.turret", kind: "bolt", cost: 30, damage: 30, rate: 3, range: 5 });
    waves({ total: 3, groups: [{ prefab: "blob", count: 4, grow: 1, gap: 0.8 }] });
    const plain = run(30 * 150, 1, 9).kills;

    expect(split).toBeGreaterThan(plain);
  });
});
