// The solo demo's room host: the same authoritative loop `kit play` runs
// in Node (LocalCore, LocalProfiles and the room rules of host/room.ts),
// without Colyseus or an HTTP server. It answers the page's seat request
// and profile routes, and plays one room for the person at the screen.
// Play money only: no wallets, no sign-in, no stakes, no pots, no claims.

import { initSim } from "@netforge/engine-sim";
import { packMeta, profileSpec, RESERVED_COMMANDS, type ProfileSpec } from "@netforge/engine/game";
import type { GameManifest } from "@netforge/engine";
import {
  MSG_INPUT,
  MSG_SNAPSHOT,
  type CommandMessage,
  type CommandResult,
  type EarnMessage,
  type PlayerId,
  type PotMessage,
  type ProgressEvent,
  type RebaseMessage,
  type SignInResult,
  type SimAdapter,
  type StakeMessage,
  type WelcomeMessage,
} from "@netforge/engine/net";
import { LocalCore, SNAPSHOT_HZ } from "../src/host/core.js";
import { isGuestId, LocalProfiles } from "../src/host/profile.js";
import type { MessageType, SoloEntry, ToHost, ToPage } from "./protocol.js";

export const LOCAL_ONLY = "This demo uses play money only";
const INFO_EVERY_TICKS = 15;
/** Most ticks one wake-up catches up on after a stall (a background tab): the rest are dropped, as a server would. */
const MAX_CATCH_UP = 5;

type Post = (m: ToPage, transfer?: ArrayBuffer[]) => void;
type Fn = (...args: unknown[]) => unknown;

interface Seat {
  readonly session: string;
  readonly player: PlayerId;
  entity: number;
  profile: string | null;
  lastInfo?: string;
  metaApplied: number;
}

interface Game {
  readonly sim: SimAdapter<unknown, unknown>;
  readonly template: string;
  readonly place: string;
  readonly seats: number;
  readonly aoi: SoloEntry["aoi"];
  readonly profile: ProfileSpec | null;
  readonly profiles: LocalProfiles;
  readonly storeCommands: ReadonlySet<string>;
}

function parseCommand(raw: unknown): CommandMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== "string" || o.name.length === 0 || o.name.length > 32) return null;
  const value = typeof o.value === "number" && Number.isFinite(o.value) ? o.value : undefined;
  return { name: o.name, ...(value !== undefined ? { value } : {}) };
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});

/** One room: the LocalRoom of host/room.ts, driven by a timer instead of Colyseus. */
class SoloRoom {
  readonly roomId = `solo-${Math.random().toString(36).slice(2, 10)}`;
  private readonly core: LocalCore<unknown, unknown>;
  private readonly seats = new Map<string, Seat>();
  private readonly byPlayer = new Map<PlayerId, Seat>();
  private readonly unsubscribe: () => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private next = 0;

  constructor(
    private readonly g: Game,
    private readonly post: Post,
  ) {
    this.core = new LocalCore(g.sim, g.aoi, (Math.random() * 2 ** 31) | 0);
    this.unsubscribe = g.profiles.onChange((id) => {
      for (const seat of this.seats.values()) if (seat.profile === id) this.applyProfile(seat);
    });
  }

  get full(): boolean {
    return this.seats.size >= this.g.seats;
  }

  get empty(): boolean {
    return this.seats.size === 0;
  }

  private send(seat: Seat, type: MessageType, data: unknown): void {
    this.post({ t: "msg", session: seat.session, type, data });
  }

  join(session: string, guest: unknown): void {
    const { player, entity } = this.core.addPlayer();
    const seat: Seat = { session, player, entity, profile: isGuestId(guest) ? `g:${guest}` : null, metaApplied: 0 };
    this.seats.set(session, seat);
    this.byPlayer.set(player, seat);
    const sim = this.g.sim;
    const welcome: WelcomeMessage = {
      player,
      entity,
      tickHz: sim.tickHz,
      snapshotHz: SNAPSHOT_HZ,
      sim: sim.name,
      version: sim.version,
      place: this.g.place,
      template: this.g.template,
      runId: null,
      earnLive: false,
    };
    this.send(seat, "welcome", welcome);
    this.applyProfile(seat);
    this.sendInfo(seat, true);
    if (!this.timer) {
      this.next = performance.now();
      this.loop();
    }
  }

  leave(session: string): void {
    const seat = this.seats.get(session);
    if (!seat) return;
    this.seats.delete(session);
    this.byPlayer.delete(seat.player);
    this.core.removePlayer(seat.player);
    this.post({ t: "closed", session });
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribe();
    this.core.dispose();
  }

  bytes(session: string, type: number, bytes: Uint8Array): void {
    const seat = this.seats.get(session);
    if (seat && type === MSG_INPUT) this.core.receiveInput(seat.player, bytes);
  }

