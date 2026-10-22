// `kit doctor`: lint a game's Kit integration. Static, offline, no RPC.
//
// Errors (exit 1):
//   CONFIG_MISSING / CONFIG_INVALID   netnet.config.json absent or malformed
//   EARN_RULE_MISSING                 no earn rule: mandatory
//   EARN_NOT_WIRED                    no game code reports an earn event
//   EARN_EVENT_UNKNOWN                game code reports an event the config lacks
//   KIT_NOT_INSTALLED / KIT_NOT_LOADED the package or the bootstrap script is missing
//   INIT_MISSING / INIT_GAME_MISMATCH  kit.init never called, or for another slug
//   STORE_SKU_UNKNOWN                 game code buys or checks a SKU the config lacks
//   POLLING_LOOP                      a timer or frame loop refreshes or reads the chain
//   DIRECT_CHAIN_READ                 game code reads the chain itself (spec §10: zero)
//   MULTICALL_MISSING                 a viem client without batch.multicall
//   HARDCODED_ADDRESS                 a 0x address literal in game code or config
//   WSNET_IN_UI                       game code mentions wsNET (spec §6.2)
// Warnings:
//   EARN_RULE_UNUSED, STORE_EMPTY
// Notes (never fail): REWARDS_UNVERIFIED, printed for every integration.

import { CONFIG_FILE, type KitProjectConfig } from "../config.js";
import { GEN_START } from "./templates.js";
import { detectProject, hasKitDependency, HTML_HOSTED, lineOf, listSourceFiles, loadConfig, readText } from "./project.js";

export type Severity = "error" | "warn";

export interface Finding {
  code: string;
  severity: Severity;
  message: string;
  fix: string;
  file?: string;
  line?: number;
}

export interface DoctorReport {
  ok: boolean;
  framework: string;
  game: string | null;
  findings: Finding[];
  /** Checks that ran and passed, by name. */
  passed: string[];
  /** Earn events the game code reports. */
  earnEvents: string[];
  /** Plain facts the creator should know; never a failure. */
  notes: string[];
}

/**
 * Ruled 2026-10-20: the referee can replay only games built on the NetNet
 * engine. A Kit game on its own engine or server is unverified, and the
 * referee decides that on its side; nothing in this project can change it.
 */
export const REWARDS_UNVERIFIED_NOTE =
  "Rewards need a verified build. NetNet's referee replays every run only for games built on the NetNet engine. A game not built through Net Forge earns no reward-pool tokens once its token is live. Its token still trades and the creator fee is unchanged. Coins before launch, the store, spends and cosmetics all still work.";

interface Source {
  file: string;
  text: string;
  bootstrap: boolean;
}

