/**
 * The SimAdapter for board genres (rules/kit.ts): the room server steps a
 * genre's rules on a fixed tick; the client predicts only its own avatar.
 *
 * The adapter, not the genre, owns what makes a game pay fairly, the same
 * way GameRunner does for the action templates:
 *  - earn rules counted per player per run (EarnTracker), seat bots never
 *    earn, unpaid events pay nobody, and world progress never pays a run
 *    that started after this world began;
 *  - store upgrades and losable gear as recorded room commands (a replay
 *    applies them at the same tick), capped at each upgrade's maxLevel;
 *  - cosmetics on the avatar;
 *  - the end screen, then `run.reset` so the room rebuilds the world and
 *    starts every seat's next referee run.
 */
import { EarnTracker, type GameEvent } from "../game/earn.js";
import type { GameManifest } from "../api/registry.js";
import type { UpgradeDef } from "../api/schemas.js";
import type { EntityState } from "../net/schema.js";
import type { PlayerId, SimAdapter, SimCommand, SimEvent } from "../net/sim-adapter.js";
import { avatarEntity, IDLE_INPUT, isRulesBot, RF, RULES_BOT_BASE, RULES_SCHEMA, rulesInputCodec, RulesKind } from "./kit.js";
import type { Avatar, RulesContext, RulesGenre, RulesInput, RunOutcome } from "./kit.js";

export interface RulesWorld<S = unknown> {
  readonly role: "server" | "client";
  /** The genre's state (server only). */
  state: S | null;
  readonly avatars: Map<PlayerId, Avatar>;
  tick: number;
  /** Ticks into the run (0 until the first step). */
  runTick: number;
  phase: "playing" | "ended";
  outcome: RunOutcome | null;
  endTick: number;
  readonly earn: EarnTracker | null;
  /** Players whose referee run started after this world made progress. */
  readonly late: Set<PlayerId>;
  /** World or fight progress (any event that is not a player's own act) has happened in this world. */
  progressed: boolean;
  /** Store upgrade levels per player: upgrade id -> level. */
  readonly upgrades: Map<PlayerId, Map<string, number>>;
  /** Earn rules paid this run, per player (HUD). */
  readonly paid: Map<PlayerId, Set<string>>;
  /** Seat bots present. */
  readonly bots: Set<PlayerId>;
  /** Total earn awards this world (harness). */
  awards: number;
}

export interface RulesAdapterOptions {
  readonly name: string;
  readonly version: string;
}

