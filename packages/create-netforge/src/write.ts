// Puts a planned game on disk. Every planned path uses forward slashes;
// each is split and rejoined with the system's path.join, so the same plan
// writes C:\games\my-game\src\game.ts on Windows and
// /srv/games/my-game/src/game.ts elsewhere.

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import * as nodePath from "node:path";

export class FolderError extends Error {}

/** Files a folder may already hold and still count as empty (a fresh git repo, editor and OS leftovers). */
const IGNORABLE = new Set([".git", ".DS_Store", "Thumbs.db", "desktop.ini", ".idea"]);

/**
 * Throws FolderError for a folder that would not land where it reads: a ~
 * that no shell expanded (it would make a folder literally named ~), or a
 * control character such as a newline.
 */
export function checkDirectory(typed: string): void {
  // Any segment that is exactly ~: "~/x" as typed, or "/opt/me/~/x" from a caller that resolved it first.
  if (/(^|[\\/])~($|[\\/])/.test(typed)) throw new FolderError(`${JSON.stringify(typed)} has a ~ folder in it, which only a shell expands: here it would make a folder named ~. Give the full path instead.`);
  if (/[\u0000-\u001f\u007f]/.test(typed)) throw new FolderError(`The folder name ${JSON.stringify(typed)} has a control character in it (a newline or similar). Pick another name.`);
}

/** Throws FolderError when `dir` exists and is not a folder, or holds anything but ignorable files. */
export function checkTarget(dir: string, shown: string): void {
  if (!existsSync(dir)) return;
  if (!statSync(dir).isDirectory()) throw new FolderError(`${shown} already exists and is a file. Pick another name.`);
  const left = readdirSync(dir).filter((f) => !IGNORABLE.has(f));
  if (left.length > 0) {
    const some = left.slice(0, 3).join(", ") + (left.length > 3 ? ", ..." : "");
    throw new FolderError(`The folder ${shown} is not empty (${some}). Pick another name, or empty it first.`);
  }
}

/** A planned relative path as a path under `root`, refusing anything that would land outside it. */
export function targetPath(root: string, rel: string, path: Pick<typeof nodePath, "join" | "resolve" | "relative" | "isAbsolute"> = nodePath): string {
  const parts = rel.split("/");
  if (rel.length === 0 || path.isAbsolute(rel) || parts.some((p) => p === "" || p === "." || p === ".." || /[\\:\0]/.test(p))) throw new Error(`bad planned path: ${rel}`);
  const out = path.join(root, ...parts);
  const back = path.relative(path.resolve(root), path.resolve(out));
  if (back.startsWith("..") || path.isAbsolute(back)) throw new Error(`bad planned path: ${rel}`);
  return out;
}

/** Writes every planned file under `root` (made if missing). Returns the written paths. */
export function writeProject(root: string, files: ReadonlyMap<string, string>): string[] {
  mkdirSync(root, { recursive: true });
  const written: string[] = [];
  for (const [rel, body] of files) {
    const file = targetPath(root, rel);
    mkdirSync(nodePath.dirname(file), { recursive: true });
    writeFileSync(file, body);
    written.push(file);
  }
  return written;
}
