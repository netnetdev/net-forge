// Plays built solo demos headlessly and checks them: serves dist/solo-demos
// from a subpath (/games/<id>/) with a plain static server, opens each in
// Chrome over CDP (directly, then inside a sandboxed cross-origin iframe the
// way itch.io frames HTML5 games), presses Play, gives ~20 s of simulated
// input, and records whether the canvas drew, whether the game advanced,
// console errors, and every network request outside the build's own folder.
//
// usage: CHROME_BIN=<chrome or chrome-headless-shell> node scripts/verify-demo.mjs <demos dir> <shots dir> [id ...] [--seconds 20] [--frame-only|--direct-only]
// Prints one JSON line per run and a summary; exits 1 when any run fails.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";

const argv = process.argv.slice(2);
const flag = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1] === "--seconds"));
const [demosArg, shotsArg, ...only] = positional;
if (!demosArg || !shotsArg) {
  console.error("usage: node scripts/verify-demo.mjs <demos dir> <shots dir> [id ...]");
  process.exit(2);
}
const DEMOS = resolve(demosArg);
const SHOTS = resolve(shotsArg);
const SECONDS = Number(flag("seconds", "20"));
const MODES = argv.includes("--mobile") ? ["mobile"] : argv.includes("--frame-only") ? ["frame"] : argv.includes("--direct-only") ? ["direct"] : ["direct", "frame"];
const CHROME = process.env.CHROME_BIN;
if (!CHROME) {
  console.error("set CHROME_BIN to a Chrome or chrome-headless-shell binary");
  process.exit(2);
}
mkdirSync(SHOTS, { recursive: true });
const ids = (only.length ? only : readdirSync(DEMOS).filter((d) => existsSync(join(DEMOS, d, "index.html")))).sort();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png", ".glb": "model/gltf-binary", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".svg": "image/svg+xml", ".webp": "image/webp" };

