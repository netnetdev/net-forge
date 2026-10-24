// The local play host's HTTP side, on one port: the built game page, the
// asset library, the seat request (POST /world/join) and in-memory profiles,
// with Colyseus behind them for the room itself. It binds to 127.0.0.1
// unless told otherwise. Sign-in, the referee and every money route answer
// 403: local play has none of them.

import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, normalize, resolve, sep } from "node:path";
import { defineRoom, defineServer, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "@netforge/engine/net";
import { LOCAL_ONLY, LocalRoom, setLocalGame, type LocalGame } from "./room.js";
import { isGuestId } from "./profile.js";

export interface HostOptions {
  readonly port: number;
  /** Interface to bind; 127.0.0.1 keeps the game on this computer. */
  readonly host: string;
  /** The built client (index.html and its assets). */
  readonly clientDir: string;
  /** The built asset library (index.json and the style folders), or null to serve none. */
  readonly libraryDir: string | null;
}

export interface RunningHost {
  readonly url: string;
  close(): Promise<void>;
}

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".glb": "model/gltf-binary",
  ".ktx2": "image/ktx2",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".woff2": "font/woff2",
};

const MAX_BODY = 64 * 1024;
/** Rooms one local host keeps open at once (each runs its own sim). */
export const MAX_ROOMS = 8;

function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** A file under `root` for a request path, or null (never outside root). */
export function fileUnder(root: string, urlPath: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (rel.includes("\0")) return null;
  const base = resolve(root);
  const file = resolve(base, "." + normalize("/" + rel));
  if (file !== base && !file.startsWith(base + sep)) return null;
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

function serveFile(res: ServerResponse, file: string): void {
  res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-cache" });
  res.end(readFileSync(file));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        fail(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (chunks.length === 0) return ok({});
      try {
        ok(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
      } catch {
        ok({});
      }
    });
    req.on("error", fail);
  });
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});

async function joinSeat(g: LocalGame, body: Obj): Promise<unknown> {
  if (body.template !== g.template) throw new Error(`this host plays the ${g.template} template`);
  const place = typeof body.place === "string" && body.place.length > 0 && body.place.length <= 64 ? body.place : g.place;
  const rooms = await matchMaker.query({ name: ROOM_NAME });
  const open = rooms.find((r) => (r.metadata as { place?: string } | undefined)?.place === place && !r.locked && r.clients < r.maxClients);
  if (!open && rooms.length >= MAX_ROOMS) throw new Error("too many rooms on this computer");
  const room = open ?? (await matchMaker.createRoom(ROOM_NAME, { place, template: g.template }));
  const reservation = await matchMaker.reserveSeatFor(room, isGuestId(body.guest) ? { guest: body.guest } : {});
  return { roomId: room.roomId, reason: open ? "joined" : "created", reservations: [reservation] };
}

async function route(g: LocalGame, o: HostOptions, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://local");
  const path = url.pathname;
  if (path === "/health") return send(res, 200, { ok: true, local: true, template: g.template }), true;
  if (path.startsWith("/auth/") || path.startsWith("/referee/") || path.startsWith("/admin/")) return send(res, 403, { error: LOCAL_ONLY }), true;
  if (path === "/world/join" && req.method === "POST") {
    try {
      send(res, 200, await joinSeat(g, obj(await readBody(req))));
    } catch (e) {
      send(res, 409, { error: e instanceof Error ? e.message : "join failed" });
    }
    return true;
  }
  if (path.startsWith("/profile")) {
    const guest = req.headers["x-guest-id"];
    const id = isGuestId(guest) ? `g:${guest}` : null;
    if (req.method === "GET" && path.startsWith("/profile/game/")) return send(res, 200, g.profiles.view(id)), true;
    if (req.method === "GET" && path === "/profile") return send(res, 200, { kind: id ? "guest" : null, wallet: null, displayName: null, settings: {}, totals: { achievements: 0, titles: 0, games: 0 }, games: [] }), true;
    if (req.method !== "POST") return send(res, 405, { error: "method" }), true;
    let body: Obj;
    try {
      body = obj(await readBody(req));
    } catch {
      return send(res, 413, { error: "body too large" }), true;
    }
    if (!id) return send(res, 400, { error: "a guest id is required" }), true;
    if (path === "/profile/settings") g.profiles.settings(id, body.settings);
    else if (path === "/profile/name") g.profiles.name(id, body.displayName);
    else if (path === "/profile/redeem") {
      const r = g.profiles.redeem(id, typeof body.item === "string" ? body.item : "");
      if (!r.ok) return send(res, 400, { error: r.error ?? "refused" }), true;
    } else if (path !== "/profile/import" && path !== "/profile/claim") return send(res, 404, { error: "not found" }), true;
    return send(res, 200, g.profiles.view(id)), true;
  }
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 404, { error: "not found" }), true;
  if (path.startsWith("/library/")) {
    const file = o.libraryDir ? fileUnder(o.libraryDir, path.slice("/library/".length)) : null;
    if (!file) return send(res, 404, { error: "not in the asset library" }), true;
    return serveFile(res, file), true;
  }
  const file = fileUnder(o.clientDir, path === "/" ? "index.html" : path.slice(1));
  if (!file) return send(res, 404, { error: "not found" }), true;
  serveFile(res, file);
  return true;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** The host name of a Host header value ("192.168.1.5:4663", "[fe80::1]:4663"), lower case. */
