// Where a starter's files come from. A published create-netforge carries a
// copy of every template's src/game.ts and llms.txt in starters/ (staged
// at build time by scripts/stage-starters.mjs, with the version of every
// package a new game installs), so making a game needs no network until
// the install. In the source repository, before a build, the same files
// are read from the sibling template packages.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Starter } from "./catalog.js";

export interface StarterFiles {
  /** The template's game module: the rules a new game starts from. */
  readonly gameTs: string;
  /** The template's guide for coding agents. */
  readonly llms: string;
}

/** Package versions a new game depends on, by package name. */
export type Versions = Readonly<Record<string, string>>;

/** The packages every new game installs besides its template. */
export const BASE_PACKAGES = ["@netforge/kit-play", "@netforge/engine"] as const;

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** starters/ in this package, or null in a source checkout that has not been built. */
function stagedDir(root: string): string | null {
  const dir = join(root, "starters");
  return existsSync(join(dir, "versions.json")) ? dir : null;
}

/** The sibling packages folder in the source repository. */
function siblings(root: string): string {
  return join(root, "..");
}

export function starterFiles(t: Starter, root: string = packageRoot): StarterFiles {
  const staged = stagedDir(root);
  const base = staged ? join(staged, t.id) : join(siblings(root), t.dir);
  const gameFile = staged ? join(base, "game.ts") : join(base, "src", "game.ts");
  const llmsFile = join(base, "llms.txt");
  if (!existsSync(gameFile)) throw new Error(`create-netforge is missing the ${t.id} template's game.ts (${gameFile}). Reinstall create-netforge.`);
  return { gameTs: readFileSync(gameFile, "utf8"), llms: existsSync(llmsFile) ? readFileSync(llmsFile, "utf8") : "" };
}

export function versions(root: string = packageRoot): Versions {
  const staged = stagedDir(root);
  if (staged) return JSON.parse(readFileSync(join(staged, "versions.json"), "utf8")) as Versions;
  return readSiblingVersions(siblings(root));
}

/** Every @netforge package's version from a packages/ folder (what the build stages). */
export function readSiblingVersions(packagesDir: string): Versions {
  const out: Record<string, string> = {};
  const dirs = ["kit-play", "engine", "engine-sim", "template-survivor", "template-arena", "template-tower", "template-dungeon", "template-idle", "template-platformer", "template-cards", "template-collector", "template-racer", "template-party"];
  for (const d of dirs) {
    const file = join(packagesDir, d, "package.json");
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, "utf8")) as { name: string; version: string };
    out[pkg.name] = pkg.version;
  }
  return out;
}

/** create-netforge's own version. */
export function selfVersion(root: string = packageRoot): string {
  return (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
}
