#!/usr/bin/env node
// npx @netforge/kit <command>
//
//   add [dir]        wire the Kit into an existing game (config, bootstrap, 2 lines in the entry)
//   init [dir]       write netnet.config.json only
//   doctor [dir]     lint the integration (exit 1 on any error)
//   sync [dir]       rewrite the bootstrap's generated block from the config
//   add-item <id>    add or update a store item
//   add-earn <id>    add or update an earn rule
//   guide [topic]    print llms-full.txt (or one section)
//   mcp              run the MCP server on stdio
//   play [dir]       run a Net Forge game on this computer with play money (@netforge/kit-play)

import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { KIT_VERSION } from "../version.js";
import { addEarnEvent, addKit, addStoreItem, CliError, initConfig, syncBootstrap, type Change } from "./add.js";
import { formatReport, runDoctor } from "./doctor.js";
import { guideSection } from "./guide.js";
import type { Framework } from "./project.js";

export interface CliIo {
  out(s: string): void;
  err(s: string): void;
  cwd: string;
}

interface Parsed {
  command: string;
  positional: string[];
  flags: Record<string, string | true>;
}

function parse(argv: string[]): Parsed {
  const [command = "help", ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] ?? "";
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2) as [string, string | undefined];
      if (v !== undefined) flags[k] = v;
      else if (rest[i + 1] !== undefined && !rest[i + 1]!.startsWith("--")) flags[k] = rest[++i]!;
      else flags[k] = true;
    } else positional.push(a);
  }
  return { command, positional, flags };
}

const str = (v: string | true | undefined): string | undefined => (typeof v === "string" ? v : undefined);

const HELP = `@netforge/kit ${KIT_VERSION}

Usage: npx @netforge/kit <command> [dir] [flags]

  add [dir]          Wire the Kit into an existing game.
                     --game <slug> --earn <id> --framework <plain-html|vite|react|phaser|three|bundler|godot|unity|emscripten> --entry <file>
  init [dir]         Write netnet.config.json only. --game <slug> --earn <id>
  doctor [dir]       Check the integration. --json for machine output. Exit 1 on errors.
  sync [dir]         Rewrite the bootstrap's generated block from netnet.config.json.
  add-item <id>      Add a store item. --label "..." --usdg 0.50 --token 10 --kind consumable|permanent|pass --duration <seconds> --dir <dir>
  add-earn <id>      Add an earn rule. --label "..." --description "..." --dir <dir>
  guide [topic]      Print the agent guide (llms-full.txt), or one section.
  mcp                Run the MCP server on stdio.
  play [dir]         Run a game downloaded from Net Forge on this computer, with play money
                     (needs @netforge/kit-play; kit play --help for its flags).

Agents: read llms.txt first. Every game must report at least one earn event.`;

function printChanges(io: CliIo, changes: Change[]): void {
  for (const c of changes) io.out(`  ${c.action.padEnd(9)} ${c.file}  (${c.note})`);
}

/**
 * `kit play` lives in @netforge/kit-play (the engine, the templates and
 * a local room host are far more than the Kit needs), found from the game
 * folder: a downloaded game's package.json lists it.
 */
