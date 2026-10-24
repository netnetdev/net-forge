// Copies every template's src/game.ts and llms.txt into starters/<id>/ and
// writes starters/versions.json (the version of each package a new game
// installs), so a published create-netforge makes a game with no network
// until the install. Runs after tsc (it reads the catalog from dist/).
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packages = join(root, "..");
const { STARTERS } = await import("../dist/catalog.js");
const { readSiblingVersions } = await import("../dist/starters.js");

const out = join(root, "starters");
for (const t of STARTERS) {
  const dir = join(out, t.id);
  mkdirSync(dir, { recursive: true });
  cpSync(join(packages, t.dir, "src", "game.ts"), join(dir, "game.ts"));
  cpSync(join(packages, t.dir, "llms.txt"), join(dir, "llms.txt"));
}
const versions = readSiblingVersions(packages);
for (const name of ["@netforge/kit-play", "@netforge/engine", ...STARTERS.map((t) => t.pkg)]) {
  if (!versions[name]) throw new Error(`stage-starters: no version for ${name} in ${packages}`);
}
writeFileSync(join(out, "versions.json"), JSON.stringify(versions, null, 2) + "\n");
console.log(`staged ${STARTERS.length} starters`);
