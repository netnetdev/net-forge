// Public types. Every amount a game sees is in the game's token or in
// dollars (USDG). The pair asset never appears here (cabinet-launcher.md §6.2).

import type { KitError } from "./errors.js";
import type { Amount } from "./units.js";

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

/** Minimal EIP-1193 provider: MetaMask, Rabby, Privy, WalletConnect all fit. */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface KitInitOptions {
  /** The game's slug, as in netnet.config.json "game". */
  game: string;
  /** Run with no chain: in-memory balances, store and referee. */
  mock?: boolean;
  /** RPC for reads. Defaults to the public Robinhood Chain RPC, always kept as the fallback. */
  rpcUrl?: string;
  /** Referee endpoint that signs earn attestations. Required for live earn. */
  referee?: string;
  /** A wallet to use straight away (e.g. Privy's embedded wallet). Otherwise call kit.wallet.connect(). */
  provider?: Eip1193Provider;
  /** Slippage for buy and cash-out quotes, in bps. Default 100 (1%). */
  slippageBps?: number;
  /** Forks and tests only: override registry entries. Never ship this. */
  addresses?: Partial<Record<"gameFactory" | "gameZap" | "USDG" | "multicall3", Address>>;
  /** Tests only: a viem Transport to read through instead of HTTP. */
  transport?: unknown;
  /** Mock mode only: starting balances in whole units. `earned` is held, unclaimed coins. */
  mockBalances?: { token?: number; usdg?: number; earned?: number };
  /** Mock mode only: the game's coin as its token metadata will name it (never a generic "COIN"). */
  mockCoin?: { name?: string; symbol?: string; logo?: string };
  /** Mock mode only: the profile's permanent store (looks, unlocks, meta levels) and its starting achievements. */
  mockProfile?: { store?: ReadonlyArray<KitProfileStoreItem>; achievements?: ReadonlyArray<string>; keepers?: ReadonlyArray<string> };
  /** Mock mode only: run as a pre-launch game (coins are play money). Default "live". */
  mockMode?: "live" | "prelaunch";
  /** A referee session token from POST /auth/sign-in, if the host page already signed the player in. Otherwise the Kit signs in (SIWE) the first time it needs one. */
  session?: string;
  /** The store's SKU ids (the bootstrap passes netnet.config.json "store").
   *  Live mode reads these from the game's vault in the one snapshot call;
   *  mock mode stocks its store with them, prices included. */
  store?: ReadonlyArray<KitStoreItem>;
}

export type SkuKind = "permanent" | "consumable" | "pass";

export interface KitStoreItem {
  id: string;
  kind: SkuKind;
  priceUsdg?: string;
  priceToken?: string;
  /** Pass length in seconds (kind "pass" only). */
  duration?: number;
}

export interface KitSku {
  id: string;
  /** keccak256(bytes(id)), the id GameVault.setSku assigns. */
  key: Hex;
  kind: SkuKind;
  /** Raw USDG units (6 decimals), or null if not sold for dollars. */
  priceUsdg: bigint | null;
  /** Raw token units, or null if not sold for the token. */
  priceToken: bigint | null;
  /** False when the vault does not list it (both prices zero, or never set). */
  active: boolean;
  /** Permanent: 1 once owned. Consumable: how many bought, ever. Pass: 1 while it runs. 0 with no wallet. */
  owned: bigint;
  /** Pass only: Unix seconds the pass runs out, or null. */
  expiresAt: number | null;
}

export interface KitTokenState {
  symbol: string;
  decimals: number;
  /** Raw units held by the connected wallet. */
  balance: bigint;
  /** Dollars per whole token: the pool's mid price once graduated, the
   *  curve's marginal price before; null when neither is known. */
  priceUsd: number | null;
  /** The transfer tax, in bps (charged only after graduation). */
  taxBps: number;
  /** True once the bonding curve has graduated: the pool is live and the tax is on. */
  graduated: boolean;
  /** The bonding curve while it runs; null once graduated (or unknown). */
  curve: KitCurveState | null;
}

/** The bonding curve as players see it, in dollars (cabinet-launcher.md,
 *  launch model revised 2026-10-15). The pair asset never appears. */
