import { beforeEach, describe, expect, it } from "vitest";
import { GameDefinitionError, earn, engine, game, prefab, store, system, upgrade } from "../src/index.js";
import { SystemScheduler, collectManifest, resetRegistry } from "../src/runtime/index.js";
import type { PlayerView } from "../src/index.js";

beforeEach(() => resetRegistry());

/** The spec §12 example, verbatim. */
function declareSpecExample(): void {
  game({
    template: "survivor",
    style: "lowpoly",
    places: { mars: { chunks: "places/mars", spawn: [0, 0, 0] } },
    players: { prefab: "style.lowpoly.mech_01", max: 4 },
  });
  prefab("bat", { model: "style.lowpoly.bat", health: 10, speed: 4, ai: "chase", drops: ["xp_small"] });
  prefab("xp_small", { model: "style.lowpoly.gem_small", health: 1, speed: 0 });
  system("waves", ({ every, spawnRing }) => {
    every(20, (n) => spawnRing("bat", { count: 20 + n * 8, radius: 18 }));
  });
  earn.rule("wave_clear", { when: "wave.cleared", n: 10, pay: 100, oncePer: "run" });
  earn.stake({ min: 1, max: 10, multiple: 2 });
  store.sku("revive", { coins: 50, usdg: 0.5 });
  store.sku("legacy", { token: 10 });
}

describe("declarative game API", () => {
  it("accepts the spec example and collects a manifest", () => {
    declareSpecExample();
    const m = collectManifest();
    expect(m.game.template).toBe("survivor");
    expect(m.prefabs.get("bat")?.ai).toBe("chase");
    expect(m.earnRules.size).toBe(1);
    expect(m.skus.get("revive")).toEqual({ coins: 50, usdg: 0.5 });
    // `token` is the old name for coins.
    expect(m.skus.get("legacy")).toEqual({ coins: 10 });
  });

  it("rejects asset URLs with an actionable message", () => {
    expect(() => prefab("bad", { model: "https://example.com/bat.glb", health: 1, speed: 1 })).toThrow(/library id/);
  });

  it("rejects unknown fields, bad ids and duplicates", () => {
    expect(() => prefab("Bat", { model: "style.lowpoly.bat", health: 1, speed: 1 })).toThrow(GameDefinitionError);
    expect(() => prefab("bat", { model: "style.lowpoly.bat", health: 1, speed: 1, colour: "red" } as never)).toThrow(/colour|Unrecognized/);
    prefab("bat", { model: "style.lowpoly.bat", health: 1, speed: 1 });
    expect(() => prefab("bat", { model: "style.lowpoly.bat", health: 1, speed: 1 })).toThrow(/twice/);
  });

  it("requires at least one earn rule and resolvable drops", () => {
    game({ template: "arena", style: "toon", places: { a: { chunks: "places/a", spawn: [0, 0, 0] } }, players: { prefab: "style.toon.hero", max: 16 } });
    prefab("bat", { model: "style.toon.bat", health: 1, speed: 1, drops: ["nope"] });
    expect(() => collectManifest()).toThrow(/earn\.rule[\s\S]*nope/);
  });

  it("accepts look and feel declarations and rejects bad values with actionable messages", () => {
    const g = game({
      template: "survivor",
      style: "lowpoly",
      places: { a: { chunks: "places/a", spawn: [0, 0, 0] } },
      players: { prefab: "style.lowpoly.keeper_01", max: 4 },
      look: { preset: "dusk", bloom: 1.4, outline: true, fog: 0.5, tint: "#ffd9a0" },
    });
    expect(g.look?.preset).toBe("dusk");
    const p = prefab("brute", {
      model: "style.lowpoly.brute",
      health: 100,
      speed: 2,
      mass: 6,
      feel: { shake: 0.4, hitStop: 0.06, particles: "burst", decal: "splat", sound: "crunch", color: "#ff4d5e" },
    });
    expect(p.feel?.particles).toBe("burst");
    expect(() => prefab("x", { model: "style.lowpoly.x", health: 1, speed: 1, feel: { hitStop: 0.5 } })).toThrow(/seconds/);
    expect(() => prefab("y", { model: "style.lowpoly.y", health: 1, speed: 1, feel: { color: "red" } })).toThrow(/rrggbb/);
    expect(() => prefab("z", { model: "style.lowpoly.z", health: 1, speed: 1, feel: { particles: "confetti" as never } })).toThrow(GameDefinitionError);
    resetRegistry();
    // A look preset defaults to night when only tuning fields are given.
    expect(game({ template: "survivor", style: "lowpoly", places: { a: { chunks: "a", spawn: [0, 0, 0] } }, players: { prefab: "style.lowpoly.k", max: 1 }, look: { bloom: 0 } }).look?.preset).toBe("night");
  });

  it("caps an instance at 100 players", () => {
    expect(() =>
      game({ template: "party", style: "voxel", places: { a: { chunks: "p", spawn: [0, 0, 0] } }, players: { prefab: "style.voxel.x", max: 500 } }),
    ).toThrow(/at most 100/);
  });

  it("a SKU needs a price; coins are whole, positive and named once", () => {
    expect(() => store.sku("free", {})).toThrow(/price/);
    expect(() => store.sku("half", { coins: 2.5 })).toThrow(GameDefinitionError);
    expect(() => store.sku("zero", { coins: 0 })).toThrow(GameDefinitionError);
    expect(() => store.sku("neg", { coins: -5 })).toThrow(GameDefinitionError);
    expect(() => store.sku("both", { coins: 5, token: 5 })).toThrow(/coins only/);
  });
});

