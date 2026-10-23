import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BOT_PLAYER_BASE, addPlayer, arenaSpawn, createWorld, destroyWorld, initSim, listPlayers, step } from "@netforge/engine-sim";
import type { InputCommand } from "@netforge/engine-sim";
import { GameDefinitionError, earn, game, prefab, store, system, upgrade, weapon } from "../src/index.js";
import { GameRunner, collectManifest, compileGame, engineSimAdapter, resetRegistry } from "../src/game/index.js";
import type { RunInfo } from "../src/game/index.js";

beforeAll(async () => {
  await initSim();
});
beforeEach(() => resetRegistry());

function declareArena(over: { round?: { seconds: number; frags?: number }; bots?: number } = {}): void {
  game({
    template: "arena",
    style: "lowpoly",
    tickRate: 60,
    places: { y: { chunks: "places/y", spawn: [0, 1, 0] } },
    players: { prefab: "style.lowpoly.hero", max: 8, loadout: ["gun", "zap"], bots: over.bots ?? 3, respawn: 1, drop: "cell" },
    arena: { halfSize: 16, pillars: [[0, 0, 1.5]], spawns: [[-10, -10], [10, 10], [10, -10], [-10, 10]] },
    round: over.round ?? { seconds: 60, frags: 8 },
  });
  prefab("cell", { model: "style.lowpoly.cell", health: 1, speed: 0, kind: "pickup", value: 30 });
  weapon("gun", { kind: "blaster", damage: 25, cooldown: 0.2, range: 22, speed: 40, knockback: 0 });
  weapon("zap", { kind: "beam", damage: 50, cooldown: 1, range: 30, knockback: 0 });
  upgrade("armor", { stat: "maxHealth", step: 25, maxLevel: 1 });
  system("credit", ({ on, emit }) => {
    on("opponent.killed", (ids) => emit("tally.kill", ids));
  });
  earn.rule("first", { when: "opponent.killed", n: 1, pay: 1, oncePer: "run" });
  earn.rule("tally", { when: "tally.kill", n: 2, pay: 1, oncePer: "run" });
  earn.rule("top", { when: "round.top", pay: 5, oncePer: "run" });
  earn.stake({ min: 1, max: 10, multiple: 2 });
  store.sku("armor", { coins: 10 });
}