async function runPlay(argv: string[], io: CliIo): Promise<number> {
  const dir = argv[0] !== undefined && !argv[0].startsWith("-") ? resolve(io.cwd, argv[0]) : io.cwd;
  let entry: string | null = null;
  for (const base of [dir, io.cwd]) {
    try {
      entry = createRequire(join(base, "package.json")).resolve("@netforge/kit-play");
      break;
    } catch {
      // next
    }
  }
  if (!entry) {
    io.err("kit play needs @netforge/kit-play. In your game's folder run: npm install (its package.json lists it), or npx @netforge/kit-play");
    return 1;
  }
  const mod = (await import(pathToFileURL(entry).href)) as { runPlayCli(argv: readonly string[], io: CliIo): Promise<number> };
  return mod.runPlayCli(argv, io);
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const { command, positional, flags } = parse(argv);
  const json = flags["json"] === true;
  const dirArg = (i: number) => resolve(io.cwd, str(flags["dir"]) ?? positional[i] ?? ".");
  try {
    switch (command) {
      case "add": {
        const r = addKit(dirArg(0), {
          ...(str(flags["game"]) ? { game: str(flags["game"]) } : {}),
          ...(str(flags["earn"]) ? { earn: str(flags["earn"]) } : {}),
          ...(str(flags["name"]) ? { name: str(flags["name"]) } : {}),
          ...(str(flags["entry"]) ? { entry: str(flags["entry"]) } : {}),
          ...(str(flags["framework"]) ? { framework: str(flags["framework"]) as Framework } : {}),
        });
        if (json) io.out(JSON.stringify(r, null, 2));
        else {
          io.out(`Kit added (${r.framework}, game "${r.game}"):`);
          printChanges(io, r.changes);
          io.out("\nNext steps:");
          r.nextSteps.forEach((s, i) => io.out(`  ${i + 1}. ${s}`));
        }
        return 0;
      }
      case "init": {
        const { config, change } = initConfig(dirArg(0), {
          ...(str(flags["game"]) ? { game: str(flags["game"]) } : {}),
          ...(str(flags["earn"]) ? { earn: str(flags["earn"]) } : {}),
        });
        if (json) io.out(JSON.stringify({ config, change }, null, 2));
        else printChanges(io, [change]);
        return 0;
      }
      case "doctor": {
        const r = runDoctor(dirArg(0));
        io.out(json ? JSON.stringify(r, null, 2) : formatReport(r));
        return r.ok ? 0 : 1;
      }
      case "sync": {
        const c = syncBootstrap(dirArg(0));
        printChanges(io, [c]);
        return 0;
      }
      case "add-item": {
        const id = positional[0];
        if (!id) throw new CliError("USAGE", "add-item needs an id.", 'npx @netforge/kit add-item revive --label "Revive" --usdg 0.25');
        const kind = str(flags["kind"]);
        const r = addStoreItem(resolve(io.cwd, str(flags["dir"]) ?? "."), {
          id,
          label: str(flags["label"]) ?? id,
          ...(kind === "permanent" || kind === "consumable" || kind === "pass" ? { kind } : {}),
          ...(str(flags["duration"]) ? { duration: Number(str(flags["duration"])) } : {}),
          ...(str(flags["usdg"]) ? { priceUsdg: str(flags["usdg"]) } : {}),
          ...(str(flags["token"]) ? { priceToken: str(flags["token"]) } : {}),
        });
        printChanges(io, r.changes);
        io.out(`\nUse it:\n${r.snippet}`);
        return 0;
      }
      case "add-earn": {
        const id = positional[0];
        if (!id) throw new CliError("USAGE", "add-earn needs an id.", 'npx @netforge/kit add-earn wave_cleared --label "Clear a wave"');
        const r = addEarnEvent(resolve(io.cwd, str(flags["dir"]) ?? "."), {
          id,
          label: str(flags["label"]) ?? id,
          ...(str(flags["description"]) ? { description: str(flags["description"]) } : {}),
        });
        printChanges(io, r.changes);
        io.out(`\nCall it where the player earns it:\n${r.snippet}`);
        return 0;
      }
      case "guide":
        io.out(guideSection(positional[0]));
        return 0;
      case "mcp": {
        const { startStdioServer } = await import("../mcp/server.js");
        await startStdioServer();
        return 0;
      }
      case "play":
        return await runPlay(argv.slice(1), io);
      case "version":
      case "--version":
        io.out(KIT_VERSION);
        return 0;
      case "help":
      case "--help":
      case "-h":
        io.out(HELP);
        return 0;
      default:
        io.err(`Unknown command "${command}".\n\n${HELP}`);
        return 2;
    }
  } catch (err) {
    if (err instanceof CliError) {
      io.err(`[${err.code}] ${err.message}\nfix: ${err.fix}`);
      return 1;
    }
    throw err;
  }
}

function isMain(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  runCli(process.argv.slice(2), { out: (s) => console.log(s), err: (s) => console.error(s), cwd: process.cwd() }).then(
    (code) => {
      if (code !== 0 || process.argv[2] !== "mcp") process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    },
  );
}
