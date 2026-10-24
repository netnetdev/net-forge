// End to end, the way a user meets it: pack the local packages with
// `pnpm pack` (what npm would serve), run the packed create-netforge to
// make games, install them from the tarballs with no network, then
// `kit-play test` and `tsc` on each, and `kit-play play --no-open` in
// headless Chrome for survivor and cards: the canvas renders and the page
// logs no errors.
//
//   pnpm --filter create-netforge test:e2e        (minutes; needs pnpm, and Chrome for the play step)
//
// CHROME_PATH picks the browser; ASSET_LIBRARY_DIR a built asset library
// (without one the games draw simple shapes). KEEP_E2E=1 keeps the work
// folder, with a screenshot per game.
//
// The Net Forge packages install from the tarballs (pnpm.overrides), never
// from the registry. Third-party packages come from the local pnpm store
// with --prefer-offline (the registry only for what the store lacks);
// E2E_OFFLINE=1 makes it --offline, for a machine whose store has them all.

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, findChrome } from "./cdp.js";

const PACKAGES = [
  "create-netforge",
  "kit-play",
  "engine",
  "engine-sim",
  "asset-library",
  "asset-library-files",
  "tabletop",
  "template-survivor",
  "template-arena",
  "template-tower",
  "template-dungeon",
  "template-idle",
  "template-platformer",
  "template-cards",
  "template-collector",
  "template-racer",
  "template-party",
];

const here = join(__dirname, "..", "..", "..");
const work = mkdtempSync(join(tmpdir(), "nf-e2e-"));
const packs = join(work, "packs");
const tarballs = new Map<string, string>();
let cli = "";

function sh(cmd: string, args: string[], cwd: string, timeout = 300_000): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1" } });
}

beforeAll(() => {
  mkdirSync(packs, { recursive: true });
  const libraryBuilt = existsSync(join(process.env.ASSET_LIBRARY_DIR ?? join(here, "asset-library", ".library"), "index.json"));
  for (const d of PACKAGES) {
    const dest = join(packs, d);
    if (d === "asset-library-files" && !libraryBuilt) {
      // No built asset library on this machine (ASSET_LIBRARY_DIR): pack the package without it, and the games draw simple shapes.
      const stub = join(work, "stub-asset-library-files");
      mkdirSync(stub, { recursive: true });
      for (const f of ["package.json", "LICENSE", "NOTICE", "README.md"]) cpSync(join(here, d, f), join(stub, f));
      sh("npm", ["pack", "--ignore-scripts", "--pack-destination", dest], stub);
    } else sh("pnpm", ["pack", "--pack-destination", dest], join(here, d));
    const file = readdirSync(dest).find((f) => f.endsWith(".tgz"));
    if (!file) throw new Error(`no tarball for ${d}`);
    const name = (JSON.parse(readFileSync(join(here, d, "package.json"), "utf8")) as { name: string }).name;
    tarballs.set(name, join(dest, file));
  }
  // The packed create-netforge, unpacked: what `npm create netforge` runs.
  const cn = join(work, "create-netforge");
  mkdirSync(cn);
  sh("tar", ["-xzf", tarballs.get("create-netforge") as string, "-C", cn], work);
  cli = join(cn, "package", "dist", "cli.js");
});

afterAll(() => {
  if (!process.env.KEEP_E2E) rmSync(work, { recursive: true, force: true });
});

