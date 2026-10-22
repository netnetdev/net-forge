// Room wire protocol, shared by the server, the demo client and the bots.
// Hot-path messages are raw bytes under numeric types (smallest header);
// rare control messages are msgpack objects under string types.

export const MSG_INPUT = 1; // client -> server, bytes (netcode/input.ts)
export const MSG_SNAPSHOT = 2; // server -> client, bytes (netcode/snapshot.ts)

export const ROOM_NAME = 'instance';

export interface WelcomeMessage {
  readonly player: number;
  readonly entity: number;
  readonly tickHz: number;
  readonly snapshotHz: number;
  readonly sim: string;
  readonly version: string;
  readonly place: string;
  readonly template: string;
  /** Present when the player joined with a wallet and earn is tracked. */
  readonly runId: string | null;
  /** False when the referee has no signer: earn is tracked but not paid. */
  readonly earnLive: boolean;
  /**
   * Why this seat earns nothing, when it does not: 'guest' (no signed-in
   * session), 'wallet-busy' (the wallet is already earning in another
   * session of this game), 'session' (the session token did not verify).
   */
  readonly earnRefused?: EarnRefusal;
  /** The game's buy-in run terms in whole coins (earn.stake), or absent when it takes no stakes. */
  readonly stake?: StakeTermsView;
  /** The game's PvP pot in whole coins (earn.pot), or absent when it has none. */
  readonly pot?: { readonly entry: number; readonly recycle: number };
}

/**
 * Server -> client ('pot'): 'in' this round's pot holds the player's entry
 * (`pot` is the whole pot so far); 'waiting' the entry is placed for the
 * next round; 'closed' the round split the pot (`paid` is this player's
 * part); 'refused' (`reason`). Whole coins.
 */
export interface PotMessage {
  readonly state: 'in' | 'waiting' | 'closed' | 'refused';
  readonly entry: number;
  readonly pot?: number;
  readonly paid?: number;
  readonly reason?: string;
}

/** A game's buy-in run terms as a client shows them (whole coins). */
export interface StakeTermsView {
  readonly min: number;
  readonly max: number;
  /** The stake's payout ceiling is stake x multiple. */
  readonly multiple: number;
}

/**
 * Client -> server ('stake'): the player spent a stake (the Kit's
 * coins.spend(amount, "stake"), committed). The room fixes the stake from
 * its own ledger when a run starts: always the NEXT run (sign-in or the
 * next round; a run in progress never restarts, ruled 2026-10-20), and a
 * staked run starts from zero earn progress. `amount` (whole coins) is read only
 * by a room whose store runs in mock mode (local play).
 */
export interface StakeRequest {
  readonly amount?: number;
}

/**
 * Server -> client ('stake'): 'live' the run in progress is staked;
 * 'waiting' a stake is placed for the next run; 'closed' a staked run ended
 * (`paid` is its stake share); 'refused' the stake was not taken (`reason`).
 * Amounts are whole coins.
 */
export interface StakeMessage {
  readonly state: 'live' | 'waiting' | 'closed' | 'refused';
  readonly stake: number;
  /** Most the run can pay: its free earn plus stake x multiple. */
  readonly ceiling?: number;
  readonly paid?: number;
  readonly reason?: string;
  /** 'live': gear the staked run brought in; 'closed': gear it lost (SKU ids). */
  readonly gear?: readonly string[];
  readonly lost?: readonly string[];
}

export type EarnRefusal = 'guest' | 'wallet-busy' | 'session';

export interface EarnMessage {
  readonly rule: string;
  readonly units: number;
}

export interface JoinOptions {
  /**
   * Ignored by the referee. Earning needs `session`: the room takes the
   * wallet from the signed session, never from this field.
   */
  readonly wallet?: string;
  /** Session token from POST /auth/sign-in (SIWE). Without it the seat is a guest. */
  readonly session?: string;
  /**
   * A guest's random profile id (16-80 of A-Z a-z 0-9 _ -), kept by the
   * browser. Progress a guest makes is saved to it on the server and merges
   * into the wallet's profile at sign-in (POST /profile/claim).
   */
  readonly guest?: string;
}

/** Guest profile ids: 16-80 characters of A-Z, a-z, 0-9, _ or - (the same rule as Launcher guest drafts). */
export const GUEST_ID_RE = /^[A-Za-z0-9_-]{16,80}$/;

