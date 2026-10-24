// A small Chrome DevTools Protocol client for the end-to-end test: launch
// headless Chrome, open a page, collect console errors and exceptions,
// evaluate expressions. Uses Node's global WebSocket, so no browser
// automation package is needed.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/** A headless Chrome binary: CHROME_PATH, else a puppeteer download, else a system Chrome. */
export function findChrome(): string | null {
  const env = process.env.CHROME_PATH;
  if (env && existsSync(env)) return env;
  const cache = join(homedir(), ".cache", "puppeteer");
  for (const kind of ["chrome-headless-shell", "chrome"]) {
    const base = join(cache, kind);
    if (!existsSync(base)) continue;
    for (const ver of readdirSync(base).sort().reverse()) {
      for (const sub of readdirSync(join(base, ver))) {
        const dir = join(base, ver, sub);
        const candidates = [
          join(dir, "chrome-headless-shell"),
          join(dir, "chrome-headless-shell.exe"),
          join(dir, "chrome"),
          join(dir, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        ];
        const hit = candidates.find((c) => existsSync(c));
        if (hit) return hit;
      }
    }
  }
  for (const c of ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]) if (existsSync(c)) return c;
  return null;
}

export interface PageProblems {
  readonly console: string[];
  readonly exceptions: string[];
  readonly network: string[];
  /** Browser interventions (a blocked API call such as navigator.vibrate before a tap): the browser's note, not a page error. */
  readonly interventions: string[];
}

export class Browser {
  private ws!: WebSocket;
  private id = 0;
  private waiting = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();
  readonly problems: PageProblems = { console: [], exceptions: [], network: [], interventions: [] };

  private constructor(
    private readonly proc: ChildProcess,
    private readonly profile: string,
  ) {}

  static async launch(binary: string, port: number): Promise<Browser> {
    const profile = mkdtempSync(join(tmpdir(), "nf-chrome-"));
    // Mock keychain and basic password store: no macOS keychain prompt for whoever runs the test.
    const args = [
      "--headless",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--use-mock-keychain",
      "--password-store=basic",
      "--no-first-run",
      "--no-default-browser-check",
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
      "--window-size=1280,800",
      "about:blank",
    ];
    const proc = spawn(binary, args, { stdio: "ignore" });
    const b = new Browser(proc, profile);
    let target: { webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; i < 100 && !target; i++) {
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
        target = list.find((t) => t.type === "page");
      } catch {
        // not up yet
      }
      if (!target) await new Promise((r) => setTimeout(r, 100));
    }
    if (!target) {
      await b.close();
      throw new Error("headless Chrome did not open a debugging port");
    }
    b.ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((ok, fail) => {
      b.ws.addEventListener("open", () => ok(), { once: true });
      b.ws.addEventListener("error", () => fail(new Error("CDP socket failed")), { once: true });
    });
    b.ws.addEventListener("message", (ev) => b.onMessage(String(ev.data)));
    await b.send("Runtime.enable");
    await b.send("Log.enable");
    await b.send("Page.enable");
    return b;
  }

  private onMessage(raw: string): void {
    const m = JSON.parse(raw) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: Record<string, unknown> };
    if (m.id !== undefined) {
      const w = this.waiting.get(m.id);
      this.waiting.delete(m.id);
      if (m.error) w?.fail(new Error(m.error.message));
      else w?.ok(m.result);
      return;
    }
    const p = m.params ?? {};
    if (m.method === "Runtime.consoleAPICalled" && p.type === "error") {
      const args = (p.args as { value?: unknown; description?: string }[] | undefined) ?? [];
      this.problems.console.push(args.map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? ""))).join(" "));
    } else if (m.method === "Runtime.exceptionThrown") {
      const d = p.exceptionDetails as { text?: string; exception?: { description?: string } } | undefined;
      this.problems.exceptions.push(d?.exception?.description ?? d?.text ?? "exception");
    } else if (m.method === "Log.entryAdded") {
      const e = p.entry as { level: string; source: string; text: string; url?: string };
      if (e.level !== "error") return;
      const bucket = e.source === "network" ? this.problems.network : e.source === "intervention" ? this.problems.interventions : this.problems.console;
      bucket.push(`${e.text}${e.url ? ` (${e.url})` : ""}`);
    }
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++this.id;
    return new Promise((ok, fail) => {
      this.waiting.set(id, { ok, fail });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async goto(url: string): Promise<void> {
    await this.send("Page.navigate", { url });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const r = (await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })) as { result: { value: T }; exceptionDetails?: { text: string } };
    if (r.exceptionDetails) throw new Error(`evaluate failed: ${r.exceptionDetails.text}`);
    return r.result.value;
  }

  async close(): Promise<void> {
    try {
      this.ws?.close();
    } catch {
      // already closed
    }
    const exited = new Promise<void>((done) => (this.proc.exitCode !== null ? done() : this.proc.once("exit", () => done())));
    this.proc.kill("SIGKILL");
    await exited;
    rmSync(this.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