const EARN_CALLS: RegExp[] = [
  /\bearn\(\s*["'`]([A-Za-z0-9_-]+)["'`]/g,
  /\bnetnetEarn\(\s*["'`]([A-Za-z0-9_-]+)["'`]/g,
  /netnetEarn\(\s*\\?["']([A-Za-z0-9_-]+)\\?["']/g,
  /\.(?:earn|rewards)\.report\(\s*\{[^}]*?\bevent\s*:\s*["'`]([A-Za-z0-9_-]+)["'`]/gs,
];
const SKU_CALLS = /\bstore\.(?:buy|owns|count|get)\(\s*["'`]([A-Za-z0-9_-]+)["'`]/g;
const CHAIN_READ = /\bcreatePublicClient\s*\(|\.readContract\s*\(|new\s+ethers\.|\bJsonRpcProvider\s*\(|["']eth_(?:call|getBalance|blockNumber|getLogs)["']|\bweb3\.eth\./g;
const LOOP_STARTERS = /\b(setInterval|setTimeout|requestAnimationFrame)\s*\(/g;
const LOOP_FORBIDDEN = /\bkit\.(?:refresh|init)\s*\(|\bstartKit\s*\(|\.refresh\s*\(\s*\)|readContract|\.multicall\s*\(|eth_(?:call|getBalance|blockNumber)|\bgetBalance\s*\(|\bgetBlockNumber\s*\(/;
const ADDRESS = /\b0x[0-9a-fA-F]{40}\b/g;
const WSNET = /\bws\s?NET\b/gi;

/** Text inside the parens that open at `open` (index of "("). */
function balanced(text: string, open: number, o = "(", c = ")"): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === o) depth++;
    else if (ch === c && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

/** Body of a named function (declaration or const arrow), for timer callbacks passed by name. */
function functionBody(text: string, name: string): string | null {
  const decl = new RegExp(`(?:function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=|\\b${name}\\s*\\([^)]*\\)\\s*\\{)`).exec(text);
  if (!decl) return null;
  const brace = text.indexOf("{", decl.index);
  return brace < 0 ? null : balanced(text, brace, "{", "}");
}

export function runDoctor(rootIn: string): DoctorReport {
  const project = detectProject(rootIn);
  const root = project.root;
  const findings: Finding[] = [];
  const passed: string[] = [];
  const add = (f: Finding) => findings.push(f);

  // 1. Config.
  const loaded = loadConfig(root);
  let config: KitProjectConfig | null = loaded.config;
  if (!loaded.exists) add({ code: "CONFIG_MISSING", severity: "error", message: `${CONFIG_FILE} not found.`, fix: "Run: npx @netnetcapital/kit add" });
  else if (!config) for (const p of loaded.problems) add({ code: "CONFIG_INVALID", severity: "error", file: CONFIG_FILE, message: p, fix: `Correct ${CONFIG_FILE}; see llms.txt "Config".` });
  else passed.push("config");

  if (config) {
    if (config.earn.length === 0) add({ code: "EARN_RULE_MISSING", severity: "error", file: CONFIG_FILE, message: "No earn rule. Every game must pay its own token for play.", fix: "Run: npx @netnetcapital/kit add-earn <id> --label \"...\" (e.g. wave_cleared)." });
    else passed.push("earn rule present");
    if (config.store.length === 0) add({ code: "STORE_EMPTY", severity: "warn", file: CONFIG_FILE, message: "No store items.", fix: "Optional: npx @netnetcapital/kit add-item <id> --label \"...\" --usdg 0.50" });
  }

  // 2. Sources.
  const sources: Source[] = listSourceFiles(root).map((file) => {
    const text = readText(root, file);
    return { file, text, bootstrap: text.includes(GEN_START) };
  });
  const game = sources.filter((s) => !s.bootstrap);

  // 3. Installed and loaded.
  if (HTML_HOSTED.has(project.framework)) {
    const loads = sources.some((s) => /\.html?$/.test(s.file) && /netnet\.js|@netnetcapital\/kit/.test(s.text));
    if (!loads) add({ code: "KIT_NOT_LOADED", severity: "error", file: project.html ?? "index.html", message: "The page never loads the Kit.", fix: 'Add <script type="module" src="./netnet.js"></script> to the page (kit add does this).' });
    else passed.push("kit loaded");
  } else {
    if (!hasKitDependency(project.pkg)) add({ code: "KIT_NOT_INSTALLED", severity: "error", file: "package.json", message: "@netnetcapital/kit is not a dependency.", fix: "Run: npx @netnetcapital/kit add (or add the dependency and install)." });
    else passed.push("kit installed");
  }

  // 4. init.
  const inits = sources.flatMap((s) => [...s.text.matchAll(/\bkit\.init\s*\(/g)].map((m) => ({ s, i: m.index ?? 0 })));
  if (inits.length === 0) add({ code: "INIT_MISSING", severity: "error", message: "kit.init is never called.", fix: "Call startKit() from the bootstrap once when the game opens (kit add wires this)." });
  else {
    passed.push("kit.init called");
    if (config) {
      const slugs: Array<{ slug: string; file: string; line: number }> = [];
      for (const s of sources) {
        if (s.bootstrap) {
          for (const m of s.text.matchAll(/\bGAME\s*=\s*["'`]([^"'`]+)["'`]/g)) slugs.push({ slug: m[1] ?? "", file: s.file, line: lineOf(s.text, m.index ?? 0) });
        }
        for (const m of s.text.matchAll(/\bkit\.init\s*\(/g)) {
          const block = balanced(s.text, (m.index ?? 0) + m[0].length - 1);
          const g = /\bgame\s*:\s*["'`]([^"'`]+)["'`]/.exec(block);
          if (g) slugs.push({ slug: g[1] ?? "", file: s.file, line: lineOf(s.text, m.index ?? 0) });
        }
      }
      for (const x of slugs) {
        if (x.slug !== config.game) add({ code: "INIT_GAME_MISMATCH", severity: "error", file: x.file, line: x.line, message: `The Kit starts for "${x.slug}" but ${CONFIG_FILE} says "${config.game}".`, fix: "Run: npx @netnetcapital/kit sync, and pass GAME from the bootstrap to kit.init." });
      }
    }
  }

  // 5. Earn wired (mandatory).
  const events = new Map<string, { file: string; line: number }>();
  for (const s of game) {
    for (const re of EARN_CALLS) {
      for (const m of s.text.matchAll(re)) {
        if (m[1] && !events.has(m[1])) events.set(m[1], { file: s.file, line: lineOf(s.text, m.index ?? 0) });
      }
    }
  }
  if (events.size === 0) {
    const first = config?.earn[0]?.id ?? "level_complete";
    const how = HTML_HOSTED.has(project.framework) ? `netnetEarn("${first}")` : `earn("${first}") (import { earn } from "./netnet")`;
    add({ code: "EARN_NOT_WIRED", severity: "error", message: "No game code reports an earn event. Earning is mandatory.", fix: `Call ${how} at the moment the player earns it.` });
  } else {
    passed.push("earn wired");
    if (config) {
      const known = new Set(config.earn.map((e) => e.id));
      for (const [ev, at] of events) {
        if (!known.has(ev)) add({ code: "EARN_EVENT_UNKNOWN", severity: "error", file: at.file, line: at.line, message: `Earn event "${ev}" is not in ${CONFIG_FILE}.`, fix: `Run: npx @netnetcapital/kit add-earn ${ev} --label "..."` });
      }
      for (const rule of config.earn) {
        if (!events.has(rule.id)) add({ code: "EARN_RULE_UNUSED", severity: "warn", file: CONFIG_FILE, message: `Earn rule "${rule.id}" is never reported by game code.`, fix: `Call earn("${rule.id}") where it happens, or remove the rule.` });
      }
    }
  }

  // 6. SKUs.
  if (config) {
    const skus = new Set(config.store.map((s) => s.id));
    for (const s of game) {
      for (const m of s.text.matchAll(SKU_CALLS)) {
        if (m[1] && !skus.has(m[1])) add({ code: "STORE_SKU_UNKNOWN", severity: "error", file: s.file, line: lineOf(s.text, m.index ?? 0), message: `Store item "${m[1]}" is not in ${CONFIG_FILE}.`, fix: `Run: npx @netnetcapital/kit add-item ${m[1]} --label "..." --usdg 0.50` });
      }
    }
  }

  // 7. No polling.
  let loops = 0;
  for (const s of sources) {
    for (const m of s.text.matchAll(LOOP_STARTERS)) {
      const open = (m.index ?? 0) + m[0].length - 1;
      const args = balanced(s.text, open);
      const named = /^\(\s*([A-Za-z_$][\w$]*)\s*[,)]/.exec(args)?.[1];
      const body = named ? functionBody(s.text, named) ?? "" : args;
      if (LOOP_FORBIDDEN.test(body)) {
        loops++;
        add({ code: "POLLING_LOOP", severity: "error", file: s.file, line: lineOf(s.text, m.index ?? 0), message: `${m[1]} refreshes the Kit or reads the chain on a timer.`, fix: "Remove it. Kit getters are free every frame; the Kit refreshes itself after the player's own transactions." });
      }
    }
  }
  if (loops === 0) passed.push("no polling loops");

  // 8. No direct chain reads; Multicall when a client exists.
  let reads = 0;
  for (const s of game) {
    for (const m of s.text.matchAll(CHAIN_READ)) {
      reads++;
      add({ code: "DIRECT_CHAIN_READ", severity: "error", file: s.file, line: lineOf(s.text, m.index ?? 0), message: `Game code reads the chain directly (${m[0].trim()}).`, fix: "Read kit.getState() / kit.coins / kit.store instead: one Multicall3 snapshot already covers balances, items and price." });
      if (/createPublicClient/.test(m[0])) {
        const block = balanced(s.text, s.text.indexOf("(", m.index ?? 0));
        if (!/multicall/.test(block)) add({ code: "MULTICALL_MISSING", severity: "error", file: s.file, line: lineOf(s.text, m.index ?? 0), message: "A viem client is built without batch.multicall.", fix: "Use the Kit's snapshot, or set batch: { multicall: true } with chain.contracts.multicall3." });
      }
    }
  }
  if (reads === 0) passed.push("reads go through the Kit's one Multicall3 snapshot");

  // 9. No hardcoded addresses.
  let addrs = 0;
  const addrSources = [...sources, ...(loaded.exists ? [{ file: CONFIG_FILE, text: readText(root, CONFIG_FILE), bootstrap: false }] : [])];
  for (const s of addrSources) {
    for (const m of s.text.matchAll(ADDRESS)) {
      addrs++;
      add({ code: "HARDCODED_ADDRESS", severity: "error", file: s.file, line: lineOf(s.text, m.index ?? 0), message: `Hardcoded address ${m[0].slice(0, 10)}...`, fix: "Delete it. The Kit resolves every contract from the game slug and the NetNet registry." });
    }
  }
  if (addrs === 0) passed.push("no hardcoded addresses");

  // 10. wsNET never reaches the player.
  let ws = 0;
  for (const s of addrSources) {
    for (const m of s.text.matchAll(WSNET)) {
      ws++;
      add({ code: "WSNET_IN_UI", severity: "error", file: s.file, line: lineOf(s.text, m.index ?? 0), message: "Game code mentions wsNET. Players see only dollars and the game's coins.", fix: "Remove it. Show prices with kit.token.priceUsd() and kit.format.usd()." });
    }
  }
  if (ws === 0) passed.push("no wsNET in game code");

  return {
    ok: findings.every((f) => f.severity !== "error"),
    framework: project.framework,
    game: config?.game ?? null,
    findings,
    passed,
    earnEvents: [...events.keys()],
    notes: [REWARDS_UNVERIFIED_NOTE],
  };
}

export function formatReport(r: DoctorReport): string {
  const errors = r.findings.filter((f) => f.severity === "error").length;
  const warns = r.findings.length - errors;
  const lines = [`kit doctor (${r.framework}${r.game ? `, game "${r.game}"` : ""}): ${r.ok ? "PASS" : "FAIL"}, ${errors} error${errors === 1 ? "" : "s"}, ${warns} warning${warns === 1 ? "" : "s"}`];
  for (const f of r.findings) {
    const where = f.file ? ` ${f.file}${f.line ? `:${f.line}` : ""}` : "";
    lines.push(`${f.severity === "error" ? "ERROR" : "WARN "} ${f.code}${where}`);
    lines.push(`      ${f.message}`);
    lines.push(`      fix: ${f.fix}`);
  }
  for (const p of r.passed) lines.push(`ok    ${p}`);
  for (const n of r.notes) lines.push(`note  ${n}`);
  return lines.join("\n");
}
