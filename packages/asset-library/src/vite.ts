/**
 * Vite plugin: serve the built library at ./library in dev and copy it into
 * the build, so a template plays with real models offline after one
 * `pnpm --filter @netnet/assets library`. With `ids`, only those assets
 * (and the bases of variants) are copied: a draft build ships what it uses.
 * In production the page reads VITE_LIBRARY_URL (the published CID) instead
 * and nothing needs copying (`copy: false`).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { assetById, baseAsset, library, soundById } from "./library.js";
import { assetPath, soundPath } from "./paths.js";

/** This package's root (the published package holds no scripts/, so this is found here rather than imported from them). */
const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_LIBRARY_DIR = join(PACKAGE_DIR, ".library");

const TYPES: Readonly<Record<string, string>> = { glb: "model/gltf-binary", png: "image/png", webp: "image/webp", json: "application/json", ogg: "audio/ogg", mp3: "audio/mpeg" };

export interface LibraryPluginOptions {
  readonly dir?: string;
  /** Library ids to copy into the build; all of them when omitted. */
  readonly ids?: () => readonly string[];
  /** Copy into the build (default true). */
  readonly copy?: boolean;
  /** With ids: also copy the audio section (every sound, about 3.5 MB). Default true. */
  readonly audio?: boolean;
}

/** Library paths for some ids: their files, the files of variant bases, and sounds (audio.*). */
export function filesFor(ids: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const s = soundById(id);
    if (s) out.add(soundPath(s));
    const a = assetById(id);
    if (!a) continue;
    const p = assetPath(baseAsset(a));
    if (p) out.add(p);
  }
  return [...out].sort();
}

function allFiles(dir: string): string[] {
  const index = join(dir, "index.json");
  if (!existsSync(index)) return [];
  const parsed = JSON.parse(readFileSync(index, "utf8")) as { assets: Record<string, { path: string }> };
  return [...new Set(Object.values(parsed.assets).map((a) => a.path))].sort();
}

export function assetLibrary(o: LibraryPluginOptions = {}): Plugin {
  const dir = resolve(o.dir ?? DEFAULT_LIBRARY_DIR);
  return {
    name: "netnet-asset-library",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0] ?? "";
        const i = url.indexOf("/library/");
        if (i < 0) return next();
        const rel = normalize(decodeURIComponent(url.slice(i + "/library/".length)));
        const file = join(dir, rel);
        if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.end("not in the built library (run: pnpm --filter @netnet/assets library)");
          return;
        }
        res.setHeader("content-type", TYPES[rel.split(".").pop() ?? ""] ?? "application/octet-stream");
        res.setHeader("cache-control", "no-cache");
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      if (o.copy === false) return;
      if (!existsSync(dir)) {
        this.warn(`no built asset library at ${dir}; the build draws primitive shapes (run: pnpm --filter @netnet/assets library)`);
        return;
      }
      const files = o.ids ? filesFor([...o.ids(), ...(o.audio === false ? [] : library().sounds.keys())]) : allFiles(dir);
      for (const f of files) {
        const src = join(dir, f);
        if (!existsSync(src)) continue;
        this.emitFile({ type: "asset", fileName: `library/${f}`, source: readFileSync(src) });
      }
    },
  };
}
