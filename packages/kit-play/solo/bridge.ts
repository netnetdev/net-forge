// The page side of the solo demo: one connection to the room host, which
// runs in a Web Worker (or in the page when workers are unavailable). The
// Colyseus stand-in (colyseus.ts) and the fetch hook (page.ts) both talk
// through it.

import type { MessageType, ToHost, ToPage } from "./protocol.js";

type Listener = (type: MessageType, data: unknown) => void;

interface Port {
  post(m: ToHost, transfer?: Transferable[]): void;
}

let port: Port | null = null;
let fallingBack = false;
const queued: Array<{ m: ToHost; transfer?: Transferable[] }> = [];
const httpWaits = new Map<number, (r: { status: number; body: string }) => void>();
const openWaits = new Map<number, (r: Extract<ToPage, { t: "opened" }>) => void>();
const sessions = new Map<string, { listen: Listener; closed: () => void }>();
const fatalCbs: Array<(message: string) => void> = [];
let nextId = 1;
let fatal: string | null = null;
/** Counters a test or a curious player can read: snapshots and messages from the host, and where the host runs. */
const counters = { host: "starting" as "starting" | "worker" | "page", snapshots: 0, messages: 0, runs: 0 };
(globalThis as { __solo?: typeof counters }).__solo = counters;

function receive(m: ToPage): void {
  switch (m.t) {
    case "ready":
      return;
    case "fatal":
      fatal = m.message;
      fatalCbs.forEach((cb) => cb(m.message));
      return;
    case "http":
      httpWaits.get(m.id)?.({ status: m.status, body: m.body });
      httpWaits.delete(m.id);
      return;
    case "opened":
      openWaits.get(m.id)?.(m);
      openWaits.delete(m.id);
      return;
    case "msg":
      counters.messages++;
      if (m.type === "run") counters.runs++;
      sessions.get(m.session)?.listen(m.type, m.data);
      return;
    case "bytes":
      counters.snapshots++;
      sessions.get(m.session)?.listen(m.type, m.bytes);
      return;
    case "closed":
      sessions.get(m.session)?.closed();
      sessions.delete(m.session);
      return;
  }
}

/** Runs the host in this page: the fallback when a module worker cannot start. */
async function inPage(): Promise<Port> {
  const { startInPage } = await import("./inpage.js");
  return startInPage(receive);
}

function fallBack(): void {
  if (fallingBack) return;
  fallingBack = true;
  port = null;
  void inPage().then(
    (p) => {
      port = p;
      counters.host = "page";
      for (const q of queued.splice(0)) p.post(q.m, q.transfer);
    },
    (e: unknown) => receive({ t: "fatal", message: e instanceof Error ? e.message : String(e) }),
  );
}

function connect(): void {
  if (port || fallingBack) return;
  let worker: Worker;
  try {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "netforge-solo-host" });
  } catch {
    fallBack();
    return;
  }
  let ready = false;
  worker.onmessage = (e: MessageEvent<ToPage>) => {
    if (e.data.t === "ready" && !ready) {
      ready = true;
      port = { post: (m, transfer) => worker.postMessage(m, transfer ?? []) };
      counters.host = "worker";
      for (const q of queued.splice(0)) port.post(q.m, q.transfer);
    }
    receive(e.data);
  };
  worker.onerror = (e) => {
    // A worker that never came up (no module workers, a blocked worker URL) falls back to the page.
    if (!ready) {
      e.preventDefault();
      worker.terminate();
      fallBack();
    }
  };
}

function post(m: ToHost, transfer?: Transferable[]): void {
  connect();
  if (port) port.post(m, transfer);
  else queued.push(transfer ? { m, transfer } : { m });
}

/** Starts the host now (it compiles the sim and physics) so pressing Play is quick. */
export function warmUp(): void {
  connect();
}

export function onFatal(cb: (message: string) => void): void {
  fatalCbs.push(cb);
  if (fatal) cb(fatal);
}

export function http(method: string, path: string, headers: Record<string, string>, body: string | null): Promise<{ status: number; body: string }> {
  const id = nextId++;
  return new Promise((resolve) => {
    httpWaits.set(id, resolve);
    post({ t: "http", id, method, path, headers, body });
  });
}

export function open(token: string, listen: Listener, closed: () => void): Promise<{ roomId: string; session: string }> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    openWaits.set(id, (r) => {
      if (!r.ok || !r.session || !r.roomId) return reject(new Error(r.error ?? "could not join"));
      sessions.set(r.session, { listen, closed });
      resolve({ roomId: r.roomId, session: r.session });
    });
    post({ t: "open", id, token });
  });
}

export function send(session: string, type: MessageType, data: unknown): void {
  post({ t: "send", session, type, data });
}

export function sendBytes(session: string, type: number, bytes: Uint8Array): void {
  const copy = bytes.slice();
  post({ t: "bytes", session, type, bytes: copy }, [copy.buffer]);
}

export function leave(session: string): void {
  post({ t: "leave", session });
}
