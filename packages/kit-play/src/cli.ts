#!/usr/bin/env node
// kit-play [dir] [--port 4663] [--host 127.0.0.1] [--players 1] [--no-open] [--library-url <url>]
// Also reached as `kit play` through @netnetcapital/kit.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

const isMain = (() => {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  const code = await runPlayCli(process.argv.slice(2), { out: (s) => console.log(s), err: (s) => console.error(s), cwd: process.cwd() });
  process.exit(code);
}
