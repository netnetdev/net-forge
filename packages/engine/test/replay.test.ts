import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addPlayer,
  Button,
  createWorld,
  critRoll,
  destroyWorld,
  grantXp,
  initSim,
  keeperButtons,
  listPlayers,
  pendingCards,
  playerBuild,
  removeEnemies,
  spawnEnemy,
  spawnEnemyScaled,
  step,
} from "@netforge/engine-sim";
import type { InputCommand, SimWorld } from "@netforge/engine-sim";
import { achievement, earn, game, keeper, mission, prefab, system, title, upgrade, weapon } from "../src/index.js";
import { GameRunner, collectManifest, compileGame, resetRegistry } from "../src/game/index.js";
import type { CompiledGame } from "../src/game/index.js";

beforeAll(async () => {
  await initSim();
});
beforeEach(() => resetRegistry());

const input = (t: number, buttons = 0): InputCommand => ({ seq: t + 1, tick: t, moveX: 0, moveZ: 0, yaw: 0, buttons });

interface Opts {
  readonly share?: "collector" | "nearby" | "all";
  readonly crit?: number;
  readonly killer?: boolean;
  readonly extra?: () => void;
}

function base(o: Opts = {}): CompiledGame {
  game({
    template: "survivor",
    style: "lowpoly",
    places: { a: { chunks: "places/a", spawn: [0, 1, 0] } },
    players: {
      prefab: "style.lowpoly.hero",
      max: 4,
      weapon: "pulse",
      ...(o.share ? { share: o.share } : {}),
      ...(o.crit !== undefined ? { crit: { chance: o.crit, multiplier: 2 } } : {}),
    },
  });
  prefab("gem", { model: "style.lowpoly.gem", health: 1, speed: 0, kind: "pickup", value: 3 });
  prefab("shade", { model: "style.lowpoly.ghost", health: 1000, speed: 0, ai: "idle", damage: 0, drops: ["gem"] });
  prefab("biter", { model: "style.lowpoly.bee", health: 1000, speed: 0, ai: "idle", damage: 500 });
  weapon("pulse", o.killer ? { kind: "nova", damage: 10, cooldown: 0.2, range: 3 } : { kind: "nova", damage: 0, cooldown: 8, range: 0.5 });
  weapon("dart", { kind: "bolt", damage: 5, cooldown: 1, range: 8 });
  upgrade("boots", { stat: "speed", step: 0.1, maxLevel: 5 });
  upgrade("heart", { stat: "maxHealth", step: 20, maxLevel: 5 });
  o.extra?.();
  earn.rule("one", { when: "enemy.killed", n: 1, pay: 1, oncePer: "run" });
  earn.stake({ min: 1, max: 10, multiple: 2 });
  return compileGame(collectManifest());
}

function runFor(g: CompiledGame, w: SimWorld, r: GameRunner, ticks: number, buttons: (pid: number, t: number) => number = () => 0): string[] {
  const names: string[] = [];
  for (let t = 0; t < ticks; t++) {
    const inputs = new Map<number, InputCommand>();
    for (const p of listPlayers(w)) inputs.set(p.playerId, input(w.tick, buttons(p.playerId, t)));
    r.beforeStep(inputs);
    for (const ev of r.afterStep(step(w, inputs).events).events) names.push(ev.name);
  }
  return names;
}

describe("co-op XP sharing", () => {
  const level = (w: SimWorld, id: number) => listPlayers(w).find((p) => p.playerId === id)?.level ?? 0;
  it('"nearby" gives teammates within 20 m half of a gem; "collector" keeps it', () => {
    for (const share of ["nearby", "collector"] as const) {
      resetRegistry();
      const g = base({ share, killer: true });
      const w = createWorld({ ...g.sim, seed: 3 });
      addPlayer(w, 1, [0, 1, 0]);
      addPlayer(w, 2, [6, 1, 0]);
      addPlayer(w, 3, [60, 1, 0]);
      const r = new GameRunner(g, w);
      // Shades with 1000 hp take ~100 ticks at 10 a pulse: keep it to gems dropped next to keeper 1.
      for (let i = 0; i < 4; i++) spawnEnemyScaled(w, g.enemyType.get("shade") ?? 0, 1 + i * 0.2, 1, { health: 0.01 });
      runFor(g, w, r, 60);
      expect(level(w, 1)).toBeGreaterThan(1);
      if (share === "nearby") expect(level(w, 2)).toBeGreaterThan(1);
      else expect(level(w, 2)).toBe(1);
      expect(level(w, 3)).toBe(1);
      destroyWorld(w);
    }
  });
});

