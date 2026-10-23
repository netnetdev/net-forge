/**
 * Fetch the library's source files from each pack's official source
 * (manifest/packs.json) into a local cache, once. After one fetch the
 * library builds and runs offline.
 *
 *   pnpm --filter @netforge/asset-library fetch-packs     # everything
 *   pnpm --filter @netforge/asset-library fetch-packs -- --style pixel
 *
 * Archives and files are checked against the sha256 in the manifest; a
 * mismatch stops the fetch (a pack changed upstream: re-verify its licence
 * and update the manifest by hand). Nothing fetched is ever committed: the
 * cache lives in packages/asset-library/.cache (gitignored). The Net Forge
 * asset pipeline turns the cache into the optimized library.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { library } from "../src/library.js";
import type { Library } from "../src/library.js";
import type { AssetDef, PackDef } from "../src/schema.js";
import { soundPath } from "../src/paths.js";

export const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CACHE_DIR = join(PACKAGE_DIR, ".cache");
export const RAW_DIR = join(CACHE_DIR, "raw");

export interface RawEntry {
  readonly id: string;
  readonly style: string;
  /** Path of the main file, relative to RAW_DIR. */
  readonly main: string;
  readonly format: "glb" | "gltf" | "png" | "ogg" | "mp3";
  /** The voxel style: rebuild this file as voxels, `res` voxels tall (the source is another entry's file). */
  readonly voxel?: { readonly res: number };
}

export interface FetchOptions {
  readonly styles?: readonly string[];
  /** Never touch the network: fail on anything not cached. */
  readonly offline?: boolean;
  readonly log?: (msg: string) => void;
  readonly fetch?: typeof fetch;
  /** Cache folder (default .cache); tests point it elsewhere. */
  readonly cacheDir?: string;
  /** The library to fetch (default: the shipped manifests). */
  readonly library?: Library;
}

const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

async function download(url: string, f: typeof fetch, tries = 5): Promise<Uint8Array> {
  let last: unknown = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await f(url, { headers: { "user-agent": "netnet-asset-library-fetch" }, signal: AbortSignal.timeout(15 * 60_000) });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw new Error(`could not download ${url}: ${last instanceof Error ? last.message : String(last)}`);
}

/** URIs a glTF references (buffers and images), for pulling textures out of an archive with the model. */
export function externalUris(bytes: Uint8Array, format: "glb" | "gltf"): string[] {
  let json: { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
  if (format === "glb") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const len = view.getUint32(12, true);
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len))) as typeof json;
  } else json = JSON.parse(new TextDecoder().decode(bytes)) as typeof json;
  return [...(json.buffers ?? []), ...(json.images ?? [])]
    .map((x) => x.uri)
    .filter((u): u is string => typeof u === "string" && !u.startsWith("data:"))
    .map((u) => decodeURIComponent(u));
}

function formatOf(path: string): "glb" | "gltf" | "png" {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "glb" || ext === "gltf" || ext === "png") return ext;
  throw new Error(`unsupported source file ${path}`);
}

