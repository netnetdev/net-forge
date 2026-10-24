// `kit-play test`: compile the game folder's src/game.ts the way the play
// build does and run the engine's headless playtest (engine.test.run) on
// it with bots. No browser, no server, no network: a quick check after
// every change, made for coding agents as much as for people.

import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gameSwap, PlayError, readGameFolder, templateDir } from "./play.js";

export interface CheckOptions {
  readonly dir: string;
  /** Minutes of game time to play, at the template's own tick rate. */
  readonly minutes: number;
  /** Bots playing; null for the template's default. */
  readonly bots: number | null;
  readonly seed: number;
  readonly log: (s: string) => void;
}

/** What the engine's playtest reports (the fields this command reads; the rest pass through to --json). */
export interface CheckReport {
  readonly ticks: number;
  readonly bots: number;
  readonly kills: number;
  readonly deaths: number;
  readonly wave: number;
  readonly maxLevel: number;
  readonly earnEmitted: number;
  readonly earned: Readonly<Record<string, number>>;
  readonly softlock: boolean;
  readonly msPerTick: number;
  readonly rules?: { readonly template: string; readonly checks: readonly { readonly ok: boolean; readonly line: string }[]; readonly progress: number };
  readonly failed: readonly string[];
}

export interface CheckResult {
  readonly ok: boolean;
  readonly template: string;
  /** Why it failed, one line each (empty when ok). */
  readonly problems: readonly string[];
  /** Simulation ticks per second of game time (the template's own rate). */
  readonly tickRate?: number;
  readonly report: CheckReport | null;
}

/** Bundles the template's manifest with the folder's game module, plus the engine's playtest. Returns the bundle path. */
async function bundleCheck(gameFile: string, tplDir: string, outFile: string): Promise<string> {
  const esbuild = await import("esbuild");
  const manifest = realpathSync(join(tplDir, "src", "manifest.ts"));
  const contents = [`export * as template from ${JSON.stringify(manifest)};`, `export { engine } from "@netforge/engine";`, `export { initSim } from "@netforge/engine-sim";`].join("\n");
  const out = await esbuild.build({
    stdin: { contents, resolveDir: join(tplDir, "src"), sourcefile: "kit-play-test.js", loader: "js" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    write: false,
    logLevel: "silent",
    plugins: [gameSwap(manifest, realpathSync(gameFile), tplDir)],
    banner: { js: "import { createRequire as __kpRequire } from 'node:module'; const require = __kpRequire(import.meta.url);" },
  });
  const file = out.outputFiles[0];
  if (!file) throw new PlayError("the test bundle produced no output");
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, file.text);
  return outFile;
}

/** esbuild's and the engine's errors as the lines a person (or an agent) needs. */
function problemLines(e: unknown): string[] {
  const errors = (e as { errors?: { text: string; location?: { file: string; line: number; column: number } | null }[] }).errors;
  if (Array.isArray(errors) && errors.length > 0) return errors.map((x) => (x.location ? `${x.location.file}:${x.location.line}:${x.location.column}: ${x.text}` : x.text));
  return [e instanceof Error ? e.message : String(e)];
}

type Fn = (...args: unknown[]) => unknown;

export async function check(o: CheckOptions): Promise<CheckResult> {
  const dir = resolve(o.dir);
  const g = readGameFolder(dir);
  const tplDir = templateDir(g.template, dir);
  const t = g.template;
  o.log(`Compiling src/game.ts (${t.label})...`);
  let mod: { template: Readonly<Record<string, unknown>>; engine: { test: { run(opts: unknown): Promise<CheckReport> } }; initSim(): Promise<void> };
  try {
    // A fresh file name per run: a module imported once stays cached for the process.
    const bundle = await bundleCheck(g.gameFile, tplDir, join(dir, ".netnet", "play", `test-${process.pid}-${Date.now()}.mjs`));
    try {
      mod = (await import(pathToFileURL(bundle).href)) as typeof mod;
    } finally {
      rmSync(bundle, { force: true });
    }
  } catch (e) {
    return { ok: false, template: t.id, problems: problemLines(e), report: null };
  }
  let tickRate = 30;
  try {
    await mod.initSim();
    const get = mod.template[t.manifest.fn];
    const make = mod.template[t.adapter];
    if (typeof get !== "function" || typeof make !== "function") throw new PlayError(`the template does not export ${t.manifest.fn} and ${t.adapter}`);
    const got = (get as Fn)() as { manifest?: { game?: { tickRate?: number } }; game?: { tickRate?: number } };
    tickRate = (t.manifest.field ? got.manifest?.game?.tickRate : got.game?.tickRate) ?? 30;
    (make as Fn)();
  } catch (e) {
    return { ok: false, template: t.id, problems: problemLines(e), report: null };
  }
  const bots = o.bots ?? Math.min(t.seats, 2);
  // The template's own tick rate (the racer and the arena shooter run at 60 Hz), so a minute is a minute of game time.
  const ticks = Math.round(o.minutes * 60 * tickRate);
  o.log(`Playtest: ${bots} bot${bots === 1 ? "" : "s"} for ${o.minutes} minute${o.minutes === 1 ? "" : "s"} of game time...`);
  let report: CheckReport;
  try {
    report = await mod.engine.test.run({ ticks, bots, seed: o.seed, tickRate });
  } catch (e) {
    return { ok: false, template: t.id, problems: problemLines(e), report: null };
  }
  const problems = [...report.failed.map((f) => `check failed: ${f}`), ...(report.rules?.checks ?? []).filter((c) => !c.ok).map((c) => `check failed: ${c.line}`)];
  if (report.softlock) problems.push("softlock: nothing changed for 30 seconds of game time (no kills, no damage, no movement)");
  return { ok: problems.length === 0, template: t.id, problems: [...new Set(problems)], tickRate, report };
}

/** The report in a few lines. */
export function summary(r: CheckResult): string[] {
  if (!r.report) return [];
  const x = r.report;
  const earned = Object.entries(x.earned)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  return [
    `  kills ${x.kills}, downs ${x.deaths}, wave ${x.wave}, top level ${x.maxLevel}`,
    `  earn rules fired ${x.earnEmitted} time${x.earnEmitted === 1 ? "" : "s"}${earned ? ` (${earned})` : ""}`,
    // A check's line says what went wrong, so only failing ones are shown.
    ...(x.rules ? [`  ${x.rules.checks.filter((c) => c.ok).length} of ${x.rules.checks.length} genre checks passed`] : []),
    ...(x.rules ? x.rules.checks.filter((c) => !c.ok).map((c) => `  FAIL ${c.line}`) : []),
    ...(x.rules ? [`  progress ${Math.round(x.rules.progress * 100)}%`] : []),
    `  ${x.msPerTick.toFixed(2)} ms per tick on this computer`,
  ];
}
