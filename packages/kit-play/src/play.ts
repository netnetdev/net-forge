// `kit play`: run a downloaded Net Forge game on this computer with play
// money. Inside the game's folder (netnet.json, src/game.ts, src/names.json)
// it builds the template's browser client with the creator's game module
// and labels swapped in, bundles a local room host around the same game
// module, serves both on one port and opens the browser.
//
// What it never does: connect a wallet, read or write a chain, talk to a
// Net Forge server, run the referee, or pay anyone. The page is built with
// no VITE_* environment, so a hosted room or library URL in the shell can
// never be baked in; the host binds to 127.0.0.1 unless --host says
// otherwise, and answers every sign-in and money route with 403.

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { namesModule, parseNames, type Names } from "./names.js";
import { templateFor, type TemplateEntry } from "./templates.js";

/** The only import a game module may make (the studio's rule, kept here so a game that plays locally plays in the studio). */
export const ALLOWED_IMPORT = "@netnetcapital/engine";

export interface PlayOptions {
  readonly dir: string;
  readonly port: number;
  readonly host: string;
  readonly open: boolean;
  /** Browser tabs to open, one per local player. */
  readonly players: number;
  /** A base URL the page loads the asset library from instead of this host (any mirror of the published library). */
  readonly libraryUrl: string | null;
  readonly log: (s: string) => void;
}

export interface GameFolder {
  readonly dir: string;
  readonly template: TemplateEntry;
  readonly gameFile: string;
  readonly names: Names | null;
}

export class PlayError extends Error {}

/** Reads and checks the game folder. */
export function readGameFolder(dir: string): GameFolder {
  const metaFile = join(dir, "netnet.json");
  if (!existsSync(metaFile)) throw new PlayError(`No netnet.json in ${dir}. Run kit play inside a game downloaded from Net Forge.`);
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(readFileSync(metaFile, "utf8")) as Record<string, unknown>;
  } catch {
    throw new PlayError("netnet.json is not valid JSON.");
  }
  const template = templateFor(meta.template);
  if (!template) throw new PlayError(`netnet.json names an unknown template: ${String(meta.template)}`);
  const gameFile = join(dir, "src", "game.ts");
  if (!existsSync(gameFile)) throw new PlayError("src/game.ts is missing.");
  const namesFile = join(dir, "src", "names.json");
  let names: Names | null = null;
  if (existsSync(namesFile)) {
    try {
      names = parseNames(readFileSync(namesFile, "utf8"));
    } catch (e) {
      throw new PlayError(e instanceof Error ? e.message : String(e));
    }
  }
  return { dir, template, gameFile, names };
}

/** Where a package is installed, looked up from the game folder first, then from kit-play itself. */
function packageDir(pkg: string, from: string, entryToRoot: (p: string) => string): string {
  const bases = [join(from, "package.json"), fileURLToPath(import.meta.url)];
  for (const base of bases) {
    try {
      return entryToRoot(createRequire(base).resolve(pkg));
    } catch {
      // next
    }
  }
  throw new PlayError(`${pkg} is not installed. Run npm install in the game folder.`);
}

/** The template package's root (its "." export is src/manifest.ts). */
export function templateDir(t: TemplateEntry, from: string): string {
  return packageDir(t.pkg, from, (p) => dirname(dirname(p)));
}

/** The built asset library shipped in @netnetcapital/asset-library-files, or null when it is not installed. */
export function libraryDir(from: string): string | null {
  try {
    const dir = packageDir("@netnetcapital/asset-library-files/package.json", from, (p) => dirname(p));
    const lib = join(dir, "library");
    return existsSync(join(lib, "index.json")) ? lib : null;
  } catch {
    return null;
  }
}

/** Builds the template client with the game module and labels swapped in. */
export async function buildClient(g: GameFolder, tplDir: string, outDir: string, cacheDir: string): Promise<void> {
  const vite = await import("vite");
  // Vite hands plugins real, forward-slash paths: compare in that form (Windows, symlinked folders).
  const norm = (p: string) => vite.normalizePath(realpathSync(p));
  const manifest = norm(join(tplDir, "src", "manifest.ts"));
  const clientDir = norm(join(tplDir, "client"));
  const templateNames = norm(join(tplDir, "client", "names.ts"));
  const gameFile = norm(g.gameFile);
  const NAMES_ID = "\0kit-play-names.js";
  const plugin: import("vite").Plugin = {
    name: "kit-play-game",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!importer) return null;
      if (importer === manifest && (source === "./game.js" || source === "./game.ts")) return gameFile;
      if (importer === gameFile) {
        if (source === ALLOWED_IMPORT) return this.resolve(source, manifest, { skipSelf: true });
        this.error(`src/game.ts may import only "${ALLOWED_IMPORT}", not "${source}"`);
      }
      if (g.names && importer.startsWith(clientDir) && importer !== templateNames && (source === "./names.js" || source === "./names.ts")) return NAMES_ID;
      return null;
    },
    load(id) {
      return id === NAMES_ID && g.names ? namesModule(g.names, templateNames) : null;
    },
  };
  await vite.build({
    configFile: false,
    root: clientDir,
    base: "./",
    logLevel: "warn",
    publicDir: false,
    cacheDir,
    // No VITE_* variables from the shell or a .env file reach the page: it always talks to this host.
    envDir: join(cacheDir, "no-env"),
    envPrefix: "KIT_PLAY_NEVER_",
    plugins: [plugin],
    build: { outDir, emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 16384, reportCompressedSize: false },
  });
}

