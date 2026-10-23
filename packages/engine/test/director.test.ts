import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addPlayer, createWorld, destroyWorld, enemyCount, initSim, isOnScreen, listPlayers, simPaused, step } from "@netforge/engine-sim";
import type { InputCommand } from "@netforge/engine-sim";
import { director, earn, engine, game, prefab, system, weapon } from "../src/index.js";
import { GameRunner, SURVIVOR_VIEWS, collectManifest, compileGame, curveAt, footprint, resetRegistry, viewRadii } from "../src/game/index.js";

beforeAll(async () => {
  await initSim();
});
beforeEach(() => resetRegistry());

const idle = (t: number, buttons = 0): InputCommand => ({ seq: t + 1, tick: t, moveX: 0, moveZ: 0, yaw: 0, buttons });

function declare(dir: Parameters<typeof director>[0] | null, extra?: () => void): void {
  game({
    template: "survivor",
    style: "lowpoly",
    places: { a: { chunks: "places/a", spawn: [0, 1, 0] } },
    players: { prefab: "style.lowpoly.hero", max: 4, weapon: "pulse" },
  });
  prefab("bat", { model: "style.lowpoly.bat", health: 10, speed: 3, damage: 5, drops: ["gem"] });
  prefab("gem", { model: "style.lowpoly.gem", health: 1, speed: 0, value: 1 });
  weapon("pulse", { kind: "nova", damage: 1, cooldown: 2, range: 0.5 });
  if (dir) director(dir);
  extra?.();
  earn.rule("one", { when: "enemy.killed", n: 1, pay: 1, oncePer: "run" });
  earn.stake({ min: 1, max: 10, multiple: 2 });
}

describe("curves", () => {
  it("are linear between keyframes and held outside them", () => {
    const c: [number, number][] = [
      [0, 1],
      [60, 3],
      [120, 3],
    ];
    expect(curveAt(c, -5)).toBe(1);
    expect(curveAt(c, 30)).toBe(2);
    expect(curveAt(c, 500)).toBe(3);
    expect(curveAt(7, 99)).toBe(7);
  });

  it("reject keyframes out of order and unknown pool prefabs, with actionable lines", () => {
    expect(() =>
      declare({
        alive: [
          [60, 1],
          [0, 2],
        ],
        rate: 1,
        pool: [{ prefab: "bat" }],
      }),
    ).toThrow(/keyframe times must increase/);
    resetRegistry();
    declare({ alive: 10, rate: 1, pool: [{ prefab: "wolf" }] });
    expect(() => collectManifest()).toThrow(/director pool has "wolf"/);
  });
});

describe("ai is honest", () => {
  it("rejects behaviours the sim does not run", () => {
    expect(() => prefab("x", { model: "style.lowpoly.x", health: 1, speed: 1, ai: "teleport" as never })).toThrow(/ai is one of/);
  });

  it("idle enemies stand still; chase is the default", async () => {
    declare(null, () => {
      prefab("post", { model: "style.lowpoly.post", health: 10, speed: 3, ai: "idle" });
      system("s", ({ spawn }) => {
        spawn("post", [10, 0, 0]);
        spawn("bat", [-10, 0, 0]);
      });
    });
    const g = compileGame(collectManifest());
    const w = createWorld({ ...g.sim, seed: 1 });
    addPlayer(w, 1, [0, 1, 0]);
    addPlayer(w, 2, [0, 1, 3]);
    const r = new GameRunner(g, w);
    for (let t = 0; t < 60; t++) {
      r.beforeStep();
      r.afterStep(step(w, new Map()).events);
    }
    const { captureState } = await import("@netforge/engine-sim");
    const es = captureState(w).entities.filter((e) => e.kind === 2);
    const post = es.find((e) => e.type === g.enemyType.get("post"));
    const bat = es.find((e) => e.type === g.enemyType.get("bat"));
    expect(Math.abs((post?.px ?? 0) / 1024 - 10)).toBeLessThan(0.01);
    expect((bat?.px ?? 0) / 1024).toBeGreaterThan(-9);
    destroyWorld(w);
  });
});

