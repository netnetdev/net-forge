import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addPlayer,
  Button,
  captureState,
  createWorld,
  decodeChoices,
  destroyWorld,
  EntityKind,
  grantXp,
  initSim,
  listPlayers,
  scaledWeapon,
  slotLevel,
  slotWeapon,
  spawnEnemy,
  step,
} from "@netforge/engine-sim";
import type { InputCommand, SimWorld } from "@netforge/engine-sim";
import { earn, game, prefab, upgrade, weapon } from "../src/index.js";
import { GameRunner, collectManifest, compileGame, levelTable, resetRegistry } from "../src/game/index.js";
import type { CompiledGame } from "../src/game/index.js";

beforeAll(async () => {
  await initSim();
});
beforeEach(() => resetRegistry());

const press = (t: number, buttons: number): InputCommand => ({ seq: t + 1, tick: t, moveX: 0, moveZ: 0, yaw: 0, buttons });

function base(start: string, extra: () => void, players: Record<string, unknown> = {}): CompiledGame {
  game({
    template: "survivor",
    style: "lowpoly",
    places: { a: { chunks: "places/a", spawn: [0, 1, 0] } },
    players: { prefab: "style.lowpoly.hero", max: 4, weapon: start, ...players },
  });
  prefab("gem", { model: "style.lowpoly.gem", health: 1, speed: 0, kind: "pickup", value: 1 });
  prefab("dummy", { model: "style.lowpoly.d", health: 100000, speed: 0, ai: "idle", damage: 0, drops: ["gem"] });
  extra();
  earn.rule("one", { when: "enemy.killed", n: 1, pay: 1, oncePer: "run" });
  earn.stake({ min: 1, max: 10, multiple: 2 });
  return compileGame(collectManifest());
}

/** Damage player 1's starting weapon deals to idle dummies at `at` over `ticks`. */
function damageOver(g: CompiledGame, ticks: number, at: readonly [number, number][]): number {
  const w = createWorld({ ...g.sim, seed: 3 });
  addPlayer(w, 1, [0, 1, 0]);
  const r = new GameRunner(g, w);
  for (const [x, z] of at) spawnEnemy(w, g.enemyType.get("dummy") ?? 0, x, z);
  for (let t = 0; t < ticks; t++) {
    r.beforeStep();
    r.afterStep(step(w, new Map([[1, press(t, 0)]])).events);
  }
  const dealt = captureState(w)
    .entities.filter((e) => e.kind === EntityKind.Enemy)
    .reduce((a, e) => a + (100000 - e.health), 0);
  destroyWorld(w);
  return dealt;
}

describe("weapon levels", () => {
  it("compile each declared level onto the one before: numbers add, percents scale", () => {
    const g = base("bolt", () => {
      weapon("bolt", { kind: "bolt", damage: 10, cooldown: 1, range: 10, levels: [{ count: 1 }, { damage: "+50%" }, { cooldown: "-20%" }, { pierce: 2 }] });
    });
    const w = g.sim.content?.weapons?.[0];
    expect(w?.maxLevel).toBe(5);
    const t = levelTable(g.manifest.weapons.get("bolt")!, 30);
    expect(t.map((l) => l.count)).toEqual([1, 2, 2, 2, 2]);
    expect(t[2]?.damage).toBeCloseTo(15);
    expect(t[3]?.cooldownTicks).toBeCloseTo(24);
    expect(t[4]?.pierce).toBe(2);
    // Might scales damage, amount adds projectiles.
    const s = scaledWeapon(w!, 5, { might: 2, haste: 1, area: 1.5, amount: 1 });
    expect(s.count).toBe(3);
    expect(s.damage).toBe(30);
  });

  it("reject unknown level fields, bad percents and a maxLevel that disagrees with levels", () => {
    expect(() => weapon("x", { kind: "bolt", damage: 1, cooldown: 1, range: 5, levels: [{ power: 1 } as never] })).toThrow(/power|Unrecognized/);
    expect(() => weapon("y", { kind: "bolt", damage: 1, cooldown: 1, range: 5, levels: [{ damage: "40%" }] })).toThrow(/percent changes/);
    resetRegistry();
    expect(() =>
      base("z", () => {
        weapon("z", { kind: "bolt", damage: 1, cooldown: 1, range: 5, maxLevel: 3, levels: [{ count: 1 }] });
      }),
    ).toThrow(/drop maxLevel/);
  });
});

