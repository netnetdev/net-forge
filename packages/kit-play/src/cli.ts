#!/usr/bin/env node
// kit-play [play] [dir] [--port 4663] [--host 127.0.0.1] [--players 1] [--no-open] [--library-url <url>]
// kit-play test [dir] [--minutes 1] [--bots n] [--seed 1] [--json]
// kit-play check [dir] ...                          (test --json)
// kit-play new [folder] [--template <id>] ...      (create-netforge)
// kit-play templates [--json]
// `kit play` through @netforge/kit reaches runPlayCli directly.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { listTemplates, nodeIo, runCreate } from "create-netforge";
import { check, summary } from "./check.js";
import { play, PlayError } from "./play.js";

export const HELP = `kit play: run a Net Forge game on this computer with play money.

Usage: kit play [dir] [flags]     (inside the folder you downloaded from Net Forge)

  --port <n>          Port for the page and the local room (default 4663).
  --host <addr>       Interface to listen on (default 127.0.0.1, this computer only).
                      Use 0.0.0.0 to let devices on your network join.
  --players <n>       Browser tabs to open, one per local player (default 1).
  --no-open           Print the link instead of opening a browser.
  --library-url <u>   Load the asset library from this URL instead of the installed copy.

No wallet, no chain, no Net Forge servers: coins are play money and nothing pays out.
kit play runs the game's own code on this computer with your permissions (it is not a
sandbox): play only games whose code you trust.`;

export const COMMANDS_HELP = `kit-play: make, test and play Net Forge games on this computer with play money.

Usage:
  kit-play play [dir] [flags]       Build the game in dir (default: here) and play it. kit-play play --help for flags.
  kit-play test [dir] [flags]       Compile src/game.ts and run the playtest bots, no browser.
  kit-play check [dir] [flags]      The same, with the report as JSON on stdout.
  kit-play new [folder] [flags]     Start a new game from a template (the same as npm create netforge).
  kit-play templates [--json]       List the templates.

kit-play [dir] without a command plays, as before.`;

export const TEST_HELP = `kit-play test: compile src/game.ts as the play build does and run the playtest bots.

Usage: kit-play test [dir] [flags]

  --minutes <n>   Minutes of game time the bots play, at the template's own tick rate (default 1, up to 30).
  --bots <n>      Bots playing (default: 2, or fewer when the template seats fewer).
  --seed <n>      Random seed (default 1).
  --json          Print the result as JSON on stdout.

Exits 0 when the game compiles and every playtest check passes, 1 otherwise.`;

export interface PlayCliIo {
  out(s: string): void;
  err(s: string): void;
  cwd: string;
}

export async function runPlayCli(argv: readonly string[], io: PlayCliIo): Promise<number> {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2) as [string, string | undefined];
      const next = argv[i + 1];
      if (v !== undefined) flags.set(k, v);
      else if (k !== "no-open" && k !== "help" && next !== undefined && !next.startsWith("--")) flags.set(k, argv[++i] ?? "");
      else flags.set(k, true);
    } else if (a === "-h") flags.set("help", true);
    else positional.push(a);
  }
  if (flags.has("help")) {
    io.out(HELP);
    return 0;
  }
  const num = (k: string, d: number, min: number, max: number): number => {
    const v = flags.get(k);
    if (v === undefined) return d;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new PlayError(`--${k} must be a whole number from ${min} to ${max}`);
    return n;
  };
  try {
    const lib = flags.get("library-url");
    if (lib !== undefined && (typeof lib !== "string" || !/^https?:\/\/[^\s]+$/.test(lib))) throw new PlayError("--library-url must be an http(s) URL");
    const host = flags.get("host");
    const playing = await play({
      dir: positional[0] ?? io.cwd,
      port: num("port", 4663, 1, 65535),
      host: typeof host === "string" && host.length > 0 ? host : "127.0.0.1",
      open: !flags.has("no-open"),
      players: num("players", 1, 1, 16),
      libraryUrl: typeof lib === "string" ? lib.replace(/\/$/, "") : null,
      log: io.out,
    });
    await new Promise<void>((done) => {
      const stop = () => {
        void playing.close().finally(done);
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
    return 0;
  } catch (e) {
    io.err(e instanceof PlayError ? e.message : e instanceof Error ? (e.stack ?? e.message) : String(e));
    return 1;
  }
}

/** Splits flags (--k v, --k=v, bare --k when listed in `bare`) from positional arguments. */
function split(argv: readonly string[], bare: ReadonlySet<string>): { flags: Map<string, string | true>; positional: string[] } {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2) as [string, string | undefined];
      const next = argv[i + 1];
      if (v !== undefined) flags.set(k, v);
      else if (!bare.has(k) && next !== undefined && !next.startsWith("--")) flags.set(k, argv[++i] ?? "");
      else flags.set(k, true);
    } else if (a === "-h") flags.set("help", true);
    else positional.push(a);
  }
  return { flags, positional };
}