/** Makes a game with the packed scaffolder, then points its Net Forge packages at the tarballs and installs offline. */
function makeGame(template: string): string {
  const out = sh(process.execPath, [cli, `game-${template}`, "--template", template, "--pm", "pnpm", "--no-install", "--no-git", "--json"], work);
  const summary = JSON.parse(out) as { dir: string; template: string; next: string[] };
  expect(summary.template).toBe(template);
  expect(summary.next).toEqual([`cd game-${template}`, "pnpm install", "pnpm play"]);
  const pkgFile = join(summary.dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as { devDependencies: Record<string, string>; pnpm?: unknown };
  const file = (name: string) => `file:${tarballs.get(name)}`;
  for (const name of Object.keys(pkg.devDependencies)) if (tarballs.has(name)) pkg.devDependencies[name] = file(name);
  pkg.pnpm = { overrides: Object.fromEntries([...tarballs.keys()].map((n) => [n, file(n)])), onlyBuiltDependencies: ["esbuild"] };
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
  sh("pnpm", ["install", process.env.E2E_OFFLINE ? "--offline" : "--prefer-offline", "--config.confirmModulesPurge=false"], summary.dir, 540_000);
  return summary.dir;
}

/** Starts `kit-play play --no-open` and resolves the URL it prints. */
function startPlay(dir: string, port: number): Promise<{ url: string; proc: ChildProcess; log: () => string }> {
  const proc = spawn(join(dir, "node_modules", ".bin", "kit-play"), ["play", "--no-open", "--port", String(port)], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`kit-play play printed no link in 180 s:\n${log}`)), 180_000);
    const on = (b: Buffer) => {
      log += b.toString();
      const m = /Playing locally with play money at (\S+)/.exec(log);
      if (m?.[1]) {
        clearTimeout(timer);
        ok({ url: m[1], proc, log: () => log });
      }
    };
    proc.stdout?.on("data", on);
    proc.stderr?.on("data", on);
    proc.once("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`kit-play play exited (${code}):\n${log}`));
    });
  });
}

const chrome = findChrome();

/** A free TCP port on this computer. */
function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.once("error", fail);
    srv.listen(0, "127.0.0.1", () => {
      const a = srv.address();
      srv.close(() => (a && typeof a === "object" ? ok(a.port) : fail(new Error("no port"))));
    });
  });
}

describe.each(["survivor", "cards"] as const)("a new %s game", (template) => {
  let dir = "";

  it("is made by the packed create-netforge and installs from the tarballs offline", () => {
    dir = makeGame(template);
    const files = readdirSync(dir);
    for (const f of ["AGENTS.md", "CLAUDE.md", ".mcp.json", "README.md", "netnet.json", "llms.txt", "src", "node_modules"]) expect(files, f).toContain(f);
  });

  it("passes kit-play test and the TypeScript check", () => {
    const r = JSON.parse(sh(join(dir, "node_modules", ".bin", "kit-play"), ["test", "--json"], dir)) as { ok: boolean };
    expect(r.ok).toBe(true);
    sh("pnpm", ["typecheck"], dir);
  });

  it.skipIf(!chrome)("plays headless: the canvas renders and the page logs no errors", async () => {
    const play = await startPlay(dir, await freePort());
    const browser = await Browser.launch(chrome as string, await freePort());
    try {
      await browser.goto(play.url);
      let canvas: { w: number; h: number } | null = null;
      for (let i = 0; i < 60 && !canvas; i++) {
        await new Promise((r) => setTimeout(r, 500));
        canvas = await browser.evaluate<{ w: number; h: number } | null>(`(() => { const c = [...document.querySelectorAll("canvas")].find((c) => c.width > 0 && c.height > 0); return c ? { w: c.width, h: c.height } : null; })()`);
      }
      expect(canvas, "a canvas with a size").not.toBeNull();
      // Let it draw and talk to the local room for a few seconds.
      await new Promise((r) => setTimeout(r, 6000));
      const shot = (await browser.send("Page.captureScreenshot", { format: "png" })) as { data: string };
      const png = Buffer.from(shot.data, "base64");
      writeFileSync(join(work, `${template}.png`), png);
      // A blank frame compresses to a few hundred bytes; a drawn scene does not.
      expect(png.length).toBeGreaterThan(8000);
      expect(browser.problems.exceptions).toEqual([]);
      expect(browser.problems.console).toEqual([]);
      expect(browser.problems.network).toEqual([]);
      if (browser.problems.interventions.length > 0) console.info(`[e2e] ${template}: browser interventions (not page errors): ${browser.problems.interventions.join(" | ")}`);
    } finally {
      await browser.close();
      play.proc.kill("SIGINT");
    }
  });
});
