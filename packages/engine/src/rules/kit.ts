/**
 * Board-style genres: tower defense, idle, card battler, monster collector. They do not
 * run on engine-sim's action world; each is a deterministic rules module the
 * room server steps on a fixed tick, behind the same SimAdapter seam, so the
 * netcode, the referee, run verification, the store and the stake are the
 * ones every template uses.
 *
 * A genre is plain integer state plus a seeded PRNG: no clocks, no
 * Math.random, iteration in id order. The room replays a run from its
 * inputs exactly (referee/verify.ts), which is what makes earn
 * replay-proof.
 *
 * Every player has an avatar (a cursor, a builder or a walking hero): the
 * one thing the client predicts, from its own input and static world state
 * only (SimAdapter contract 2). Everything else is authoritative and arrives
 * in snapshots (moving things, interpolated) or in per-player run state
 * (SimAdapter.infoFor: hidden hands, your gold).
 */
import type { BitReader, BitWriter } from "../net/bits.js";
import type { EntitySchema, EntityState } from "../net/schema.js";
import type { InputCodec } from "../net/sim-adapter.js";
import type { GameEvent } from "../game/earn.js";

/** Fixed-point units per metre for avatars and entities. */
export const UNITS = 64;

/** One tick of a player's input. */
export interface RulesInput {
  /** Stick, -127..127 (walking avatars). */
  readonly mx: number;
  readonly mz: number;
  /** Cursor or target on the ground, 1/16 m, -32768..32767. */
  readonly cx: number;
  readonly cz: number;
  /** The action this tick: 0 none; the genre names the rest. */
  readonly act: number;
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

export const IDLE_INPUT: RulesInput = { mx: 0, mz: 0, cx: 0, cz: 0, act: 0, a: 0, b: 0, c: 0 };

const clampInt = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : 0);

/** 50 bits a tick idle, 99 with an action. */
export const rulesInputCodec: InputCodec<RulesInput> = {
  idle: IDLE_INPUT,
  write(w: BitWriter, i: RulesInput): void {
    w.writeSigned(clampInt(i.mx, -127, 127), 8);
    w.writeSigned(clampInt(i.mz, -127, 127), 8);
    w.writeSigned(clampInt(i.cx, -32768, 32767), 16);
    w.writeSigned(clampInt(i.cz, -32768, 32767), 16);
    const act = clampInt(i.act, 0, 255);
    w.writeBool(act !== 0);
    if (act !== 0) {
      w.writeBits(act, 8);
      w.writeBits(clampInt(i.a, 0, 0xffff), 16);
      w.writeBits(clampInt(i.b, 0, 0xffff), 16);
      w.writeBits(clampInt(i.c, 0, 0xffff), 16);
    }
  },
  read(r: BitReader): RulesInput {
    const mx = r.readSigned(8);
    const mz = r.readSigned(8);
    const cx = r.readSigned(16);
    const cz = r.readSigned(16);
    if (!r.readBool()) return { mx, mz, cx, cz, act: 0, a: 0, b: 0, c: 0 };
    return { mx, mz, cx, cz, act: r.readBits(8), a: r.readBits(16), b: r.readBits(16), c: r.readBits(16) };
  },
};

/** Entity kinds on the wire. */
export const RulesKind = { Avatar: 1, Unit: 2, Shot: 3, Structure: 4, Pickup: 5 } as const;

/** Field indices in RULES_SCHEMA. */
export const RF = { x: 0, z: 1, yaw: 2, type: 3, hp: 4, flags: 5, value: 6, aux: 7 } as const;

/**
 * The wire schema every board genre shares: position (1/64 m), facing, a
 * type, health, flags and two small values. Units interpolate their
 * position; everything else steps.
 */
export const RULES_SCHEMA: EntitySchema = {
  fields: [
    { name: "x", kind: "int", bits: 20, deltaBits: 10 },
    { name: "z", kind: "int", bits: 20, deltaBits: 10 },
    { name: "yaw", kind: "angle16", deltaBits: 9 },
    { name: "type", kind: "uint", bits: 8, interp: "step" },
    { name: "hp", kind: "uint", bits: 20, interp: "step", deltaBits: 8 },
    { name: "flags", kind: "uint", bits: 8, interp: "step" },
    { name: "value", kind: "uint", bits: 16, interp: "step", deltaBits: 6 },
    { name: "aux", kind: "uint", bits: 16, interp: "step", deltaBits: 6 },
  ],
  xField: RF.x,
  yField: RF.z,
  unitsPerWorld: UNITS,
};

/** A player's avatar (fixed point). The only state a client predicts. */
export interface Avatar {
  x: number;
  z: number;
  /** u16 turn. */
  yaw: number;
  /** Look the player wears (store cosmetic id, 0 the default). */
  cosmetic: number;
  /** Genre flags drawn with the avatar (e.g. "ready"). */
  flags: number;
}

/** Entity state for an avatar. Avatar entity ids are the player ids. */
export function avatarEntity(player: number, a: Avatar): EntityState {
  return { id: player, kind: RulesKind.Avatar, owner: player, values: [a.x, a.z, (a.yaw / 65536) * Math.PI * 2, 0, 0, a.flags & 0xff, a.cosmetic & 0xffff, 0] };
}

/** Entity ids a genre uses start here (avatars take the player ids below). */
export const ENTITY_BASE = 0x10000;