export interface KitCurveState {
  /** 0..1: how far the raise is to graduation. */
  progress: number;
  /** Dollars raised so far (the curve's reserve at today's price); null without a dollar price. */
  raisedUsd: number | null;
  /** Dollars that graduate the curve; null without a dollar price. */
  targetUsd: number | null;
  /** The per-wallet cap on net buys, in dollars; null without a dollar price. */
  walletCapUsd: number | null;
  /** What the connected wallet has left under its cap, in dollars (the cap with no wallet). */
  walletRoomUsd: number | null;
  /** The curve's trade fee, in bps, both ways. */
  feeBps: number;
}

export interface KitPendingReward {
  /** The earn rule's name, e.g. "wave_cleared". */
  rule: string;
  /** Raw token units. */
  amount: bigint;
  /** Signed by the referee. Passed back to kit.earn.claim. */
  attestation: KitAttestation;
}

/** A signed RewardVault.Reward exactly as the room server's referee sends
 *  it (apps/rooms/src/referee/referee.ts attestationToJson): over the room
 *  socket as "attest", or from GET /referee/claims/:wallet. */
export interface KitAttestation {
  vault: Address;
  rule: string;
  runId: Hex;
  player: Address;
  ruleId: number;
  /** Token wei, decimal string. */
  amount: string;
  nonce: Hex;
  paidEntry: boolean;
  /** Unix seconds, decimal string. */
  expiry: string;
  /** The struct's last field. RewardVault reverts NotVerified unless it is true, and one false item sinks a whole claimBatch, so the Kit never submits one that is not true. */
  verified: boolean;
  signature: Hex;
}

/** ERC-7572 metadata the token reads from the factory. */
export interface KitGameMeta {
  name: string;
  contractURI: string;
  metadataHash: Hex;
}

/** The game's coin: its token, shown under the token's own metadata. 1 coin = 1 token. */
export interface KitCoin {
  /** The token's name from its metadata (contractURI), else the token's on-chain name. */
  name: string;
  /** The token's on-chain symbol. */
  symbol: string;
  /** The logo URL from the token's metadata (ipfs:// resolved to a gateway), or null until known. */
  logo: string | null;
  decimals: number;
}

/** The referee's coin ledger for the connected wallet (GET /referee/coins). Raw coin units. */
export interface KitCoinsState {
  /** "prelaunch": coins are play money (points). null: no referee configured. */
  mode: "live" | "prelaunch" | null;
  /** Earned, unclaimed and unsigned: spendable off chain right now. */
  earned: bigint;
  /** Signed for a claim and not yet claimed on chain (not spendable off chain). */
  claimable: bigint;
  /** Handed back after a claim that did not happen; spendable again once the chain proves the signature dead. */
  returning: bigint;
  /** Locked by a spend waiting on its chain remainder. */
  reserved: bigint;
  /** Committed coin purchases by reason (off-chain store items). */
  purchases: Record<string, number>;
}

export interface CoinSpendResult {
  /** Raw coins taken from earned (off chain). */
  fromEarned: bigint;
  /** Raw coins paid from the wallet on chain (0 when earned covered it). */
  onChain: bigint;
  /** Whole coins spent. */
  coins: number;
  /** The referee's key for this spend (null when no referee). A room accepts it once as proof of a paid command: `room.send("command", { name: reason, proof: key })`. */
  key: string | null;
}

/** One item of the game's permanent store as the profile sees it: a look, an unlock, losable gear, or a meta upgrade's next level. */
export interface KitProfileStoreItem {
  id: string;
  kind: "cosmetic" | "unlock" | "meta" | "gear";
  /** Whole coins for the next purchase; null when owned or at the top level. */
  coins: number | null;
  owned: boolean;
  cosmetic?: number;
  keeper?: string;
  /** Gear: the run upgrade it brings into staked runs, and the share of a run's most earn below which the run loses it. */
  gear?: string;
  loseBelow?: number;
  /** Meta upgrades: the stat, bonus per level (0.05 = +5%), level owned, top level, bonus now. */
  stat?: string;
  step?: number;
  level?: number;
  levels?: number;
  bonus?: number;
}