describe("the arena template machinery", () => {
  it("compiles the yard, the loadout, the round and the heal drop", () => {
    declareArena();
    const g = compileGame(collectManifest());
    expect(g.mode).toBe("arena");
    expect(g.loadout).toEqual([0, 1]);
    expect(g.bots).toBe(3);
    expect(g.round).toEqual({ seconds: 60, frags: 8 });
    expect(g.sim.arena).toMatchObject({ halfExtent: 16, pillars: [{ x: 0, z: 0, radius: 1.5 }] });
    expect(g.sim.content?.arena).toMatchObject({ enabled: true, respawnTicks: 60, dropHeal: 30 });
    expect(g.sim.content?.progression?.loadout).toEqual([0, 1]);
  });

  it("refuses arenas without a yard or loadout, survivor weapons in arenas, and arena weapons in survivor games", () => {
    game({ template: "arena", style: "lowpoly", places: { y: { chunks: "p", spawn: [0, 0, 0] } }, players: { prefab: "style.lowpoly.x", max: 4 } });
    weapon("ring", { kind: "orbit", damage: 1, cooldown: 1, range: 2 });
    earn.rule("x", { when: "opponent.killed", pay: 1, oncePer: "run" });
    earn.stake({ min: 1, max: 10, multiple: 2 });
    const err = (() => {
      try {
        compileGame(collectManifest());
      } catch (e) {
        return e as GameDefinitionError;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(GameDefinitionError);
    expect(err?.issues.join("\n")).toMatch(/arena: \{ halfSize, pillars, spawns \}/);
    expect(err?.issues.join("\n")).toMatch(/players\.loadout/);
    expect(err?.issues.join("\n")).toMatch(/blaster, beam or nova/);
    resetRegistry();
    game({ template: "survivor", style: "lowpoly", places: { y: { chunks: "p", spawn: [0, 0, 0] } }, players: { prefab: "style.lowpoly.x", max: 4, weapon: "gun" } });
    prefab("bat", { model: "style.lowpoly.bat", health: 1, speed: 1 });
    weapon("gun", { kind: "blaster", damage: 1, cooldown: 1, range: 2 });
    earn.rule("x", { when: "enemy.killed", pay: 1, oncePer: "run" });
    earn.stake({ min: 1, max: 10, multiple: 2 });
    expect(() => compileGame(collectManifest())).toThrow(/nova, bolt or orbit/);
  });

  it("a collected game is sealed: the next module declares into a fresh registry", () => {
    declareArena();
    const a = collectManifest();
    game({ template: "survivor", style: "lowpoly", places: { y: { chunks: "p", spawn: [0, 0, 0] } }, players: { prefab: "style.lowpoly.x", max: 4, weapon: "pulse" } });
    weapon("pulse", { kind: "nova", damage: 1, cooldown: 1, range: 2 });
    earn.rule("x", { when: "enemy.killed", pay: 1, oncePer: "run" });
    earn.stake({ min: 1, max: 10, multiple: 2 });
    const b = collectManifest();
    expect(a.game.template).toBe("arena");
    expect(b.game.template).toBe("survivor");
    expect([...a.weapons.keys()]).toEqual(["gun", "zap"]);
    expect([...b.weapons.keys()]).toEqual(["pulse"]);
    // Two game() calls in one module (nothing collected between them) are still refused.
    resetRegistry();
    game({ template: "survivor", style: "lowpoly", places: { y: { chunks: "p", spawn: [0, 0, 0] } }, players: { prefab: "style.lowpoly.x", max: 4 } });
    expect(() => game({ template: "survivor", style: "lowpoly", places: { y: { chunks: "p", spawn: [0, 0, 0] } }, players: { prefab: "style.lowpoly.x", max: 4 } })).toThrow(/called twice/);
  });

  it("a round alone with seat bots: bots fill in, kills credit the killer, the frag limit ends it, and nothing pays (bot kills and a board of bots never earn)", () => {
    declareArena({ round: { seconds: 150, frags: 8 } });
    const g = compileGame(collectManifest());
    const sim = engineSimAdapter({ name: "t", version: "1", game: g });
    const w = sim.createWorld(4, "server");
    sim.addPlayer(w, 1);
    const awards: string[] = [];
    let info: RunInfo | null = null;
    for (let t = 0; t < 150 * 60 && !(info && (info as RunInfo).phase === "won"); t++) {
      const cmd = w.runner?.autopilot(1) ?? ({ seq: 0, tick: t, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 } as InputCommand);
      for (const e of sim.step(w, new Map([[1, [cmd]]]))) if (e.type === "earn") awards.push(`${e.player}:${e.rule}`);
      info = sim.info?.(w) as RunInfo;
    }
    const end = info as RunInfo | null;
    expect(end?.phase).toBe("won");
    expect(end?.players.filter((p) => p.bot)).toHaveLength(2);
    const top = Math.max(...(end?.players.map((p) => p.kills) ?? [0]));
    expect(top).toBe(8);
    // A seat bot never takes the round: the person reached the frag limit, and no bot is ahead of them.
    expect(end?.players.find((p) => p.id === 1)?.kills).toBe(8);
    expect(end?.feed.length).toBeGreaterThan(0);
    // Every kill was a bot and nobody else was in the round: no rule pays, not even what a system emits from those kills.
    expect(awards).toEqual([]);
    sim.disposeWorld?.(w);
  });

  it("with two people and seat bots: only kills of a person pay, emits from bot kills pay nothing, round.top pays the top fragger", () => {
    declareArena({ bots: 4, round: { seconds: 150, frags: 10 } });
    const g = compileGame(collectManifest());
    const world = createWorld({ ...g.sim, seed: 7 });
    const runner = new GameRunner(g, world);
    for (const id of [1, 2]) {
      const [x, z] = arenaSpawn(world, id);
      addPlayer(world, id, [x, world.config.arena.spawn[1], z]);
    }
    const humanKills = new Map<number, number>();
    const botKills = new Map<number, number>();
    const awards: string[] = [];
    let unpaidKills = 0;
    let unpaidTallies = 0;
    let top: readonly number[] = [];
    let topUnpaid = false;
    for (let t = 0; t < 150 * 60 && runner.phaseNow === "playing"; t++) {
      const inputs = new Map([1, 2].map((id) => [id, runner.autopilot(id)] as const));
      runner.beforeStep(inputs);
      const r = step(world, inputs);
      for (const e of r.events) {
        if (e.type !== "player.killed" || e.by <= 0 || e.by === e.playerId || e.by >= BOT_PLAYER_BASE) continue;
        const m = e.playerId >= BOT_PLAYER_BASE ? botKills : humanKills;
        m.set(e.by, (m.get(e.by) ?? 0) + 1);
      }
      const after = runner.afterStep(r.events);
      for (const ev of after.events) {
        if (ev.name === "opponent.killed" && ev.unpaid) unpaidKills++;
        if (ev.name === "tally.kill" && ev.unpaid) unpaidTallies++;
        if (ev.name === "round.top") {
          top = ev.players;
          topUnpaid = ev.unpaid === true;
        }
      }
      for (const a of after.awards) awards.push(`${a.player}:${a.rule}`);
    }
    expect(runner.phaseNow).toBe("won");
    const botKilled = [...botKills.values()].reduce((s, n) => s + n, 0);
    expect(botKilled).toBeGreaterThan(0);
    expect(unpaidKills).toBeGreaterThanOrEqual(botKilled);
    expect(unpaidTallies).toBeGreaterThanOrEqual(botKilled);
    // Bot kills still score: the board counts them.
    for (const id of [1, 2]) expect(runner.killsOf(id)).toBe((humanKills.get(id) ?? 0) + (botKills.get(id) ?? 0));
    expect([...humanKills.values()].some((n) => n > 0)).toBe(true);
    for (const id of [1, 2]) {
      const h = humanKills.get(id) ?? 0;
      expect(awards.includes(`${id}:first`)).toBe(h >= 1);
      expect(awards.includes(`${id}:tally`)).toBe(h >= 2);
    }
    // Another person was in the round: topping the board pays.
    expect(top.length).toBeGreaterThan(0);
    expect(topUnpaid).toBe(false);
    for (const id of top) if (id < BOT_PLAYER_BASE) expect(awards).toContain(`${id}:top`);
    for (const a of awards) expect(Number(a.split(":")[0])).toBeLessThan(BOT_PLAYER_BASE);
    destroyWorld(world);
  });

  it("with nobody in the room the seat bots leave and the run resets", () => {
    declareArena();
    const g = compileGame(collectManifest());
    const sim = engineSimAdapter({ name: "t", version: "1", game: g });
    const w = sim.createWorld(4, "server");
    sim.addPlayer(w, 1);
    for (let t = 0; t < 30; t++) sim.step(w, new Map());
    expect(listPlayers(w.sim)).toHaveLength(3);
    sim.removePlayer(w, 1);
    const resets: number[] = [];
    for (let t = 0; t < 30; t++) for (const e of sim.step(w, new Map())) if (e.type === "run.reset") resets.push(t);
    expect(listPlayers(w.sim)).toHaveLength(0);
    expect(resets.length).toBeGreaterThan(0);
    sim.disposeWorld?.(w);
  });

  it("emit(event, ids) credits only those players", () => {
    declareArena({ bots: 0, round: { seconds: 120, frags: 6 } });
    const g = compileGame(collectManifest());
    const sim = engineSimAdapter({ name: "t", version: "1", game: g });
    const w = sim.createWorld(9, "server");
    for (const id of [1, 2, 3]) sim.addPlayer(w, id);
    const runner = w.runner as GameRunner;
    const tallies = new Set<number>();
    const kills = new Map<number, number>();
    for (let t = 0; t < 60 * 120 && runner.phaseNow === "playing"; t++) {
      const inputs = new Map([1, 2, 3].map((id) => [id, [runner.autopilot(id)]] as const));
      for (const e of sim.step(w, inputs)) if (e.type === "earn" && e.rule === "tally") tallies.add(e.player);
      for (const id of [1, 2, 3]) kills.set(id, runner.killsOf(id));
    }
    expect(runner.phaseNow).toBe("won");
    expect(tallies.size).toBeGreaterThan(0);
    for (const id of [1, 2, 3]) expect(tallies.has(id)).toBe((kills.get(id) ?? 0) >= 2);
    sim.disposeWorld?.(w);
  });
});
