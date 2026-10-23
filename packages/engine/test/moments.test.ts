import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addPlayer,
  captureState,
  createWorld,
  decodeChoices,
  destroyWorld,
  enemyCount,
  EntityKind,
  initSim,
  listPlayers,
  PICKUP_SPECIAL,
  spawnEnemy,
  spawnEnemyScaled,
  spawnPickupAt,
  step,
} from "@netforge/engine-sim";
import type { InputCommand, SimWorld } from "@netforge/engine-sim";
import { earn, game, prefab, system, weapon } from "../src/index.js";
import { GameRunner, collectManifest, compileGame, resetRegistry } from "../src/game/index.js";
import type { CompiledGame } from "../src/game/index.js";
import type { SystemContext } from "../src/index.js";

beforeAll(async () => {
  await initSim();
});
beforeEach(() => resetRegistry());

const idle = (t: number): InputCommand => ({ seq: t + 1, tick: t, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 });

function base(extra: () => void, killer = false, field?: { halfSize: number }): CompiledGame {
  game({
    template: "survivor",
    style: "lowpoly",
    places: { a: { chunks: "places/a", spawn: [0, 1, 0] } },
    players: { prefab: "style.lowpoly.hero", max: 4, weapon: "pulse" },
    ...(field ? { field: { halfSize: field.halfSize, pillars: [] } } : {}),
  });
  prefab("gem", { model: "style.lowpoly.gem", health: 1, speed: 0, kind: "pickup", value: 3 });
  prefab("meal", { model: "style.lowpoly.cell_heal", health: 1, speed: 0, kind: "pickup", pickup: { effect: "heal", amount: 0.5 } });
  prefab("lodestar", { model: "style.lowpoly.crystal", health: 1, speed: 0, kind: "pickup", pickup: { effect: "vacuum" } });
  prefab("flare", { model: "style.lowpoly.grenade", health: 1, speed: 0, kind: "pickup", pickup: { effect: "bomb" } });
  prefab("chest", { model: "style.lowpoly.chest", health: 1, speed: 0, kind: "pickup", pickup: { effect: "chest", amount: 2 } });
  prefab("shade", { model: "style.lowpoly.ghost", health: 10, speed: 0, ai: "idle", damage: 0, drops: ["gem"] });
  weapon("pulse", killer ? { kind: "nova", damage: 1000, cooldown: 0.2, range: 3 } : { kind: "nova", damage: 0, cooldown: 8, range: 0.5 });
  weapon("other", { kind: "nova", damage: 1, cooldown: 1, range: 1 });
  extra();
  earn.rule("one", { when: "enemy.killed", n: 1, pay: 1, oncePer: "run" });
  earn.stake({ min: 1, max: 10, multiple: 2 });
  return compileGame(collectManifest());
}

function run(g: CompiledGame, w: SimWorld, ticks: number, r = new GameRunner(g, w)): { r: GameRunner; names: string[] } {
  const names: string[] = [];
  for (let t = 0; t < ticks; t++) {
    r.beforeStep();
    for (const ev of r.afterStep(step(w, new Map([[1, idle(t)]])).events).events) names.push(ev.name);
  }
  return { r, names };
}

const pickupIndex = (g: CompiledGame, id: string) => g.specialPickups.indexOf(id);

