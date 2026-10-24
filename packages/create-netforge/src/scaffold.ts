// scaffold(): the library entry. Makes a new game folder with no questions,
// no install and no git, and returns what it wrote and the commands to run
// next. The CLI (main.ts) and other tools (the Net Forge MCP server's
// netforge_create_game) call this one function, so every new game has the
// same files.

import { basename, resolve } from "node:path";
import { ArgError, AGENTS, runScript, shellArg, type Agent, type PackageManager } from "./args.js";
import { findStarter, STARTERS, suggestStarter } from "./catalog.js";
import { checkName, dependencies, packageName, planProject } from "./project.js";
import { selfVersion, starterFiles, versions } from "./starters.js";
import { checkDirectory, checkTarget, writeProject } from "./write.js";

export interface ScaffoldOptions {
  /** A template id (survivor, arena, tower-defense, ...) or an alias such as tower. */
  readonly template: string;
  /** The folder to make: absolute, or relative to cwd. It must be missing or empty. */
  readonly directory: string;
  /** What a relative directory is resolved against (default: the process's current directory). */
  readonly cwd?: string | undefined;
  /** The package name; defaults from the folder name. */
  readonly name?: string | undefined;
  /** The package manager the guides and next commands name (default npm). */
  readonly pm?: PackageManager | undefined;
  /** Agent files besides AGENTS.md and the MCP configs (default: all). */
  readonly agents?: readonly Agent[] | undefined;
}

export interface ScaffoldResult {
  /** The folder made, absolute. */
  readonly directory: string;
  readonly name: string;
  /** The template id. */
  readonly template: string;
  /** Every file written, relative to directory, with forward slashes. */
  readonly files: string[];
  /** The commands to run next, from the folder's parent, in order (install, then play). */
  readonly next: string[];
}

/** The ArgError for a template name that is not one, with the nearest id. */
export function unknownTemplate(name: string): ArgError {
  const near = suggestStarter(name);
  return new ArgError(`There is no template called "${name}".${near ? ` Did you mean ${near}?` : ""} The templates are: ${STARTERS.map((t) => t.id).join(", ")}.`);
}

/**
 * Makes a new game. Throws ArgError (unknown template), NameError (a name
 * that cannot install) or FolderError (the folder is a file or not empty),
 * each with a message that says what to do.
 */
export async function scaffold(o: ScaffoldOptions): Promise<ScaffoldResult> {
  const starter = findStarter(o.template);
  if (!starter) throw unknownTemplate(o.template);
  checkDirectory(o.directory);
  const directory = resolve(o.cwd ?? process.cwd(), o.directory);
  const name = o.name !== undefined && o.name.trim() !== "" ? packageName(o.name) : packageName(basename(directory));
  const v = versions();
  checkName(name, dependencies(starter, v));
  checkTarget(directory, directory);
  const pm = o.pm ?? "npm";
  const files = planProject({ name, starter, files: starterFiles(starter), versions: v, pm, creator: selfVersion(), agents: o.agents ?? AGENTS });
  writeProject(directory, files);
  return { directory, name, template: starter.id, files: [...files.keys()], next: [`cd ${shellArg(directory)}`, `${pm} install`, runScript(pm, "play")] };
}