describe("the view footprint", () => {
  it("is a trapezoid: short toward the camera, long and wide away from it", () => {
    const [tl, tr, br, bl] = footprint(SURVIVOR_VIEWS[0]!);
    expect(tl![1]).toBeLessThan(-12); // far edge, toward -z (camera 17 m out since the round 1 playtest)
    expect(br![1]).toBeGreaterThan(5); // near edge, toward +z
    expect(tr![0] - tl![0]).toBeGreaterThan(br![0] - bl![0]);
    const r = viewRadii(SURVIVOR_VIEWS);
    expect(Math.max(...r)).toBeGreaterThan(25);
    expect(Math.min(...r)).toBeGreaterThan(8);
  });
});

describe("the spawn director", () => {
  it("caps the living crowd at the alive curve", () => {
    declare({ alive: 20, rate: 30, pool: [{ prefab: "bat" }], start: 5 });
    const g = compileGame(collectManifest());
    const w = createWorld({ ...g.sim, seed: 5 });
    addPlayer(w, 1, [0, 1, 0]);
    const r = new GameRunner(g, w);
    let spawns = 0;
    let peak = 0;
    for (let t = 0; t < 30 * 8; t++) {
      r.beforeStep();
      const res = step(w, new Map());
      for (const e of res.events) {
        if (e.type !== "entity.spawned" || e.kind !== 2) continue;
        spawns++;
      }
      r.afterStep(res.events);
      peak = Math.max(peak, enemyCount(w));
    }
    expect(spawns).toBeGreaterThanOrEqual(20);
    expect(peak).toBeLessThanOrEqual(20);
    destroyWorld(w);
  });

  it("never places a spawn on a player's screen (checked at the moment of spawning)", async () => {
    declare({ alive: 200, rate: 60, pool: [{ prefab: "bat", group: [3, 6] }], start: 10 });
    const g = compileGame(collectManifest());
    const w = createWorld({ ...g.sim, seed: 9 });
    addPlayer(w, 1, [50, 1, 50]); // hugging a corner: the old ring clamped spawns to the wall, on screen
    addPlayer(w, 2, [-20, 1, 0]);
    const r = new GameRunner(g, w);
    const { entityPosition } = await import("@netforge/engine-sim");
    let seen = 0;
    let total = 0;
    for (let t = 0; t < 30 * 4; t++) {
      r.beforeStep();
      const res = step(w, new Map());
      r.afterStep(res.events);
      for (const e of res.events) {
        if (e.type !== "entity.spawned" || e.kind !== 2) continue;
        total++;
        const p = entityPosition(w, e.netId);
        // The sim moved it one tick toward a player; give it that much slack.
        if (p && isOnScreen(w, p[0], p[1]) && isOnScreen(w, p[0] * 0.97, p[1] * 0.97)) seen++;
      }
    }
    expect(total).toBeGreaterThan(50);
    expect(seen / total).toBeLessThan(0.02);
    destroyWorld(w);
  });

  it("scales the crowd with players and halves the rate while a boss lives", () => {
    declare({ alive: 10, rate: 2, perPlayer: 0.6, pool: [{ prefab: "bat" }] });
    const g = compileGame(collectManifest());
    const w = createWorld({ ...g.sim, seed: 3 });
    for (let p = 1; p <= 4; p++) addPlayer(w, p, [p * 2, 1, 0]);
    const r = new GameRunner(g, w);
    for (let t = 0; t < 30 * 20; t++) {
      r.beforeStep();
      r.afterStep(step(w, new Map()).events);
    }
    // 10 x (1 + 0.6 x 3) = 28
    expect(enemyCount(w)).toBeGreaterThan(20);
    expect(enemyCount(w)).toBeLessThanOrEqual(28);
    destroyWorld(w);
  });
});