// One server, two names: the game is served as 127.0.0.1 and the itch-like frame page as localhost, so the frame is cross-origin.
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const p = decodeURIComponent(url.pathname);
  if (p.startsWith("/frame/")) {
    const id = p.slice("/frame/".length);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#222}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style></head><body><iframe id="game" src="http://127.0.0.1:${port}/games/${id}/index.html" sandbox="allow-scripts allow-same-origin allow-pointer-lock" allow="autoplay; fullscreen; gamepad" allowfullscreen></iframe></body></html>`);
    return;
  }
  if (!p.startsWith("/games/")) {
    res.writeHead(404);
    res.end();
    return;
  }
  let rel = p.slice("/games/".length);
  if (rel.endsWith("/")) rel += "index.html";
  const file = resolve(DEMOS, "." + normalize("/" + rel));
  if (!file.startsWith(DEMOS + sep) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const port = server.address().port;
// localhost must reach the same server: listen there too on the same port.
const server2 = createServer((req, res) => server.emit("request", req, res));
await new Promise((ok, fail) => server2.listen(port, "localhost", ok).on("error", fail)).catch(() => undefined);

async function cdpConnect(debugPort) {
  let ws = null;
  for (let i = 0; i < 80 && !ws; i++) {
    await sleep(150);
    try {
      const v = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
      ws = new WebSocket(v.webSocketDebuggerUrl);
    } catch {
      // not up yet
    }
  }
  if (!ws) throw new Error("chrome did not come up");
  await new Promise((ok, fail) => {
    ws.onopen = ok;
    ws.onerror = () => fail(new Error("cdp socket"));
  });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(String(m.data));
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) fail(new Error(`${msg.error.message}`));
      else ok(msg.result ?? {});
    } else if (msg.method) listeners.forEach((l) => l(msg));
  };
  // Every call times out, so a renderer that stops answering fails the run instead of hanging it.
  const send = (method, params = {}, sessionId) =>
    new Promise((ok, fail) => {
      const i = ++id;
      const timer = setTimeout(() => {
        pending.delete(i);
        fail(new Error(`${method} timed out`));
      }, 15000);
      pending.set(i, { ok: (v) => (clearTimeout(timer), ok(v)), fail: (e) => (clearTimeout(timer), fail(e)) });
      ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return { send, on: (l) => listeners.push(l), close: () => ws.close() };
}

async function runOne(id, mode) {
  const debugPort = 9700 + Math.floor(Math.random() * 250);
  const profile = mkdtempSync(join(tmpdir(), "solo-verify-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${debugPort}`,
      "--window-size=1280,800",
      "--no-first-run",
      "--no-default-browser-check",
      "--use-mock-keychain",
      "--password-store=basic",
      `--user-data-dir=${profile}`,
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--autoplay-policy=no-user-gesture-required",
      "--use-angle=metal",
      "--disable-component-update",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-features=OptimizationHints,MediaRouter,Translate",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const result = { id, mode, ok: false, errors: [], external: [], requests: 0, problems: [] };
  try {
    const c = await cdpConnect(debugPort);
    const { targetId } = await c.send("Target.createTarget", { url: "about:blank" });
    const { sessionId: page } = await c.send("Target.attachToTarget", { targetId, flatten: true });
    const sessions = new Map([[page, "page"]]);
    let gameSession = mode === "frame" ? null : page;
    const mobile = mode === "mobile";
    if (mobile) {
      await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, page);
      await c.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, page);
    }
    const gameOrigin = `http://127.0.0.1:${port}`;
    const framePrefix = `http://localhost:${port}/frame/`;
    const allowed = (u) => u.startsWith(`${gameOrigin}/games/${id}/`) || u.startsWith(framePrefix) || u.startsWith("data:") || u.startsWith("blob:") || u === "about:blank";
    const enable = async (s) => {
      await c.send("Runtime.enable", {}, s).catch(() => undefined);
      await c.send("Network.enable", {}, s).catch(() => undefined);
      await c.send("Log.enable", {}, s).catch(() => undefined);
      await c.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, s).catch(() => undefined);
      await c.send("Runtime.runIfWaitingForDebugger", {}, s).catch(() => undefined);
    };
    // Frames that share the page's process (no out-of-process iframe target) are reached by their execution context.
    const contexts = new Map();
    c.on((msg) => {
      const s = msg.sessionId;
      if (msg.method === "Runtime.executionContextCreated" && s === page) {
        const ctx = msg.params.context;
        if (ctx.auxData?.isDefault && ctx.origin === gameOrigin) contexts.set(ctx.auxData.frameId, ctx.id);
      }
      if (msg.method === "Target.attachedToTarget") {
        const t = msg.params.targetInfo;
        sessions.set(msg.params.sessionId, t.type);
        if (t.type === "iframe" && t.url.startsWith(gameOrigin)) gameSession = msg.params.sessionId;
        void enable(msg.params.sessionId);
      } else if (msg.method === "Network.requestWillBeSent") {
        result.requests++;
        const u = msg.params.request.url;
        if (!allowed(u)) result.external.push(u);
      } else if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        result.errors.push(`[${sessions.get(s) ?? "?"}] exception: ${d.exception?.description ?? d.text}`.slice(0, 400));
      } else if (msg.method === "Runtime.consoleAPICalled" && (msg.params.type === "error" || msg.params.type === "assert")) {
        result.errors.push(`[${sessions.get(s) ?? "?"}] console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`.slice(0, 400));
      } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        result.errors.push(`[${sessions.get(s) ?? "?"}] log: ${msg.params.entry.text} ${msg.params.entry.url ?? ""}`.slice(0, 400));
      }
    });
    await enable(page);
    await c.send("Page.enable", {}, page);
    const url = mode === "frame" ? `${framePrefix}${id}` : `${gameOrigin}/games/${id}/`;
    await c.send("Page.navigate", { url }, page);
    const evalIn = async (expr) => {
      const ctxId = !gameSession && contexts.size > 0 ? [...contexts.values()].pop() : undefined;
      if (!gameSession && ctxId === undefined) return undefined;
      const r = await c
        .send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, ...(ctxId !== undefined ? { contextId: ctxId } : {}) }, gameSession ?? page)
        .catch((e) => ({ result: { value: `ERR ${e.message}` } }));
      return r.result?.value;
    };
    // The start screen.
    let button = null;
    for (let i = 0; i < 60 && !button; i++) {
      await sleep(250);
      button = await evalIn(`(() => { const b = document.querySelector('#nf-solo-start button'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: document.querySelector('#nf-solo-start')?.innerText ?? '' }; })()`);
    }
    if (!button) throw new Error("no start screen");
    result.startScreen = button.text.replace(/\s+/g, " ").trim();
    await sleep(1200);
    const shot = async (name) => {
      const r = await c.send("Page.captureScreenshot", { format: "png" }, page);
      const f = join(SHOTS, `${id}-${mode}-${name}.png`);
      writeFileSync(f, Buffer.from(r.data, "base64"));
      return f;
    };
    await shot("start");
    const mouse = (type, x, y, extra = {}) => c.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra }, page);
    const touch = (type, x, y) => c.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] }, page);
    const click = async (x, y) => {
      if (mobile) {
        await touch("touchStart", x, y);
        await sleep(60);
        await touch("touchEnd", x, y);
        return;
      }
      await mouse("mouseMoved", x, y, { button: "none" });
      await mouse("mousePressed", x, y);
      await sleep(60);
      await mouse("mouseReleased", x, y);
    };
    await click(button.x, button.y);
    const gone = await (async () => {
      for (let i = 0; i < 20; i++) {
        await sleep(100);
        if (await evalIn(`document.querySelector('#nf-solo-start')?.classList.contains('gone') ?? false`)) return true;
      }
      return false;
    })();
    if (!gone) result.problems.push("Play did not dismiss the start screen");
    const sample = () =>
      evalIn(`(() => {
        const g = window.__arena ?? window.__board ?? window.__crawl ?? window.__party ?? window.__platformer ?? window.__racer ?? window.__survivor ?? null;
        const cv = [...document.querySelectorAll('canvas')].map((c) => c.width * c.height).reduce((a, b) => Math.max(a, b), 0);
        const hud = (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 2000);
        return JSON.stringify({ solo: window.__solo ?? null, stats: g, canvas: cv, hud });
      })()`).then((s) => (typeof s === "string" && !s.startsWith("ERR") ? JSON.parse(s) : null));
    await sleep(2000);
    const first = await sample();
    // ~20 s of input: movement keys held in turn, the mouse sweeping and clicking, and any game buttons pressed now and then.
    const keyDefs = { w: ["KeyW", 87], a: ["KeyA", 65], s: ["KeyS", 83], d: ["KeyD", 68], ArrowUp: ["ArrowUp", 38], ArrowLeft: ["ArrowLeft", 37], ArrowRight: ["ArrowRight", 39], " ": ["Space", 32], "1": ["Digit1", 49], e: ["KeyE", 69] };
    const key = (type, k) => c.send("Input.dispatchKeyEvent", { type, key: k, code: keyDefs[k][0], windowsVirtualKeyCode: keyDefs[k][1], ...(type === "keyDown" && k.length === 1 ? { text: k } : {}) }, page);
    const plan = [["w", "d"], ["d"], ["s", "a"], ["a", "w"], ["ArrowUp", "ArrowRight"], ["ArrowUp", "ArrowLeft"], ["w", " "], ["d", "s"]];
    const t0 = Date.now();
    let step = 0;
    let midShot = null;
    while (Date.now() - t0 < SECONDS * 1000) {
      if (mobile) {
        // A thumb on the lower left (the joystick side), dragged around, then a tap on the right half.
        const ox = 90, oy = 700;
        await touch("touchStart", ox, oy);
        for (let j = 0; j < 8; j++) {
          const ang = (step * 8 + j) * 0.6;
          await touch("touchMove", ox + Math.cos(ang) * 50, oy + Math.sin(ang) * 50);
          await sleep(150);
        }
        await touch("touchEnd", ox, oy);
        await click(280 + (step % 3) * 30, 420);
        step++;
        if (!midShot && Date.now() - t0 > (SECONDS * 1000) / 2) midShot = await shot("mid");
        continue;
      }
      const held = plan[step % plan.length];
      for (const k of held) await key("keyDown", k);
      for (let j = 0; j < 6; j++) {
        const ang = (step * 6 + j) * 0.7;
        const x = 640 + Math.cos(ang) * 260;
        const y = 420 + Math.sin(ang) * 170;
        await mouse("mouseMoved", x, y, { button: "none" });
        if (j % 2 === 0) await click(x, y);
        await sleep(200);
      }
      if (step % 2 === 1) {
        // A game button, if the screen offers one (cards to play, towers to place, upgrades to buy), never the store, invite or sign-in.
        const b = await evalIn(`(() => { const bs = [...document.querySelectorAll('button')].filter((b) => !b.closest('#nf-solo-start') && !b.disabled && b.offsetParent && !/invite|sign|wallet|store|shop|buy|mute|sound|copy|share|stats|menu|settings|leave/i.test(b.innerText + ' ' + (b.id || '') + ' ' + (b.className || ''))); if (!bs.length) return null; const b = bs[${step} % bs.length]; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        if (b && typeof b === "object") await click(b.x, b.y);
      }
      if (step % 4 === 3) await key("keyDown", "1").then(() => key("keyUp", "1"));
      for (const k of held) await key("keyUp", k);
      step++;
      if (!midShot && Date.now() - t0 > (SECONDS * 1000) / 2) midShot = await shot("mid");
    }
    const last = await sample();
    result.shot = await shot("end");
    result.midShot = midShot;
    result.host = last?.solo?.host ?? null;
    result.snapshots = [first?.solo?.snapshots ?? 0, last?.solo?.snapshots ?? 0];
    result.canvas = last?.canvas ?? 0;
    const changed = [];
    const flat = (o, p = "", out = {}) => {
      if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) flat(v, p ? `${p}.${k}` : k, out);
      else out[p] = o;
      return out;
    };
    const a = flat(first?.stats ?? {});
    const b = flat(last?.stats ?? {});
    for (const k of Object.keys(b)) if (!/fps|frameMs|cpuMs|KBps|rttMs|pixelRatio|drawCalls|triangles|frames$/.test(k) && a[k] !== b[k] && (typeof b[k] === "number" || typeof b[k] === "string")) changed.push(`${k}: ${a[k]} -> ${b[k]}`);
    result.statsChanged = changed.slice(0, 14);
    result.hudChanged = (first?.hud ?? "") !== (last?.hud ?? "");
    result.hudEnd = (last?.hud ?? "").slice(0, 300);
    result.frames = [first?.stats?.frames ?? null, last?.stats?.frames ?? null];
    if (!(result.canvas > 0)) result.problems.push("no canvas drawn");
    if (!(result.snapshots[1] > result.snapshots[0])) result.problems.push("the room host sent no snapshots during play");
    if (!result.hudChanged && changed.length === 0) result.problems.push("nothing in the game changed during play");
    if (result.external.length) result.problems.push(`${result.external.length} requests outside the build`);
    if (result.errors.length) result.problems.push(`${result.errors.length} console errors`);
    result.ok = result.problems.length === 0;
    c.close();
  } catch (e) {
    result.problems.push(String(e?.message ?? e));
  } finally {
    chrome.kill("SIGKILL");
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }
  return result;
}

const results = [];
for (const id of ids) {
  for (const mode of MODES) {
    const r = await runOne(id, mode);
    results.push(r);
    console.log(JSON.stringify(r));
  }
}
server.close();
server2.close();
console.log("\nsummary:");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.id.padEnd(14)} ${r.mode.padEnd(6)} host=${r.host} snapshots=${r.snapshots?.join("->")} errors=${r.errors.length} external=${r.external.length}${r.problems.length ? `  ${r.problems.join("; ")}` : ""}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