describe("SystemScheduler", () => {
  it("runs `every` on whole ticks with n = 1, 2, 3", () => {
    declareSpecExample();
    const m = collectManifest();
    let tick = 0;
    const spawns: string[] = [];
    const players: PlayerView[] = [{ id: 1, position: [0, 0, 0], health: 100, alive: true, kills: 0, deaths: 0, bot: false }];
    const s = new SystemScheduler(m, {
      tickRate: 30,
      tick: () => tick,
      players: () => players,
      spawn: (id) => spawns.push(id),
      random: () => 0.5,
      emit: () => undefined,
    });
    s.start();
    for (tick = 1; tick <= 30 * 60; tick++) s.tick();
    // Waves at 20 s, 40 s, 60 s: 28 + 36 + 44 bats.
    expect(spawns.length).toBe(28 + 36 + 44);
  });

  it("rejects spawning an undeclared prefab", () => {
    declareSpecExample();
    system("oops", ({ after, spawn }) => after(1, () => spawn("dragon", [0, 0, 0])));
    const m = collectManifest();
    let tick = 0;
    const s = new SystemScheduler(m, { tickRate: 30, tick: () => tick, players: () => [], spawn: () => undefined, random: () => 0, emit: () => undefined });
    s.start();
    expect(() => {
      for (tick = 1; tick <= 30; tick++) s.tick();
    }).toThrow(/dragon/);
  });
});

describe("engine.test.run", () => {
  it("runs bots on the server sim and reports", async () => {
    const r = await engine.test.run({
      ticks: 600,
      bots: 4,
      enemies: 300,
      assert: [{ name: "something died", check: (x) => x.kills > 0 }, { name: "impossible", check: () => false }],
    });
    expect(r.bots).toBe(4);
    expect(r.kills).toBeGreaterThan(0);
    expect(r.msPerTick).toBeGreaterThan(0);
    expect(r.failed).toEqual(["impossible"]);
  });
});

