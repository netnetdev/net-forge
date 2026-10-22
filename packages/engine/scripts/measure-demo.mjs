#!/usr/bin/env node
// Measure the arena demo in headless Chrome over raw CDP (no puppeteer dependency).
//
//   pnpm --filter @netnetcapital/engine demo:build
//   pnpm --filter @netnetcapital/engine exec vite preview --config demo/vite.config.ts --port 5311 &
//   CHROME_BIN=/path/to/chrome node scripts/measure-demo.mjs "http://localhost:5311/?autopilot=1" [seconds] [extra chrome flags...]
//
// Prints the page's window.__arena stats as JSON after warm-up, and saves a
// screenshot next to the script's cwd as measure-<backend>.png.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [url = "http://localhost:5311/?autopilot=1", secondsArg = "20", ...extra] = process.argv.slice(2);
const seconds = Number(secondsArg);
const bin = process.env.CHROME_BIN;
if (!bin) throw new Error("set CHROME_BIN to a Chrome or chrome-headless-shell binary");
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(
  bin,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    "--window-size=1280,720",
    "--no-first-run",
    "--no-default-browser-check",
    // Never touch the macOS keychain ("Chromium Safe Storage" prompt).
    "--use-mock-keychain",
    "--password-store=basic",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    `--user-data-dir=${process.env.MEASURE_PROFILE_DIR ?? process.env.TMPDIR ?? "/tmp"}/engine-measure-${port}`,
    ...extra,
    "about:blank",
  ],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === "page");
    } catch {}
  }
  if (!target) throw new Error("chrome did not expose a page target");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === "Runtime.consoleAPICalled") {
      logs.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
    } else if (msg.method === "Runtime.exceptionThrown") {
      logs.push("EXC " + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text));
    }
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const n = ++id;
      pending.set(n, r);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.result?.value;
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url });
  await sleep(seconds * 1000);
  const stats = await evaluate("JSON.stringify(window.__arena ?? null)");
  const gpu = await evaluate(
    "(async()=>{try{const a=await navigator.gpu?.requestAdapter();return a?JSON.stringify(a.info??{}):'no adapter'}catch(e){return String(e)}})()",
  );
  const err = await evaluate("document.getElementById('err')?.textContent ?? ''");
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const parsed = stats ? JSON.parse(stats) : null;
  if (shot.result?.data) writeFileSync(`measure-${parsed?.backend ?? "none"}.png`, Buffer.from(shot.result.data, "base64"));
  console.log(JSON.stringify({ url, seconds, gpu, stats: parsed, error: err || undefined, logs: logs.slice(0, 10) }, null, 2));
  ws.close();
} finally {
  chrome.kill("SIGKILL");
}