describe("crits and the damage tally", () => {
  it("a crit doubles the hit; the tally credits the weapon that landed it", () => {
    const dealt = (crit: number): number => {
      resetRegistry();
      const g = base({ killer: true, crit });
      const w = createWorld({ ...g.sim, seed: 3 });
      addPlayer(w, 1, [0, 1, 0]);
      const r = new GameRunner(g, w);
      spawnEnemy(w, g.enemyType.get("shade") ?? 0, 1.5, 0);
      runFor(g, w, r, 90);
      const b = playerBuild(w, 1);
      expect(b?.weapons[0]).toEqual({ index: 0, level: 1 });
      destroyWorld(w);
      return b?.damage[0] ?? 0;
    };
    const plain = dealt(0);
    const crits = dealt(0.5);
    // The same pulses land; every hit is 10, or 20 on a crit.
    expect(plain).toBeGreaterThan(0);
    expect(plain % 10).toBe(0);
    expect(crits).toBeGreaterThan(plain);
    expect(crits).toBeLessThanOrEqual(plain * 2);
    // The roll is a pure function of (tick, netId): clients can tell a crit.
    expect(critRoll(100, 7)).toBe(critRoll(100, 7));
    expect(critRoll(100, 7)).not.toBe(critRoll(101, 7));
  });
});

describe("keepers", () => {
  const withKeepers = () =>
    base({
      extra: () => {
        keeper("lamp", { name: "Lamp", weapon: "pulse", passive: "heart" });
        keeper("dartist", { name: "Dartist", weapon: "dart", passive: "boots", unlock: "first" });
        achievement("first", { title: "First", when: "enemy.killed" });
      },
    });

  it("a keeper's start weapon and passive; the pick is taken at level 1 and kept across runs", () => {
    const g = withKeepers();
    const w = createWorld({ ...g.sim, seed: 3 });
    addPlayer(w, 1, [0, 1, 0]);
    const r = new GameRunner(g, w);
    // Everyone starts as the first keeper.
    expect(playerBuild(w, 1)).toMatchObject({ keeper: 0, weapons: [{ index: 0, level: 1 }], stats: [{ index: 1, level: 1 }] });
    runFor(g, w, r, 2, () => keeperButtons(1));
    expect(playerBuild(w, 1)).toMatchObject({ keeper: 1, weapons: [{ index: 1, level: 1 }], stats: [{ index: 0, level: 1 }] });
    expect(r.info().players[0]?.keeper).toBe("dartist");
    // Past level 1 the pick waits for the next run.
    grantXp(w, 1, 50);
    runFor(g, w, r, 2, () => keeperButtons(0));
    expect(playerBuild(w, 1)?.keeper).toBe(1);
    destroyWorld(w);
  });

  it("rejects keepers that start with an unknown weapon, unlock with an unknown achievement, or all need an unlock", () => {
    expect(() => base({ extra: () => keeper("x", { name: "X", weapon: "nope" }) })).toThrow(/not a declared weapon/);
    resetRegistry();
    expect(() => base({ extra: () => keeper("x", { name: "X", weapon: "pulse", unlock: "nope" }) })).toThrow(/not a declared achievement/);
    resetRegistry();
    expect(() =>
      base({
        extra: () => {
          achievement("a", { title: "A", when: "enemy.killed" });
          keeper("x", { name: "X", weapon: "pulse", unlock: "a" });
        },
      }),
    ).toThrow(/at least one keeper needs no unlock/);
  });
});

