// The local play room: one Colyseus room per place, speaking the engine's
// room protocol (@netforge/engine/net protocol.ts) so the template
// clients connect to it exactly as they connect to a hosted room. Play
// money only: there are no wallets, no sign-in, no stakes, no pots and no
// claims here, and earn events are shown to the player but pay nothing.

import { Room, type Client } from "@colyseus/core";
import { packMeta, RESERVED_COMMANDS, type ProfileSpec } from "@netforge/engine/game";
import {
  MSG_INPUT,
  MSG_SNAPSHOT,
  type CommandMessage,
  type CommandResult,
  type CreateOptions,
  type EarnMessage,
  type JoinOptions,
  type PlayerId,
  type PotMessage,
  type ProgressEvent,
  type RebaseMessage,
  type SignInResult,
  type SimAdapter,
  type StakeMessage,
  type WelcomeMessage,
} from "@netforge/engine/net";
import { LocalCore, SNAPSHOT_HZ, type LocalAoi } from "./core.js";
import { isGuestId, type LocalProfiles } from "./profile.js";

/** What the host serves: one game, set once before the server listens. */
export interface LocalGame {
  readonly sim: SimAdapter<unknown, unknown>;
  readonly template: string;
  readonly place: string;
  readonly instanceCap: number;
  readonly aoi: LocalAoi;
  readonly profile: ProfileSpec | null;
  readonly profiles: LocalProfiles;
  /** SKU ids the store sells for coins (play money here): the only commands a client may send. */
  readonly storeCommands: ReadonlySet<string>;
}

let current: LocalGame | null = null;

export function setLocalGame(g: LocalGame): void {
  current = g;
}

function game(): LocalGame {
  if (!current) throw new Error("local game not set");
  return current;
}

/** Why local play turns these down, in the words the client shows. */
export const LOCAL_ONLY = "Local play uses play money only";

interface Seat {
  readonly sessionId: string;
  readonly player: PlayerId;
  entity: number;
  profile: string | null;
  lastInfo?: string;
  metaApplied: number;
}

const INFO_EVERY_TICKS = 15;

function parseCommand(raw: unknown): CommandMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== "string" || o.name.length === 0 || o.name.length > 32) return null;
  const value = typeof o.value === "number" && Number.isFinite(o.value) ? o.value : undefined;
  return { name: o.name, ...(value !== undefined ? { value } : {}) };
}

export class LocalRoom extends Room {
  private core!: LocalCore<unknown, unknown>;
  private g!: LocalGame;
  private readonly seats = new Map<string, Seat>();
  private readonly clients_ = new Map<PlayerId, Client>();
  private unsubscribe: (() => void) | null = null;

  override onCreate(options: CreateOptions): void {
    this.g = game();
    if (options?.template !== this.g.template) throw new Error(`this host plays the ${this.g.template} template`);
    const sim = this.g.sim;
    this.maxClients = this.g.instanceCap;
    this.autoDispose = true;
    this.setPatchRate(null);
    void this.setMetadata({ place: this.g.place, template: this.g.template });
    this.core = new LocalCore(sim, this.g.aoi, (Math.random() * 2 ** 31) | 0);

    this.unsubscribe = this.g.profiles.onChange((id) => {
      for (const seat of this.seats.values()) if (seat.profile === id) this.applyProfile(seat);
    });

    this.onMessageBytes(MSG_INPUT, (client: Client, bytes: Uint8Array) => {
      const seat = this.seats.get(client.sessionId);
      if (seat) this.core.receiveInput(seat.player, bytes);
    });
    this.onMessage("command", (client: Client, raw: unknown) => {
      const seat = this.seats.get(client.sessionId);
      const cmd = parseCommand(raw);
      if (!seat || !cmd) return;
      const reply = (r: CommandResult) => client.send("command-result", r);
      if (!sim.command) return reply({ name: cmd.name, ok: false, reason: "no store in this game" });
      if (RESERVED_COMMANDS.has(cmd.name)) return reply({ name: cmd.name, ok: false, reason: "not for sale" });
      const sold = cmd.name === "cosmetic" ? this.g.profiles.ownsCosmetic(seat.profile, cmd.value ?? 0) : this.g.storeCommands.has(cmd.name);
      if (!sold) return reply({ name: cmd.name, ok: false, reason: "not for sale" });
      const ok = this.core.command(seat.player, { name: cmd.name, ...(cmd.value !== undefined ? { value: cmd.value } : {}) });
      reply(ok ? { name: cmd.name, ok } : { name: cmd.name, ok, reason: "not applicable now" });
    });
    this.onMessage("stake", (client: Client) => client.send("stake", { state: "refused", stake: 0, reason: LOCAL_ONLY } satisfies StakeMessage));
    this.onMessage("pot", (client: Client) => client.send("pot", { state: "refused", entry: 0, reason: LOCAL_ONLY } satisfies PotMessage));
    this.onMessage("sign-in", (client: Client) => client.send("sign-in-result", { ok: false, runId: null, earnRefused: "guest" } satisfies SignInResult));
    this.onMessage("claim", (client: Client) => client.send("attest-error", LOCAL_ONLY));
    this.onMessage("ping", (client: Client, t: unknown) => client.send("pong", t));

    this.setSimulationInterval(() => this.tickOnce(), 1000 / sim.tickHz);
  }

