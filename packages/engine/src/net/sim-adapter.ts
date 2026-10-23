// The narrow seam between the netcode and a game's simulation.
//
// The room server and the client both drive a SimAdapter: the server steps
// the authoritative world, the client steps a local copy that holds only its
// own predicted entity. Until `@netforge/engine-sim` lands on main, the
// room runs the built-in test sim (`src/sim/movers.ts`) behind this
// interface; swapping in the shared sim is a change to `src/sim/index.ts`.
//
// Contract the netcode relies on (and the engine-sim adapter must keep):
//
//   1. Each input command is ONE tick of the owning player's motion. `step`
//      applies a player's queued inputs in order, then runs world systems
//      once. A player with no input this tick does not move by input.
//   2. A player's own predicted fields depend only on that player's inputs
//      and on static world state, so replaying unacknowledged inputs on top
//      of the server's state reproduces the server exactly (reconciliation
//      converges to zero error). Interactions that break this (being pushed
//      by others) are corrected by the next snapshot and smoothed.
//   3. `snapshot` values are real numbers; the schema quantizes them. A sim
//      that keeps its state on the quantization grid (fixed-point) gets
//      bit-exact prediction.

import type { BitReader, BitWriter } from './bits.js';
import type { EntitySchema, EntityState } from './schema.js';

/** Small integer assigned by the room to each connected player (1..65535). */
export type PlayerId = number;

export interface InputCodec<I> {
  write(w: BitWriter, input: I): void;
  read(r: BitReader): I;
  /** The input a player is assumed to send when idle. */
  readonly idle: I;
}

/** Something the authoritative sim says a player earned. */
export interface EarnEvent {
  readonly type: 'earn';
  readonly player: PlayerId;
  /** Earn rule name, as declared in the game's earn rules. */
  readonly rule: string;
  /** Units earned (the referee converts units to token amount per rule). */
  readonly units: number;
}

/** The sim started a fresh run in place (game over or victory screen ended). Referee runs restart. */
export interface RunResetEvent {
  readonly type: 'run.reset';
}

/**
 * The sim says a player reached something their profile keeps: an achievement, one of today's goals,
 * or an end-screen title. The room writes it to the player's profile on
 * the server; the browser never grants these.
 */
export interface ProgressEvent {
  readonly type: 'progress';
  readonly player: PlayerId;
  readonly kind: 'achievement' | 'goal' | 'title';
  /** The declared achievement, mission or title id. */
  readonly id: string;
}

export type SimEvent = EarnEvent | RunResetEvent | ProgressEvent;

/** What a player's profile lets them choose (the room checks it on every input). */
export interface PlayerRights {
  /** Keeper indices this player may pick; null when the game has no keepers. */
  readonly keepers: readonly number[] | null;
}

/** A room-level command from a player (store hooks): a paid revive, a cosmetic. */
export interface SimCommand {
  readonly name: string;
  readonly value?: number;
}

/** A hitscan the sim wants resolved against lag-compensated hitboxes. */
export interface HitscanRequest {
  readonly shooter: PlayerId;
  readonly ox: number;
  readonly oy: number;
  readonly dx: number;
  readonly dy: number;
  readonly range: number;
}

export interface Hitbox {
  readonly entity: number;
  readonly owner: PlayerId;
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export interface SimAdapter<W, I> {
  readonly name: string;
  /** Content version of the logic module (hot swap compares these). */
  readonly version: string;
  readonly tickHz: number;
  readonly schema: EntitySchema;
  readonly input: InputCodec<I>;
  /**
   * Most inputs one player may apply in one tick. Omit for "drain" sims
   * where each input is one tick of motion and catching up after a stall is
   * exact (the movers test sim). Set 1 for physics sims whose state moves
   * without input (engine-sim: `step(world, Map<PlayerId, InputCommand>)`
   * takes exactly one command per player per tick).
   */
  readonly maxInputsPerTick?: number;

  /**
   * A fresh world. The server's is authoritative ('server'); the client's
   * ('client') holds only what it predicts, so it must not spawn world
   * entities of its own.
   */
  createWorld(seed: number, role: 'server' | 'client'): W;
  /** Spawns the player's entity, returns its entity id. */
  addPlayer(world: W, player: PlayerId): number;
  removePlayer(world: W, player: PlayerId): void;
  /** Advances one tick. Inputs per player are applied in order. */
  step(world: W, inputsByPlayer: ReadonlyMap<PlayerId, readonly I[]>): readonly SimEvent[];
  /** Every networked entity, real values in schema field order. */
  snapshot(world: W): readonly EntityState[];
  /**
   * Overwrites world entities with these states (creating any missing).
   * The client uses it to reset its predicted entity to the server's state.
   */
  applySnapshot(world: W, entities: readonly EntityState[]): void;

  /** Lag compensation hook: hitscans requested by this tick's inputs. */
  hitscans?(world: W, player: PlayerId, input: I): HitscanRequest | null;
  /** Current hitboxes, recorded each tick into the rewind buffer. */
  hitboxes?(world: W): readonly Hitbox[];
  /** Resolution of a lag-compensated hitscan; may emit earn events. */
  applyHit?(world: W, shooter: PlayerId, target: Hitbox): readonly SimEvent[];

  /**
   * Run state for the room to broadcast a few times a second (JSON-safe):
   * phase, timer, wave, boss health. Kept out of snapshots on purpose.
   */
  info?(world: W): unknown;
  /**
   * Run state for one player (JSON-safe), sent to that player only, in
   * place of `info`: what only they may see (a hand of cards, their own
   * gold). A sim with hidden information implements this and keeps every
   * secret out of `snapshot` and `info`. The room sends it when it changed.
   */
  infoFor?(world: W, player: PlayerId): unknown;
  /** Ticks between run-state sends (default: the room's, 2 Hz at 30 Hz). Board games send more often. */
  readonly infoEveryTicks?: number;
  /**
   * Rewrites an input so it chooses only what the player's profile allows
   * (a locked keeper becomes the first open one). The room applies it as
   * inputs arrive, before they are recorded, so a replay sees the same.
   */
  restrictInput?(input: I, rights: PlayerRights): I;
  /** Apply a room-level command (already verified by the room). Returns false if it did nothing. */
  command?(world: W, player: PlayerId, cmd: SimCommand): boolean;
  /**
   * A referee run starts for this player now (sign-in, or a new round): the
   * player's earn progress starts over, so a run is paid only for what it
   * did itself (never for counts made as a guest or in an earlier run). The
   * room records it in the run log, so a replay applies it at the same
   * point. Optional: a sim without earn progress leaves it out.
   */
  startRun?(world: W, player: PlayerId): void;
  /** Free native memory (Rapier) when the room disposes. */
  disposeWorld?(world: W): void;
}
