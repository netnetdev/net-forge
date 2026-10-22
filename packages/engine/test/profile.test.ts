// Universal saves and the coin model: the declarations, their caps, the runner's progress
// for profiles, the adapter's keeper check and meta command.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addPlayer, createWorld, destroyWorld, initSim, keeperButtons, listPlayers, metaBonusOf, playerBuild, setMetaBonus, step } from "@netnetcapital/engine-sim";
import type { InputCommand, SimWorld } from "@netnetcapital/engine-sim";
import { achievement, earn, economy, game, keeper, metaUpgrade, mission, prefab, store, system, title, upgrade, weapon } from "../src/index.js";
import {
  GameRunner,
  collectManifest,
  compileGame,
  engineSimAdapter,
  metaBonus,
  metaPrice,
  openKeepers,
  ownedCosmetics,
  packMeta,
  profileSpec,
  resetRegistry,
  todaysGoals,
  unpackMeta,
} from "../src/game/index.js";
import type { CompiledGame } from "../src/game/index.js";

beforeAll(async () => {
  await initSim();
});
beforeEach(() => resetRegistry());

const input = (t: number, buttons = 0): InputCommand => ({ seq: t + 1, tick: t, moveX: 0, moveZ: 0, yaw: 0, buttons });

function base(extra?: () => void): CompiledGame {
  game({ template: "survivor", style: "lowpoly", places: { a: { chunks: "places/a", spawn: [0, 1, 0] } }, players: { prefab: "style.lowpoly.hero", max: 4 } });
  prefab("gem", { model: "style.lowpoly.gem", health: 1, speed: 0, kind: "pickup", value: 3 });
  prefab("shade", { model: "style.lowpoly.ghost", health: 1, speed: 0, ai: "idle", damage: 0, drops: ["gem"] });
  weapon("pulse", { kind: "nova", damage: 10, cooldown: 0.2, range: 3 });
  weapon("dart", { kind: "bolt", damage: 5, cooldown: 1, range: 8 });
  upgrade("boots", { stat: "speed", step: 0.1, maxLevel: 5 });
  keeper("lamp", { name: "Lamp", weapon: "pulse" });
  keeper("dartist", { name: "Dartist", weapon: "dart", unlock: "first" });
  keeper("ranger", { name: "Ranger", weapon: "dart" });
  achievement("first", { title: "First", when: "enemy.killed" });
  earn.rule("one", { when: "enemy.killed", n: 1, pay: 1, oncePer: "run" });
  earn.stake({ min: 1, max: 10, multiple: 2 });
  extra?.();
  return compileGame(collectManifest());
}

