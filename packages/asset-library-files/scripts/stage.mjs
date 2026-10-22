// Copies the built asset library (packages/asset-library/.library, made by
// `pnpm --filter @netnet/assets library`) into ./library before packing.
// Only the files index.json lists are copied, plus index.json: never
// published.json or anything else the build left next to them.
//
// With no built library to copy from (the public source repo carries the
// staged ./library itself), a ./library that is already staged is kept, after
// every file index.json lists is checked against its sha256.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const src = process.env.ASSET_LIBRARY_DIR ?? join(here, "..", "asset-library", ".library");
const out = join(here, "library");
const index = join(src, "index.json");

/** Every { path, sha256 } index.json lists, with the path checked to stay inside the library. */
function entries(indexPath) {
  const parsed = JSON.parse(readFileSync(indexPath, "utf8"));
  const list = new Map();
  for (const section of ["assets", "sounds"]) {
    for (const a of Object.values(parsed[section] ?? {})) {
      if (!a || typeof a.path !== "string") continue;
      const rel = normalize(a.path);
      if (rel.startsWith("..") || rel.startsWith("/")) throw new Error(`bad path in index.json: ${a.path}`);
      list.set(rel, typeof a.sha256 === "string" ? a.sha256 : null);
    }
  }
  return list;
}

if (!existsSync(index)) {
  if (process.env.ASSET_LIBRARY_DIR === undefined && existsSync(join(out, "index.json"))) {
    let n = 0;
    for (const [rel, sha] of entries(join(out, "index.json"))) {
      const file = join(out, rel);
      if (!existsSync(file)) continue;
      const got = createHash("sha256").update(readFileSync(file)).digest("hex");
      if (sha && got !== sha) {
        console.error(`library/${rel}: sha256 ${got} does not match index.json (${sha})`);
        process.exit(1);
      }
      n++;
    }
    console.log(`kept the staged library: ${n} files match index.json`);
    process.exit(0);
  }
  console.error(`No built asset library at ${src}. Build it first: pnpm --filter @netnet/assets library`);
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
let n = 0;
for (const rel of entries(index).keys()) {
  const from = join(src, rel);
  if (!existsSync(from)) continue;
  mkdirSync(dirname(join(out, rel)), { recursive: true });
  cpSync(from, join(out, rel));
  n++;
}
writeFileSync(join(out, "index.json"), readFileSync(index));
console.log(`staged ${n} library files from ${src}`);
