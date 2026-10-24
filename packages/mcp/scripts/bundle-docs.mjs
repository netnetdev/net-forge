// Copies the Net Forge packages' agent docs (README.md, llms.txt,
// llms-full.txt, GAME-DESIGN.md, AGENTS.md) into dist/docs, so the MCP
// server's search_docs and explain_api work from the npm tarball alone.
// Runs after tsc in `pnpm build`; reads the sibling package folders.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packages = join(here, "..", "..");
const out = join(here, "..", "dist", "docs");
const FILES = ["README.md", "llms.txt", "llms-full.txt", "GAME-DESIGN.md", "AGENTS.md"];
const DIRS = ["engine", "engine-sim", "kit-play", "kit", "tabletop", "asset-library", "asset-library-files", "mcp"];
for (const d of readdirSync(packages).sort()) if (d.startsWith("template-")) DIRS.push(d);

rmSync(out, { recursive: true, force: true });
const index = [];
for (const dir of DIRS) {
  const root = join(packages, dir);
  if (!existsSync(join(root, "package.json"))) continue;
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (pkg.private) continue;
  for (const file of FILES) {
    if (!existsSync(join(root, file))) continue;
    mkdirSync(join(out, dir), { recursive: true });
    copyFileSync(join(root, file), join(out, dir, file));
    index.push({ package: pkg.name, dir, file });
  }
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`[bundle-docs] ${index.length} files from ${new Set(index.map((i) => i.dir)).size} packages`);