/** The SimAdapter for a board genre built from a game manifest. */
export function rulesAdapter<S>(genre: RulesGenre<S>, manifest: GameManifest, opts: RulesAdapterOptions): SimAdapter<RulesWorld<S>, RulesInput> & { readonly genre: RulesGenre<S>; readonly manifest: GameManifest } {
  const upgrades = manifest.upgrades;
  const skus = manifest.skus;
  const gear = new Set([...skus.values()].flatMap((s) => (s.grants && "gear" in s.grants ? [s.grants.gear] : [])));
  const endTicks = Math.max(1, Math.round(genre.endSeconds * genre.tickRate));

  const ctxOf = (w: RulesWorld<S>): RulesContext => ({
    bonus(player, stat) {
      const mine = w.upgrades.get(player);
      if (!mine) return 0;
      let b = 0;
      for (const [id, lvl] of mine) {
        const u: UpgradeDef | undefined = upgrades.get(id);
        if (u && u.stat === stat) b += u.step * lvl;
      }
      return b;
    },
    isBot: (p) => isRulesBot(p),
  });

  /** Earn credits people only; unpaid events pay nobody; world progress skips late runs. */
  const record = (w: RulesWorld<S>, ev: GameEvent, out: SimEvent[]): void => {
    if (!w.earn) return;
    if (ev.own !== true && !ev.unpaid) w.progressed = true;
    if (ev.unpaid) return;
    const late = ev.own === true || w.late.size === 0 ? null : w.late;
    const players = ev.players.filter((p) => !isRulesBot(p) && w.avatars.has(p) && !(late?.has(p) ?? false));
    if (players.length === 0) return;
    for (const a of w.earn.record({ name: ev.name, players })) {
      out.push({ type: "earn", player: a.player, rule: a.rule, units: a.units });
      let set = w.paid.get(a.player);
      if (!set) w.paid.set(a.player, (set = new Set()));
      set.add(a.rule);
      w.awards++;
    }
  };

  const addAvatar = (w: RulesWorld<S>, player: PlayerId): number => {
    const at = genre.spawn(w.state, player);
    w.avatars.set(player, { x: at.x, z: at.z, yaw: 0, cosmetic: 0, flags: 0 });
    if (w.state) genre.join(w.state, player);
    return player;
  };

  const removeAvatar = (w: RulesWorld<S>, player: PlayerId): void => {
    if (!w.avatars.delete(player)) return;
    if (w.state) genre.leave(w.state, player);
    w.earn?.forget(player);
    w.upgrades.delete(player);
    w.paid.delete(player);
    w.late.delete(player);
    w.bots.delete(player);
  };

  /** Seat bots: as many as the genre wants with the people present, one change a tick, only while a person is here. */
  const fillSeats = (w: RulesWorld<S>): void => {
    if (!genre.seats || !w.state) return;
    let humans = 0;
    for (const p of w.avatars.keys()) if (!isRulesBot(p)) humans++;
    const want = humans > 0 ? Math.max(0, genre.seats(w.state, humans)) : 0;
    if (w.bots.size < want) {
      let id = RULES_BOT_BASE;
      while (w.bots.has(id)) id++;
      w.bots.add(id);
      addAvatar(w, id);
    } else if (w.bots.size > want) {
      const id = Math.max(...w.bots);
      removeAvatar(w, id);
    }
  };

  const level = (w: RulesWorld<S>, player: PlayerId, id: string): boolean => {
    const u = upgrades.get(id);
    if (!u || !w.avatars.has(player)) return false;
    let mine = w.upgrades.get(player);
    if (!mine) w.upgrades.set(player, (mine = new Map()));
    const now = mine.get(id) ?? 0;
    if (now >= u.maxLevel) return false;
    mine.set(id, now + 1);
    return true;
  };

  return {
    name: opts.name,
    version: opts.version,
    tickHz: genre.tickRate,
    schema: RULES_SCHEMA,
    input: rulesInputCodec,
    maxInputsPerTick: 1,
    infoEveryTicks: genre.infoEveryTicks,
    genre,
    manifest,

    createWorld(seed, role) {
      const w: RulesWorld<S> = {
        role,
        state: null,
        avatars: new Map(),
        tick: 0,
        runTick: 0,
        phase: "playing",
        outcome: null,
        endTick: 0,
        earn: role === "server" ? new EarnTracker(manifest.earnRules) : null,
        late: new Set(),
        progressed: false,
        upgrades: new Map(),
        paid: new Map(),
        bots: new Set(),
        awards: 0,
      };
      if (role === "server") w.state = genre.create(seed >>> 0, ctxOf(w));
      return w;
    },

    addPlayer(w, player) {
      return addAvatar(w, player);
    },

    removePlayer(w, player) {
      removeAvatar(w, player);
    },

    step(w, inputsByPlayer) {
      w.tick++;
      const out: SimEvent[] = [];
      const s = w.state;
      // The client predicts its own avatar only.
      if (!s) {
        for (const [p, list] of inputsByPlayer) {
          const a = w.avatars.get(p);
          const i = list[0];
          if (a && i) genre.moveAvatar(a, i);
        }
        return out;
      }
      fillSeats(w);
      const emit = (e: GameEvent) => record(w, e, out);
      for (const [p, a] of w.avatars) {
        const i: RulesInput = isRulesBot(p) ? genre.bot(s, p, a, w.tick, 0.8) : (inputsByPlayer.get(p)?.[0] ?? IDLE_INPUT);
        genre.moveAvatar(a, i);
        if (w.phase === "playing" && i.act !== 0) genre.act(s, p, i, a, emit);
        if (w.phase === "playing") genre.tend?.(s, p, a, emit);
      }
      if (w.phase === "playing") {
        genre.step(s, emit);
        w.runTick++;
        const o = genre.outcome(s);
        if (o) {
          w.phase = "ended";
          w.outcome = o;
          w.endTick = w.tick + endTicks;
        }
      } else if (w.tick >= w.endTick) {
        out.push({ type: "run.reset" });
        // The room rebuilds the world at its safe point; until then nothing moves.
        w.endTick = Number.MAX_SAFE_INTEGER;
      }
      return out;
    },

    snapshot(w) {
      const out: EntityState[] = [];
      for (const [p, a] of w.avatars) out.push(avatarEntity(p, a));
      if (w.state) genre.entities(w.state, out);
      return out;
    },

    applySnapshot(w, entities) {
      for (const e of entities) {
        if (e.kind !== RulesKind.Avatar) continue;
        const v = e.values;
        const yaw = Math.round(((v[RF.yaw] ?? 0) / (Math.PI * 2)) * 65536) & 0xffff;
        const a = w.avatars.get(e.owner);
        if (a) {
          a.x = Math.round(v[RF.x] ?? 0);
          a.z = Math.round(v[RF.z] ?? 0);
          a.yaw = yaw;
          a.flags = Math.round(v[RF.flags] ?? 0);
          a.cosmetic = Math.round(v[RF.value] ?? 0);
        } else {
          w.avatars.set(e.owner, { x: Math.round(v[RF.x] ?? 0), z: Math.round(v[RF.z] ?? 0), yaw, cosmetic: Math.round(v[RF.value] ?? 0), flags: Math.round(v[RF.flags] ?? 0) });
        }
      }
    },

    info(w) {
      if (!w.state) return null;
      return { ...genre.view(w.state, null), phase: w.phase, outcome: w.outcome, endsIn: w.phase === "ended" ? Math.max(0, (w.endTick - w.tick) / genre.tickRate) : null };
    },

    infoFor(w, player) {
      if (!w.state) return null;
      const progress = [...manifest.earnRules].map(([id, r]) => ({ id, when: r.when, n: r.n, have: Math.min(r.n, w.earn?.count(player, r.when) ?? 0), paid: w.paid.get(player)?.has(id) ?? false }));
      const ups = Object.fromEntries(w.upgrades.get(player) ?? []);
      return {
        ...genre.view(w.state, player),
        you: player,
        phase: w.phase,
        outcome: w.outcome,
        endsIn: w.phase === "ended" ? Math.max(0, Math.round(((w.endTick - w.tick) / genre.tickRate) * 10) / 10) : null,
        earn: progress,
        upgrades: ups,
        late: w.late.has(player),
      };
    },

    startRun(w, player) {
      w.earn?.forget(player);
      w.paid.delete(player);
      // A run that starts after the world made progress is never paid for that progress. A run that starts
      // before any (the first player's sign-in lands a few ticks after the world begins) is not late.
      if (w.progressed) w.late.add(player);
    },

    command(w, player, cmd: SimCommand) {
      const a = w.avatars.get(player);
      if (!a) return false;
      if (cmd.name === "cosmetic") {
        a.cosmetic = Math.max(0, Math.min(255, Math.round(cmd.value ?? 0)));
        return true;
      }
      // A store upgrade (a SKU named after a declared upgrade) or gear the room issues at a staked run's start: one level.
      if (upgrades.has(cmd.name) && (skus.has(cmd.name) || gear.has(cmd.name))) return level(w, player, cmd.name);
      return false;
    },
  };
}
