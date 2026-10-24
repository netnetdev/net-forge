// Finding the installed Net Forge packages: from the game folder first (its
// own node_modules), then through kit-play (which depends on every template),
// then from this package.

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const self = fileURLToPath(import.meta.url);

function bases(from?: string): string[] {
  const out: string[] = [];
  if (from) out.push(join(from, "package.json"));
  try {
    out.push(createRequire(self).resolve("@netforge/kit-play"));
  } catch {
    // kit-play missing: fall through to this package
  }
  out.push(self);
  return out;
}

/** The root folder of an installed package (the folder holding its package.json), or null. */
export function packageRoot(pkg: string, from?: string): string | null {
  for (const base of bases(from)) {
    const req = createRequire(base);
    try {
      return dirname(req.resolve(`${pkg}/package.json`));
    } catch {
      // no ./package.json export: walk up from the main entry
    }
    try {
      let dir = dirname(req.resolve(pkg));
      while (dir !== dirname(dir)) {
        if (existsSync(join(dir, "package.json"))) return dir;
        dir = dirname(dir);
      }
    } catch {
      // next base
    }
  }
  return null;
}

/** A template package's root (its "." export is src/manifest.ts, so two levels up). */
export function templateRoot(pkg: string, from?: string): string | null {
  for (const base of bases(from)) {
    try {
      return dirname(dirname(createRequire(base).resolve(pkg)));
    } catch {
      // next
    }
  }
  return null;
}