describe("the coin model: declarations and caps", () => {
  it("the default needs no declaration: cosmetics, unlocks and consumables, no meta", () => {
    const g = base(() => {
      store.sku("revive", { coins: 50 });
      store.sku("skin_gold", { coins: 300, grants: { cosmetic: 1 } });
      store.sku("unlock_ranger", { coins: 400, grants: { keeper: "ranger" } });
    });
    const spec = profileSpec(g.manifest);
    expect(spec.economy).toEqual({ store: "default", metaUpgrades: false });
    expect([...spec.skus.values()].map((s) => [s.id, s.kind])).toEqual([
      ["revive", "consumable"],
      ["skin_gold", "cosmetic"],
      ["unlock_ranger", "unlock"],
    ]);
    // ranger is sold (unlock_ranger), so it is locked until bought.
    expect(openKeepers(spec, { achievements: [], owned: [] })).toEqual([0]);
    expect(openKeepers(spec, { achievements: ["first"], owned: ["unlock_ranger"] })).toEqual([0, 1, 2]);
    expect(ownedCosmetics(spec, ["skin_gold"])).toEqual([0, 1]);
  });

  it("meta upgrades are opt-in: declaring one without economy({ metaUpgrades: true }) fails", () => {
    expect(() => base(() => metaUpgrade("hearth", { stat: "maxHealth", step: 0.05, levels: 3, cost: 100 }))).toThrow(/opt-in/);
  });

  it("caps: one level at most +15%, a stat at most +15%, all meta at most +30%, growth at least 1.5", () => {
    expect(() => base(() => (economy({ metaUpgrades: true }), metaUpgrade("big", { stat: "might", step: 0.2, levels: 1, cost: 1 })))).toThrow(/\+15%/);
    resetRegistry();
    expect(() => base(() => (economy({ metaUpgrades: true }), metaUpgrade("long", { stat: "might", step: 0.05, levels: 4, cost: 1 })))).toThrow(/within \+15%/);
    resetRegistry();
    expect(() =>
      base(() => {
        economy({ metaUpgrades: true });
        metaUpgrade("a", { stat: "might", step: 0.05, levels: 3, cost: 10 });
        metaUpgrade("b", { stat: "might", step: 0.05, levels: 1, cost: 10 });
      }),
    ).toThrow(/caps one stat at \+15%/);
    resetRegistry();
    expect(() =>
      base(() => {
        economy({ metaUpgrades: true });
        metaUpgrade("a", { stat: "might", step: 0.05, levels: 3, cost: 10 });
        metaUpgrade("b", { stat: "speed", step: 0.05, levels: 3, cost: 10 });
        metaUpgrade("c", { stat: "area", step: 0.05, levels: 1, cost: 10 });
      }),
    ).toThrow(/caps all meta power at \+30%/);
    resetRegistry();
    expect(() => base(() => (economy({ metaUpgrades: true }), metaUpgrade("flat", { stat: "might", step: 0.05, levels: 2, cost: 10, growth: 1.2 })))).toThrow(/geometrically/);
  });

  it("a cosmetics-only store sells looks only, and never meta", () => {
    expect(() => base(() => (economy({ store: "cosmetics" }), store.sku("revive", { coins: 50 })))).toThrow(/sells looks only/);
    resetRegistry();
    expect(() => economy({ store: "cosmetics", metaUpgrades: true })).toThrow(/no meta upgrades/);
    resetRegistry();
    const g = base(() => (economy({ store: "cosmetics" }), store.sku("skin_gold", { coins: 300, grants: { cosmetic: 1 } })));
    expect(g.manifest.economy.store).toBe("cosmetics");
  });

  it("unlock SKUs name a declared keeper, never the free default; the first keeper is always free", () => {
    expect(() => base(() => store.sku("u", { coins: 5, grants: { keeper: "ghost" } }))).toThrow(/not a declared keeper/);
    resetRegistry();
    expect(() => base(() => store.sku("unlock_lamp", { coins: 5, grants: { keeper: "lamp" } }))).toThrow(/free default keeper/);
    resetRegistry();
    // Earned or bought, never both: a sold keeper that also declares an achievement unlock is refused (the import could open it).
    expect(() => base(() => store.sku("unlock_dartist", { coins: 5, grants: { keeper: "dartist" } }))).toThrow(/both unlocked by an achievement .* and sold/);
    resetRegistry();
    const sold = profileSpec(base(() => store.sku("unlock_ranger", { coins: 5, grants: { keeper: "ranger" } })).manifest);
    expect(sold.keepers.map((k) => [k.id, k.sold])).toEqual([["lamp", false], ["dartist", false], ["ranger", true]]);
    // A sold keeper is locked until bought.
    expect(openKeepers(sold, { achievements: ["first"], owned: [] })).toEqual([0, 1]);
    expect(openKeepers(sold, { achievements: [], owned: ["unlock_ranger"] })).toEqual([0, 2]);
    resetRegistry();
    expect(() => {
      game({ template: "survivor", style: "lowpoly", places: { a: { chunks: "places/a", spawn: [0, 1, 0] } }, players: { prefab: "style.lowpoly.hero", max: 4 } });
      weapon("pulse", { kind: "nova", damage: 10, cooldown: 0.2, range: 3 });
      achievement("first", { title: "First", when: "enemy.killed" });
      keeper("locked", { name: "L", weapon: "pulse", unlock: "first" });
      keeper("free", { name: "F", weapon: "pulse" });
      earn.rule("one", { when: "enemy.killed", n: 1, pay: 1, oncePer: "run" });
      earn.stake({ min: 1, max: 10, multiple: 2 });
      collectManifest();
    }).toThrow(/declared first/);
  });

  it("prices grow geometrically; the bonus is capped again whatever is stored; levels pack into one command", () => {
    const g = base(() => {
      economy({ metaUpgrades: true });
      metaUpgrade("hearth", { stat: "maxHealth", step: 0.05, levels: 3, cost: 100, growth: 2 });
      metaUpgrade("stride", { stat: "speed", step: 0.03, levels: 5, cost: 80, growth: 1.5 });
    });
    const spec = profileSpec(g.manifest);
    const def = spec.meta.get("hearth");
    if (!def) throw new Error("no hearth");
    expect([0, 1, 2, 3].map((l) => metaPrice(def, l))).toEqual([100, 200, 400, null]);
    const top = metaBonus(spec, { hearth: 3, stride: 5 });
    expect(top.maxHealth).toBeCloseTo(0.15);
    expect(top.speed).toBeCloseTo(0.15);
    expect(metaBonus(spec, { hearth: 99 }).maxHealth).toBeLessThanOrEqual(0.15);
    const v = packMeta(spec, { hearth: 2, stride: 4 });
    expect(unpackMeta(spec, v)).toEqual({ hearth: 2, stride: 4 });
  });
});