  message(session: string, type: MessageType, raw: unknown): void {
    const seat = this.seats.get(session);
    if (!seat) return;
    const sim = this.g.sim;
    switch (type) {
      case "command": {
        const cmd = parseCommand(raw);
        if (!cmd) return;
        const reply = (r: CommandResult) => this.send(seat, "command-result", r);
        if (!sim.command) return reply({ name: cmd.name, ok: false, reason: "no store in this game" });
        if (RESERVED_COMMANDS.has(cmd.name)) return reply({ name: cmd.name, ok: false, reason: "not for sale" });
        const sold = cmd.name === "cosmetic" ? this.g.profiles.ownsCosmetic(seat.profile, cmd.value ?? 0) : this.g.storeCommands.has(cmd.name);
        if (!sold) return reply({ name: cmd.name, ok: false, reason: "not for sale" });
        const ok = this.core.command(seat.player, { name: cmd.name, ...(cmd.value !== undefined ? { value: cmd.value } : {}) });
        return reply(ok ? { name: cmd.name, ok } : { name: cmd.name, ok, reason: "not applicable now" });
      }
      case "stake":
        return this.send(seat, "stake", { state: "refused", stake: 0, reason: LOCAL_ONLY } satisfies StakeMessage);
      case "pot":
        return this.send(seat, "pot", { state: "refused", entry: 0, reason: LOCAL_ONLY } satisfies PotMessage);
      case "sign-in":
        return this.send(seat, "sign-in-result", { ok: false, runId: null, earnRefused: "guest" } satisfies SignInResult);
      case "claim":
        return this.send(seat, "attest-error", LOCAL_ONLY);
      case "ping":
        return this.send(seat, "pong", raw);
      default:
        return;
    }
  }

  /** A fixed-rate loop that catches up after short stalls, like Colyseus' simulation interval. */
  private loop(): void {
    const dt = 1000 / this.g.sim.tickHz;
    const now = performance.now();
    let n = 0;
    while (this.next <= now && n < MAX_CATCH_UP) {
      this.tickOnce();
      this.next += dt;
      n++;
    }
    if (this.next <= now) this.next = now + dt;
    this.timer = setTimeout(() => this.loop(), Math.max(0, this.next - performance.now()));
  }

  private applyProfile(seat: Seat): void {
    const keepers = this.g.profiles.keepers(seat.profile);
    this.core.setRights(seat.player, keepers ? { keepers } : null);
    const spec = this.g.profile;
    if (spec && spec.economy.metaUpgrades && spec.meta.size > 0) {
      const value = packMeta(spec, this.g.profiles.metaLevels(seat.profile));
      if (value !== seat.metaApplied) {
        this.core.command(seat.player, { name: "meta", value });
        seat.metaApplied = value;
      }
    }
    this.send(seat, "profile", this.g.profiles.view(seat.profile));
  }

  private sendInfo(seat: Seat, force: boolean): void {
    const sim = this.g.sim;
    if (sim.infoFor) {
      const v = sim.infoFor(this.core.world, seat.player);
      if (v === null || v === undefined) return;
      const json = JSON.stringify(v);
      if (!force && json === seat.lastInfo) return;
      seat.lastInfo = json;
      this.send(seat, "run", v);
      return;
    }
    const info = sim.info?.(this.core.world);
    if (info) this.send(seat, "run", info);
  }

  private recordProgress(e: ProgressEvent): void {
    if (!this.g.profile) return;
    const seat = this.byPlayer.get(e.player);
    if (seat?.profile) this.g.profiles.record(seat.profile, e.kind, e.id);
  }

  private tickOnce(): void {
    const res = this.core.step();
    let reset = false;
    for (const e of res.events) {
      if (e.type === "run.reset") reset = true;
      else if (e.type === "progress") this.recordProgress(e);
      else {
        const seat = this.byPlayer.get(e.player);
        if (seat) this.send(seat, "earn", { rule: e.rule, units: e.units } satisfies EarnMessage);
      }
    }
    for (const [player, bytes] of res.snapshots) {
      const seat = this.byPlayer.get(player);
      if (!seat) continue;
      const copy = bytes.slice();
      this.post({ t: "bytes", session: seat.session, type: MSG_SNAPSHOT, bytes: copy }, [copy.buffer as ArrayBuffer]);
    }
    const sim = this.g.sim;
    if (res.tick % (sim.infoEveryTicks ?? INFO_EVERY_TICKS) === 0) {
      if (sim.infoFor) {
        for (const seat of this.seats.values()) this.sendInfo(seat, false);
      } else if (sim.info) {
        const info = sim.info(this.core.world);
        if (info) for (const seat of this.seats.values()) this.send(seat, "run", info);
      }
    }
    if (reset) this.newRun();
  }

  private newRun(): void {
    const entities = this.core.rebase((Math.random() * 2 ** 31) | 0);
    const sim = this.g.sim;
    for (const seat of this.seats.values()) {
      const entity = entities.get(seat.player);
      if (entity === undefined) continue;
      seat.entity = entity;
      seat.lastInfo = undefined;
      seat.metaApplied = 0;
      this.send(seat, "rebase", { entity, sim: sim.name, version: sim.version } satisfies RebaseMessage);
      this.applyProfile(seat);
    }
  }
}

/** The host: one game, one room at a time, answering the page's messages. */
export class SoloHost {
  private room: SoloRoom | null = null;
  private readonly reservations = new Map<string, { guest: unknown }>();
  private readonly sessions = new Set<string>();
  private nextId = 1;

