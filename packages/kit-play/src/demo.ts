// `kit-play build-demo`: a single-player build of a template (or of a game
// folder) that plays entirely in the browser. The same room host `kit play`
// runs in Node runs here in a Web Worker, reached through a stand-in for the
// Colyseus client, so the engine, the game module and the template client
// are unchanged. The output is a static folder (index.html, assets/ and the
// library files the game draws) with relative paths: it plays from any
// subpath or in an iframe, and makes no network request outside its own
// files.
//
// What it never does: connect a wallet, talk to a Net Forge server, or pay
// anyone. Coins are play money.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gameClientPlugin, libraryDir, PlayError, readGameFolder, templateDir, type GameFolder } from "./play.js";
import { TEMPLATES, templateFor, type TemplateEntry, type TemplateId } from "./templates.js";

/** The room endpoint the build is compiled against; the page answers it in memory (solo/protocol.ts holds the same value). */
export const SOLO_ENDPOINT = "http://solo.netforge.invalid";

export interface DemoOptions {
  /** A template id, or null to build the game folder in `dir`. */
  readonly template: TemplateId | null;
  /** The game folder (netnet.json, src/game.ts) when `template` is null; where packages are looked up from otherwise. */
  readonly dir: string;
  readonly out: string;
  /** The built asset library (index.json and the style folders), or null to look for @netforge/asset-library-files. */
  readonly library: string | null;
  readonly log: (s: string) => void;
}

export interface DemoReport {
  readonly template: TemplateId;
  readonly out: string;
  readonly files: number;
  readonly bytes: number;
  readonly libraryFiles: number;
  readonly libraryBytes: number;
  /** False when no built library was found: the game draws its fallback shapes. */
  readonly library: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));
