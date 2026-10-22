// `kit add`, `kit init`, `kit sync` and the config editors the MCP server
// exposes. Every change is a small, reviewable diff, and every function is
// idempotent: running it twice changes nothing the second time.

import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { CONFIG_FILE, DECIMAL_RE, ID_RE, SLUG_RE, slugify, type EarnRuleConfig, type KitProjectConfig, type StoreItemConfig } from "../config.js";
import { KIT_VERSION } from "../version.js";
import { detectProject, HTML_HOSTED, listSourceFiles, loadConfig, readText, saveConfig, writeText, type Framework, type Project } from "./project.js";
import {
  BOOTSTRAP_BASENAME, bundlerBootstrap, defaultConfig, ENTRY_MARKER, entryLines, GEN_START, generatedBlock, HTML_TAG, htmlBootstrap, replaceGenerated,
} from "./templates.js";

export interface Change {
  file: string;
  action: "created" | "updated" | "unchanged";
  note: string;
}

export interface AddResult {
  framework: Framework;
  game: string;
  changes: Change[];
  nextSteps: string[];
}

export class CliError extends Error {
  constructor(readonly code: string, message: string, readonly fix: string) {
    super(message);
    this.name = "CliError";
  }
}

export interface InitOptions {
  game?: string;
  name?: string;
  earn?: string;
  earnLabel?: string;
}

/** Write netnet.config.json if it does not exist. */
export function initConfig(root: string, opts: InitOptions = {}): { config: KitProjectConfig; change: Change } {
  const loaded = loadConfig(root);
  if (loaded.exists) {
    if (!loaded.config) throw new CliError("CONFIG_INVALID", `${CONFIG_FILE} has problems: ${loaded.problems.join("; ")}`, `Fix ${CONFIG_FILE} by hand or delete it and run kit init again.`);
    return { config: loaded.config, change: { file: CONFIG_FILE, action: "unchanged", note: "already present" } };
  }
  const project = detectProject(root);
  const pkgName = typeof project.pkg?.["name"] === "string" ? (project.pkg["name"] as string) : basename(project.root);
  const game = opts.game ?? slugify(pkgName);
  if (!SLUG_RE.test(game)) throw new CliError("BAD_GAME_SLUG", `"${game}" is not a valid slug.`, "Pass --game with lowercase letters, digits and dashes, 3 to 32 characters.");
  const earnId = opts.earn ?? "level_complete";
  if (!ID_RE.test(earnId)) throw new CliError("BAD_EARN_ID", `"${earnId}" is not a valid earn id.`, "Use lowercase snake case, e.g. wave_cleared.");
  const config = defaultConfig(game, opts.name, earnId, opts.earnLabel ?? labelFromId(earnId));
  saveConfig(root, config);
  return { config, change: { file: CONFIG_FILE, action: "created", note: `game "${game}", earn rule "${earnId}"` } };
}