/**
 * The player's saved progress in this game, kept by the referee (rooms
 * server), the same on every device the player signs in on (Q146).
 * Achievements, goals and titles are granted by the server from the
 * authoritative sim, never by the browser.
 */
export interface KitProfile {
  game: string;
  /** Whose: the signed-in wallet, this browser's guest id, or null (nothing saved yet / no referee). */
  kind: "wallet" | "guest" | null;
  displayName: string | null;
  achievements: { id: string; at: number; source: "sim" | "import" }[];
  /** Keeper (character) ids the player may pick. */
  keepers: string[];
  /** Permanent SKUs owned (cosmetics, unlocks). */
  owned: string[];
  cosmetics: number[];
  /** Meta upgrade levels (only in games that opt in). */
  meta: Record<string, number>;
  goals: { day: number; today: string[]; done: string[] };
  titles: Record<string, number>;
  settings: Record<string, unknown>;
  store: KitProfileStoreItem[];
  imported: boolean;
  /** Store credit in whole coins (a refunded purchase the referee could not return as earned coins); spent first by the next buy. */
  credit: number;
  /** Across every game (the Launcher's profile page). */
  totals: { achievements: number; titles: number; games: number };
}

export interface KitState {
  status: "idle" | "loading" | "ready" | "error";
  mode: "live" | "mock";
  game: string | null;
  account: Address | null;
  token: KitTokenState;
  /** Raw USDG units (6 decimals) held by the connected wallet. */
  usdg: bigint;
  skus: KitSku[];
  storeHalted: boolean;
  /** The game's metadata record (contractURI, metadataHash), or null in mock mode or before launch. */
  meta: KitGameMeta | null;
  pendingRewards: KitPendingReward[];
  coin: KitCoin;
  coins: KitCoinsState;
  /** The player's saved progress in this game (null until loaded, or with no referee). */
  profile: KitProfile | null;
  /** ms timestamp of the last snapshot. */
  updatedAt: number;
  error: KitError | null;
}

export interface TxReceiptInfo {
  hashes: Hex[];
}

export interface BuyOptions {
  /** Pay in dollars (USDG), in the game's token from the wallet, or in coins (earned first, then the wallet). Defaults to USDG when the SKU has a dollar price. */
  pay?: "usdg" | "token" | "coins";
}

export interface CashOutQuote {
  /** Raw USDG the player receives. */
  usdgOut: bigint;
  /** Same, in dollars. */
  usd: number;
  /** "market": the game's pool (GameZap.sellToken), after graduation.
   *  "curve": back to the bonding curve (GameZap.sellOnCurve), before.
   *  There is no redemption route. */
  route: "market" | "curve";
}

export interface BuyQuote {
  /** Raw token units the player receives (after the transfer tax once graduated). */
  tokenOut: bigint;
  /** Same, in whole tokens. */
  tokens: number;
  /** "market" after graduation (GameZap.buyToken), "curve" before (GameZap.buyOnCurve). */
  route: "market" | "curve";
}

export interface EarnReport {
  /** Event id from netnet.config.json "earn". */
  event: string;
  /** How many times it happened (e.g. waves cleared). Default 1. */
  n?: number;
  /** The run this happened in, if the referee issued one. */
  runId?: string;
  /** Anything the referee needs to verify it (inputs, score, seed). */
  data?: unknown;
}

/**
 * How the referee treats this game's earn, decided on the server from how
 * the game was built and launched (never from anything the game sends):
 * "verified" (built through Net Forge on the NetNet engine; every run is
 * replayed before it pays) or "unverified" (not replayable; earns no
 * reward-pool tokens once live).
 */
export type RewardsClass = "verified" | "unverified";

export interface EarnResult {
  granted: boolean;
  /** Raw coin units granted (0 if not granted). Held: spendable now, claimable later. */
  amount: bigint;
  /** Same, in whole coins (1 coin = 1 token). */
  tokens: number;
  /** The game's rewards class when the referee said it (bring-your-own games always get one). */
  rewards?: RewardsClass;
  /** Set when this game earns no tokens, e.g. "Rewards need a verified build." Show it to the player as is. */
  notice?: string;
}

export type { Amount };
