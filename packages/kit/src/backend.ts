// The seam between the public Kit API and where the numbers come from: the
// chain (live.ts) or memory (mock.ts). Both return the same Snapshot, so the
// game code is identical in both modes.

import type { Address, EarnReport, Eip1193Provider, Hex, KitAttestation, KitCoinsState, KitGameMeta, KitPendingReward, KitProfile, KitSku, KitTokenState, RewardsClass } from "./types.js";
import type { CurvePool, Pools } from "./units.js";

export interface Snapshot {
  token: KitTokenState;
  usdg: bigint;
  skus: KitSku[];
  storeHalted: boolean;
  meta: KitGameMeta | null;
  /** Null until the game's pool holds liquidity (before graduation). */
  pools: Pools | null;
  /** The dollar pool (pair asset / USDG), known before graduation too. Internal. */
  dollar: Pools["dollar"] | null;
  /** True once the curve graduated (GameToken.graduated). */
  graduated: boolean;
  /** The curve's numbers while it runs (null once graduated), plus the wallet's net buys. Internal (pair-asset wei). */
  curve: (CurvePool & { netBought: bigint }) | null;
  allowances: { usdgToVault: bigint; tokenToVault: bigint; usdgToZap: bigint; tokenToZap: bigint };
}

export interface Backend {
  readonly mode: "live" | "mock";
  /** The one read: everything the game shows, in one call. */
  load(account: Address | null): Promise<Snapshot>;
  connect(provider?: Eip1193Provider): Promise<Address>;
  disconnect(): void;
  /** Called by the wallet layer when the player switches accounts. */
  onAccountsChanged(cb: (account: Address | null) => void): void;
  buySku(account: Address, sku: KitSku, inToken: boolean, snap: Snapshot): Promise<Hex[]>;
  spend(account: Address, amount: bigint, memo: Hex, snap: Snapshot): Promise<Hex[]>;
  /** GameZap.buyToken (graduated) or GameZap.buyOnCurve (before). `minMid` is the pair-asset floor for the curve route. */
  buyToken(account: Address, usdgIn: bigint, minTokenOut: bigint, snap: Snapshot, minMid: bigint): Promise<Hex[]>;
  /** GameZap.sellToken into the game's pool (graduated) or GameZap.sellOnCurve (before). There is no redemption route. */
  cashOut(account: Address, tokenIn: bigint, minUsdgOut: bigint, snap: Snapshot): Promise<Hex[]>;
  /** Report an event to the referee (with the session); returns the coin wei it granted (held) and any attestations it sent anyway. */
  report(account: Address, game: string, input: EarnReport): Promise<{ granted: bigint; attestations: KitAttestation[]; rewards?: RewardsClass; notice?: string }>;
  /** Attestations the referee holds for this wallet (left over from runs). */
  collect(account: Address): Promise<KitAttestation[]>;
  /** RewardVault.claim for one, claimBatch for several: one transaction. */
  claim(account: Address, rewards: KitPendingReward[]): Promise<Hex[]>;

  // ---- Coins: the referee's off-chain ledger on the Net Forge room server. No chain calls. ----

  /** True when a referee is configured (live) or always (mock). */
  readonly hasReferee: boolean;
  /** GET /referee/coins/:game/:wallet. One HTTP request, no RPC. */
  coins(account: Address, game: string): Promise<KitCoinsState>;
  /** POST /referee/spend. */
  spendCoins(account: Address, game: string, req: { amount: bigint; reason: string; key: string; remainder: boolean }): Promise<CoinSpend>;
  commitSpend(account: Address, game: string, key: string, txHash: Hex | null): Promise<void>;
  cancelSpend(account: Address, game: string, key: string): Promise<void>;
  /** POST /referee/claims/release: the referee signs the held coins; returns every claimable attestation. */
  release(account: Address, game: string): Promise<KitAttestation[]>;
  /** POST /referee/claims/return: hand back signatures the player did not use. */
  returnClaims(account: Address, game: string, nonces: Hex[]): Promise<void>;
  /** The coin's logo (and name) from the token's contractURI JSON. One fetch, cached by hash. */
  coinMetadata(meta: KitGameMeta): Promise<{ name: string | null; logo: string | null }>;
  // ---- Profiles: the referee's saves on the Net Forge room server. HTTP, no chain calls. ----

  /** GET /profile/game/:game as the signed-in wallet (when a session exists) or the guest. */
  profile(game: string, guest: string): Promise<KitProfile>;
  /** POST /profile/settings or /profile/name: as the session when there is one, else as the guest. */
  profileWrite(path: "/profile/settings" | "/profile/name", guest: string, body: Record<string, unknown>): Promise<KitProfile | null>;
  /** POST /profile/claim (wallet session, signs in if needed): merge the guest's progress into the wallet. */
  profileClaim(account: Address, game: string, guest: string): Promise<KitProfile>;
  /**
   * POST /profile/redeem (wallet session): a committed coin spend (its key;
   * null to pay from store credit only) becomes ownership. `level`: the meta
   * level being bought. A spend that cannot apply is refunded by the server.
   */
  profileRedeem(account: Address, game: string, item: string, key: string | null, level?: number): Promise<KitProfile>;

  /** SIWE sign-in against the referee; returns the session token. */
  signIn(account: Address): Promise<string>;
  session(): string | null;
  setSession(token: string | null): void;
}

export interface CoinSpend {
  status: "committed" | "reserved" | "cancelled";
  fromEarned: bigint;
  remainder: bigint;
  coins: KitCoinsState | null;
}
