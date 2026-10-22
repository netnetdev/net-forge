/**
 * The newcomer check (GAME-DESIGN.md, arena shooter): one new person alone
 * in a room with the seat bots. The newcomer here is a deliberately weak
 * player: it sees 250 ms late, aims loosely, only uses the rifle and never
 * dashes. It should get a kill within about 20 s, rarely die within 3 s of
 * spawning, finish in the top half most rounds without winning every one,
 * and no bot may end the round. It also counts what the newcomer earns:
 * alone with bots that is nothing from kills and nothing from topping the
 * board (bot kills never pay, and "round.top" pays only with another
 * person in the round).
 */
import { describe, expect, it } from "vitest";
import { addPlayer, arenaSpawn, Button, createWorld, destroyWorld, initSim, listPlayers, step, BOT_PLAYER_BASE } from "@netnetcapital/engine-sim";
import type { InputCommand } from "@netnetcapital/engine-sim";
import { GameRunner, sightBlocked } from "@netnetcapital/engine/game";
import { arenaGame } from "../src/manifest.js";

interface Outcome {
  firstKill: number | null;
  deaths: number;
  spawnDeaths: number;
  rank: number;
  of: number;
  /** A seat bot reached the frag limit (never allowed: only a person ends the round on kills). */
  botEndedRound: boolean;
  kills: number;
  /** The newcomer's kills that were seat bots. */
  botKills: number;
  /** Coins the newcomer earned this round, the part from rules keyed on kills (kills, streaks), and the part from topping the board. */
  coins: number;
  coinsFromBotKills: number;
  coinsFromTop: number;
  roundSeconds: number;
}

