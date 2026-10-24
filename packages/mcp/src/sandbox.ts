// Validating and playtesting a game module without a browser, a chain or a
// server. The game's src/game.ts is bundled with its template's
// src/manifest.ts (the same swap kit play makes) and one copy of the
// engine, then run in a child Node process with a time limit, so a game
// that loops forever or throws at import never takes the MCP server down.
//
// The child prints one line starting with RESULT_MARK holding the JSON
// result; anything else the game logs is kept as `logs`.
//
// The child is locked down because an agent may pass code it did not write:
// Node's permission model (no file writes, no reads outside the bundle's own
// folder, no child processes, no workers, no native addons), a scrubbed
// environment (no API keys), a heap cap, a working folder of its own and a
// time limit. It still has the network, so it is a guard rail, not a VM; and
// what the game prints is untrusted text, capped before it reaches the agent.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { templateFor, type TemplateEntry } from "@netforge/kit-play";
import { templateRoot } from "./locate.js";

export const ALLOWED_IMPORT = "@netforge/engine";
const RESULT_MARK = "@@NETFORGE_RESULT@@";

export interface GameSource {
  /** Absolute path of src/game.ts. */
  readonly gameFile: string;
  readonly template: TemplateEntry;
  /** The game folder (netnet.json, src/game.ts), used to find installed packages. */
  readonly dir: string;
  /** Set when the source came in as text: the temp folder to remove afterwards. */
  readonly temp: string | null;
}

export class SourceError extends Error {}

/** A game from a folder (netnet.json + src/game.ts) or from code plus a template id. */
export function gameSource(input: { projectDir?: string | undefined; code?: string | undefined; template?: string | undefined }): GameSource {
  if (input.code !== undefined) {
    const template = templateFor(input.template ?? (input.projectDir ? readTemplate(resolve(input.projectDir)) : undefined));
    if (!template) throw new SourceError(`Pass "template" with "code": one of the ids netforge_list_templates returns (got ${JSON.stringify(input.template ?? null)}).`);
    const temp = mkdtempSync(join(tmpdir(), "netforge-mcp-"));
    mkdirSync(join(temp, "src"));
    const gameFile = join(temp, "src", "game.ts");
    writeFileSync(gameFile, input.code);
    writeFileSync(join(temp, "netnet.json"), JSON.stringify({ template: template.id }));
    return { gameFile, template, dir: input.projectDir ? resolve(input.projectDir) : temp, temp };
  }
  if (!input.projectDir) throw new SourceError('Pass "projectDir" (a game folder with netnet.json and src/game.ts), or "code" with "template".');
  const dir = resolve(input.projectDir);
  const template = templateFor(readTemplate(dir));
  if (!template) throw new SourceError(`netnet.json in ${dir} names an unknown template. Use one of the ids netforge_list_templates returns.`);
  const gameFile = join(dir, "src", "game.ts");
  if (!existsSync(gameFile)) throw new SourceError(`${gameFile} is missing. A Net Forge game keeps its whole game in src/game.ts.`);
  return { gameFile, template, dir, temp: null };
}

function readTemplate(dir: string): string {
  const file = join(dir, "netnet.json");
  if (!existsSync(file)) throw new SourceError(`No netnet.json in ${dir}. Create one with netforge_create_game, or pass "code" and "template".`);
  try {
    const meta = JSON.parse(readFileSync(file, "utf8")) as { template?: unknown };
    return String(meta.template);
  } catch {
    throw new SourceError(`${file} is not valid JSON.`);
  }
}

export function dispose(src: GameSource): void {
  if (src.temp) rmSync(src.temp, { recursive: true, force: true });
}

export interface GameError {
  /** declare: the declarations were rejected; compile: the template could not build the game; build: the file did not bundle; playtest: the game threw while bots played; timeout. */
  readonly stage: "build" | "declare" | "compile" | "playtest" | "timeout";
  readonly message: string;
  /** 1-based line in src/game.ts the error most likely points at, when one could be found. */
  readonly line?: number;
  readonly hint?: string;
}

export interface GameSummary {
  readonly template: string;
  readonly style: string | null;
  /** Server ticks per second (game({ tickRate }), 30 when unset). */
  readonly tickRate: number;
  readonly counts: Readonly<Record<string, number>>;
  readonly earnRules: readonly string[];
  readonly skus: readonly string[];
}

