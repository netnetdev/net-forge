// play_locally: starts `kit-play` for a game folder in a child process and
// returns the URL once the page and the local room are up. One session per
// folder; the sessions stop when the MCP server exits or on stop.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { packageRoot } from "./locate.js";

interface Session {
  readonly dir: string;
  readonly url: string;
  readonly port: number;
  readonly child: ChildProcess;
  readonly started: number;
}

const sessions = new Map<string, Session>();
let hooked = false;

function stopAll(): void {
  for (const s of sessions.values()) s.child.kill("SIGTERM");
  sessions.clear();
}

export interface PlayResult {
  readonly ok: boolean;
  readonly url: string | null;
  readonly running: boolean;
  readonly message: string;
  readonly log: readonly string[];
}

export async function playLocally(o: { projectDir: string; port?: number | undefined; host?: string | undefined; stop?: boolean | undefined; timeoutMs?: number | undefined }): Promise<PlayResult> {
  const dir = resolve(o.projectDir);
  const existing = sessions.get(dir);
  if (o.stop) {
    if (!existing) return { ok: true, url: null, running: false, message: "No local session was running for that folder.", log: [] };
    existing.child.kill("SIGTERM");
    sessions.delete(dir);
    return { ok: true, url: null, running: false, message: `Stopped the local session at ${existing.url}.`, log: [] };
  }
  if (existing && existing.child.exitCode === null) return { ok: true, url: existing.url, running: true, message: "Already running. Open the URL; pass stop: true to stop it.", log: [] };

  if (!existsSync(join(dir, "netnet.json"))) return { ok: false, url: null, running: false, message: `No netnet.json in ${dir}. Pass the game folder netforge_create_game made.`, log: [] };
  const root = packageRoot("@netforge/kit-play", dir);
  if (!root) return { ok: false, url: null, running: false, message: "@netforge/kit-play is not installed. Run npm install in the game folder.", log: [] };
  const port = o.port ?? 4663;
  const args = [join(root, "dist", "cli.js"), dir, "--no-open", "--port", String(port), "--host", o.host ?? "127.0.0.1"];
  const child = spawn(process.execPath, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  if (!hooked) {
    hooked = true;
    process.once("exit", stopAll);
  }
  const log: string[] = [];
  const timeoutMs = o.timeoutMs ?? 240_000;
  return new Promise<PlayResult>((done) => {
    let settled = false;
    const finish = (r: PlayResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done(r);
    };
    const onData = (d: Buffer) => {
      for (const line of d.toString().split("\n")) {
        if (!line.trim()) continue;
        if (log.length < 60) log.push(line.slice(0, 400));
        const m = /Playing locally with play money at (\S+)/.exec(line);
        if (m?.[1]) {
          sessions.set(dir, { dir, url: m[1], port, child, started: Date.now() });
          finish({ ok: true, url: m[1], running: true, message: "Running with play money on this computer. Open the URL in a browser; more tabs are more players. Call play_locally with stop: true to stop it.", log });
        }
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    // Without this a failed spawn is an unhandled 'error' event and takes the MCP server down.
    child.on("error", (err) => {
      sessions.delete(dir);
      finish({ ok: false, url: null, running: false, message: `kit-play could not start: ${err.message}`, log });
    });
    child.on("exit", (code) => {
      sessions.delete(dir);
      finish({ ok: false, url: null, running: false, message: `kit-play exited (code ${code}) before the game was up. Read the log; a port in use needs another port.`, log });
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ ok: false, url: null, running: false, message: `kit-play was not up after ${Math.round(timeoutMs / 1000)} s; stopped it.`, log });
    }, timeoutMs);
  });
}

export function stopAllSessions(): void {
  stopAll();
}