describe("the buy-in run is mandatory (earn.stake)", () => {
  const base = () => {
    game({ template: "survivor", style: "lowpoly", places: { a: { chunks: "p", spawn: [0, 0, 0] } }, players: { prefab: "style.lowpoly.x", max: 4 } });
    earn.rule("one", { when: "wave.cleared", pay: 1, oncePer: "run" });
  };
  it("a game without one does not collect", () => {
    base();
    expect(() => collectManifest()).toThrow(/earn\.stake/);
  });
  it("one is collected with its terms; a second is refused; bad terms are refused", () => {
    base();
    earn.stake({ min: 5, max: 50, multiple: 2 });
    expect(() => earn.stake({ min: 5, max: 50, multiple: 2 })).toThrow(GameDefinitionError);
    expect(collectManifest().stake).toEqual({ min: 5, max: 50, multiple: 2 });
    resetRegistry();
    expect(() => earn.stake({ min: 5, max: 50, multiple: 3 })).toThrow(GameDefinitionError);
    expect(() => earn.stake({ min: 60, max: 50, multiple: 2 })).toThrow(GameDefinitionError);
  });
  it("no SKU may take the stake's spend reason", () => {
    base();
    earn.stake({ min: 5, max: 50, multiple: 2 });
    store.sku("stake", { coins: 5 });
    expect(() => collectManifest()).toThrow(/buy-in run's coin spend reason/);
  });
});

describe("losable gear (store.sku grants { gear, loseBelow })", () => {
  const base = () => {
    game({ template: "survivor", style: "lowpoly", places: { a: { chunks: "p", spawn: [0, 0, 0] } }, players: { prefab: "style.lowpoly.x", max: 4 } });
    earn.rule("one", { when: "wave.cleared", pay: 1, oncePer: "run" });
    earn.stake({ min: 5, max: 50, multiple: 2 });
  };
  it("names a declared upgrade and sells for coins only", () => {
    base();
    store.sku("charm", { coins: 50, grants: { gear: "nope", loseBelow: 0.25 } });
    expect(() => collectManifest()).toThrow(/not a declared upgrade/);
    resetRegistry();
    base();
    upgrade("might", { stat: "might", step: 0.1, maxLevel: 3 });
    store.sku("charm", { coins: 50, usdg: 1, grants: { gear: "might", loseBelow: 0.25 } });
    expect(() => collectManifest()).toThrow(/gear sells for coins only/);
    resetRegistry();
    expect(() => store.sku("charm", { coins: 50, grants: { gear: "might", loseBelow: 2 } })).toThrow(GameDefinitionError);
  });
  it("collects as gear in the profile spec", async () => {
    base();
    upgrade("might", { stat: "might", step: 0.1, maxLevel: 3 });
    store.sku("charm", { coins: 50, grants: { gear: "might", loseBelow: 0.25 } });
    const { profileSpec, ownedGear } = await import("../src/game/profile.js");
    const spec = profileSpec(collectManifest());
    expect(spec.skus.get("charm")?.kind).toBe("gear");
    expect(ownedGear(spec, ["charm"])).toEqual([{ sku: "charm", upgrade: "might", loseBelow: 0.25, coins: 50 }]);
  });
});

describe("PvP pots (earn.pot)", () => {
  it("are optional, for the arena template only, declared once, with a recycle share", () => {
    game({ template: "survivor", style: "lowpoly", places: { a: { chunks: "p", spawn: [0, 0, 0] } }, players: { prefab: "style.lowpoly.x", max: 4 } });
    earn.rule("one", { when: "wave.cleared", pay: 1, oncePer: "run" });
    earn.stake({ min: 5, max: 50, multiple: 2 });
    expect(collectManifest().pot).toBeNull();
    resetRegistry();
    game({ template: "survivor", style: "lowpoly", places: { a: { chunks: "p", spawn: [0, 0, 0] } }, players: { prefab: "style.lowpoly.x", max: 4 } });
    earn.rule("one", { when: "wave.cleared", pay: 1, oncePer: "run" });
    earn.stake({ min: 5, max: 50, multiple: 2 });
    earn.pot({ entry: 10, recycle: 0.05 });
    expect(() => earn.pot({ entry: 10, recycle: 0.05 })).toThrow(GameDefinitionError);
    expect(() => collectManifest()).toThrow(/arena template/);
    resetRegistry();
    expect(() => earn.pot({ entry: 10, recycle: 0 })).toThrow(GameDefinitionError);
  });

  it("are off unless enabled (ruled 2026-10-20: until the R-16 legal review)", () => {
    resetRegistry();
    expect(earn.pot({ entry: 10, recycle: 0.05 }).enabled).toBe(false);
    resetRegistry();
    expect(earn.pot({ entry: 10, recycle: 0.05, enabled: true }).enabled).toBe(true);
    resetRegistry();
  });
});