export interface RunResult {
  readonly ok: boolean;
  readonly errors: readonly GameError[];
  readonly summary: GameSummary | null;
  readonly report: Record<string, unknown> | null;
  readonly wallMs: number;
  readonly logs: readonly string[];
}

/** The child's own code: import the bundled template (which runs game.ts), compile, then maybe playtest. */
const CHILD = `
const __opts = JSON.parse(process.argv[2] ?? "{}");
const __out = (o) => new Promise((r) => process.stdout.write("\\n${RESULT_MARK}" + JSON.stringify(o) + "\\n", r));
const __err = (stage, e) => ({ stage, message: e && e.message ? String(e.message) : String(e), issues: e && Array.isArray(e.issues) ? e.issues.map(String) : null });
const __errors = [];
let __summary = null;
let __report = null;
let __mod = null;
try {
  __mod = await import("@@TEMPLATE@@");
} catch (e) {
  __errors.push(__err("declare", e));
}
if (__mod) {
  try {
    const fn = __mod[__opts.manifestFn];
    if (typeof fn !== "function") throw new Error("the template does not export " + __opts.manifestFn);
    const got = fn();
    const m = __opts.manifestField ? got[__opts.manifestField] : got;
    const g = m.game;
    const size = (x) => (x && typeof x.size === "number" ? x.size : 0);
    const content = {};
    if (m.content) for (const k of m.content.keys()) { const kind = String(k).split(":")[0]; content[kind] = (content[kind] ?? 0) + 1; }
    __summary = {
      template: String(g.template), style: g.style ?? null, tickRate: typeof g.tickRate === "number" && g.tickRate > 0 ? g.tickRate : 30,
      counts: { prefabs: size(m.prefabs), weapons: size(m.weapons), upgrades: size(m.upgrades), systems: size(m.systems), earnRules: size(m.earnRules), skus: size(m.skus), keepers: size(m.keepers), achievements: size(m.achievements), missions: size(m.missions), titles: size(m.titles), metaUpgrades: size(m.metaUpgrades), ...content },
      earnRules: [...(m.earnRules?.keys?.() ?? [])].map(String),
      skus: [...(m.skus?.keys?.() ?? [])].map(String),
    };
  } catch (e) {
    __errors.push(__err("compile", e));
  }
}
if (__summary && __opts.playtest) {
  try {
    const { engine } = await import("@@ENGINE@@");
    // Game seconds become ticks at the game's own rate (arena, racer and platformer run at 60).
    const { seconds, ...pt } = __opts.playtest;
    const r = await engine.test.run({ ...pt, ticks: Math.round(seconds * __summary.tickRate) });
    __report = JSON.parse(JSON.stringify(r));
  } catch (e) {
    __errors.push(__err("playtest", e));
  }
}
await __out({ errors: __errors, summary: __summary, report: __report });
process.exit(0);
`;

/** Bundles the child for one game: the template's manifest with src/game.ts swapped in, the engine once. */
async function bundle(src: GameSource, tplDir: string, outFile: string): Promise<GameError | null> {
  const esbuild = await import("esbuild");
  const manifest = realpathSync(join(tplDir, "src", "manifest.ts"));
  const gameFile = realpathSync(src.gameFile);
  const swap: import("esbuild").Plugin = {
    name: "netforge-swap",
    setup(b) {
      b.onResolve({ filter: /^@@TEMPLATE@@$/ }, () => ({ path: manifest }));
      b.onResolve({ filter: /^@@ENGINE@@$/ }, () => b.resolve(ALLOWED_IMPORT, { resolveDir: join(tplDir, "src"), kind: "import-statement" }));
      b.onResolve({ filter: /^\.\/game\.(js|ts)$/ }, (args) => (args.importer === manifest ? { path: gameFile } : undefined));
      b.onResolve({ filter: /.*/ }, async (args) => {
        if (args.importer !== gameFile) return undefined;
        if (args.path === ALLOWED_IMPORT) return b.resolve(args.path, { resolveDir: join(tplDir, "src"), kind: args.kind });
        return { errors: [{ text: `src/game.ts may import only "${ALLOWED_IMPORT}", not "${args.path}"` }] };
      });
    },
  };
  try {
    const out = await esbuild.build({
      stdin: { contents: CHILD, resolveDir: tplDir, sourcefile: "netforge-check.js", loader: "js" },
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      write: false,
      logLevel: "silent",
      external: ["bufferutil", "utf-8-validate"],
      plugins: [swap],
      banner: { js: "import { createRequire as __nfRequire } from 'node:module'; const require = __nfRequire(import.meta.url);" },
    });
    const file = out.outputFiles[0];
    if (!file) return { stage: "build", message: "the bundle produced no output" };
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, file.text);
    return null;
  } catch (e) {
    const errs = (e as { errors?: Array<{ text: string; location?: { file?: string; line?: number; lineText?: string } | null }> }).errors ?? [];
    const first = errs[0];
    if (!first) return { stage: "build", message: e instanceof Error ? e.message : String(e) };
    const inGame = first.location?.file && realpathSafe(resolve(tplDir, first.location.file)) === gameFile;
    return {
      stage: "build",
      message: errs.map((x) => x.text).join("; "),
      ...(inGame && first.location?.line ? { line: first.location.line } : {}),
      hint: first.text.includes("may import only") ? `Import every declaration from "${ALLOWED_IMPORT}" and nothing else; templates draw, network and simulate the game for you.` : "Fix the syntax error at that line; src/game.ts is TypeScript.",
    };
  }
}