describe("co-op: revive buff, late joiners", () => {
  it("the reviver gets the buff", () => {
    const g = base();
    const w = createWorld({ ...g.sim, seed: 3 });
    addPlayer(w, 1, [0, 1, 0]);
    addPlayer(w, 2, [1.5, 1, 0]);
    const r = new GameRunner(g, w);
    // A biter downs player 2 (500 damage), player 1 stands beside them.
    spawnEnemy(w, g.enemyType.get("biter") ?? 0, 2.2, 0);
    let buffedAt = -1;
    const names: string[] = [];
    for (let t = 0; t < 30 * 8 && buffedAt < 0; t++) {
      names.push(...runFor(g, w, r, 1));
      if (names.includes("player.revived")) buffedAt = t;
    }
    expect(names).toContain("player.downed");
    expect(buffedAt).toBeGreaterThan(0);
    expect(listPlayers(w).find((p) => p.playerId === 1)?.buffed).toBe(true);
    expect(listPlayers(w).find((p) => p.playerId === 2)?.buffed).toBe(false);
    expect(r.info().players.find((p) => p.id === 1)?.buffed).toBe(true);
    // 5 s later it is gone (the biter leaves so nobody goes down again).
    removeEnemies(w, g.enemyType.get("biter") ?? 0);
    runFor(g, w, r, 30 * 5 + 2);
    expect(listPlayers(w).find((p) => p.playerId === 1)?.buffed).toBe(false);
    destroyWorld(w);
  });

  it("a late joiner starts at the team's average level minus 2, with the cards to pick", () => {
    const g = base();
    const w = createWorld({ ...g.sim, seed: 3 });
    addPlayer(w, 1, [0, 1, 0]);
    addPlayer(w, 2, [3, 1, 0]);
    const r = new GameRunner(g, w);
    runFor(g, w, r, 30 * 11);
    grantXp(w, 1, 2000);
    grantXp(w, 2, 2000);
    const avg = listPlayers(w).reduce((s, p) => s + p.level, 0) / 2;
    addPlayer(w, 3, [0, 1, 3]);
    runFor(g, w, r, 1);
    const me = listPlayers(w).find((p) => p.playerId === 3);
    expect(me?.level).toBe(Math.round(avg) - 2);
    expect(pendingCards(w, 3)).toBe(Math.round(avg) - 3);
    destroyWorld(w);
  });
});

describe("the end screen", () => {
  it("summarises the run as data, and a unanimous Play again starts the next run early", () => {
    const g = base({
      killer: true,
      extra: () => {
        title("butcher", { text: "The Butcher", most: "kills" });
        title("untouchable", { text: "Untouchable", least: "downs" });
        achievement("first", { title: "First", when: "enemy.killed" });
        mission("elite", { text: "Kill an elite", when: "elite.killed" });
        system("s", ({ after, end, upcoming }) => {
          upcoming("THE BOSS", 60);
          after(4, () => end("won"));
        });
      },
    });
    const w = createWorld({ ...g.sim, seed: 3 });
    addPlayer(w, 1, [0, 1, 0]);
    addPlayer(w, 2, [30, 1, 0]);
    const r = new GameRunner(g, w);
    spawnEnemyScaled(w, g.enemyType.get("shade") ?? 0, 1.5, 0, { elite: true, health: 0.01 });
    const names = runFor(g, w, r, 30 * 2);
    expect(names).toContain("elite.killed");
    expect(r.info().next).toMatchObject({ label: "THE BOSS" });
    expect(r.info().players.find((p) => p.id === 1)?.counts["elite.killed"]).toBe(1);
    expect(r.info().players.find((p) => p.id === 1)?.achievements).toEqual(["first"]);
    runFor(g, w, r, 30 * 3);
    const info = r.info();
    expect(info.phase).toBe("won");
    const s = info.summary;
    const p1 = s?.players.find((p) => p.id === 1);
    expect(p1?.weapons[0]?.id).toBe("pulse");
    expect(p1?.weapons[0]?.damage).toBeGreaterThan(0);
    expect(p1?.titles).toContain("The Butcher");
    expect(p1?.coins).toEqual([{ rule: "one", units: 1 }]);
    expect(s?.peak).toBeGreaterThanOrEqual(1);
    // Both vote: the next run starts after the 2 s minimum, not the 10 s fallback.
    const run = info.run;
    runFor(g, w, r, 30 * 3, () => Button.Ready);
    expect(r.info().run).toBe(run + 1);
    destroyWorld(w);
  });
});
