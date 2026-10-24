// create-netforge: make a new Net Forge game folder, install it, and print
// the next command. Interactive in a terminal; with flags (or with no
// terminal, as when a coding agent runs it) it asks nothing.

import { spawn } from "node:child_process";
import { basename, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { ArgError, detectPackageManager, parseArgs, runScript, shellArg, type CreateArgs, type PackageManager } from "./args.js";
import { findStarter, STARTERS, type Starter } from "./catalog.js";
import { DOCS_URL } from "./docs.js";
import { checkName, dependencies, NameError, packageName } from "./project.js";
import { scaffold, unknownTemplate } from "./scaffold.js";
import { selfVersion, versions } from "./starters.js";
import { checkDirectory, checkTarget, FolderError } from "./write.js";

export const DEFAULT_TEMPLATE = "survivor";
export const DEFAULT_DIR = "my-game";

export interface RunOptions {
  readonly cwd: string;
  /** Print to stdout (true) or to stderr (false: --json keeps stdout for the summary). */
  readonly toStdout: boolean;
  /** Hide the command's output (a probe such as git rev-parse). */
  readonly quiet?: boolean;
}

export interface CreateIo {
  out(s: string): void;
  err(s: string): void;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** True when a person is at a terminal: questions may be asked. */
  readonly interactive: boolean;
  /** Asks one question and returns the answer (only called when interactive). */
  ask(question: string): Promise<string>;
  /** Runs a command; resolves its exit code, or -1 when it could not start. */
  run(cmd: string, args: readonly string[], o: RunOptions): Promise<number>;
  /** The command name shown in help ("create-netforge" or "kit-play new"). */
  readonly command?: string;
}

export function helpText(command = "create-netforge"): string {
  return `${command}: start a Net Forge game.

Usage: ${command} [folder] [options]

      --dir <folder>    The folder to make (the same as giving it first).
  -t, --template <id>   The template to start from (${STARTERS.map((t) => t.id).join(", ")}).
  -y, --yes             Ask nothing: take the defaults (${DEFAULT_DIR}, ${DEFAULT_TEMPLATE}) for anything not given.
      --pm <name>       npm, pnpm, yarn or bun (default: the one running this command).
      --no-install      Write the files only.
      --no-git          Do not make a git repository.
      --agent <list>    Agent files besides AGENTS.md and .mcp.json: claude, cursor, copilot,
                        all (the default) or none. Comma separated for more than one.
      --list            List the templates (add --json for JSON).
      --json            Print a JSON summary on stdout when done (logs go to stderr).
  -h, --help            This help.
  -v, --version         The version.

Examples:
  npm create netforge@latest my-game
  npm create netforge@latest my-game -- --template survivor --yes
  npx create-netforge my-game --template cards --yes
  npx create-netforge --list --json

With no terminal (CI, a coding agent) it never asks: a missing folder is ${DEFAULT_DIR}
and a missing template is ${DEFAULT_TEMPLATE}.`;
}

/** The templates as a table for people, or as JSON. */
export function listTemplates(json: boolean): string {
  if (json) return JSON.stringify(STARTERS.map((t) => ({ id: t.id, title: t.title, genre: t.genre, players: t.seats, package: t.pkg, description: t.line })), null, 2);
  const w = Math.max(...STARTERS.map((t) => t.id.length));
  return STARTERS.map((t) => `  ${t.id.padEnd(w)}  ${t.genre} (${t.title}, up to ${t.seats} players). ${t.line}`).join("\n");
}

const badTemplate = unknownTemplate;

async function pickTemplate(io: CreateIo): Promise<Starter> {
  io.out("Which template?");
  const w = Math.max(...STARTERS.map((t) => t.id.length));
  STARTERS.forEach((t, i) => io.out(`  ${String(i + 1).padStart(2)}  ${t.id.padEnd(w)}  ${t.genre}: ${t.line}`));
  for (;;) {
    const a = (await io.ask(`Pick a number or a name [1 ${STARTERS[0]?.id}]: `)).trim();
    if (a === "") return STARTERS[0] as Starter;
    const n = Number(a);
    const byNumber = Number.isInteger(n) ? STARTERS[n - 1] : undefined;
    const t = byNumber ?? findStarter(a);
    if (t) return t;
    io.out(badTemplate(a).message);
  }
}

interface Target {
  readonly dir: string;
  readonly shown: string;
  readonly name: string;
}

function target(io: CreateIo, typed: string, starter: Starter): Target {
  checkDirectory(typed);
  const dir = resolve(io.cwd, typed);
  const shown = relative(io.cwd, dir) || ".";
  const name = packageName(basename(dir));
  checkName(name, dependencies(starter, versions()));
  checkTarget(dir, shown);
  return { dir, shown, name };
}

async function pickTarget(io: CreateIo, args: CreateArgs, starter: Starter): Promise<Target> {
  if (args.dir !== null || !io.interactive || args.yes) return target(io, args.dir ?? DEFAULT_DIR, starter);
  for (;;) {
    const a = (await io.ask(`Project name [${DEFAULT_DIR}]: `)).trim() || DEFAULT_DIR;
    try {
      return target(io, a, starter);
    } catch (e) {
      if (e instanceof NameError || e instanceof FolderError) io.out(e.message);
      else throw e;
    }
  }
}

export interface Created {
  readonly dir: string;
  readonly name: string;
  readonly template: string;
  readonly pm: PackageManager;
  readonly installed: boolean;
  readonly git: boolean;
  /** Every file written, relative to dir. */
  readonly files: readonly string[];
  /** The commands to run next, in order. */
  readonly next: readonly string[];
  /** Where the play command serves the game. */
  readonly url: string;
  readonly docs: string;
}

/** Runs create-netforge with these arguments. Resolves the exit code. */
export async function runCreate(argv: readonly string[], io: CreateIo): Promise<number> {
  let args: CreateArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    io.err(e instanceof Error ? e.message : String(e));
    return 2;
  }
  if (args.help) {
    io.out(helpText(io.command));
    return 0;
  }
  if (args.version) {
    io.out(selfVersion());
    return 0;
  }
  if (args.list) {
    io.out(listTemplates(args.json));
    return 0;
  }
  const log = args.json ? io.err.bind(io) : io.out.bind(io);
  const interactive = io.interactive && !args.yes;
  try {
    let starter: Starter;
    // `npm create netforge my-game --template x` without the "--" hands --template to npm, which passes it on as npm_config_template.
    const asked = args.template ?? (io.env.npm_config_template || null);
    if (asked !== null) {
      const t = findStarter(asked);
      if (!t) throw badTemplate(asked);
      starter = t;
    } else if (interactive) starter = await pickTemplate({ ...io, out: log });
    else {
      starter = findStarter(DEFAULT_TEMPLATE) as Starter;
      log(`No --template given: using ${starter.id} (${starter.genre}). Run with --list to see the others.`);
    }
    const t = await pickTarget({ ...io, out: log, interactive }, args, starter);
    const pm = args.pm ?? detectPackageManager(io.env.npm_config_user_agent);

    const made = await scaffold({ template: starter.id, directory: t.dir, name: t.name, pm, agents: args.agents });
    const files = made.files;
    log(`Made ${t.shown}: ${starter.title}, the ${starter.genre} template.`);

    let git = false;
    if (args.git) git = await initGit(io, t.dir, log, args.json);

    let installed = false;
    if (args.install) {
      log(`Installing with ${pm} (${pm} install)...`);
      const code = await io.run(pm, ["install"], { cwd: t.dir, toStdout: !args.json });
      if (code === -1) log(`Could not start ${pm}. Is it installed? Install by hand: cd ${shellArg(t.shown)} && ${pm} install`);
      else if (code !== 0) {
        io.err(`${pm} install failed (exit ${code}). The files are in ${t.shown}; fix the problem above, then run: cd ${shellArg(t.shown)} && ${pm} install`);
        return 1;
      } else installed = true;
    }

    const next = [...(t.shown === "." ? [] : [`cd ${shellArg(t.shown)}`]), ...(installed ? [] : [`${pm} install`]), runScript(pm, "play")];
    log("");
    log("Next:");
    for (const n of next) log(`  ${n}`);
    log("");
    log(`It opens http://127.0.0.1:4663. Open the same link in another tab for a second player (up to ${starter.seats}).`);
    log(`The rules live in src/game.ts. Check a change with ${runScript(pm, "test")}, then play again. AGENTS.md is the guide for coding agents.`);
    log(`Docs: ${DOCS_URL}`);
    if (args.json) {
      const summary: Created = { dir: t.dir, name: t.name, template: starter.id, pm, installed, git, files, next, url: "http://127.0.0.1:4663", docs: DOCS_URL };
      io.out(JSON.stringify(summary, null, 2));
    }
    return 0;
  } catch (e) {
    if (e instanceof ArgError || e instanceof NameError || e instanceof FolderError) {
      io.err(e.message);
      return 2;
    }
    io.err(e instanceof Error ? (e.stack ?? e.message) : String(e));
    return 1;
  }
}