/** A fixed hash to -0.5..0.5 (the newcomer's wobble). */
const wobble = (a: number, b: number) => {
  let h = Math.imul(a ^ 0x27d4eb2d, 0x85ebca6b) ^ Math.imul(b + 0x165667b1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296 - 0.5;
};

export async function newcomerRound(seed: number): Promise<Outcome> {
  await initSim();
  const g = arenaGame();
  const world = createWorld({ ...g.sim, seed });
  const runner = new GameRunner(g, world);
  const rate = world.tickRate;
  const me = 1;
  const [sx, sz] = arenaSpawn(world, me);
  addPlayer(world, me, [sx, world.config.arena.spawn[1], sz]);
  const pillars = world.config.arena.pillars;
  const half = world.config.arena.halfExtent;
  const lagTicks = Math.round(0.25 * rate);
  const history: { id: number; x: number; z: number; up: boolean }[][] = [];
  let spawnTick = 0;
  let firstKill: number | null = null;
  let deaths = 0;
  let spawnDeaths = 0;
  let wanderA = 0;
  let botKills = 0;
  let coins = 0;
  let coinsFromBotKills = 0;
  let coinsFromTop = 0;
  const topRules = new Set([...g.manifest.earnRules].filter(([, r]) => r.when === "round.top").map(([id]) => id));
  const killRules = new Set([...g.manifest.earnRules].filter(([, r]) => r.when === "opponent.killed" || r.when === "streak.five").map(([id]) => id));
  let out: Outcome | null = null;
  for (let t = 0; t < rate * 200 && !out; t++) {
    const players = listPlayers(world);
    history.push(players.map((p) => ({ id: p.playerId, x: p.x, z: p.z, up: p.up })));
    if (history.length > lagTicks + 1) history.shift();
    const seen = history[0] ?? [];
    const self = players.find((p) => p.playerId === me);
    let cmd: InputCommand = { seq: 0, tick: t, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 };
    if (self?.up) {
      // The nearest opponent it can see, as it was 250 ms ago.
      let target: { x: number; z: number; d: number } | null = null;
      for (const o of seen) {
        if (o.id === me || !o.up) continue;
        const d = Math.hypot(o.x - self.x, o.z - self.z);
        if (d < 30 && !sightBlocked(self.x, self.z, o.x, o.z, pillars) && (!target || d < target.d)) target = { x: o.x, z: o.z, d };
      }
      let mx = 0;
      let mz = 0;
      let yaw = 0;
      let buttons = 0;
      if (target) {
        const dx = target.x - self.x;
        const dz = target.z - self.z;
        const keep = target.d > 12 ? 1 : target.d < 7 ? -0.6 : 0;
        mx = (dx / target.d) * keep;
        mz = (dz / target.d) * keep;
        yaw = Math.atan2(-dx, -dz) + wobble(seed, Math.floor(t / (rate * 0.4))) * 0.3;
        if (target.d < 24) buttons |= Button.Fire;
      } else {
        // Wander toward the middle, the way a new player looks for a fight.
        wanderA += 0.004;
        mx = Math.cos(wanderA + seed) * 8 - self.x;
        mz = Math.sin(wanderA + seed) * 8 - self.z;
        yaw = Math.atan2(-mx, -mz);
      }
      if (Math.abs(self.x) > half - 2) mx -= Math.sign(self.x);
      if (Math.abs(self.z) > half - 2) mz -= Math.sign(self.z);
      const len = Math.hypot(mx, mz) || 1;
      cmd = { seq: 0, tick: t, moveX: mx / len, moveZ: -mz / len, yaw, buttons };
    }
    const inputs = new Map<number, InputCommand>([[me, cmd]]);
    runner.beforeStep(inputs);
    const r = step(world, inputs);
    const after = runner.afterStep(r.events);
    for (const e of r.events) {
      if ((e.type === "player.joined" || e.type === "player.respawned") && e.playerId === me) spawnTick = t;
      if (e.type === "player.killed" && e.playerId === me) {
        deaths++;
        if (t - spawnTick <= 3 * rate) spawnDeaths++;
      }
      if (e.type === "player.killed" && e.by === me && firstKill === null) firstKill = t / rate;
      if (e.type === "player.killed" && e.by === me && e.playerId >= BOT_PLAYER_BASE) botKills++;
    }
    for (const a of after.awards) {
      if (a.player !== me) continue;
      const pay = (g.manifest.earnRules.get(a.rule)?.pay ?? 0) * a.units;
      coins += pay;
      // Alone with bots, every kill-keyed rule (kills, streaks) is paid for killing bots.
      if (killRules.has(a.rule)) coinsFromBotKills += pay;
      if (topRules.has(a.rule)) coinsFromTop += pay;
    }
    if (after.events.some((e) => e.name === "run.won")) {
      const info = runner.info();
      const mine = info.players.find((p) => p.id === me);
      const k = mine?.kills ?? 0;
      const d = mine?.deaths ?? 0;
      const better = info.players.filter((p) => p.id !== me && (p.kills > k || (p.kills === k && p.deaths < d))).length;
      const limit = g.round?.frags ?? Infinity;
      out = {
        firstKill,
        deaths,
        spawnDeaths,
        rank: better + 1,
        of: info.players.length,
        botEndedRound: info.players.some((p) => p.id >= BOT_PLAYER_BASE && p.kills >= limit),
        kills: k,
        botKills,
        coins,
        coinsFromBotKills,
        coinsFromTop,
        roundSeconds: info.seconds,
      };
    }
  }
  destroyWorld(world);
  if (!out) throw new Error("the round never ended");
  return out;
}

describe("VOLTYARD newcomer", () => {
  it("a weak new player alone with the seat bots: a kill within ~20 s, no spawn deaths, top half most rounds but not always first, bots never end the round, bot kills and a board of bots pay nothing", async () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const rounds: Outcome[] = [];
    for (const s of seeds) rounds.push(await newcomerRound(s));
    const firsts = rounds.map((r) => r.firstKill ?? 999).sort((a, b) => a - b);
    const median = firsts[Math.floor(firsts.length / 2)] ?? 999;
    const deaths = rounds.reduce((s, r) => s + r.deaths, 0);
    const spawnDeaths = rounds.reduce((s, r) => s + r.spawnDeaths, 0);
    const topHalf = rounds.filter((r) => r.rank <= Math.ceil(r.of / 2)).length;
    const firstPlace = rounds.filter((r) => r.rank === 1).length;
    console.info(`[newcomer] ${JSON.stringify(rounds)}`);
    console.info(
      `[newcomer] median first kill ${median}s, spawn deaths ${spawnDeaths}/${deaths}, ranks ${rounds.map((r) => `${r.rank}/${r.of}`).join(" ")}, top half ${topHalf}/${rounds.length}, first ${firstPlace}/${rounds.length}, coins/round ${rounds.map((r) => r.coins).join(" ")} (from bot kills ${rounds.map((r) => r.coinsFromBotKills).join(" ")}, from top of the board ${rounds.map((r) => r.coinsFromTop).join(" ")})`,
    );
    expect(median).toBeLessThanOrEqual(20);
    expect(spawnDeaths).toBe(0);
    // Top half in most rounds, but a newcomer does not simply win every round either.
    expect(topHalf).toBeGreaterThanOrEqual(Math.ceil(rounds.length * 0.6));
    expect(firstPlace).toBeLessThan(rounds.length);
    for (const r of rounds) expect(r.botEndedRound).toBe(false);
    // Alone with bots: killing them and topping their board pay nothing.
    for (const r of rounds) {
      expect(r.coinsFromBotKills).toBe(0);
      expect(r.coinsFromTop).toBe(0);
    }
  }, 240_000);
});
