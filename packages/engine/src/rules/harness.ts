/**
 * The headless playtest for board genres: the game
 * runs on the same adapter the room server steps, with playtest players
 * driven by the genre's own bot, and reports in HarnessReport terms. A run
 * that ends is rebuilt the way the room does it (a fresh world, every
 * player re-added, every referee run restarted).
 */
import type { GameManifest } from "../api/registry.js";
import type { HarnessOptions, HarnessReport } from "../api/harness.js";
import { rulesAdapter, type RulesWorld } from "./adapter.js";
import type { RulesGenre, RulesHarnessRun, RulesInput, RulesStats } from "./kit.js";

/** One run of the playtest, with the genre's numbers kept for its checks. */
export interface RulesPlaytest {
  readonly report: HarnessReport;
  readonly run: RulesHarnessRun;
}

// performance exists in browsers, Node and Bun, but not in lib ES2022's types.
const perf = (globalThis as { performance?: { now(): number } }).performance;
const now = (): number => (perf ? perf.now() : Date.now());

export function playRules<S>(genre: RulesGenre<S>, manifest: GameManifest, opts: HarnessOptions): RulesPlaytest {
  const adapter = rulesAdapter(genre, manifest, { name: "playtest", version: "playtest" });
  const seed = opts.seed ?? 1;
  const players = Math.max(1, Math.min(manifest.game.players.max, opts.bots));
  const skill = opts.bot === "human" ? 0.6 : 1;
  let world: RulesWorld<S> = adapter.createWorld(seed, "server");
  const join = (w: RulesWorld<S>) => {
    for (let p = 1; p <= players; p++) {
      adapter.addPlayer(w, p);
      adapter.startRun?.(w, p);
    }
  };
  join(world);
  const earned: Record<string, number> = {};
  let earnEmitted = 0;
  let won = 0;
  let lost = 0;
  let firstEarn: number | null = null;
  let firstRun: number | null = null;
  const times: number[] = [];
  let lastActivity = -1;
  let quietTicks = 0;
  let softlock = false;
  const quietLimit = 30 * genre.tickRate;
  // Totals across runs (each world's stats restart with it).
  let kills = 0;
  let deaths = 0;
  let wave = 0;
  let level = 0;
  let peak = 0;
  let topScore = 0;
  let scorers = 0;
  const fold = (st: RulesStats) => {
    kills += st.kills;
    deaths += st.deaths;
    wave = Math.max(wave, st.wave);
    level = Math.max(level, st.level);
    peak = Math.max(peak, st.peakUnits);
    topScore = Math.max(topScore, st.topScore);
    scorers = Math.max(scorers, st.scorers);
  };
  let tick = 0;
  for (; tick < opts.ticks; tick++) {
    const s = world.state;
    if (!s) break;
    const inputs = new Map<number, RulesInput[]>();
    for (const [p, a] of world.avatars) if (p <= players) inputs.set(p, [genre.bot(s, p, a, tick, skill)]);
    const t0 = now();
    const events = adapter.step(world, inputs);
    times.push(now() - t0);
    let reset = false;
    for (const e of events) {
      if (e.type === "earn") {
        earned[e.rule] = (earned[e.rule] ?? 0) + e.units;
        earnEmitted += e.units;
        firstEarn ??= tick / genre.tickRate;
      } else if (e.type === "run.reset") reset = true;
    }
    const act = genre.activity(s);
    if (act === lastActivity) {
      if (++quietTicks >= quietLimit && world.phase === "playing") softlock = true;
    } else {
      quietTicks = 0;
      lastActivity = act;
    }
    if (reset) {
      if (world.outcome === "won") won++;
      else lost++;
      firstRun ??= tick / genre.tickRate;
      fold(genre.stats(s));
      world = adapter.createWorld(seed + won + lost, "server");
      join(world);
      lastActivity = -1;
      quietTicks = 0;
    }
  }
  if (world.state) {
    fold(genre.stats(world.state));
    // A run that ended inside the last few seconds of the playtest still counts.
    if (world.phase === "ended") {
      if (world.outcome === "won") won++;
      else lost++;
      firstRun ??= tick / genre.tickRate;
    }
  }
  const sorted = [...times].sort((a, b) => a - b);
  const mean = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  const p99 = sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0) : 0;
  const stats: RulesStats = { kills, wave, level, deaths, peakUnits: peak, scorers, topScore };
  const report: HarnessReport = {
    ticks: tick,
    bots: players,
    deaths,
    kills,
    wave,
    runs: { won, lost },
    maxLevel: level,
    peakEnemies: peak,
    topScore,
    scorers,
    earned,
    msPerTick: mean,
    p99MsPerTick: p99,
    earnEmitted,
    softlock,
    failed: [],
  };
  const run: RulesHarnessRun = { seconds: tick / genre.tickRate, players, stats, runs: { won, lost }, earned, firstEarnSeconds: firstEarn, firstRunSeconds: firstRun };
  const full: HarnessReport = { ...report, rules: { template: genre.template, checks: genre.checks(run), progress: Math.max(0, Math.min(1, genre.progress(run))) } };
  const failed = (opts.assert ?? []).filter((a) => !a.check(full)).map((a) => a.name);
  return { report: { ...full, failed }, run };
}
