// The §3 fun table for CRYPTWICK (GAME-DESIGN.md "measure fun with bots"):
// human-like bots play the game headless on the server sim, and the
// harness's fun metrics are summed over several seeds.
//
//   pnpm --filter @netnetcapital/template-dungeon fun -- --runs 20 --minutes 10 --bots 1 --picks random
import { engine } from "@netnetcapital/engine";
import type { FunMetrics, HarnessReport } from "@netnetcapital/engine";
import "../src/manifest.js";

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? dflt) : dflt;
}
const RUNS = Number(arg("runs", "10"));
const MINUTES = Number(arg("minutes", "10"));
const BOTS = Number(arg("bots", "1"));
const PICKS = arg("picks", "random") as "random" | "greedy";
const BOT = arg("bot", "human") as "human" | "basic";

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor(s.length / 2)] ?? 0) : NaN;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const nums = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => x !== null && x !== undefined);

/** Median seconds from spawn to kill, per boss prefab. */
function bossRows(funs: FunMetrics[]): [string, string][] {
  const by = new Map<string, number[]>();
  for (const f of funs) for (const b of f.bossKills) by.set(b.prefab, [...(by.get(b.prefab) ?? []), b.seconds]);
  return [...by].map(([p, xs]) => [`${p} time to kill (median)`, `${median(xs)} s (${xs.length} kills)`]);
}

async function main(): Promise<void> {
  const reports: HarnessReport[] = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await engine.test.run({ ticks: Math.round(MINUTES * 60 * 30), bots: BOTS, seed: 100 + i, bot: BOT, picks: PICKS });
    reports.push(r);
    if (process.argv.includes("--json")) console.error(JSON.stringify(r.fun));
    const f = r.fun as FunMetrics;
    console.error(
      `seed ${100 + i}: survived ${f.survivalSeconds}s, won ${r.runs.won}, L2 ${f.firstRewardSeconds}s, threat ${f.firstThreatSeconds}s, hit ${f.firstHitSeconds}s, hp120 ${f.lowestHealthBy120}, elite ${f.firstEliteSeconds}s, boss ${f.firstBossSeconds}s, out ${f.downTimeShare}, lv@1/3/6/9 ${f.levelAt["60"]}/${f.levelAt["180"]}/${f.levelAt["360"]}/${f.levelAt["540"]}, early downs ${f.deathsBeforeMinute}, bosses ${f.bossKills.map((b) => `${b.prefab}:${b.seconds}s`).join(" ") || "-"}, telegraphed ${f.telegraphedDeathShare}, onscreen@30 ${f.onScreenAt30}, hits/min1 ${f.contactHitsFirstMinute}, spawnsOnScreen ${f.spawnsOnScreen}, peak ${r.peakEnemies}, ${r.msPerTick.toFixed(2)} ms/tick`,
    );
  }
  const funs = reports.map((r) => r.fun as FunMetrics);
  const lv = (k: "60" | "180" | "360" | "540") => {
    const xs = nums(funs.map((f) => f.levelAt[k]));
    return xs.length ? `${median(xs)} (${xs.length}/${funs.length} reached)` : "not reached";
  };
  const firstRunWon = reports.filter((r) => r.runs.won > 0 && (r.fun?.survivalSeconds ?? 0) > 0).length;
  const rows: [string, string][] = [
    ["Time to level 2 (median)", `${median(nums(funs.map((f) => f.firstRewardSeconds)))} s`],
    ["Time to first threat (median)", `${median(nums(funs.map((f) => f.firstThreatSeconds)))} s`],
    ["Time to first damage taken (median)", `${median(nums(funs.map((f) => f.firstHitSeconds)))} s`],
    ["Lowest HP by 2:00 (median)", String(median(nums(funs.map((f) => f.lowestHealthBy120))))],
    ["First elite (median)", `${median(nums(funs.map((f) => f.firstEliteSeconds)))} s`],
    ["First boss (median)", `${median(nums(funs.map((f) => f.firstBossSeconds)))} s`],
    ["Time spent downed or out (mean share)", mean(nums(funs.map((f) => f.downTimeShare))).toFixed(3)],
    ["Level at 1:00", lv("60")],
    ["Level at 3:00", lv("180")],
    ["Level at 6:00", lv("360")],
    ["Level at 9:00", lv("540")],
    ["Deaths before 1:00", `${funs.reduce((a, f) => a + (f.deathsBeforeMinute ?? 0), 0)} in ${RUNS} runs`],
    ["Median survival", `${median(nums(funs.map((f) => f.survivalSeconds)))} s`],
    ["Runs won", `${firstRunWon}/${RUNS}`],
    ["Contact hits per player in minute 1 (mean)", mean(nums(funs.map((f) => f.contactHitsFirstMinute))).toFixed(2)],
    ["Enemies on screen at 0:30 (max)", String(Math.max(...nums(funs.map((f) => f.onScreenAt30))))],
    ["Spawns on screen (share)", mean(nums(funs.map((f) => f.spawnsOnScreen))).toFixed(3)],
    ["Telegraphed deaths after 3:00", (() => {
      const xs = nums(funs.map((f) => f.telegraphedDeathShare));
      return xs.length ? mean(xs).toFixed(2) : "no downs after 3:00";
    })()],
    ...bossRows(funs),
    ["Downs by what hit last", (() => {
      const all: Record<string, number> = {};
      for (const f of funs) for (const [k, v] of Object.entries(f.downsBySource)) all[k] = (all[k] ?? 0) + v;
      return Object.entries(all).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
    })()],
    ["Peak enemies", String(Math.max(...reports.map((r) => r.peakEnemies)))],
    ["Server ms/tick (mean / worst p99)", `${mean(reports.map((r) => r.msPerTick)).toFixed(2)} / ${Math.max(...reports.map((r) => r.p99MsPerTick)).toFixed(2)}`],
  ];
  console.log(`\n${BOTS} ${BOT} bot(s), ${PICKS} picks, ${RUNS} runs of ${MINUTES} min\n`);
  console.log("| Metric | Value |\n|---|---|");
  for (const [k, v] of rows) console.log(`| ${k} | ${v} |`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