async function packArchive(pack: PackDef, o: FetchOptions, f: typeof fetch): Promise<Record<string, Uint8Array>> {
  if (pack.download.kind !== "zip") throw new Error(`${pack.id} is not an archive pack`);
  const path = join(o.cacheDir ?? CACHE_DIR, "packs", `${pack.id}.zip`);
  let bytes: Uint8Array;
  if (existsSync(path)) bytes = new Uint8Array(await readFile(path));
  else {
    if (o.offline) throw new Error(`${pack.id} is not cached and --offline is set`);
    o.log?.(`downloading ${pack.title} from ${pack.download.url}`);
    bytes = await download(pack.download.url, f);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  if (pack.download.sha256 && sha256(bytes) !== pack.download.sha256) {
    throw new Error(`${pack.id}: archive sha256 ${sha256(bytes)} does not match the manifest. The pack changed upstream; re-verify its licence and update manifest/packs.json.`);
  }
  return unzipSync(bytes);
}

/** Fetch every source file for the chosen styles into RAW_DIR and write RAW_DIR/index.json. */
export async function fetchLibrary(o: FetchOptions = {}): Promise<RawEntry[]> {
  const lib = o.library ?? library();
  const rawDir = join(o.cacheDir ?? CACHE_DIR, "raw");
  const f = o.fetch ?? fetch;
  const styles = o.styles?.length ? o.styles : [...lib.styles.keys()];
  const assets: AssetDef[] = styles.flatMap((s) => lib.styles.get(s as never)?.assets ?? []);
  // Voxel models are rebuilt from another entry's file: fetch that file too.
  for (const a of [...assets]) {
    if (!("voxelize" in a.source)) continue;
    const from = lib.byId.get(a.source.voxelize);
    if (from && !assets.includes(from)) assets.push(from);
  }
  const archives = new Map<string, Record<string, Uint8Array>>();
  const entries: RawEntry[] = [];
  const queue: (() => Promise<void>)[] = [];

  for (const a of assets) {
    const src = a.source;
    if (!("pack" in src)) continue;
    const [, style = "", name = ""] = a.id.split(".");
    const dir = join(rawDir, style, name);
    if ("path" in src) {
      const pack = lib.packs.get(src.pack);
      if (!pack) throw new Error(`${a.id}: unknown pack ${src.pack}`);
      let files = archives.get(pack.id);
      if (!files) {
        files = await packArchive(pack, o, f);
        archives.set(pack.id, files);
      }
      const main = files[src.path];
      if (!main) throw new Error(`${a.id}: ${src.path} is not in ${pack.id}`);
      if (src.sha256 && sha256(main) !== src.sha256) throw new Error(`${a.id}: ${src.path} changed upstream`);
      const format = formatOf(src.path);
      const base = posix.basename(src.path);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, base), main);
      if (format !== "png") {
        const from = posix.dirname(src.path);
        for (const uri of externalUris(main, format)) {
          const inArchive = posix.normalize(posix.join(from, uri));
          const res = files[inArchive];
          if (!res) throw new Error(`${a.id}: ${src.path} needs ${uri}, which is not in ${pack.id}`);
          const out = join(dir, ...uri.split("/"));
          if (!out.startsWith(dir)) throw new Error(`${a.id}: resource ${uri} escapes its folder`);
          await mkdir(dirname(out), { recursive: true });
          await writeFile(out, res);
        }
      }
      entries.push({ id: a.id, style, main: posix.join(style, name, base), format });
    } else {
      const out = join(dir, `${name}.glb`);
      entries.push({ id: a.id, style, main: posix.join(style, name, `${name}.glb`), format: "glb" });
      if (existsSync(out) && (!src.sha256 || sha256(new Uint8Array(await readFile(out))) === src.sha256)) continue;
      if (o.offline) throw new Error(`${a.id} is not cached and --offline is set`);
      queue.push(async () => {
        const bytes = await download(src.url, f);
        if (src.sha256 && sha256(bytes) !== src.sha256) throw new Error(`${a.id}: ${src.url} sha256 does not match the manifest (changed upstream; re-verify ${src.page})`);
        await mkdir(dir, { recursive: true });
        await writeFile(out, bytes);
        o.log?.(`fetched ${a.id}`);
      });
    }
  }
  for (const a of assets) {
    if (!("voxelize" in a.source)) continue;
    const fromId = lib.byId.get(a.source.voxelize)?.id;
    const from = entries.find((e) => e.id === fromId);
    if (!from || (from.format !== "glb" && from.format !== "gltf")) throw new Error(`${a.id}: ${a.source.voxelize} has no model file to voxelize`);
    const [, style = ""] = a.id.split(".");
    entries.push({ id: a.id, style, main: from.main, format: from.format, voxel: { res: a.source.res } });
  }
  // The audio section (style "audio"): sound effects out of pack archives and per-file music, each pinned by sha256.
  if (!o.styles?.length || o.styles.includes("audio")) {
    for (const s of lib.sounds.values()) {
      const main = soundPath(s);
      const out = join(rawDir, ...main.split("/"));
      const format = main.endsWith(".mp3") ? "mp3" : "ogg";
      entries.push({ id: s.id, style: "audio", main, format });
      const pack = lib.packs.get(s.source.pack);
      if (!pack) throw new Error(`${s.id}: unknown pack ${s.source.pack}`);
      const src = s.source;
      if ("path" in src) {
        let files = archives.get(pack.id);
        if (!files) {
          files = await packArchive(pack, o, f);
          archives.set(pack.id, files);
        }
        const bytes = files[src.path];
        if (!bytes) throw new Error(`${s.id}: ${src.path} is not in ${pack.id}`);
        if (sha256(bytes) !== src.sha256) throw new Error(`${s.id}: ${src.path} changed upstream`);
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, bytes);
        continue;
      }
      if (existsSync(out) && sha256(new Uint8Array(await readFile(out))) === src.sha256) continue;
      if (o.offline) throw new Error(`${s.id} is not cached and --offline is set`);
      queue.push(async () => {
        const bytes = await download(src.url, f);
        if (sha256(bytes) !== src.sha256) throw new Error(`${s.id}: ${src.url} sha256 does not match the manifest (changed upstream; re-verify ${src.page})`);
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, bytes);
        o.log?.(`fetched ${s.id}`);
      });
    }
  }
  // Per-file downloads, a few at a time.
  const workers = Array.from({ length: 6 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) await job();
  });
  await Promise.all(workers);
  await mkdir(rawDir, { recursive: true });
  await writeFile(join(rawDir, "index.json"), JSON.stringify(entries, null, 1));
  return entries;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const styles: string[] = [];
  const i = process.argv.indexOf("--style");
  if (i >= 0 && process.argv[i + 1]) styles.push(process.argv[i + 1] as string);
  fetchLibrary({ styles, offline: process.argv.includes("--offline"), log: (m) => console.log(m) })
    .then((e) => console.log(`${e.length} source files in ${RAW_DIR}`))
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