  private constructor(
    private readonly g: Game,
    private readonly post: Post,
  ) {}

  static async create(tpl: Readonly<Record<string, unknown>>, entry: SoloEntry, post: Post): Promise<SoloHost> {
    await initSim();
    const make = tpl[entry.adapter];
    const get = tpl[entry.manifest.fn];
    if (typeof make !== "function" || typeof get !== "function") throw new Error(`the template does not export ${entry.adapter} and ${entry.manifest.fn}`);
    const sim = (make as Fn)() as SimAdapter<unknown, unknown>;
    const got = (get as Fn)() as Record<string, unknown>;
    const manifest = (entry.manifest.field ? got[entry.manifest.field] : got) as GameManifest;
    const template = typeof tpl.TEMPLATE === "string" ? tpl.TEMPLATE : "";
    const place = typeof tpl.PLACE === "string" ? tpl.PLACE : "local";
    const spec = profileSpec(manifest);
    const storeCommands = new Set<string>();
    for (const [id, s] of manifest.skus) if (!s.grants && s.coins !== undefined) storeCommands.add(id);
    const gameName = typeof tpl.GAME_NAME === "string" ? tpl.GAME_NAME : template;
    return new SoloHost({ sim, template, place, seats: entry.seats, aoi: entry.aoi, profile: spec, profiles: new LocalProfiles(gameName, spec), storeCommands }, post);
  }

  handle(m: ToHost): void {
    switch (m.t) {
      case "http": {
        const [status, body] = this.http(m.method, m.path, m.headers, m.body);
        this.post({ t: "http", id: m.id, status, body: JSON.stringify(body) });
        return;
      }
      case "open": {
        const r = this.reservations.get(m.token);
        this.reservations.delete(m.token);
        if (!r) return this.post({ t: "opened", id: m.id, ok: false, error: "seat reservation expired" });
        const room = this.openRoom();
        if (room.full) return this.post({ t: "opened", id: m.id, ok: false, error: "room full" });
        const session = `s${this.nextId++}`;
        this.sessions.add(session);
        this.post({ t: "opened", id: m.id, ok: true, roomId: room.roomId, session });
        room.join(session, r.guest);
        return;
      }
      case "send":
        return this.room?.message(m.session, m.type, m.data);
      case "bytes":
        return this.room?.bytes(m.session, m.type, m.bytes);
      case "leave": {
        if (!this.sessions.delete(m.session)) return;
        this.room?.leave(m.session);
        if (this.room?.empty) {
          this.room.dispose();
          this.room = null;
        }
        return;
      }
    }
  }

  private openRoom(): SoloRoom {
    if (!this.room) this.room = new SoloRoom(this.g, this.post);
    return this.room;
  }

  /** The room server's HTTP routes, answered in memory: [status, JSON body]. */
  private http(method: string, path: string, headers: Readonly<Record<string, string>>, raw: string | null): [number, unknown] {
    const g = this.g;
    let body: Obj = {};
    try {
      body = raw ? obj(JSON.parse(raw)) : {};
    } catch {
      body = {};
    }
    if (path === "/health") return [200, { ok: true, local: true, solo: true, template: g.template }];
    if (path.startsWith("/auth/") || path.startsWith("/referee/") || path.startsWith("/admin/")) return [403, { error: LOCAL_ONLY }];
    if (path === "/world/join" && method === "POST") {
      if (body.template !== g.template) return [409, { error: `this demo plays the ${g.template} template` }];
      const room = this.openRoom();
      if (room.full) return [409, { error: "the room is full" }];
      const token = `r${this.nextId++}-${Math.random().toString(36).slice(2)}`;
      this.reservations.set(token, { guest: body.guest });
      return [200, { roomId: room.roomId, reason: "created", reservations: [{ sessionId: token, roomId: room.roomId, name: "solo", processId: "solo", publicAddress: "", room: { roomId: room.roomId, name: "solo", processId: "solo" } }] }];
    }
    if (path.startsWith("/profile")) {
      const guest = headers["x-guest-id"];
      const id = isGuestId(guest) ? `g:${guest}` : null;
      if (method === "GET" && path.startsWith("/profile/game/")) return [200, g.profiles.view(id)];
      if (method === "GET" && path === "/profile") return [200, { kind: id ? "guest" : null, wallet: null, displayName: null, settings: {}, totals: { achievements: 0, titles: 0, games: 0 }, games: [] }];
      if (method !== "POST") return [405, { error: "method" }];
      if (!id) return [400, { error: "a guest id is required" }];
      if (path === "/profile/settings") g.profiles.settings(id, body.settings);
      else if (path === "/profile/name") g.profiles.name(id, body.displayName);
      else if (path === "/profile/redeem") {
        const r = g.profiles.redeem(id, typeof body.item === "string" ? body.item : "");
        if (!r.ok) return [400, { error: r.error ?? "refused" }];
      } else if (path !== "/profile/import" && path !== "/profile/claim") return [404, { error: "not found" }];
      return [200, g.profiles.view(id)];
    }
    return [404, { error: "not found" }];
  }
}