/** Bundles the local host with the game module (one copy of the engine and the sim). Returns the bundle path. */
export async function bundleHost(g: GameFolder, tplDir: string, outFile: string): Promise<string> {
  const esbuild = await import("esbuild");
  const manifest = realpathSync(join(tplDir, "src", "manifest.ts"));
  const gameFile = realpathSync(g.gameFile);
  const here = dirname(fileURLToPath(import.meta.url));
  const entryFile = existsSync(join(here, "host", "entry.js")) ? join(here, "host", "entry.js") : join(here, "host", "entry.ts");
  const swap: import("esbuild").Plugin = {
    name: "kit-play-swap",
    setup(b) {
      b.onResolve({ filter: /^\.\/game\.(js|ts)$/ }, (args) => (args.importer === manifest ? { path: gameFile } : undefined));
      b.onResolve({ filter: /.*/ }, async (args) => {
        if (args.importer !== gameFile) return undefined;
        if (args.path === ALLOWED_IMPORT) return b.resolve(args.path, { resolveDir: join(tplDir, "src"), kind: args.kind });
        return { errors: [{ text: `src/game.ts may import only "${ALLOWED_IMPORT}"` }] };
      });
    },
  };
  const contents = [`export { startHost } from ${JSON.stringify(entryFile)};`, `export * as template from ${JSON.stringify(manifest)};`].join("\n");
  const out = await esbuild.build({
    stdin: { contents, resolveDir: here, sourcefile: "kit-play-host.js", loader: "js" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    write: false,
    logLevel: "silent",
    external: ["bufferutil", "utf-8-validate"],
    plugins: [swap],
    banner: { js: "import { createRequire as __kpRequire } from 'node:module'; const require = __kpRequire(import.meta.url);" },
  });
  const file = out.outputFiles[0];
  if (!file) throw new PlayError("the host bundle produced no output");
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, file.text);
  return outFile;
}

function openBrowser(url: string): void {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args as string[], { stdio: "ignore", detached: true }).unref();
  } catch {
    // the URL is printed either way
  }
}

export interface Playing {
  readonly url: string;
  close(): Promise<void>;
}

export async function play(o: PlayOptions): Promise<Playing> {
  const dir = resolve(o.dir);
  const g = readGameFolder(dir);
  const tplDir = templateDir(g.template, dir);
  const work = join(dir, ".netnet", "play");
  const clientOut = join(work, "client");
  const lib = o.libraryUrl ? null : libraryDir(dir);
  if (!o.libraryUrl && !lib) o.log("No asset library installed (@netnetcapital/asset-library-files): the game draws simple shapes. Pass --library-url <url> to load one from a mirror.");
  o.log(`Building ${g.names?.title ?? "your game"} (${g.template.label})...`);
  await buildClient(g, tplDir, clientOut, join(work, "vite-cache"));
  const bundle = await bundleHost(g, tplDir, join(work, "host.mjs"));
  const mod = (await import(pathToFileURL(bundle).href + `?t=${Date.now()}`)) as {
    startHost: (tpl: unknown, opts: unknown) => Promise<{ url: string; close(): Promise<void> }>;
    template: unknown;
  };
  const running = await mod.startHost(mod.template, {
    adapter: g.template.adapter,
    manifest: g.template.manifest,
    seats: g.template.seats,
    aoi: g.template.aoi,
    port: o.port,
    host: o.host,
    clientDir: clientOut,
    libraryDir: lib,
  });
  const params = new URLSearchParams({ server: running.url });
  if (o.libraryUrl) params.set("library", o.libraryUrl);
  const url = `${running.url}/?${params.toString()}`;
  o.log(`Playing locally with play money at ${url}`);
  o.log("Open the link in more tabs or windows for more players. Ctrl+C stops.");
  o.log("kit play runs the game's code on this computer with your permissions: play only games whose code you trust.");
  if (o.open) for (let i = 0; i < Math.max(1, o.players); i++) openBrowser(url);
  return { url, close: running.close };
}