/** One item of a game's permanent store as a profile sees it (cosmetics, unlocks, meta levels). */
export interface ProfileStoreItem {
  readonly id: string;
  readonly kind: 'cosmetic' | 'unlock' | 'meta' | 'gear';
  /** Coins for the next purchase (the next level of a meta upgrade); null when owned or at the top. */
  readonly coins: number | null;
  readonly owned: boolean;
  /** Cosmetic id, or the keeper an unlock opens. */
  readonly cosmetic?: number;
  readonly keeper?: string;
  /** Gear: the run upgrade it brings into staked runs, and the share of a run's most earn below which it is lost. */
  readonly gear?: string;
  readonly loseBelow?: number;
  /** Meta upgrades: the stat, bonus per level (0.05 = +5%), the level owned, the top level, the bonus now. */
  readonly stat?: string;
  readonly step?: number;
  readonly level?: number;
  readonly levels?: number;
  readonly bonus?: number;
}

/**
 * A player's saved progress in one game, kept by the room server (Q146,
 * ruled 2026-10-16): the same on every device the player signs in on.
 * Achievements, goals and titles come from the authoritative sim only.
 */
export interface GameProfile {
  readonly game: string;
  /** Whose: a signed-in wallet, a guest id, or null (nothing is saved for this seat). */
  readonly kind: 'wallet' | 'guest' | null;
  readonly wallet: string | null;
  readonly displayName: string | null;
  readonly achievements: readonly { readonly id: string; readonly at: number; readonly source: 'sim' | 'import' }[];
  /** Keeper ids this player may pick. */
  readonly keepers: readonly string[];
  /** Permanent SKUs owned (cosmetics and unlocks), by id. */
  readonly owned: readonly string[];
  /** Cosmetic ids owned (0, the default look, always). */
  readonly cosmetics: readonly number[];
  /** Meta upgrade levels owned (opt-in games only). */
  readonly meta: Readonly<Record<string, number>>;
  /** Today's goals (UTC day) and which are done. */
  readonly goals: { readonly day: number; readonly today: readonly string[]; readonly done: readonly string[] };
  /** Titles taken, by id, with how many times. */
  readonly titles: Readonly<Record<string, number>>;
  /** The game's settings for this player (JSON, set by the client). */
  readonly settings: Readonly<Record<string, unknown>>;
  /** The permanent store: cosmetics, unlocks and meta levels with their next price. */
  readonly store: readonly ProfileStoreItem[];
  /** True once local (pre-profile) progress was imported. */
  readonly imported: boolean;
  /** Store credit in whole coins: a refunded purchase the server could not return as earned coins. The next purchase spends it first. */
  readonly credit: number;
  /** Across every game: for the Launcher's profile page. */
  readonly totals: { readonly achievements: number; readonly titles: number; readonly games: number };
}

/** Client -> server: sign in mid-session (a guest who just signed the SIWE message). */
export interface SignInMessage {
  readonly session: string;
}

/** Server -> client: the outcome of a mid-session sign-in. */
export interface SignInResult {
  readonly ok: boolean;
  readonly runId: string | null;
  readonly earnRefused?: EarnRefusal;
}

/**
 * Server -> client: the room rebuilt its world at a safe point (between
 * rounds): a new logic module (hot swap, `version` changed) or a fresh
 * verification segment. The player keeps its id; its entity id may change,
 * baselines are void and the next snapshot is full.
 */
export interface RebaseMessage {
  readonly entity: number;
  readonly sim: string;
  readonly version: string;
}

/** Client -> server: a store hook (paid revive, cosmetic). The room verifies before the sim applies it. */
export interface CommandMessage {
  readonly name: string;
  readonly value?: number;
  /** Proof of payment from the Kit: a transaction hash, or the key of a coin spend (POST /referee/spend). Verified by the room when the store is live. */
  readonly proof?: string;
}

/** Server -> client: the outcome of a command. */
export interface CommandResult {
  readonly name: string;
  readonly ok: boolean;
  readonly reason?: string;
}

/** Server -> client: a fresh referee run started (new runId after a run reset). */
export interface RunIdMessage {
  readonly runId: string | null;
}

export interface CreateOptions {
  readonly place: string;
  readonly template: string;
}