  override onJoin(client: Client, options?: JoinOptions): void {
    const { player, entity } = this.core.addPlayer();
    const seat: Seat = { sessionId: client.sessionId, player, entity, profile: isGuestId(options?.guest) ? `g:${options.guest}` : null, metaApplied: 0 };
    this.seats.set(client.sessionId, seat);
    this.clients_.set(player, client);
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
    client.send("welcome", welcome);
    this.applyProfile(seat);
    this.sendInfo(seat, client, true);
  }

  override onLeave(client: Client): void {
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;
    this.seats.delete(client.sessionId);
    this.clients_.delete(seat.player);
    this.core.removePlayer(seat.player);
  }

  override onDispose(): void {
    this.unsubscribe?.();
    this.core?.dispose();
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
    this.clients_.get(seat.player)?.send("profile", this.g.profiles.view(seat.profile));
  }

  private sendInfo(seat: Seat, client: Client, force: boolean): void {
    const sim = this.g.sim;
    if (sim.infoFor) {
      const v = sim.infoFor(this.core.world, seat.player);
      if (v === null || v === undefined) return;
      const json = JSON.stringify(v);
      if (!force && json === seat.lastInfo) return;
      seat.lastInfo = json;
      client.send("run", v);
      return;
    }
    const info = sim.info?.(this.core.world);
    if (info) client.send("run", info);
  }

  private recordProgress(e: ProgressEvent): void {
    if (!this.g.profile) return;
    const c = this.clients_.get(e.player);
    const seat = c ? this.seats.get(c.sessionId) : undefined;
    if (seat?.profile) this.g.profiles.record(seat.profile, e.kind, e.id);
  }

  private tickOnce(): void {
    const res = this.core.step();
    let reset = false;
    for (const e of res.events) {
      if (e.type === "run.reset") reset = true;
      else if (e.type === "progress") this.recordProgress(e);
      else this.clients_.get(e.player)?.send("earn", { rule: e.rule, units: e.units } satisfies EarnMessage);
    }
    for (const [player, bytes] of res.snapshots) this.clients_.get(player)?.sendBytes(MSG_SNAPSHOT, bytes);
    const sim = this.g.sim;
    if (res.tick % (sim.infoEveryTicks ?? INFO_EVERY_TICKS) === 0) {
      if (sim.infoFor) {
        for (const seat of this.seats.values()) {
          const c = this.clients_.get(seat.player);
          if (c) this.sendInfo(seat, c, false);
        }
      } else if (sim.info) {
        const info = sim.info(this.core.world);
        if (info) this.broadcast("run", info);
      }
    }
    if (reset) this.newRun();
  }

  /** The sim ended a run: a fresh world, as the hosted room does between runs. Players stay connected. */
  private newRun(): void {
    const entities = this.core.rebase((Math.random() * 2 ** 31) | 0);
    const sim = this.g.sim;
    for (const seat of this.seats.values()) {
      const entity = entities.get(seat.player);
      if (entity === undefined) continue;
      seat.entity = entity;
      seat.lastInfo = undefined;
      seat.metaApplied = 0;
      this.clients_.get(seat.player)?.send("rebase", { entity, sim: sim.name, version: sim.version } satisfies RebaseMessage);
      this.applyProfile(seat);
    }
  }
}
