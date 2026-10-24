// Command line arguments for create-netforge (and `kit-play new`).

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
export const PACKAGE_MANAGERS: readonly PackageManager[] = ["npm", "pnpm", "yarn", "bun"];

/** The coding agents a new game carries instruction files for (AGENTS.md is always written). */
export type Agent = "claude" | "cursor" | "copilot";
export const AGENTS: readonly Agent[] = ["claude", "cursor", "copilot"];

export interface CreateArgs {
  /** The folder to make, as typed. */
  readonly dir: string | null;
  readonly template: string | null;
  /** Take the default for every question not answered by a flag. */
  readonly yes: boolean;
  readonly pm: PackageManager | null;
  readonly install: boolean;
  readonly git: boolean;
  /** Agent files to write besides AGENTS.md and .mcp.json (--agent; every one by default, none with --agent none). */
  readonly agents: readonly Agent[];
  /** List the templates instead of making a game. */
  readonly list: boolean;
  /** Machine-readable output (with --list, or a summary after making a game). */
  readonly json: boolean;
  readonly help: boolean;
  readonly version: boolean;
}

export class ArgError extends Error {}

const VALUE_FLAGS = new Set(["template", "pm", "agent", "dir"]);
const BOOL_FLAGS = new Set(["yes", "no-install", "no-git", "list", "json", "help", "version", "install", "git"]);
const SHORT: Readonly<Record<string, string>> = { t: "template", y: "yes", h: "help", v: "version" };

export function parseArgs(argv: readonly string[]): CreateArgs {
  const values = new Map<string, string>();
  const agentValues: string[] = [];
  const bools = new Set<string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "-" || !a.startsWith("-")) {
      positional.push(a);
      continue;
    }
    // npm 7+ needs "--" before a create package's flags (npm create netforge my-game -- --template x),
    // and some ways of running it pass the "--" through: it is skipped, never a separator.
    if (a === "--") continue;
    let key: string;
    let inline: string | undefined;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      key = eq >= 0 ? a.slice(2, eq) : a.slice(2);
      inline = eq >= 0 ? a.slice(eq + 1) : undefined;
    } else {
      const k = SHORT[a.slice(1)];
      if (!k) throw new ArgError(`Unknown option ${a}. Run with --help for the options.`);
      key = k;
    }
    if (VALUE_FLAGS.has(key)) {
      const v = inline ?? argv[i + 1];
      if (v === undefined || (inline === undefined && v.startsWith("-"))) throw new ArgError(`--${key} needs a value.`);
      if (inline === undefined) i++;
      if (key === "agent") agentValues.push(...v.split(","));
      else values.set(key, v);
    } else if (BOOL_FLAGS.has(key)) {
      if (inline !== undefined) throw new ArgError(`--${key} takes no value.`);
      bools.add(key);
    } else {
      throw new ArgError(`Unknown option --${key}. Run with --help for the options.`);
    }
  }
  const dirFlag = values.get("dir");
  if (dirFlag !== undefined) {
    if (positional.length > 0 && positional[0] !== dirFlag) throw new ArgError(`Give the folder once: either ${positional[0]} or --dir ${dirFlag}.`);
    positional.splice(0, positional.length, dirFlag);
  }
  if (positional.length > 1) throw new ArgError(`Give one folder name, not ${positional.length} (${positional.join(", ")}). Quote a name that has spaces.`);
  const pm = values.get("pm");
  if (pm !== undefined && !(PACKAGE_MANAGERS as readonly string[]).includes(pm)) throw new ArgError(`--pm must be one of ${PACKAGE_MANAGERS.join(", ")}.`);
  const template = values.get("template");
  if (template !== undefined && template.trim() === "") throw new ArgError("--template needs a value.");
  let agents: Agent[] = [...AGENTS];
  if (agentValues.length > 0) {
    const picked = agentValues.map((a) => a.trim().toLowerCase()).filter(Boolean);
    for (const a of picked) if (a !== "none" && a !== "all" && !(AGENTS as readonly string[]).includes(a)) throw new ArgError(`--agent must be ${AGENTS.join(", ")}, all or none (comma separated for more than one), not "${a}".`);
    agents = picked.includes("all") ? [...AGENTS] : AGENTS.filter((a) => picked.includes(a));
  }
  return {
    dir: positional[0] ?? null,
    template: template ?? null,
    yes: bools.has("yes"),
    pm: (pm as PackageManager | undefined) ?? null,
    install: !bools.has("no-install"),
    git: !bools.has("no-git"),
    agents,
    list: bools.has("list"),
    json: bools.has("json"),
    help: bools.has("help"),
    version: bools.has("version"),
  };
}

/** The package manager that ran this command, from npm_config_user_agent ("pnpm/10.0.0 npm/? node/v22 darwin arm64"). */
export function detectPackageManager(userAgent: string | undefined): PackageManager {
  const name = (userAgent ?? "").split(" ")[0]?.split("/")[0] ?? "";
  return (PACKAGE_MANAGERS as readonly string[]).includes(name) ? (name as PackageManager) : "npm";
}

/** How a package manager runs a package.json script. */
export function runScript(pm: PackageManager, script: string): string {
  return pm === "npm" || pm === "bun" ? `${pm} run ${script}` : `${pm} ${script}`;
}

/** A folder for a shell command line: quoted when it has anything a shell would split or expand. */
export function shellArg(s: string): string {
  return /^[A-Za-z0-9_./:\\-]+$/.test(s) ? s : `"${s.replace(/(["$`\\])/g, "\\$1")}"`;
}