describe("profiles from the sim: the runner reports, the adapter checks", () => {
  it("achievements, goals and titles reached in a run come out of takeProgress, humans only", () => {
    const g = base(() => {
      mission("kill", { text: "Kill one", when: "enemy.killed" });
      title("butcher", { text: "The Butcher", most: "kills" });
      system("s", ({ after, end, spawn }) => {
        after(0.1, () => spawn("shade", [0.5, 1, 0]));
        after(2, () => end("won"));
      });
    });
    const w = createWorld({ ...g.sim, seed: 3 });
    addPlayer(w, 1, [0, 1, 0]);
    const r = new GameRunner(g, w);
    const got: string[] = [];
    for (let t = 0; t < 30 * 3; t++) {
      const inputs = new Map<number, InputCommand>([[1, input(w.tick)]]);
      r.beforeStep(inputs);
      r.afterStep(step(w, inputs).events);
      for (const p of r.takeProgress()) got.push(`${p.player}:${p.kind}:${p.id}`);
    }
    expect(got).toEqual(expect.arrayContaining(["1:achievement:first", "1:goal:kill", "1:title:butcher"]));
    expect(r.takeProgress()).toEqual([]);
    destroyWorld(w);
  });

  it("restrictInput rewrites a locked keeper pick to the first open one; the server adapter emits progress events", () => {
    const g = base();
    const sim = engineSimAdapter({ name: "t", version: "t", game: g });
    const pick = (i: number) => sim.restrictInput?.(input(0, keeperButtons(i)), { keepers: [0, 2] }).buttons;
    expect(pick(2)).toBe(keeperButtons(2));
    expect(pick(1)).toBe(keeperButtons(0));
    expect(sim.restrictInput?.(input(0, 1), { keepers: [0, 2] }).buttons).toBe(1);
    // The sim then plays keeper 0 when the client asked for the locked one.
    const world = sim.createWorld(3, "server");
    sim.addPlayer(world, 1);
    const locked = sim.restrictInput?.(input(0, keeperButtons(1)), { keepers: [0, 2] }) ?? input(0);
    sim.step(world, new Map([[1, [locked]]]));
    expect(playerBuild(world.sim, 1)?.keeper).toBe(0);
    sim.disposeWorld?.(world);
  });

  it("the meta command applies the capped bonus (only in an opted-in game); max health follows a full player", () => {
    const g = base(() => {
      economy({ metaUpgrades: true });
      metaUpgrade("hearth", { stat: "maxHealth", step: 0.05, levels: 3, cost: 100 });
    });
    const sim = engineSimAdapter({ name: "t", version: "t", game: g });
    const world = sim.createWorld(3, "server");
    sim.addPlayer(world, 1);
    const before = listPlayers(world.sim)[0]?.maxHealth ?? 0;
    expect(sim.command?.(world, 1, { name: "meta", value: packMeta(profileSpec(g.manifest), { hearth: 2 }) })).toBe(true);
    expect(metaBonusOf(world.sim, 1).maxHealth).toBeCloseTo(0.1);
    const after = listPlayers(world.sim)[0];
    expect(after?.maxHealth).toBe(Math.round(before * 1.1));
    expect(after?.health).toBe(after?.maxHealth);
    sim.disposeWorld?.(world);
    // A game without the opt-in ignores the command.
    resetRegistry();
    const plain = engineSimAdapter({ name: "p", version: "p", game: base() });
    const w2 = plain.createWorld(3, "server");
    plain.addPlayer(w2, 1);
    expect(plain.command?.(w2, 1, { name: "meta", value: 7 })).toBe(false);
    plain.disposeWorld?.(w2);
  });

  it("engine-sim clamps any bonus it is handed: +15% a stat, +30% in all", () => {
    const g = base();
    const w: SimWorld = createWorld({ ...g.sim, seed: 1 });
    addPlayer(w, 1, [0, 1, 0]);
    setMetaBonus(w, 1, { might: 5, speed: 0.15, area: 0.15, haste: 0.15 });
    const m = metaBonusOf(w, 1);
    expect(m.might + m.speed + m.area + m.haste).toBeCloseTo(0.3);
    expect(Math.max(m.might, m.speed, m.area, m.haste)).toBeLessThanOrEqual(0.15);
    destroyWorld(w);
  });

  it("today's goals are the same for everyone on a UTC day", () => {
    expect(todaysGoals(["a", "b", "c", "d", "e"], 20000)).toEqual(todaysGoals(["a", "b", "c", "d", "e"], 20000));
    expect(todaysGoals(["a", "b", "c", "d", "e"], 20000)).toHaveLength(3);
  });
});
