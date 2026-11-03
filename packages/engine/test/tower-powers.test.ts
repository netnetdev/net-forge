import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initSim } from "@netforge/engine-sim";
import { earn, game, power, prefab, tower, towerBoard, waves } from "../src/index.js";
import { collectManifest, resetRegistry } from "../src/api/registry.js";
import type { Avatar, RulesContext } from "../src/rules/kit.js";
import { TowerAct, towerGenre } from "../src/rules/tower.js";

const ctx: RulesContext = { bonus: () => 0, isBot: () => false };
const avatar = { x: 0, z: 0, yaw: 0, flags: 0 } as unknown as Avatar;
const input = (act: number, a = 0, b = 0, c = 0) => ({ mx: 0, mz: 0, cx: 0, cz: 0, act, a, b, c });
const noop = () => {};
const aliveCount = (s: { creeps: { gone: number; hp: number }[] }) => s.creeps.filter((c) => c.gone === 0 && c.hp > 0).length;

function gameBase() {
  game({
    template: "tower-defense",
    style: "lowpoly",
    places: { floor: { chunks: "places/moor", spawn: [0, 0, 0] } },
    players: { prefab: "style.lowpoly.worker", max: 4 },
  });
  // Slow, numerous, tanky creeps; high lives; a tower that is declared but never built.
  towerBoard({ size: [18, 12], path: [[0, 6], [17, 6]], lives: 200, gold: 100, prep: 3, breather: 2 });
  prefab("mob", { model: "style.lowpoly.slime_green", health: 40, speed: 0.6, value: 1, damage: 1 });
  tower("unused", { model: "style.lowpoly.turret", kind: "bolt", cost: 40, damage: 5, rate: 1, range: 3 });
  waves({ total: 3, groups: [{ prefab: "mob", count: 12, grow: 2, gap: 0.3 }] });
  earn.rule("cleared", { when: "wave.cleared", n: 1, pay: 1, oncePer: "run" });
  earn.stake({ min: 1, max: 10, multiple: 2 });
}

/** Create a joined, running state with creeps already on the road (no towers built). */
function started(seed = 1) {
  const genre = towerGenre(collectManifest());
  const s = genre.create(seed, ctx);
  genre.join(s, 1);
  for (let i = 0; i < 200 && aliveCount(s) < 4; i++) genre.step(s, noop);
  return { genre, s };
}

beforeAll(async () => {
  await initSim();
});
beforeEach(() => resetRegistry());

describe("tower powers: compile", () => {
  it("compiles powers with cooldown in ticks and the parsed effect", () => {
    gameBase();
    power("airstrike", { cooldown: 10, target: "point", effect: { kind: "burst", damage: 200, radius: 2 } });
    power("freeze", { cooldown: 20, effect: { kind: "slow", slow: 0.6, seconds: 4 } });
    const g = towerGenre(collectManifest()).game;
    expect(g.powers.map((p) => p.id)).toEqual(["airstrike", "freeze"]);
    expect(g.powers[0]!.cooldownTicks).toBe(10 * 30);
    expect(g.powers[0]!.effect).toEqual({ kind: "burst", damage: 200, radius: 2 });
    expect(g.powers[1]!.target).toBe("none");
  });
});

describe("tower powers: a burst kills creeps and respects its cooldown", () => {
  it("fires, kills, then is blocked until the cooldown elapses", () => {
    gameBase();
    power("airstrike", { cooldown: 2, target: "point", effect: { kind: "burst", damage: 1000, radius: 8 } });
    const { genre, s } = started(3);
    expect(aliveCount(s)).toBeGreaterThan(0);
    const before = s.kills;

    // Blast the middle of the road (tile 8,6); radius 8 covers the whole lane.
    genre.act(s, 1, input(TowerAct.Power, 0, 8, 6), avatar, noop);
    expect(s.kills).toBeGreaterThan(before);
    expect(s.powerCd[0]).toBeGreaterThan(0);

    // A second blast on cooldown does nothing.
    const afterFirst = s.kills;
    genre.act(s, 1, input(TowerAct.Power, 0, 8, 6), avatar, noop);
    expect(s.kills).toBe(afterFirst);

    // After the cooldown elapses it is ready again.
    const cd = s.powerCd[0]!;
    for (let i = 0; i < cd + 1; i++) genre.step(s, noop);
    expect(s.powerCd[0]).toBe(0);
  });
});

describe("tower powers: slow affects the whole board", () => {
  it("applies a slow to every creep", () => {
    gameBase();
    power("freeze", { cooldown: 20, effect: { kind: "slow", slow: 0.6, seconds: 4 } });
    const { genre, s } = started(5);
    const living = s.creeps.filter((c) => c.gone === 0 && c.hp > 0);
    expect(living.length).toBeGreaterThan(0);
    genre.act(s, 1, input(TowerAct.Power, 0), avatar, noop);
    expect(living.every((c) => c.slowTicks > 0 && c.slow >= 0.6)).toBe(true);
  });
});