function labelFromId(id: string): string {
  const s = id.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Find the bootstrap module (the file holding the generated block). */
export function findBootstrap(root: string): string | null {
  for (const f of listSourceFiles(root)) {
    if (!/\.[cm]?[jt]sx?$/.test(f)) continue;
    if (readText(root, f).includes(GEN_START)) return f;
  }
  return null;
}

/** Rewrite the generated block from netnet.config.json. */
export function syncBootstrap(root: string): Change {
  const { config, problems } = loadConfig(root);
  if (!config) throw new CliError("CONFIG_INVALID", problems.join("; ") || `${CONFIG_FILE} is missing.`, "Run kit init, or fix netnet.config.json.");
  const file = findBootstrap(root);
  if (!file) return { file: "(none)", action: "unchanged", note: "no bootstrap found; run kit add" };
  const src = readText(root, file);
  const ts = /\.tsx?$/.test(file);
  const next = replaceGenerated(src, generatedBlock(config, ts));
  if (next === null || next === src) return { file, action: "unchanged", note: "already in sync" };
  writeText(root, file, next);
  return { file, action: "updated", note: "generated block synced from netnet.config.json" };
}

const IMPORT_BLOCK = /^(?:import\s[^;]*?from\s*["'][^"']+["'];?|import\s*["'][^"']+["'];?)[ \t]*$/gms;

/** Insert the two entry lines after the last import, once. */
function wireEntry(root: string, entry: string): Change {
  const src = readText(root, entry);
  if (src.includes(ENTRY_MARKER) || /\bstartKit\s*\(/.test(src)) return { file: entry, action: "unchanged", note: "already starts the Kit" };
  let at = 0;
  for (const m of src.matchAll(IMPORT_BLOCK)) at = (m.index ?? 0) + m[0].length;
  if (at === 0) {
    // No imports: go below the file's leading comment block, not above it.
    const header = /^(?:#![^\n]*\n)?(?:[ \t]*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)[ \t]*\n)*/.exec(src);
    at = header ? header[0].length : 0;
    if (at > 0) {
      const head = src.slice(0, at);
      writeText(root, entry, `${head}\n${entryLines()}${src.slice(at)}`);
      return { file: entry, action: "updated", note: "imports the bootstrap and starts the Kit (2 lines)" };
    }
  }
  const head = src.slice(0, at);
  const tail = src.slice(at);
  const sep = at === 0 ? "" : "\n";
  writeText(root, entry, `${head}${sep}${entryLines()}${tail.startsWith("\n") ? tail.slice(1) : tail}`);
  return { file: entry, action: "updated", note: "imports the bootstrap and starts the Kit (2 lines)" };
}

function wireHtml(root: string, html: string): Change {
  const src = readText(root, html);
  if (src.includes(`${BOOTSTRAP_BASENAME}.js`)) return { file: html, action: "unchanged", note: "already loads the Kit" };
  let next: string;
  if (/<\/head>/i.test(src)) next = src.replace(/<\/head>/i, `  ${HTML_TAG}\n</head>`);
  else if (/<script\b/i.test(src)) next = src.replace(/<script\b/i, `${HTML_TAG}\n<script`);
  else if (/<body[^>]*>/i.test(src)) next = src.replace(/<body[^>]*>/i, (m) => `${m}\n${HTML_TAG}`);
  else next = `${HTML_TAG}\n${src}`;
  writeText(root, html, next);
  return { file: html, action: "updated", note: "loads the Kit bootstrap (1 line)" };
}

function addDependency(root: string, project: Project): Change {
  const pkg = project.pkg;
  if (!pkg) return { file: "package.json", action: "unchanged", note: "no package.json" };
  const deps = (pkg["dependencies"] && typeof pkg["dependencies"] === "object" ? pkg["dependencies"] : {}) as Record<string, string>;
  if (deps["@netnetcapital/kit"]) return { file: "package.json", action: "unchanged", note: "already depends on the Kit" };
  pkg["dependencies"] = { ...deps, "@netnetcapital/kit": KIT_VERSION };
  const indent = /^(\s+)"/m.exec(readText(root, "package.json"))?.[1] ?? "  ";
  writeText(root, "package.json", `${JSON.stringify(pkg, null, indent)}\n`);
  return { file: "package.json", action: "updated", note: `adds @netnetcapital/kit ${KIT_VERSION} (exact)` };
}

export interface AddOptions extends InitOptions {
  framework?: Framework;
  /** The game's entry module, relative to the project, when detection misses it. */
  entry?: string;
}

/** `kit add`: wire the Kit into an existing game with minimal diffs. */
export function addKit(rootIn: string, opts: AddOptions = {}): AddResult {
  if (!existsSync(rootIn)) throw new CliError("NO_PROJECT", `${rootIn} does not exist.`, "Run kit add from the game's folder or pass its path.");
  const changes: Change[] = [];
  const { config, change } = initConfig(rootIn, opts);
  changes.push(change);
  const project = detectProject(rootIn, opts.framework);
  const root = project.root;
  const nextSteps: string[] = [];
  const firstEarn = config.earn[0]?.id ?? "level_complete";

  if (HTML_HOSTED.has(project.framework)) {
    if (!project.html) throw new CliError("NO_HTML", "No index.html found.", "Run kit add in the folder that holds the game's index.html.");
    const bootRel = join(dirname(project.html), `${BOOTSTRAP_BASENAME}.js`).split("\\").join("/").replace(/^\.\//, "");
    if (existsSync(join(root, bootRel))) changes.push({ file: bootRel, action: "unchanged", note: "bootstrap already present" });
    else {
      writeText(root, bootRel, htmlBootstrap(config));
      changes.push({ file: bootRel, action: "created", note: "Kit bootstrap (loads the Kit, starts it, exposes window.kit and window.netnetEarn)" });
    }
    changes.push(wireHtml(root, project.html));
    nextSteps.push(`Call netnetEarn("${firstEarn}") in the game code where the player earns it (mandatory: kit doctor fails without an earn call).`);
    if (project.framework === "godot") nextSteps.push(`From GDScript: JavaScriptBridge.eval("netnetEarn('${firstEarn}')")`);
    if (project.framework === "unity") nextSteps.push(`From C#: add a .jslib with a function that calls window.netnetEarn("${firstEarn}") and [DllImport("__Internal")] it.`);
  } else {
    if (opts.entry) project.entry = opts.entry;
    if (!project.entry) throw new CliError("NO_ENTRY", "Could not find the game's entry module.", "Pass the entry with --entry, or create src/main.ts that starts the game.");
    const ext = project.typescript ? "ts" : "js";
    const bootRel = join(dirname(project.entry), `${BOOTSTRAP_BASENAME}.${ext}`).split("\\").join("/");
    const existing = findBootstrap(root);
    if (existing) changes.push({ file: existing, action: "unchanged", note: "bootstrap already present" });
    else {
      writeText(root, bootRel, bundlerBootstrap(config, project.typescript));
      changes.push({ file: bootRel, action: "created", note: "Kit bootstrap (startKit, earn, typed ids)" });
    }
    changes.push(wireEntry(root, project.entry));
    changes.push(addDependency(root, project));
    nextSteps.push(`Install: ${project.packageManager} install`);
    nextSteps.push(`Call earn("${firstEarn}") (import { earn } from "./${BOOTSTRAP_BASENAME}") where the player earns it (mandatory: kit doctor fails without an earn call).`);
    if (project.framework === "react") nextSteps.push(`Read Kit state in components with: import { useKit } from "@netnetcapital/kit/react"; const state = useKit();`);
  }
  nextSteps.push("Add store items with `npx @netnetcapital/kit add-item <id> --label \"...\" --usdg 0.50` (optional).");
  nextSteps.push("Run in mock mode (no chain): ?kit=mock in the URL, or VITE_NETNET_KIT_MOCK=1 for Vite.");
  nextSteps.push("Check the integration: npx @netnetcapital/kit doctor");
  return { framework: project.framework, game: config.game, changes, nextSteps };
}

export interface StoreItemInput {
  id: string;
  label: string;
  kind?: "consumable" | "permanent" | "pass";
  /** Pass length in seconds (kind "pass"). */
  duration?: number;
  priceUsdg?: string;
  priceToken?: string;
}

export function addStoreItem(root: string, input: StoreItemInput): { item: StoreItemConfig; changes: Change[]; snippet: string } {
  const { config, problems } = loadConfig(root);
  if (!config) throw new CliError("CONFIG_INVALID", problems.join("; ") || `${CONFIG_FILE} is missing.`, "Run kit add first.");
  if (!ID_RE.test(input.id)) throw new CliError("BAD_SKU_ID", `"${input.id}" is not a valid SKU id.`, "Use lowercase snake case up to 31 characters, e.g. skin_gold.");
  if (!input.priceUsdg && !input.priceToken) throw new CliError("NO_PRICE", "A store item needs a price.", "Pass priceUsdg (dollars, e.g. \"0.50\"), priceToken (e.g. \"10\"), or both.");
  if (input.kind === "pass" && !(input.duration && Number.isInteger(input.duration) && input.duration > 0)) throw new CliError("NO_DURATION", "A pass needs a duration.", "Pass duration in whole seconds, e.g. 604800 for a week.");
  for (const p of [input.priceUsdg, input.priceToken]) {
    if (p !== undefined && !DECIMAL_RE.test(p)) throw new CliError("BAD_PRICE", `"${p}" is not a decimal price.`, "Write prices as decimal strings, e.g. \"0.50\".");
  }
  const item: StoreItemConfig = {
    id: input.id,
    label: input.label,
    kind: input.kind ?? "consumable",
    ...(input.kind === "pass" ? { duration: input.duration ?? 0 } : {}),
    ...(input.priceUsdg ? { priceUsdg: input.priceUsdg } : {}),
    ...(input.priceToken ? { priceToken: input.priceToken } : {}),
  };
  const i = config.store.findIndex((s) => s.id === item.id);
  if (i >= 0) config.store[i] = item;
  else config.store.push(item);
  saveConfig(root, config);
  const changes: Change[] = [{ file: CONFIG_FILE, action: "updated", note: `${i >= 0 ? "updated" : "added"} store item "${item.id}"` }, syncBootstrap(root)];
  const pay = item.priceUsdg ? "usdg" : "token";
  const snippet = item.kind === "pass"
    ? `await kit.store.buy("${item.id}", { pay: "${pay}" });\nconst active = kit.store.owns("${item.id}"); // sync, no RPC; false once the pass runs out`
    : item.kind === "permanent"
    ? `if (!kit.store.owns("${item.id}")) await kit.store.buy("${item.id}", { pay: "${pay}" });\nconst unlocked = kit.store.owns("${item.id}"); // sync, no RPC`
    : `await kit.store.buy("${item.id}", { pay: "${pay}" });\nconst left = kit.store.count("${item.id}"); // sync, no RPC`;
  return { item, changes, snippet };
}

export function addEarnEvent(root: string, input: { id: string; label: string; description?: string }): { rule: EarnRuleConfig; changes: Change[]; snippet: string } {
  const { config, problems } = loadConfig(root);
  if (!config) throw new CliError("CONFIG_INVALID", problems.join("; ") || `${CONFIG_FILE} is missing.`, "Run kit add first.");
  if (!ID_RE.test(input.id)) throw new CliError("BAD_EARN_ID", `"${input.id}" is not a valid earn id.`, "Use lowercase snake case up to 31 characters, e.g. wave_cleared.");
  const rule: EarnRuleConfig = { id: input.id, label: input.label, ...(input.description ? { description: input.description } : {}) };
  const i = config.earn.findIndex((e) => e.id === rule.id);
  if (i >= 0) config.earn[i] = rule;
  else config.earn.push(rule);
  saveConfig(root, config);
  const changes: Change[] = [{ file: CONFIG_FILE, action: "updated", note: `${i >= 0 ? "updated" : "added"} earn rule "${rule.id}"` }, syncBootstrap(root)];
  const project = detectProject(root);
  const snippet = HTML_HOSTED.has(project.framework) ? `netnetEarn("${rule.id}");` : `earn("${rule.id}"); // import { earn } from "./${BOOTSTRAP_BASENAME}"`;
  return { rule, changes, snippet };
}