export async function runTestCli(argv: readonly string[], io: PlayCliIo): Promise<number> {
  const { flags, positional } = split(argv, new Set(["json", "help"]));
  if (flags.has("help")) {
    io.out(TEST_HELP);
    return 0;
  }
  const json = flags.has("json");
  const num = (k: string, d: number, min: number, max: number, whole: boolean): number => {
    const v = flags.get(k);
    if (v === undefined) return d;
    const n = Number(v);
    if (!Number.isFinite(n) || (whole && !Number.isInteger(n)) || n < min || n > max) throw new PlayError(`--${k} must be a ${whole ? "whole " : ""}number from ${min} to ${max}`);
    return n;
  };
  const known = new Set(["json", "help", "minutes", "bots", "seed"]);
  try {
    for (const k of flags.keys()) if (!known.has(k)) throw new PlayError(`unknown flag --${k} (kit-play test --help lists the flags)`);
    const bots = flags.has("bots") ? num("bots", 2, 1, 16, true) : null;
    const r = await check({
      dir: positional[0] ?? io.cwd,
      minutes: num("minutes", 1, 0.1, 30, false),
      bots,
      seed: num("seed", 1, 0, 2 ** 31 - 1, true),
      log: json ? io.err : io.out,
    });
    if (json) io.out(JSON.stringify(r, null, 2));
    else {
      for (const l of summary(r)) io.out(l);
      if (r.ok) io.out("PASS: the game compiles and the playtest checks pass.");
      else {
        io.err("FAIL:");
        for (const p of r.problems) io.err(`  ${p}`);
      }
    }
    return r.ok ? 0 : 1;
  } catch (e) {
    const msg = e instanceof PlayError ? e.message : e instanceof Error ? (e.stack ?? e.message) : String(e);
    if (json) io.out(JSON.stringify({ ok: false, problems: [msg], report: null }, null, 2));
    else io.err(msg);
    return 1;
  }
}

/** The kit-play command: play (the default), test, new and templates. */
export async function runKitPlayCli(argv: readonly string[], io: PlayCliIo): Promise<number> {
  const [first, ...rest] = argv;
  switch (first) {
    case "play":
      return runPlayCli(rest, io);
    case "test":
      return runTestCli(rest, io);
    case "check":
      // test with the report as JSON on stdout: what scripts and coding agents read.
      return runTestCli(rest.includes("--json") ? rest : [...rest, "--json"], io);
    case "new":
    case "create":
      return runCreate(rest, { ...nodeIo("kit-play new"), out: io.out, err: io.err, cwd: io.cwd });
    case "templates":
      if (rest.includes("--help") || rest.includes("-h")) {
        io.out("kit-play templates [--json]: list the templates a new game can start from.");
        return 0;
      }
      io.out(listTemplates(rest.includes("--json")));
      return 0;
    case "help":
      io.out(COMMANDS_HELP);
      return 0;
    case undefined:
      return runPlayCli([], io);
    default:
      if (first === "--help" || first === "-h") {
        io.out(`${COMMANDS_HELP}\n\n${HELP}`);
        return 0;
      }
      return runPlayCli(argv, io);
  }
}

const isMain = (() => {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  const code = await runKitPlayCli(process.argv.slice(2), { out: (s) => console.log(s), err: (s) => console.error(s), cwd: process.cwd() });
  process.exit(code);
}
