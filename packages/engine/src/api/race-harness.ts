/**
 * The headless playtest for the race templates (platformer, racer): the
 * room's own race runner with playtest players (ids 1..bots, the template's
 * course bot at full skill, or at 0.75 for `bot: "human"`), the game's seat
 * bots on top, and per-course route checks. Same report shape as the other
 * genres (harness.ts), with `fun.genre: "race"`.
 */
import type { InputCommand } from "@netforge/engine-sim";
import type { GameManifest } from "./registry.js";
import type { FunMetrics, HarnessOptions, HarnessReport } from "./harness.js";
import type { RaceCore } from "../game/race.js";

interface RaceSetup {
  readonly core: RaceCore;
  readonly tickRate: number;
  readonly bots: number;
  readonly roundSeconds: number | null;
  readonly courses: number;
  readonly routes: FunMetrics["routes"];
  /** Mishap events (falls, wall hits) by name. */
  readonly mishap: string;
}

async function setup(manifest: GameManifest): Promise<RaceSetup> {
  const { compileGame } = await import("../game/compile.js");
  const compiled = compileGame(manifest);
  if (compiled.mode === "platformer" && compiled.platformer) {
    const { PlatformCore, routeFor } = await import("../game/platformer.js");
    const p = compiled.platformer;
    // The start signal comes after the race runner's 3 s countdown.
    const start = Math.round(3 * compiled.tickRate);
    const routes = p.levels.map((level, course) => {
      const tape = routeFor(level, compiled.tickRate, p.tuning, start);
      return { course, found: tape !== null, seconds: tape ? Math.round((tape.length / compiled.tickRate) * 10) / 10 : null };
    });
    return { core: new PlatformCore(p, compiled.tickRate), tickRate: compiled.tickRate, bots: compiled.bots, roundSeconds: compiled.round?.seconds ?? null, courses: p.levels.length, routes, mishap: "player.fell" };
  }
  if (compiled.mode === "racer" && compiled.racer) {
    const { KartCore } = await import("../game/racer.js");
    const r = compiled.racer;
    return { core: new KartCore(r, compiled.tickRate), tickRate: compiled.tickRate, bots: compiled.bots, roundSeconds: compiled.round?.seconds ?? null, courses: r.tracks.length, routes: [], mishap: "kart.bumped" };
  }
  throw new Error(`no race machinery for template "${manifest.game.template}"`);
}

export async function runRaceHarness(manifest: GameManifest, opts: HarnessOptions): Promise<HarnessReport> {
  const { initSim } = await import("@netforge/engine-sim");
  const { RaceRunner } = await import("../game/race.js");
  await initSim();
  const s = await setup(manifest);
  const runner = new RaceRunner(manifest, s.core, { bots: s.bots, roundSeconds: s.roundSeconds, courses: s.courses, seed: opts.seed ?? 1 });
  const players = Math.max(0, Math.min(100, Math.floor(opts.bots)));
  for (let i = 1; i <= players; i++) runner.joined(i);
  const skill = opts.bot === "human" ? 0.75 : 1;
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  const now = () => (perf ? perf.now() : Date.now());
  const times: number[] = [];
  const earned: Record<string, number> = {};
  let earnEmitted = 0;
  let mishaps = 0;
  const finishes = new Map<number, number>();
  const finishSeconds: number[] = [];
  let firstCoin: number | null = null;
  const runs = { won: 0, lost: 0 };
  let rounds = 0;
  let quiet = 0;
  let softlock = false;
  const best = new Map<number, number>();
  let raceTicks = 0;
  for (let t = 0; t < opts.ticks; t++) {
    const inputs = new Map<number, InputCommand>();
    for (let i = 1; i <= players; i++) inputs.set(i, { ...s.core.botInput(i, t, skill), seq: t + 1 });
    const a = now();
    runner.beforeStep(inputs);
    const phase = runner.phaseNow;
    const info = phase === "racing" ? runner.info() : null;
    const r = runner.afterStep(s.core.step(inputs));
    times.push(now() - a);
    for (const aw of r.awards) {
      earned[aw.rule] = (earned[aw.rule] ?? 0) + aw.units;
      earnEmitted += aw.units;
    }
    let moved = false;
    for (const ev of r.events) {
      const mine = ev.players.filter((p) => p >= 1 && p <= players);
      if (mine.length === 0) continue;
      if (ev.name === s.mishap) mishaps += mine.length;
      if (ev.name === "coin.collected" && firstCoin === null) firstCoin = raceTicks / s.tickRate;
      if (ev.name === "player.finished") {
        moved = true;
        for (const p of mine) finishes.set(p, (finishes.get(p) ?? 0) + 1);
        finishSeconds.push(info?.seconds ?? 0);
      }
    }
    if (phase === "racing") {
      raceTicks++;
      for (let i = 1; i <= players; i++) {
        const pr = s.core.progress(i);
        if (pr > (best.get(i) ?? -1) + 0.002) {
          best.set(i, pr);
          moved = true;
        }
        if (s.core.finished(i)) moved = true;
      }
      quiet = moved || players === 0 ? 0 : quiet + 1;
      if (quiet >= 30 * s.tickRate) softlock = true;
    }
    if (phase === "racing" && runner.phaseNow === "results") {
      rounds++;
      const done = [...Array(players)].every((_, k) => s.core.finished(k + 1));
      if (done) runs.won++;
      else runs.lost++;
      best.clear();
    }
  }
  const sorted = [...times].sort((x, y) => x - y);
  const med = (v: number[]) => (v.length === 0 ? null : ([...v].sort((x, y) => x - y)[Math.floor(v.length / 2)] ?? null));
  const totalFinishes = [...finishes.values()].reduce((x, y) => x + y, 0);
  const fun: FunMetrics = {
    genre: "race",
    firstThreatSeconds: null,
    firstRewardSeconds: firstCoin,
    levelAt: { "60": null, "180": null, "360": null, "540": null },
    deathsBeforeMinute: null,
    onScreenAt30: null,
    contactHitsFirstMinute: null,
    telegraphedDeathShare: null,
    spawnsOnScreen: null,
    survivalSeconds: null,
    spawnToDamageSeconds: null,
    spawnDeathShare: null,
    killSpread: null,
    leadChanges: null,
    bossKills: [],
    downsBySource: {},
    finishSeconds: med(finishSeconds),
    finishRate: rounds > 0 && players > 0 ? Math.round((totalFinishes / (rounds * players)) * 100) / 100 : null,
    mishapsPerRound: rounds > 0 && players > 0 ? Math.round((mishaps / (Math.max(1, rounds) * players)) * 10) / 10 : null,
    firstCoinSeconds: firstCoin,
    routes: s.routes ?? [],
  };
  const base = {
    ticks: opts.ticks,
    bots: players,
    deaths: mishaps,
    kills: 0,
    wave: rounds,
    runs,
    maxLevel: 0,
    peakEnemies: 0,
    topScore: Math.max(0, ...finishes.values()),
    scorers: finishes.size,
    earned,
    msPerTick: times.reduce((x, y) => x + y, 0) / Math.max(1, times.length),
    p99MsPerTick: sorted[Math.floor(0.99 * Math.max(0, sorted.length - 1))] ?? 0,
    earnEmitted,
    softlock,
    fun,
  };
  const failed = (opts.assert ?? []).filter((x) => !x.check({ ...base, failed: [] })).map((x) => x.name);
  return { ...base, failed };
}
