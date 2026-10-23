// Rebuild engine-sim's and the engine's dist/ when their sources are newer,
// so a template build never bundles a stale engine. Templates consume the
// engine through dist/ (package exports), and `pnpm --filter <template> build`
// does not build workspace dependencies first (turbo's ^build does).
//
// usage (from a template's build script): node ../engine/scripts/fresh-dist.mjs
// A fresh dist (the usual case under turbo, which built it a moment ago) is a
// no-op, so parallel template builds never rewrite dist under each other.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packages = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Build order: the engine depends on engine-sim.
const ORDER = [
  { dir: "engine-sim", name: "@netforge/engine-sim" },
  { dir: "engine", name: "@netforge/engine" },
];

/** Newest mtime (ms) of the files under `path`, or 0 when it does not exist. */
function newest(path) {
  if (!existsSync(path)) return 0;
  const s = statSync(path);
  if (!s.isDirectory()) return s.mtimeMs;
  let best = 0;
  for (const e of readdirSync(path)) best = Math.max(best, newest(join(path, e)));
  return best;
}

let rebuilt = false;
for (const p of ORDER) {
  const root = join(packages, p.dir);
  const source = Math.max(newest(join(root, "src")), newest(join(root, "tsconfig.json")), newest(join(root, "package.json")));
  const dist = newest(join(root, "dist"));
  // A dependency rebuilt just now makes this one stale too (its .d.ts and imports changed).
  if (!rebuilt && dist >= source) continue;
  console.log(`[fresh-dist] building ${p.name} (${dist === 0 ? "no dist" : rebuilt ? "dependency rebuilt" : "sources newer than dist"})`);
  execFileSync("pnpm", ["--filter", p.name, "build"], { stdio: "inherit" });
  rebuilt = true;
}