describe("players.* rules", () => {
  it("hit i-frames: one touch per half second, however many enemies touch", () => {
    declare(null, () => {
      system("s", ({ spawnRing }) => spawnRing("bat", { count: 20, radius: 1.2 }));
    });
    const g = compileGame(collectManifest());
    const w = createWorld({ ...g.sim, seed: 1 });
    addPlayer(w, 1, [0, 1, 0]);
    addPlayer(w, 2, [30, 1, 30]);
    const r = new GameRunner(g, w);
    let hits = 0;
    for (let t = 0; t < 30; t++) {
      r.beforeStep();
      const res = step(w, new Map());
      hits += res.events.filter((e) => e.type === "player.hit" && e.playerId === 1).length;
      r.afterStep(res.events);
    }
    // 1 s of 20 touching enemies: 2 hits with 0.5 s i-frames (it was 20 a second).
    expect(hits).toBeLessThanOrEqual(3);
    destroyWorld(w);
  });

  it("solo cards pause the sim and the run clock; a pick resumes", () => {
    game({
      template: "survivor",
      style: "lowpoly",
      places: { a: { chunks: "places/a", spawn: [0, 1, 0] } },
      players: { prefab: "style.lowpoly.hero", max: 4, weapon: "pulse", xp: { base: 1, growth: 0 } },
    });
    prefab("bat", { model: "style.lowpoly.bat", health: 1, speed: 3, damage: 1, drops: ["gem"] });
    prefab("gem", { model: "style.lowpoly.gem", health: 1, speed: 0, value: 1 });
    weapon("pulse", { kind: "nova", damage: 5, cooldown: 0.2, range: 3 });
    weapon("dart", { kind: "bolt", damage: 5, cooldown: 0.2, range: 6 });
    system("s", ({ spawnRing }) => spawnRing("bat", { count: 3, radius: 1.5 }));
    earn.rule("one", { when: "enemy.killed", n: 1, pay: 1, oncePer: "run" });
    earn.stake({ min: 1, max: 10, multiple: 2 });
    const g = compileGame(collectManifest());
    const w = createWorld({ ...g.sim, seed: 1 });
    addPlayer(w, 1, [0, 1, 0]);
    const r = new GameRunner(g, w);
    let t = 0;
    while (!simPaused(w) && t < 300) {
      r.beforeStep();
      r.afterStep(step(w, new Map([[1, idle(t)]])).events);
      t++;
    }
    expect(simPaused(w)).toBe(true);
    const clock = r.info().seconds;
    for (let i = 0; i < 90; i++) {
      r.beforeStep();
      r.afterStep(step(w, new Map([[1, idle(t++)]])).events);
    }
    expect(r.info().seconds).toBe(clock);
    expect(r.info().paused).toBe(true);
    r.beforeStep();
    r.afterStep(step(w, new Map([[1, idle(t++, 1 << 5)]])).events);
    expect(listPlayers(w)[0]?.level).toBeGreaterThan(1);
    destroyWorld(w);
  });
});

describe("fun metrics in the harness", () => {
  it("a human-like bot reports the first minute of a director game", async () => {
    declare({ alive: [[0, 8], [60, 30]], rate: [[0, 1], [60, 3]], pool: [{ prefab: "bat" }], start: 4 });
    const r = await engine.test.run({ ticks: 30 * 70, bots: 1, seed: 2, bot: "human" });
    expect(r.fun?.genre).toBe("horde");
    expect(r.fun?.spawnsOnScreen).toBe(0);
    expect(r.fun?.deathsBeforeMinute).toBe(0);
    expect(r.fun?.onScreenAt30).not.toBeNull();
    expect(r.fun?.firstThreatSeconds).not.toBeNull();
  });

  it("flags a game that spawns on screen", async () => {
    declare(null, () => {
      system("s", ({ every, spawnRing }) => every(1, () => spawnRing("bat", { count: 6, radius: 8 })));
    });
    const r = await engine.test.run({ ticks: 30 * 40, bots: 1, seed: 2, bot: "human" });
    expect(r.fun?.spawnsOnScreen ?? 0).toBeGreaterThan(0.5);
  });
});