function hostName(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end > 0 ? h.slice(0, end + 1) : h;
  }
  return h.replace(/:\d+$/, "");
}

/**
 * A name a DNS rebinding page cannot put in the Host header: an IP literal,
 * localhost, or an mDNS .local name (resolved on the network itself, never
 * by a public DNS server an attacker controls).
 */
function directName(name: string): boolean {
  return LOOPBACK.has(name) || /^\d{1,3}(\.\d{1,3}){3}$/.test(name) || /^\[[0-9a-f:.]+\]$/.test(name) || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.local$/.test(name);
}

/**
 * On a loopback bind, only requests addressed to this computer by name are
 * answered (a page elsewhere that rebinds its own host name to 127.0.0.1
 * gets 403). On any other bind (--host 0.0.0.0 for phones on the network)
 * the Host must still be an address, not a DNS name, so the same rebinding
 * trick fails there too. Either way only same-origin or non-browser
 * requests may POST or open a WebSocket.
 */
export function allowedRequest(bindHost: string, port: number, host: string | undefined, origin: string | undefined, method: string | undefined): boolean {
  const loopback = LOOPBACK.has(bindHost);
  const name = hostName(host ?? "");
  if (loopback ? !LOOPBACK.has(name) : !directName(name)) return false;
  if (method === "GET" || method === "HEAD" || origin === undefined) return true;
  try {
    const o = new URL(origin);
    const oName = o.hostname.toLowerCase();
    if (o.protocol !== "http:" || Number(o.port || 80) !== port) return false;
    return loopback ? LOOPBACK.has(oName) : oName === name || (LOOPBACK.has(oName) && LOOPBACK.has(name));
  } catch {
    return false;
  }
}

export async function startServer(g: LocalGame, o: HostOptions): Promise<RunningHost> {
  setLocalGame(g);
  const http = createServer();
  const emit = http.emit.bind(http) as (event: string | symbol, ...args: unknown[]) => boolean;
  // Our routes answer first; Colyseus sees only what is left (the WebSocket upgrades that consume a seat).
  http.emit = ((event: string | symbol, ...args: unknown[]): boolean => {
    if (event !== "request") return emit(event, ...args);
    const req = args[0] as IncomingMessage;
    const res = args[1] as ServerResponse;
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    if (!allowedRequest(o.host, o.port, req.headers.host, origin, req.method)) return send(res, 403, { error: "local play answers this computer only" }), true;
    // Seats come only from /world/join; Colyseus' own HTTP matchmaking (which could open rooms without limit) is closed.
    if (path.startsWith("/matchmake")) return send(res, 403, { error: "seats come from /world/join" }), true;
    void route(g, o, req, res).catch(() => send(res, 500, { error: "local host error" }));
    return true;
  }) as typeof http.emit;
  // WebSocket upgrades pass the same Host and Origin check as requests.
  const upgradeEmit = http.emit;
  http.emit = ((event: string | symbol, ...args: unknown[]): boolean => {
    if (event === "upgrade") {
      const req = args[0] as IncomingMessage;
      const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
      if (!allowedRequest(o.host, o.port, req.headers.host, origin, "POST")) {
        (args[1] as { destroy(): void }).destroy();
        return true;
      }
    }
    return (upgradeEmit as (event: string | symbol, ...a: unknown[]) => boolean).call(http, event, ...args);
  }) as typeof http.emit;
  const server = defineServer({
    transport: new WebSocketTransport({ server: http, pingInterval: 5000, pingMaxRetries: 3 }),
    rooms: { [ROOM_NAME]: defineRoom(LocalRoom) },
    greet: false,
    gracefullyShutdown: false,
  });
  await server.listen(o.port, o.host);
  const shown = o.host === "0.0.0.0" || o.host === "::" ? "localhost" : o.host;
  return {
    url: `http://${shown}:${o.port}`,
    close: async () => {
      await server.gracefullyShutdown(false).catch(() => undefined);
      http.close();
    },
  };
}

