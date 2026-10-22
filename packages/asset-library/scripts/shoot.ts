/**
 * Render library pictures in headless Chrome through the viewer:
 *
 *   CHROME_BIN=... pnpm --filter @netnetcapital/asset-library shoot -- sheets --out <dir>   contact sheets of every model
 *   CHROME_BIN=... pnpm --filter @netnetcapital/asset-library shoot -- thumbs               gallery thumbnails into .library/thumbs
 *
 * Chrome runs with a throwaway profile, --use-mock-keychain and
 * --password-store=basic. Needs the built library in .library (see the README).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { galleryFor, idsForStyle, stockedStyles } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const args = process.argv.slice(2).filter((a) => a !== "--");
const what = args[0] ?? "sheets";
const outArg = args.includes("--out") ? args[args.indexOf("--out") + 1] : undefined;
const chromeBin = process.env.CHROME_BIN;
if (!chromeBin) throw new Error("set CHROME_BIN to a Chrome or chrome-headless-shell binary");
const PORT = 5480;
const DEBUG = 9480 + Math.floor(Math.random() * 400);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const children: ChildProcess[] = [];

async function waitFor(url: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error(`${url} did not come up`);
}

interface Cdp {
  send(method: string, params?: object): Promise<{ result?: { result?: { value?: unknown }; data?: string } }>;
}

async function cdp(): Promise<Cdp> {
  let target: { type: string; webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try {
      const list = (await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      target = list.find((t) => t.type === "page");
    } catch {
      // chrome not ready
    }
  }
  if (!target) throw new Error("chrome exposed no page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((ok, fail) => {
    ws.onopen = () => ok();
    ws.onerror = () => fail(new Error("cdp socket"));
  });
  let id = 0;
  const pending = new Map<number, (m: unknown) => void>();
  ws.onmessage = (m) => {
    const msg = JSON.parse(String(m.data)) as { id?: number };
    if (msg.id !== undefined) {
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    }
  };
  return {
    send: (method, params = {}) =>
      new Promise((r) => {
        const n = ++id;
        pending.set(n, r as (m: unknown) => void);
        ws.send(JSON.stringify({ id: n, method, params }));
      }),
  };
}

async function shot(c: Cdp, url: string, width: number, height: number, out: string): Promise<string[]> {
  await c.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await c.send("Page.navigate", { url });
  for (let i = 0; i < 240; i++) {
    await sleep(250);
    const r = await c.send("Runtime.evaluate", { expression: "window.__ready === true", returnByValue: true });
    if (r.result?.result?.value === true) break;
  }
  const errs = await c.send("Runtime.evaluate", { expression: "JSON.stringify(window.__errors ?? [])", returnByValue: true });
  const png = await c.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale: 1 } });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(png.result?.data ?? "", "base64"));
  return JSON.parse(String(errs.result?.result?.value ?? "[]")) as string[];
}

async function main(): Promise<void> {
  const vite = spawn(process.execPath, [resolve(pkg, "node_modules/vite/bin/vite.js"), "--config", "viewer/vite.config.ts", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: pkg, stdio: ["ignore", "ignore", "inherit"] });
  children.push(vite);
  await waitFor(`http://127.0.0.1:${PORT}/`, 30_000);
  const profile = mkdtempSync(join(tmpdir(), "nn-library-chrome-"));
  const chrome = spawn(
    chromeBin as string,
    ["--headless=new", `--remote-debugging-port=${DEBUG}`, "--window-size=1600,1200", "--no-first-run", "--no-default-browser-check", "--use-mock-keychain", "--password-store=basic", `--user-data-dir=${profile}`, "--use-angle=metal", "--enable-unsafe-webgpu", "about:blank"],
    { stdio: "ignore" },
  );
  children.push(chrome);
  try {
    const c = await cdp();
    await c.send("Page.enable");
    await c.send("Runtime.enable");
    const errors: string[] = [];
    if (what === "one") {
      // shoot one <library id> <appearance json> <out.png>
      const [, id = "", look = "", out = "one.png"] = args;
      const q = `?style=${id.split(".")[1] ?? "lowpoly"}&id=${encodeURIComponent(id)}${look ? `&look=${encodeURIComponent(look)}` : ""}&cell=256`;
      errors.push(...(await shot(c, `http://127.0.0.1:${PORT}/${q}`, 256, 256, resolve(out))));
      console.log(resolve(out));
    } else if (what === "thumbs") {
      for (const style of stockedStyles()) {
        for (const g of galleryFor(style)) {
          const out = join(pkg, ".library", g.thumb);
          errors.push(...(await shot(c, `http://127.0.0.1:${PORT}/?style=${style}&thumb=${g.id}`, 256, 256, out)));
          console.log(out);
        }
      }
    } else {
      const outDir = resolve(outArg ?? "library-sheets");
      const mode = args.includes("--crowd") ? "&mode=crowd" : "";
      for (const style of stockedStyles()) {
        const n = idsForStyle(style).length;
        for (let from = 0; from < n; from += 48) {
          const out = join(outDir, `${style}-${String(from).padStart(3, "0")}${mode ? "-crowd" : ""}.png`);
          errors.push(...(await shot(c, `http://127.0.0.1:${PORT}/?style=${style}&from=${from}&count=48&cols=8${mode}`, 8 * 160, 6 * 160, out)));
          console.log(out);
        }
      }
    }
    if (errors.length) console.log(`errors:\n${errors.join("\n")}`);
    rmSync(profile, { recursive: true, force: true });
  } finally {
    for (const ch of children) ch.kill();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  for (const ch of children) ch.kill();
  process.exit(1);
});