/** git init and a first commit, unless the folder is already inside a repository or git is missing. */
async function initGit(io: CreateIo, dir: string, log: (s: string) => void, json: boolean): Promise<boolean> {
  const inside = await io.run("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir, toStdout: false, quiet: true });
  if (inside === -1) return false;
  if (inside === 0) {
    log("The folder is inside a git repository already, so no new one was made.");
    return false;
  }
  const q = { cwd: dir, toStdout: !json, quiet: true };
  if ((await io.run("git", ["init", "-q"], q)) !== 0) return false;
  await io.run("git", ["add", "-A"], q);
  // A machine with no git identity still gets the repository, just no first commit.
  const committed = await io.run("git", ["commit", "-q", "-m", "Start a Net Forge game"], q);
  log(committed === 0 ? "Made a git repository with a first commit." : "Made a git repository (no commit: set git user.name and user.email to commit).");
  return true;
}

/**
 * Windows runs npm, pnpm, yarn and bun from .cmd shims, which only a shell
 * starts. git is a real executable, and it gets the commit message (which
 * has spaces) as one argument only without a shell.
 */
export function needsShell(cmd: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" && cmd !== "git";
}

/** The one command line a shell runs: fixed words only, never a value that came from outside. */
export function shellCommand(cmd: string, args: readonly string[]): string {
  for (const w of [cmd, ...args]) if (!/^[A-Za-z0-9._-]+$/.test(w)) throw new Error(`refusing to pass ${JSON.stringify(w)} through a shell`);
  return [cmd, ...args].join(" ");
}

/** The real terminal, processes and environment. */
export function nodeIo(command?: string): CreateIo {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.CI;
  let rl: ReturnType<typeof createInterface> | null = null;
  return {
    out: (s) => console.log(s),
    err: (s) => console.error(s),
    cwd: process.cwd(),
    env: process.env,
    interactive,
    ...(command ? { command } : {}),
    async ask(q) {
      rl ??= createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(q);
      } catch {
        // Ctrl+D or Ctrl+C at a question.
        process.exit(130);
      }
    },
    run(cmd, args, o) {
      if (rl) {
        rl.close();
        rl = null;
      }
      return new Promise((done) => {
        const out = o.quiet ? "ignore" : o.toStdout ? "inherit" : process.stderr;
        const stdio = ["ignore", out, o.quiet ? "ignore" : out === "inherit" ? "inherit" : process.stderr] as const;
        const shell = needsShell(cmd, process.platform);
        // A shell joins its arguments unquoted, so only fixed words ever go through one (shellCommand refuses anything else).
        const child = shell ? spawn(shellCommand(cmd, args), { cwd: o.cwd, stdio: [...stdio], shell: true }) : spawn(cmd, args, { cwd: o.cwd, stdio: [...stdio] });
        child.once("error", () => done(-1));
        child.once("close", (code) => done(code ?? 1));
      });
    },
  };
}