function realpathSafe(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** Points an engine message at the line of src/game.ts that declares what it names. */
function locate(message: string, source: string): number | undefined {
  const lines = source.split("\n");
  const quoted = [...message.matchAll(/"([a-z0-9_.-]+)"/gi)].map((m) => m[1] ?? "").filter((s) => s.length > 1);
  for (const q of quoted) {
    const i = lines.findIndex((l) => l.includes(`"${q}"`) || l.includes(`'${q}'`));
    if (i >= 0) return i + 1;
  }
  const where = /^(\w+)(?:\(|\.)/.exec(message)?.[1];
  if (where) {
    const i = lines.findIndex((l) => new RegExp(`\\b${where}\\s*\\(`).test(l));
    if (i >= 0) return i + 1;
  }
  return undefined;
}

function hintFor(message: string): string | undefined {
  if (/earn\.rule/.test(message)) return 'Add earn.rule("<id>", { label: "...", ... }) for the moment a player earns. Every game needs at least one.';
  if (/earn\.stake/.test(message)) return "Add earn.stake({ min, max, multiple }): every game needs a buy-in run.";
  if (/declared twice/.test(message)) return "Give each declaration its own id.";
  if (/not a declared/.test(message)) return "Declare that id first (prefab, weapon, upgrade or achievement), or fix the spelling.";
  if (/library|asset/i.test(message)) return 'Use an asset library id such as "style.lowpoly.ghost", never a URL or a path. netforge_search_docs "asset ids" lists how ids are formed.';
  if (/no game\(\)/.test(message)) return "Call game({ template, style, ... }) once at the top of src/game.ts.";
  if (/lower_snake_case|lower case|snake/.test(message)) return "Ids are lower_snake_case: letters, digits and underscores.";
  return undefined;
}

/** Turns the child's raw errors into one actionable error per issue. */
function explain(raw: Array<{ stage: GameError["stage"]; message: string; issues: string[] | null }>, source: string): GameError[] {
  const out: GameError[] = [];
  for (const r of raw) {
    const head = r.message.split("\n")[0]?.replace(/:$/, "") ?? r.message;
    const items = r.issues && r.issues.length > 0 ? r.issues.map((i) => `${head}: ${i}`) : [r.message];
    for (const message of items) {
      const line = locate(message, source);
      const hint = hintFor(message);
      out.push({ stage: r.stage, message, ...(line ? { line } : {}), ...(hint ? { hint } : {}) });
    }
  }
  return out;
}

export interface RunOptions {
  /** engine.test.run options; omitted for a validation only. */
  readonly playtest?: { seconds: number; bots: number; seed: number; bot?: "basic" | "human" };
  readonly timeoutMs: number;
}

/** Validates (and with `playtest`, playtests) one game in a child process. */
export async function runGame(src: GameSource, o: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const tplDir = templateRoot(src.template.pkg, src.dir);
  if (!tplDir) {
    return { ok: false, errors: [{ stage: "build", message: `${src.template.pkg} is not installed`, hint: "Run npm install in the game folder (its package.json lists @netforge/kit-play, which brings every template)." }], summary: null, report: null, wallMs: 0, logs: [] };
  }
  const work = realpathSync(mkdtempSync(join(tmpdir(), "netforge-run-")));
  try {
    const file = join(work, "check.mjs");
    const built = await bundle(src, tplDir, file);
    if (built) return { ok: false, errors: [built], summary: null, report: null, wallMs: Date.now() - started, logs: [] };
    const opts = { manifestFn: src.template.manifest.fn, manifestField: src.template.manifest.field ?? null, playtest: o.playtest ?? null };
    const child = await runChild(file, JSON.stringify(opts), o.timeoutMs, work);
    const source = readFileSync(src.gameFile, "utf8");
    if (!child.result) {
      const message = child.timedOut ? `stopped after ${Math.round(o.timeoutMs / 1000)} s` : `the check process exited without a result (code ${child.code})`;
      const tail = clip(child.stderr.trim().split("\n").slice(-8).join("\n"), MAX_MESSAGE);
      return {
        ok: false,
        errors: [{ stage: child.timedOut ? "timeout" : "playtest", message: tail ? `${message}: ${tail}` : message, hint: child.timedOut ? "A system may loop forever, or the playtest is too long: lower seconds or bots." : "Read the message; the game threw outside a declaration." }],
        summary: null,
        report: null,
        wallMs: Date.now() - started,
        logs: child.logs,
      };
    }
    const r = child.result as { errors: Array<{ stage: GameError["stage"]; message: string; issues: string[] | null }>; summary: GameSummary | null; report: Record<string, unknown> | null };
    const errors = explain(capRaw(r.errors), source);
    return { ok: errors.length === 0, errors, summary: r.summary, report: r.report, wallMs: Date.now() - started, logs: child.logs };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Longest error message and most errors handed back: the text comes from the game's code. */
export const MAX_MESSAGE = 2_000;
export const MAX_ERRORS = 50;

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)} [cut: ${s.length - n} more characters]` : s;
}

type RawError = { stage: GameError["stage"]; message: string; issues: string[] | null };
function capRaw(raw: unknown): RawError[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_ERRORS).map((r: Partial<RawError>) => ({
    stage: (["build", "declare", "compile", "playtest", "timeout"] as const).includes(r.stage as GameError["stage"]) ? (r.stage as GameError["stage"]) : "playtest",
    message: clip(String(r.message ?? ""), MAX_MESSAGE),
    issues: Array.isArray(r.issues) ? r.issues.slice(0, MAX_ERRORS).map((i) => clip(String(i), MAX_MESSAGE)) : null,
  }));
}

/** Node's permission flag: stable as --permission from 22.13 / 23.5, experimental before. */
function permissionFlag(): string {
  return process.allowedNodeEnvironmentFlags.has("--permission") ? "--permission" : "--experimental-permission";
}

/** Only what Node itself needs; never the user's tokens or keys. */
export function childEnv(src: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const k of ["PATH", "SystemRoot", "TMPDIR", "TEMP", "TMP"]) if (src[k] !== undefined) env[k] = src[k];
  return env;
}

interface ChildOut {
  readonly result: unknown;
  readonly code: number | null;
  readonly timedOut: boolean;
  readonly stderr: string;
  readonly logs: string[];
}

function runChild(file: string, arg: string, timeoutMs: number, work: string): Promise<ChildOut> {
  return new Promise((done) => {
    const flags = [permissionFlag(), `--allow-fs-read=${work}`, "--max-old-space-size=2048", "--no-warnings"];
    const p = spawn(process.execPath, [...flags, file, arg], { cwd: work, stdio: ["ignore", "pipe", "pipe"], env: childEnv() });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    p.stdout.on("data", (d: Buffer) => {
      // Keep the tail: the result line comes last, after whatever the game printed.
      stdout += d.toString();
      if (stdout.length > 4_000_000) stdout = stdout.slice(-4_000_000);
    });
    p.stderr.on("data", (d: Buffer) => {
      if (stderr.length < 200_000) stderr += d.toString();
    });
    const timer = setTimeout(() => {
      timedOut = true;
      p.kill("SIGKILL");
    }, timeoutMs);
    p.on("close", (code) => {
      clearTimeout(timer);
      let result: unknown = null;
      const logs: string[] = [];
      for (const line of stdout.split("\n")) {
        if (line.startsWith(RESULT_MARK)) {
          try {
            result = JSON.parse(line.slice(RESULT_MARK.length));
          } catch {
            result = null;
          }
        } else if (line.trim() && logs.length < 40) logs.push(line.slice(0, 400));
      }
      done({ result, code, timedOut, stderr, logs });
    });
  });
}