/** The browser side of the solo build (solo/*.ts), next to src/ and dist/. */
export const SOLO_DIR = join(here, "..", "solo");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** The library files a build copies: the models game.ts and the scene name, in every art style, the ps1 surfaces and every sound, as the template's own vite.config.ts picks them. */
export async function libraryFiles(tplDir: string, gameFile: string, cacheDir: string): Promise<string[]> {
  const esbuild = await import("esbuild");
  const decor = realpathSync(join(tplDir, "client", "decor.ts"));
  const contents = [
    `import { idsForStyle, inEveryStyle, libraryIdsIn, library } from "@netforge/asset-library";`,
    `import { filesFor } from "@netforge/asset-library/vite";`,
    `import { SCENE_MODELS } from ${JSON.stringify(decor)};`,
    `export function files(src) {`,
    `  return filesFor([...inEveryStyle([...libraryIdsIn(src), ...SCENE_MODELS]), ...idsForStyle("ps1").filter((id) => id.includes(".surface_")), ...library().sounds.keys()]);`,
    `}`,
  ].join("\n");
  const out = await esbuild.build({
    stdin: { contents, resolveDir: join(tplDir, "client"), sourcefile: "kit-play-library.js", loader: "js" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    write: false,
    logLevel: "silent",
    external: ["vite"],
  });
  const file = out.outputFiles[0];
  if (!file) throw new PlayError("the library list produced no output");
  const tmp = join(cacheDir, "library-list.mjs");
  writeFileSync(tmp, file.text);
  const mod = (await import(pathToFileURL(tmp).href)) as { files(src: string): string[] };
  return mod.files(readFileSync(gameFile, "utf8"));
}

export async function buildDemo(o: DemoOptions): Promise<DemoReport> {
  const dir = resolve(o.dir);
  let entry: TemplateEntry;
  let game: GameFolder | null = null;
  if (o.template) {
    const t = templateFor(o.template);
    if (!t) throw new PlayError(`unknown template: ${o.template} (one of ${Object.keys(TEMPLATES).join(", ")})`);
    entry = t;
  } else {
    game = readGameFolder(dir);
    entry = game.template;
  }
  const tplDir = templateDir(entry, dir);
  const out = resolve(o.out);
  if (out === "/" || out === resolve(dir) || out === tplDir || tplDir.startsWith(out + sep)) throw new PlayError(`refusing to build into ${out}`);
  const lib = o.library ? resolve(o.library) : (process.env.ASSET_LIBRARY_DIR ?? libraryDir(dir));
  if (lib && !existsSync(join(lib, "index.json"))) throw new PlayError(`${lib} has no index.json: pass the built asset library folder`);
  if (!lib) o.log("No asset library found (@netforge/asset-library-files, --library or ASSET_LIBRARY_DIR): the demo draws simple shapes.");

  const vite = await import("vite");
  const norm = (p: string) => vite.normalizePath(realpathSync(p));
  const clientDir = norm(join(tplDir, "client"));
  const mainFile = norm(join(tplDir, "client", "main.ts"));
  const manifest = norm(join(tplDir, "src", "manifest.ts"));
  const page = norm(join(SOLO_DIR, "page.ts"));
  const shim = norm(join(SOLO_DIR, "colyseus.ts"));
  const VIRTUAL = "virtual:kit-play-solo";
  const RESOLVED = "\0" + VIRTUAL;
  const soloEntry = { id: entry.id, label: entry.label, adapter: entry.adapter, manifest: entry.manifest, seats: entry.seats, aoi: entry.aoi };
  const solo = (): import("vite").Plugin => ({
    name: "kit-play-solo",
    enforce: "pre",
    resolveId(source) {
      if (source === VIRTUAL) return RESOLVED;
      if (source === "@colyseus/sdk") return shim;
      return null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      return `export * as template from ${JSON.stringify(manifest)};\nexport const entry = ${JSON.stringify(soloEntry)};\n`;
    },
    transform(code, id) {
      // The boot module first: its fetch hook is in place before the client asks for a seat.
      if (id.split("?")[0] === mainFile) return { code: `import ${JSON.stringify(page)};\n${code}`, map: null };
      return null;
    },
  });
  const plugins = (): import("vite").PluginOption[] => (game ? [gameClientPlugin(game, tplDir, vite.normalizePath), solo()] : [solo()]);

  const cacheDir = mkdtempSync(join(tmpdir(), "kit-play-demo-"));
  const title = game?.names?.title ?? entry.label;
  o.log(`Building the solo demo of ${title} (${entry.label})...`);
  try {
    mkdirSync(join(cacheDir, "no-env"), { recursive: true });
    await vite.build({
      configFile: false,
      root: clientDir,
      base: "./",
      logLevel: "warn",
      publicDir: false,
      cacheDir: join(cacheDir, "vite"),
      // No VITE_* variables from the shell or a .env file reach the page: it always talks to its own host.
      envDir: join(cacheDir, "no-env"),
      envPrefix: "KIT_PLAY_NEVER_",
      define: {
        "import.meta.env.VITE_ROOMS_URL": JSON.stringify(SOLO_ENDPOINT),
        "import.meta.env.VITE_LIBRARY_URL": JSON.stringify("./library"),
      },
      plugins: plugins(),
      worker: { format: "es", plugins },
      build: {
        outDir: out,
        emptyOutDir: true,
        target: "es2022",
        chunkSizeWarningLimit: 16384,
        reportCompressedSize: false,
        sourcemap: false,
        assetsInlineLimit: 4096,
      },
    });
    const html = readFileSync(join(out, "index.html"), "utf8");
    if (!html.includes("./assets/")) throw new PlayError("the built page does not load its assets by relative path");

    let libraryCount = 0;
    let libraryBytes = 0;
    if (lib) {
      const files = await libraryFiles(tplDir, game ? game.gameFile : join(tplDir, "src", "game.ts"), cacheDir);
      for (const f of files) {
        const src = join(lib, f);
        if (!existsSync(src)) continue;
        const dst = join(out, "library", f);
        mkdirSync(dirname(dst), { recursive: true });
        cpSync(src, dst);
        libraryCount++;
        libraryBytes += statSync(src).size;
      }
    }
    const all = walk(out);
    const bytes = all.reduce((n, f) => n + statSync(f).size, 0);
    o.log(`${relative(process.cwd(), out) || "."}: ${all.length} files, ${(bytes / 1e6).toFixed(1)} MB (${libraryCount} library files, ${(libraryBytes / 1e6).toFixed(1)} MB)`);
    return { template: entry.id, out, files: all.length, bytes, libraryFiles: libraryCount, libraryBytes, library: lib !== null };
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}