describe("weapon shapes", () => {
  const shapes: [string, Parameters<typeof weapon>[1], [number, number][]][] = [
    ["aura", { kind: "aura", damage: 5, cooldown: 0.5, range: 3 }, [[2, 0], [0, -2]]],
    ["cone", { kind: "cone", damage: 10, cooldown: 0.5, range: 4, spread: 360 }, [[2, 0], [-2, 0]]],
    ["meteor", { kind: "meteor", damage: 30, cooldown: 1, range: 10, blast: 2 }, [[6, 0]]],
  ];
  for (const [name, def, at] of shapes) {
    it(`${name} hits what it should`, () => {
      const g = base(name, () => weapon(name, def));
      expect(damageOver(g, 90, at)).toBeGreaterThan(0);
    });
  }

  it("a chain strikes the nearest and jumps to each next one in reach", () => {
    const g = base("chain", () => weapon("chain", { kind: "chain", damage: 10, cooldown: 3, range: 8, count: 2, speed: 4 }));
    // One strike in 3 s: the first dummy, then two jumps.
    expect(damageOver(g, 20, [[5, 0], [7, 0], [9, 0]])).toBe(30);
  });

  it("a boomerang hits on the way out and on the way back", () => {
    const g = base("boom", () => weapon("boom", { kind: "boomerang", damage: 10, cooldown: 8, range: 8, speed: 12 }));
    expect(damageOver(g, 60, [[4, 0]])).toBe(20);
  });

  it("a cone only sweeps where the keeper faces", () => {
    const g = base("whip", () => weapon("whip", { kind: "cone", damage: 10, cooldown: 0.5, range: 4, spread: 60 }));
    // Facing yaw 0 is -z: a dummy at -z is hit, one at +z is not.
    expect(damageOver(g, 30, [[0, 3]])).toBe(0);
    resetRegistry();
    const g2 = base("whip", () => weapon("whip", { kind: "cone", damage: 10, cooldown: 0.5, range: 4, spread: 60 }));
    expect(damageOver(g2, 30, [[0, -3]])).toBeGreaterThan(0);
  });
});

describe("cards: evolutions, rerolls, skips, maxed out", () => {
  function world(g: CompiledGame, players = 1): SimWorld {
    const w = createWorld({ ...g.sim, seed: 5 });
    for (let p = 1; p <= players; p++) addPlayer(w, p, [p * 2, 1, 0]);
    return w;
  }
  const me = (w: SimWorld, p = 1) => captureState(w).entities.find((e) => e.kind === EntityKind.Player && e.owner === p);
  const tap = (w: SimWorld, t: number, buttons: number) => {
    step(w, new Map([[1, press(t, buttons)]]));
    step(w, new Map([[1, press(t + 1, 0)]]));
  };

  it("at max level, with the paired passive taken, the evolution always shows and replaces the weapon", () => {
    const g = base("ember", () => {
      weapon("ember", { kind: "nova", damage: 1, cooldown: 1, range: 1, levels: [{ damage: 1 }], evolve: { into: "sun", requires: "bellows" } });
      weapon("sun", { kind: "nova", damage: 9, cooldown: 1, range: 2 });
      upgrade("bellows", { stat: "haste", step: 0.05 });
    }, { xp: { base: 1, growth: 0 } });
    const w = world(g);
    const ember = g.weaponIds.indexOf("ember");
    const sun = g.weaponIds.indexOf("sun");
    const bellows = g.weaponIds.length;
    let t = 0;
    // Take cards until the evolution shows: ember to level 2, bellows once. "sun" is never offered before.
    let evolvedOffer = false;
    for (let i = 0; i < 6 && !evolvedOffer; i++) {
      grantXp(w, 1, 1);
      const { offers } = decodeChoices(me(w)?.choices ?? 0);
      if (offers.includes(sun)) {
        evolvedOffer = true;
        tap(w, (t += 2), Button.Choice1 << offers.indexOf(sun));
        break;
      }
      const k = offers.indexOf(ember) >= 0 ? offers.indexOf(ember) : offers.indexOf(bellows);
      tap(w, (t += 2), Button.Choice1 << Math.max(0, k));
    }
    expect(evolvedOffer).toBe(true);
    const packed = me(w)?.weapons ?? 0;
    expect(slotWeapon(packed, 0)).toBe(sun);
    expect(slotLevel(packed, 0)).toBe(1);
    destroyWorld(w);
  });

  it("a reroll draws new cards once per run; a skip heals instead of a card", () => {
    const g = base("a", () => {
      for (const id of ["a", "b", "c", "d", "e", "f"]) weapon(id, { kind: "nova", damage: 1, cooldown: 1, range: 1 });
      upgrade("u1", { stat: "speed", step: 0.1 });
      upgrade("u2", { stat: "might", step: 0.1 });
    }, { xp: { base: 1, growth: 0 }, rerolls: 1 });
    const w = world(g);
    grantXp(w, 1, 1);
    const before = decodeChoices(me(w)?.choices ?? 0).offers.join();
    tap(w, 2, Button.Reroll);
    const after = decodeChoices(me(w)?.choices ?? 0).offers.join();
    expect(after).not.toBe(before);
    tap(w, 4, Button.Reroll);
    expect(decodeChoices(me(w)?.choices ?? 0).offers.join()).toBe(after); // no rerolls left
    tap(w, 6, Button.Skip);
    expect(decodeChoices(me(w)?.choices ?? 0).pending).toBe(0);
    destroyWorld(w);
  });

  it("when everything is maxed, a level heals and gives teammates a little XP", () => {
    const g = base("solo", () => {
      weapon("solo", { kind: "nova", damage: 1, cooldown: 1, range: 1, maxLevel: 1 });
    }, { xp: { base: 1, growth: 0 } });
    const w = world(g, 2);
    const xpBefore = me(w, 2)?.xp ?? 0;
    const lvBefore = me(w, 2)?.level ?? 1;
    grantXp(w, 1, 1);
    expect(decodeChoices(me(w)?.choices ?? 0).pending).toBe(0);
    const p2 = me(w, 2);
    expect((p2?.level ?? 1) * 1000 + (p2?.xp ?? 0)).toBeGreaterThan(lvBefore * 1000 + xpBefore);
    expect(listPlayers(w).length).toBe(2);
    destroyWorld(w);
  });
});