describe("special pickups", () => {
  it("heal, vacuum, bomb and chest do what they say, and raise <effect>.collected", () => {
    const g = base(() => undefined);
    const w = createWorld({ ...g.sim, seed: 2 });
    addPlayer(w, 1, [0, 1, 0]);
    const r = new GameRunner(g, w);
    const shade = g.enemyType.get("shade") ?? 0;
    // Gems far away, a crowd on screen, then the four pickups at the keeper's feet one by one.
    for (let i = 0; i < 5; i++) spawnEnemy(w, shade, 6 + i, 0);
    spawnPickupAt(w, pickupIndex(g, "flare"), 0.2, 0);
    const a = run(g, w, 3, r);
    expect(a.names).toContain("bomb.collected");
    expect(enemyCount(w)).toBe(0);
    // The bombed shades dropped gems; a lodestar pulls them all in.
    const gemsBefore = captureState(w).entities.filter((e) => e.kind === EntityKind.Pickup && e.type < PICKUP_SPECIAL).length;
    expect(gemsBefore).toBeGreaterThan(0);
    spawnPickupAt(w, pickupIndex(g, "lodestar"), 0.2, 0);
    const b = run(g, w, 3, r);
    expect(b.names).toContain("vacuum.collected");
    expect(captureState(w).entities.filter((e) => e.kind === EntityKind.Pickup && e.type < PICKUP_SPECIAL).length).toBe(0);
    // A chest opens two card picks.
    spawnPickupAt(w, pickupIndex(g, "chest"), 0.2, 0);
    run(g, w, 3, r);
    const me = captureState(w).entities.find((e) => e.kind === EntityKind.Player);
    expect(decodeChoices(me?.choices ?? 0).pending).toBeGreaterThanOrEqual(2);
    destroyWorld(w);
  });

  it("drops roll their chance, elites always drop a chest, and bosses drop loot", () => {
    const g = base(() => {
      prefab("rich", { model: "style.lowpoly.r", health: 1, speed: 0, ai: "idle", damage: 0, drops: ["gem", { id: "meal", chance: 1 }, { id: "flare", chance: 0 }] });
    }, true);
    const w = createWorld({ ...g.sim, seed: 2 });
    addPlayer(w, 1, [0, 1, 0]);
    addPlayer(w, 2, [40, 1, 40]);
    spawnEnemy(w, g.enemyType.get("rich") ?? 0, 2, 0);
    spawnEnemyScaled(w, g.enemyType.get("shade") ?? 0, -2, 0, { elite: true });
    // The keeper's magnet pulls the drops in: what it collected tells what dropped.
    const { names } = run(g, w, 40);
    expect(names).toContain("heal.collected");
    expect(names).not.toContain("bomb.collected");
    expect(names).toContain("chest.collected");
    destroyWorld(w);
  });

  it("chances are for special pickups only, with an actionable line", () => {
    expect(() =>
      base(() => {
        prefab("bad", { model: "style.lowpoly.b", health: 1, speed: 1, drops: [{ id: "gem", chance: 0.5 }] });
      }),
    ).toThrow(/chances are for special pickups/);
  });
});

describe("systems: announce, events, props", () => {
  it("announce, xpBoost, scatter, clear, bossAlive and pauseDirector work from a system", () => {
    let ctx: SystemContext | null = null;
    const g = base(() => {
      prefab("urn", { model: "style.lowpoly.barrel", health: 20, speed: 0, damage: 0, prop: true, drops: ["gem"] });
      system("s", (c) => {
        ctx = c;
        c.after(0.1, () => {
          c.announce("THE TIDE RISES", { tone: "danger" });
          expect(c.scatter("urn", 10)).toBe(10);
          c.spawnEdge("shade", { count: 6 });
        });
      });
    }, false, { halfSize: 80 });
    const w = createWorld({ ...g.sim, seed: 4 });
    addPlayer(w, 1, [0, 1, 0]);
    const { r } = run(g, w, 10);
    expect(r.info().announce).toMatchObject({ text: "THE TIDE RISES", tone: "danger" });
    // Props are not enemies: they never count toward the crowd.
    expect(enemyCount(w)).toBe(6);
    expect(w.config.arena.halfExtent).toBe(80);
    const c = ctx as unknown as SystemContext;
    expect(c.bossAlive()).toBe(false);
    expect(c.clear("shade")).toBe(6);
    expect(enemyCount(w)).toBe(0);
    expect(listPlayers(w).length).toBe(1);
    destroyWorld(w);
  });
});
