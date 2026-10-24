// What a new game folder holds, as a plan of files (relative paths with
// forward slashes, and their text). Nothing here touches the disk, so the
// plan is the same on every system; write.ts turns each path into the
// system's own with path.join.

import { AGENTS, type Agent, type PackageManager } from "./args.js";
import type { Starter } from "./catalog.js";
import { agentGuide, claudeMd, copilotInstructions, cursorRule, readme } from "./docs.js";
import { BASE_PACKAGES, type StarterFiles, type Versions } from "./starters.js";

/** The TypeScript a new game checks its rules with (the version the engine is built with). */
export const TYPESCRIPT_VERSION = "5.8.3";

export interface ProjectOptions {
  /** The package name (packageName of the folder). */
  readonly name: string;
  readonly starter: Starter;
  readonly files: StarterFiles;
  readonly versions: Versions;
  readonly pm: PackageManager;
  /** create-netforge's version, recorded in netnet.json. */
  readonly creator: string;
  /** Agent instruction files to write besides AGENTS.md (default: all). */
  readonly agents?: readonly Agent[];
}

/** The Net Forge MCP server a new game's agents connect to (docs, templates, validation). */
export const MCP_PACKAGE = "@netforge/mcp";

/** VS Code's MCP config: "servers", with the transport named (what `netforge setup agent` writes). */
export function vscodeMcpConfig(): string {
  return JSON.stringify({ servers: { netforge: { type: "stdio", command: "npx", args: ["-y", MCP_PACKAGE] } } }, null, 2) + "\n";
}

/** .mcp.json (Claude Code and others) and .cursor/mcp.json share this shape. */
export function mcpConfig(): string {
  return JSON.stringify({ mcpServers: { netforge: { command: "npx", args: ["-y", MCP_PACKAGE] } } }, null, 2) + "\n";
}

export class NameError extends Error {}

/** A valid npm package name from a folder name: lower case, dashes for anything else, never empty. */
export function packageName(folder: string): string {
  return folder
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._~-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[._~-]+/, "")
    .replace(/[-.]+$/, "")
    .slice(0, 214);
}

/** The packages a new game lists, by name, with their versions. */
export function dependencies(starter: Starter, versions: Versions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of [...BASE_PACKAGES, starter.pkg]) {
    const v = versions[name];
    if (!v) throw new Error(`create-netforge does not know which version of ${name} to install. Reinstall create-netforge.`);
    out[name] = v;
  }
  out.typescript = TYPESCRIPT_VERSION;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** Throws NameError when a package name cannot be used for a new game. */
export function checkName(name: string, deps: Readonly<Record<string, string>>): void {
  if (name.length === 0) throw new NameError("The folder name has no letters or digits to make a package name from. Pick another name.");
  if (!/^[a-z0-9~][a-z0-9._~-]*$/.test(name)) throw new NameError(`"${name}" is not a valid package name. Use lower case letters, digits and dashes.`);
  if (name === "node_modules" || name === "favicon.ico") throw new NameError(`"${name}" is a reserved name. Pick another name.`);
  // npm and pnpm refuse to install a package into a project with the same name.
  const clash = Object.keys(deps).find((d) => d === name || d.split("/")[1] === name) ?? (name === "create-netforge" ? "create-netforge" : undefined);
  if (clash) throw new NameError(`"${name}" is the name of a package this game depends on (${clash}), so it cannot install. Pick another name, such as my-${name}.`);
}

/** Every file of a new game, by relative path. */
export function planProject(o: ProjectOptions): Map<string, string> {
  const deps = dependencies(o.starter, o.versions);
  checkName(o.name, deps);
  const files = new Map<string, string>();
  const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
  files.set(
    "package.json",
    json({
      name: o.name,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        play: "kit-play play",
        test: "kit-play test",
        check: "kit-play check",
        typecheck: "tsc --noEmit",
      },
      devDependencies: deps,
    }),
  );
  files.set("netnet.json", json({ forge: "Net Forge", template: o.starter.id, engine: "@netforge/engine", createdWith: `create-netforge@${o.creator}` }));
  files.set("src/game.ts", o.files.gameTs);
  if (o.files.llms) files.set("llms.txt", o.files.llms);
  files.set(
    "tsconfig.json",
    json({
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022"],
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
        isolatedModules: true,
        skipLibCheck: true,
        types: [],
      },
      include: ["src"],
    }),
  );
  files.set(".gitignore", "node_modules/\n.netnet/\n*.log\n.DS_Store\n");
  const ctx = { name: o.name, starter: o.starter, gameTs: o.files.gameTs, pm: o.pm, hasLlms: o.files.llms.length > 0 };
  files.set("README.md", readme(ctx));
  files.set("AGENTS.md", agentGuide(ctx));
  files.set(".mcp.json", mcpConfig());
  files.set(".vscode/mcp.json", vscodeMcpConfig());
  const agents = o.agents ?? AGENTS;
  if (agents.includes("claude")) files.set("CLAUDE.md", claudeMd());
  if (agents.includes("cursor")) {
    files.set(".cursor/rules/netforge.mdc", cursorRule(ctx));
    files.set(".cursor/mcp.json", mcpConfig());
  }
  if (agents.includes("copilot")) files.set(".github/copilot-instructions.md", copilotInstructions());
  return files;
}