export function entity(id: number, kind: number, owner: number, x: number, z: number, yawTurn: number, type: number, hp: number, flags = 0, value = 0, aux = 0): EntityState {
  return { id: ENTITY_BASE + id, kind, owner, values: [x, z, (yawTurn / 65536) * Math.PI * 2, type, Math.max(0, Math.min(0xfffff, Math.round(hp))), flags & 0xff, value & 0xffff, aux & 0xffff] };
}

/** Seat bots and only them: player ids at 0xff00 and up (engine-sim's BOT_PLAYER_BASE). */
export const RULES_BOT_BASE = 0xff00;
export const isRulesBot = (p: number): boolean => p >= RULES_BOT_BASE;

/** mulberry32 on a state word kept in the genre's state (so a restored state continues the same stream). */
export interface Rng {
  s: number;
}
export function rand(r: Rng): number {
  r.s = (r.s + 0x6d2b79f5) | 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/** 0..n-1. */
export function randInt(r: Rng, n: number): number {
  return Math.floor(rand(r) * n) % Math.max(1, n);
}
/** Fisher-Yates in place. */
export function shuffle<T>(r: Rng, list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randInt(r, i + 1);
    const t = list[i] as T;
    list[i] = list[j] as T;
    list[j] = t;
  }
  return list;
}

/** What a genre reads about the players from the adapter. */
export interface RulesContext {
  /** A store upgrade's bonus for this player: the sum of step x level over the player's upgrades of `stat`. */
  bonus(player: number, stat: string): number;
  isBot(player: number): boolean;
}

export type RunOutcome = "won" | "lost";

/** Numbers the headless harness reports (HarnessReport), in the genre's own sense. */
export interface RulesStats {
  /** Enemies defeated (TD creeps, duels won, wild creatures beaten). */
  readonly kills: number;
  /** Progress through the run: wave, tier, floor (1-based). */
  readonly wave: number;
  /** Highest level any player reached. */
  readonly level: number;
  /** Times a player lost something (lives lost, duels lost, a creature fainted). */
  readonly deaths: number;
  /** Most units alive at once. */
  readonly peakUnits: number;
  /** Players with at least one kill. */
  readonly scorers: number;
  /** Best single player's kills. */
  readonly topScore: number;
}

/** A genre's own line in the playtest gate: a hard check or a scored part. */
export interface RulesCheck {
  readonly ok: boolean;
  /** The line the model reads when it fails, or what it measured. */
  readonly line: string;
}

/**
 * One board genre. `S` is its whole authoritative state: integers, arrays
 * and maps in insertion order, a PRNG word. Factories build one from the
 * game's manifest (rules/genres.ts).
 */
export interface RulesGenre<S> {
  /** The engine template it plays (game({ template })). */
  readonly template: string;
  readonly tickRate: number;
  /** Seconds the end screen stays before a fresh run. */
  readonly endSeconds: number;
  /** Ticks between per-player run-state sends. */
  readonly infoEveryTicks: number;
  create(seed: number, ctx: RulesContext): S;
  /** Where a joining player's avatar starts. */
  spawn(s: S | null, player: number): { x: number; z: number };
  /** Moves an avatar one tick from its own input and static world state only (both sides: the client predicts it). */
  moveAvatar(a: Avatar, input: RulesInput): void;
  join(s: S, player: number): void;
  leave(s: S, player: number): void;
  /** Applies a player's action (validated here: the server never trusts a client's numbers). */
  act(s: S, player: number, input: RulesInput, avatar: Avatar, emit: (e: GameEvent) => void): void;
  /**
   * Server only, every tick, after each avatar moved: what the world does
   * with where a player stands (a step into tall grass). It may move the
   * avatar (a teleport home), which the client then reconciles.
   */
  tend?(s: S, player: number, avatar: Avatar, emit: (e: GameEvent) => void): void;
  /** One tick of the world. */
  step(s: S, emit: (e: GameEvent) => void): void;
  /** The run ended (null while it goes on). */
  outcome(s: S): RunOutcome | null;
  /** What `player` may see (null: what everyone may see). JSON-safe. Never another player's secrets. */
  view(s: S, player: number | null): Record<string, unknown>;
  /** Networked entities other than avatars (ids from 0). */
  entities(s: S, out: EntityState[]): void;
  /** Seat bots wanted with `humans` people in the room (bots never earn). Omit for none. */
  seats?(s: S, humans: number): number;
  /** A bot's (or a playtest player's) input this tick. `skill` 0..1 (playtests use 1). */
  bot(s: S, player: number, avatar: Avatar, tick: number, skill: number): RulesInput;
  stats(s: S): RulesStats;
  /** Changes whenever anything happens (the softlock detector). */
  activity(s: S): number;
  /** The genre's own playtest checks on one playtest run (the gate fails the draft on any that is not ok in the squad run). */
  checks(run: RulesHarnessRun): RulesCheck[];
  /** How far the playtest got through the genre's arc, 0..1 (the gate's progression score). */
  progress(run: RulesHarnessRun): number;
}

/** One harness run's numbers, for a genre's checks. */
export interface RulesHarnessRun {
  readonly seconds: number;
  readonly players: number;
  readonly stats: RulesStats;
  readonly runs: { readonly won: number; readonly lost: number };
  readonly earned: Readonly<Record<string, number>>;
  /** Seconds until the first earn award (null if none). */
  readonly firstEarnSeconds: number | null;
  /** Seconds the first run lasted (null if it never ended). */
  readonly firstRunSeconds: number | null;
}
