// The public Kit: one object an AI coding agent writes against.
//
// Contract:
//   - kit.init() reads once (one Multicall3 eth_call). Every getter after
//     that is synchronous over the snapshot, so a game loop can read
//     balances every frame for free.
//   - The Kit reads again only after the wallet's own transaction, on an
//     account switch, or on an explicit kit.refresh(). It never polls.
//   - A game that never calls kit.init() makes zero calls.
//   - Amounts are in the game's token or in dollars. Nothing here mentions
//     the pair asset.
//   - kit.profile is the player's saved progress (achievements, unlocks,
//     goals, titles, owned looks and meta levels, settings), kept by the
//     referee per wallet (or per guest id until sign-in), never in the
//     browser. One HTTP GET the first time the game reads it, and
//     after a sign-in or a purchase; a game that never reads it makes no
//     call. No chain reads, no timers.
//   - kit.coins is how a game should show and spend the token: 1 coin = 1
//     token, under the token's own name, symbol and logo. Earned, unclaimed
//     coins are spent off chain through the referee first (an HTTP call, no
//     wallet prompt); only the remainder goes on chain. Before launch the
//     same calls spend play money.

import type { Backend, Snapshot } from "./backend.js";
import { isAttestation } from "./attestation.js";
import { EMPTY_COINS, spendKey } from "./coins.js";
import { guestId, loadPendingCommits, loadPendingRedeem, rotateGuestId, savePendingCommit, savePendingRedeem } from "./profile.js";
import { KitError, toKitError } from "./errors.js";
import { createMockBackend } from "./mock.js";
import type {
  Address, BuyOptions, BuyQuote, CashOutQuote, CoinSpendResult, EarnReport, EarnResult, Eip1193Provider, Hex, KitInitOptions,
  KitAttestation, KitCoin, KitCoinsState, KitCurveState, KitGameMeta, KitPendingReward, KitProfile, KitProfileStoreItem, KitSku, KitState,
} from "./types.js";
import {
  fromRaw, minOut, quoteBuy, quoteCurveBuy, quoteCurveSell, quoteMarketSell, memoKey, toRaw, USDG_DECIMALS, type Amount,
} from "./units.js";
import { discoverWallets, type WalletOption } from "./wallet.js";
import { SLUG_RE, ID_RE } from "./config.js";

export interface KitStore {
  /** Every SKU on the game's vault, with what the wallet owns. Sync, no RPC. */
  list(): KitSku[];
  get(id: string): KitSku | undefined;
  /** True if the wallet holds at least one (on chain, or bought with coins). Sync, no RPC. */
  owns(id: string): boolean;
  /** How many the wallet holds (on chain plus bought with coins). Sync, no RPC. */
  count(id: string): number;
  /** Buy one. USDG and token pay on chain (a wallet prompt, an approval first if needed). `{ pay: "coins" }` spends earned coins first, off chain, at the SKU's token price. */
  buy(id: string, opts?: BuyOptions): Promise<KitSku>;
}

export interface KitToken {
  symbol(): string;
  /** Whole tokens held. Sync, no RPC. */
  balance(): number;
  /** Raw units held. Sync, no RPC. */
  balanceRaw(): bigint;
  /** Dollars per token: the pool's mid price once graduated, the curve's price before. */
  priceUsd(): number | null;
  /** True once the bonding curve graduated: the game's pool is live and the tax is on. Sync, no RPC. */
  graduated(): boolean;
  /** The bonding curve in dollars (progress, raised, the wallet's room under its cap), or null once graduated. Sync, no RPC. */
  curve(): KitCurveState | null;
  /** The wallet's tokens valued in dollars at the mid price. */
  valueUsd(): number | null;
  /** How many tokens `usd` dollars buys now: on the curve before graduation, in the pool (after the transfer tax) after. Sync, no RPC. */
  quoteBuy(usd: Amount): BuyQuote;
  /** Buy tokens with dollars (USDG) in one zap transaction: GameZap.buyOnCurve before graduation, GameZap.buyToken after. */
  buy(usd: Amount): Promise<BuyQuote>;
  /** Spend wallet tokens on chain (a GameVault tip). Prefer kit.coins.spend, which spends earned coins first with no prompt. */
  spend(amount: Amount, reason: string): Promise<void>;
  /** Dollars received for `amount` tokens: back to the curve before graduation, into the pool after. Sync, no RPC. */
  quoteCashOut(amount: Amount): CashOutQuote;
  /** Turn tokens into dollars (USDG) in one transaction: GameZap.sellOnCurve before graduation, GameZap.sellToken after. */
  cashOut(amount: Amount): Promise<CashOutQuote>;
}

/**
 * The game's coins: its token as players meet it in play. 1 coin = 1 token,
 * shown under the token's own name, symbol and logo (its metadata), never a
 * generic "COIN". Every getter is sync over the snapshot (no RPC).
 */
export interface KitCoins {
  /** The token's own name, from its metadata. */
  name(): string;
  /** The token's own symbol. */
  symbol(): string;
  /** The token's logo URL from its metadata, or null until it loads. */
  logo(): string | null;
  /** Whole coins: earned and unclaimed (spendable now) plus the wallet's tokens. Before launch: play money. Sync. */
  balance(): number;
  /** Same, raw units. */
  balanceRaw(): bigint;
  /** Whole coins earned, not yet claimed, spendable off chain. Sync. */
  earned(): number;
  /** Whole coins signed for a claim and not yet claimed on chain. Sync. */
  claimable(): number;
  /** "live" (real tokens), "prelaunch" (play money), or null with no referee. */
  mode(): "live" | "prelaunch" | null;
  /** How many times `reason` was bought with coins. Sync. */
  purchases(reason: string): number;
  /** Format raw coin units, e.g. "1,250". */
  format(raw: bigint, digits?: number): string;
  /**
   * Spend coins on in-game utility (`reason` is an id like "revive").
   * Earned coins go first, off chain, with no wallet prompt; only a
   * remainder is paid from the wallet on chain (one confirmation). Before
   * launch it spends play money, with the same call.
   */
  spend(amount: Amount, reason: string): Promise<CoinSpendResult>;
  /** Buy coins with dollars: USDG to the token through GameZap.buyToken, one transaction. Only once graduated (before, coins are play money). */
  buy(usd: Amount): Promise<BuyQuote>;
  /** Claim every earned coin to the wallet: the referee signs, then one RewardVault transaction. Returns whole coins claimed. */
  claim(): Promise<number>;
  /** Sell wallet coins for dollars (USDG) in one transaction, GameZap.sellToken only. Only once graduated. */
  cashOut(amount: Amount): Promise<CashOutQuote>;
  /** Dollars `amount` coins sell for now. Sync, no RPC. */
  quoteCashOut(amount: Amount): CashOutQuote;
  /** Coins `usd` dollars buys now, after the transfer tax. Sync, no RPC. */
  quoteBuy(usd: Amount): BuyQuote;
}

/**
 * The player's saves in this game: the same on every
 * device the player signs in on. A guest's progress is kept under this
 * browser's guest id and merges into the wallet at kit.wallet.signIn().
 * Reads are sync over the last load; the first read starts the one load
 * (it returns null until then; subscribers hear when it lands), and the Kit
 * loads again after a sign-in, a merge or a purchase. HTTP only, no RPC.
 */
export interface KitProfileApi {
  /** The saved profile, or null before it loads (or with no referee). Sync. */
  get(): KitProfile | null;
  /** Called whenever the profile changes. Returns an unsubscribe. */
  subscribe(listener: (profile: KitProfile | null) => void): () => void;
  /** Load it again (one HTTP GET). Only after an event outside the game, never on a timer. */
  refresh(): Promise<KitProfile | null>;
  /** True when a permanent item (a look, an unlock) is owned. Sync. */
  owns(id: string): boolean;
  /** A meta upgrade's level (0 when none, and always 0 in games without them). Sync. */
  level(id: string): number;
  /** True when the server granted this achievement. Sync. */
  achieved(id: string): boolean;
  /** The permanent store with each item's next price in coins (meta: the next level's). Sync. */
  store(): KitProfileStoreItem[];
  /** Replace this game's settings for the player (a small JSON object, at most 4 KB). */
  setSettings(settings: Record<string, unknown>): Promise<KitProfile | null>;
  /** The display name (1-24 characters) the Launcher shows. */
  setName(name: string): Promise<void>;
  /**
   * Buy a permanent item with coins: kit.coins.spend(price, id) (earned
   * coins first, no prompt), then the referee turns the spend into
   * ownership at the price in the game's manifest. Needs a wallet.
   */
  buy(id: string): Promise<KitProfile>;
  /** This browser's guest id (the profile key until sign-in). */
  guestId(): string;
}

export interface KitEarn {
  /** Tell the referee the player earned (POST <referee>/referee/report). The referee decides; the browser never does. */
  report(input: EarnReport, opts?: { claim?: boolean }): Promise<EarnResult>;
  /** Add attestations the room server sent over its socket ("attest" message). Returns how many were new and usable. */
  accept(attestations: readonly unknown[]): number;
  /** Fetch attestations the referee kept for this wallet (GET <referee>/referee/claims/:wallet). No chain call. */
  collect(): Promise<number>;
  /** Rewards granted by the referee and not yet claimed. */
  pending(): KitPendingReward[];
  /** Claim one pending reward (the oldest by default). Returns whole tokens claimed. */
  claim(reward?: KitPendingReward): Promise<number>;
  /** Claim every pending reward in one transaction (RewardVault.claimBatch). Returns whole tokens claimed. */
  claimAll(): Promise<number>;
}

export interface KitWallet {
  /** Connect a wallet. Call from a click. Pass a provider (Privy, WalletConnect) or let the Kit find one. */
  connect(provider?: Eip1193Provider): Promise<Address>;
  disconnect(): void;
  address(): Address | null;
  /** Installed wallets (EIP-6963), for a picker. No RPC. */
  available(): Promise<WalletOption[]>;
  /** Sign in to the referee (one SIWE signature, no gas). The Kit does this itself the first time it needs a session; call it from a click to choose when the prompt shows. */
  signIn(): Promise<string>;
  /** The referee session token, or null. */
  session(): string | null;
}

export interface Kit {
  init(opts: KitInitOptions): Promise<KitState>;
  getState(): KitState;
  /** Subscribe to state changes. Returns an unsubscribe. Shaped for React's useSyncExternalStore. */
  subscribe(listener: () => void): () => void;
  /** Read the chain again (one call). Only after an event outside the game. Never on a timer. */
  refresh(): Promise<KitState>;
  wallet: KitWallet;
  store: KitStore;
  token: KitToken;
  /** The game's coins (its token, under its own name and logo). Start here for balances, spends and claims. */
  coins: KitCoins;
  /** The player's saved progress (achievements, unlocks, goals, looks, meta levels, settings), kept by the referee. */
  profile: KitProfileApi;
  earn: KitEarn;
  /** The game's ERC-7572 metadata (contractURI, metadataHash), or null. Sync, no RPC. */
  metadata(): KitGameMeta | null;
  /** Alias of `earn`, matching the spec's `kit.rewards.report`. */
  rewards: KitEarn;
  format: {
    usd(n: number | null): string;
    token(raw: bigint, digits?: number): string;
  };
  /** Tests only: forget everything. */
  reset(): void;
}

const EMPTY_STATE: KitState = {
  status: "idle",
  mode: "live",
  game: null,
  account: null,
  token: { symbol: "", decimals: 18, balance: 0n, priceUsd: null, taxBps: 0, graduated: false, curve: null },
  usdg: 0n,
  skus: [],
  storeHalted: false,
  meta: null,
  pendingRewards: [],
  coin: { name: "", symbol: "", logo: null, decimals: 18 },
  coins: EMPTY_COINS,
  profile: null,
  updatedAt: 0,
  error: null,
};

export function createKit(): Kit {
  let state: KitState = EMPTY_STATE;
  let backend: Backend | null = null;
  let options: KitInitOptions | null = null;
  let snap: Snapshot | null = null;
  let initPromise: Promise<KitState> | null = null;
  let inflight: Promise<KitState> | null = null;
  const listeners = new Set<() => void>();

  function set(patch: Partial<KitState>): void {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  }

  function ready(): { backend: Backend; snap: Snapshot; opts: KitInitOptions } {
    if (!backend || !snap || !options) throw new KitError("NOT_INITIALIZED");
    return { backend, snap, opts: options };
  }

  function account(): Address {
    ready();
    if (!state.account) throw new KitError("NO_WALLET");
    return state.account;
  }

  /** The one read. Concurrent callers share it. */
  function load(): Promise<KitState> {
    if (!backend) return Promise.reject(new KitError("NOT_INITIALIZED"));
    if (inflight) return inflight;
    const b = backend;
    set({ status: state.status === "idle" ? "loading" : state.status });
    const who = state.account;
    // The referee's coin ledger is one HTTP GET (no RPC), in parallel with
    // the one snapshot call; a referee outage keeps the last coin state.
    const coinsP: Promise<KitCoinsState | null> = who && b.hasReferee && state.game ? b.coins(who, state.game).catch(() => null) : Promise.resolve(null);
    inflight = Promise.all([b.load(who), coinsP])
      .then(([s, c]) => {
        snap = s;
        const coin: KitCoin = { ...state.coin, symbol: s.token.symbol, decimals: s.token.decimals, name: state.coin.name || s.meta?.name || s.token.symbol };
        set({ status: "ready", token: s.token, usdg: s.usdg, skus: s.skus, storeHalted: s.storeHalted, meta: s.meta, coin, ...(c ? { coins: c } : who ? {} : { coins: EMPTY_COINS }), updatedAt: Date.now(), error: null });
        loadCoinMetadata(b, s);
        return state;
      })
      .catch((err: unknown) => {
        const e = toKitError(err, "RPC_ERROR");
        set({ status: "error", error: e });
        throw e;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  /**
   * A purchase: refresh the profile (the price may have moved), spend only
   * what store credit does not cover, then redeem. The spend's key is kept
   * until the redeem lands, so a network failure retries the same spend
   * instead of paying twice. One buy per item at a time.
   */
  const buying = new Map<string, Promise<KitProfile>>();
  async function buyItem(id: string): Promise<KitProfile> {
    const { backend: b } = ready();
    const who = account();
    const game = state.game;
    if (!b.hasReferee || !game) throw new KitError("NO_REFEREE");
    // The referee consumed or refunded the spend: only then is its key done with. A 429, a 5xx or no answer keeps it for a retry.
    const settled = (e: unknown) => e instanceof KitError && /the coins were returned|no committed spend|that spend was just used/.test(e.message);
    const pending = loadPendingRedeem(game, id);
    if (pending && pending.account.toLowerCase() === who.toLowerCase()) {
      try {
        const p = await b.profileRedeem(who, game, id, pending.key, pending.level);
        savePendingRedeem(game, id, null);
        set({ profile: p });
        return p;
      } catch (e) {
        if (!settled(e)) throw toKitError(e);
        // The referee refunded or already used that spend. Start fresh.
        savePendingRedeem(game, id, null);
      }
    }
    const fresh = await loadProfile();
    const item = fresh?.store.find((i) => i.id === id);
    if (!fresh || !item) throw new KitError("UNKNOWN_SKU", `"${id}" is not in this game's permanent store.`);
    if (item.coins === null) throw new KitError("SKU_NOT_PRICED", `"${id}" is owned already or at its top level.`);
    const level = item.kind === "meta" ? (item.level ?? 0) + 1 : undefined;
    const need = Math.max(0, Math.ceil(item.coins - fresh.credit));
    let key: string | null = null;
    if (need > 0) {
      const spent = await spendCoins(need, id);
      if (!spent.key) throw new KitError("NO_REFEREE");
      key = spent.key;
      savePendingRedeem(game, id, { key, account: who, ...(level !== undefined ? { level } : {}) });
    }
    const p = await b.profileRedeem(who, game, id, key, level).catch((e: unknown) => {
      if (settled(e)) savePendingRedeem(game, id, null);
      throw toKitError(e);
    });
    savePendingRedeem(game, id, null);
    set({ profile: p });
    return p;
  }

  /** The first read of kit.profile loads it (once per account); nothing loads for a game that never reads it. */
  let profileWanted = false;
  let profileFor: string | null = null;
  function wantProfile(): KitProfile | null {
    profileWanted = true;
    const key = `${state.game ?? ""}|${state.account ?? ""}`;
    if (profileFor !== key && backend?.hasReferee && state.game) {
      profileFor = key;
      void loadProfile().catch(() => {
        profileFor = null;
      });
    }
    return state.profile;
  }

  /** One profile GET (HTTP, no RPC): as the session when there is one, else as this browser's guest. */
  async function loadProfile(): Promise<KitProfile | null> {
    const b = backend;
    if (!b || !b.hasReferee || !state.game) return null;
    const p = await b.profile(state.game, guestId());
    if (backend === b) set({ profile: p });
    return p;
  }

  /** After a sign-in: the guest's progress merges into the wallet; the guest id is spent. */
  async function claimGuest(): Promise<void> {
    const b = backend;
    if (!b || !b.hasReferee || !state.game || !state.account) return;
    const p = await b.profileClaim(state.account, state.game, guestId());
    rotateGuestId();
    if (backend === b) set({ profile: p });
  }

  /** The coin's name and logo from the token's metadata JSON: once per session (cached by the backend), never blocking the game. */
  let metaFor: string | null = null;
  function loadCoinMetadata(b: Backend, s: Snapshot): void {
    const key = s.meta ? `${s.meta.metadataHash}|${s.meta.contractURI}` : b.mode === "mock" ? "mock" : null;
    if (!key || key === metaFor) return;
    metaFor = key;
    void b
      .coinMetadata(s.meta ?? { name: "", contractURI: "", metadataHash: "0x" })
      .then((m) => {
        if (backend !== b) return;
        set({ coin: { ...state.coin, name: m.name ?? state.coin.name, logo: m.logo ?? state.coin.logo } });
      })
      .catch(() => undefined);
  }

  async function afterTx<T>(fn: () => Promise<Hex[]>, then: () => T): Promise<T> {
    try {
      await fn();
    } catch (err) {
      // A failed or rejected transaction still may have landed an approval.
      await load().catch(() => undefined);
      throw toKitError(err);
    }
    await load();
    return then();
  }

  function sku(id: string): KitSku {
    const { snap: s } = ready();
    const found = s.skus.find((x) => x.id === id);
    if (!found) throw new KitError("UNKNOWN_SKU", `No SKU "${id}" on this game's vault.`);
    return found;
  }

  function tokenRaw(amount: Amount): bigint {
    return toRaw(amount, state.token.decimals);
  }

  function cashOutQuote(amount: Amount): CashOutQuote {
    const { snap: s } = ready();
    const raw = tokenRaw(amount);
    if (!s.graduated) {
      if (!s.curve || !s.dollar) throw new KitError("NO_LIQUIDITY");
      const usdgOut = quoteCurveSell(raw, s.dollar, s.curve);
      return { usdgOut, usd: fromRaw(usdgOut, USDG_DECIMALS), route: "curve" };
    }
    if (!s.pools) throw new KitError("NO_LIQUIDITY");
    const usdgOut = quoteMarketSell(raw, s.pools, BigInt(s.token.taxBps));
    return { usdgOut, usd: fromRaw(usdgOut, USDG_DECIMALS), route: "market" };
  }

  /** The quote plus, on the curve, the pair-asset floor the zap's first leg needs. */
  function buyPlan(usd: Amount): BuyQuote & { mid: bigint } {
    const { snap: s } = ready();
    const usdgIn = toRaw(usd, USDG_DECIMALS);
    if (!s.graduated) {
      if (!s.curve || !s.dollar) throw new KitError("NO_LIQUIDITY");
      const q = quoteCurveBuy(usdgIn, s.dollar, s.curve);
      if (s.curve.netBought + q.net > s.curve.walletCap) throw new KitError("WALLET_CAP");
      return { tokenOut: q.tokensOut, tokens: fromRaw(q.tokensOut, s.token.decimals), route: "curve", mid: q.mid };
    }
    if (!s.pools) throw new KitError("NO_LIQUIDITY");
    const tokenOut = quoteBuy(usdgIn, s.pools, BigInt(s.token.taxBps));
    return { tokenOut, tokens: fromRaw(tokenOut, s.token.decimals), route: "market", mid: 0n };
  }

  function buyQuote(usd: Amount): BuyQuote {
    const { tokenOut, tokens, route } = buyPlan(usd);
    return { tokenOut, tokens, route };
  }

  async function claimSome(rewards: KitPendingReward[], released: readonly Hex[] = []): Promise<number> {
    const { backend: b } = ready();
    const who = account();
    if (rewards.length === 0) throw new KitError("NOTHING_TO_CLAIM");
    try {
      return await afterTx(
        () => b.claim(who, rewards),
        () => {
          set({ pendingRewards: state.pendingRewards.filter((r) => !rewards.includes(r)) });
          return rewards.reduce((n, r) => n + fromRaw(r.amount, state.token.decimals), 0);
        },
      );
    } catch (err) {
      // The claim did not happen: hand the signatures the referee just made
      // back, so their coins become spendable again once they lapse.
      const back = rewards.map((r) => r.attestation.nonce).filter((n) => released.includes(n));
      if (back.length > 0 && state.game) {
        await b.returnClaims(who, state.game, back).catch(() => undefined);
        set({ pendingRewards: state.pendingRewards.filter((r) => !back.includes(r.attestation.nonce)) });
        await load().catch(() => undefined);
      }
      throw err;
    }
  }

  /** Every earned coin, signed by the referee now, plus attestations already held. */
  async function releaseAll(): Promise<Hex[]> {
    const { backend: b } = ready();
    const who = account();
    if (!b.hasReferee || !state.game) return [];
    if (state.coins.mode === "prelaunch") throw new KitError("PRELAUNCH");
    const atts = await b.release(who, state.game);
    const before = new Set(state.pendingRewards.map((r) => r.attestation.nonce.toLowerCase()));
    addAttestations(atts);
    return atts.filter((a) => !before.has(a.nonce.toLowerCase())).map((a) => a.nonce);
  }

  async function claimEverything(): Promise<number> {
    const released = await releaseAll();
    return claimSome([...state.pendingRewards], released);
  }

  function coinsRaw(amount: Amount): bigint {
    return toRaw(amount, state.coin.decimals || state.token.decimals);
  }

  /**
   * Earned coins first, off chain (the referee deducts them; no prompt).
   * A remainder is paid from the wallet on chain as a GameVault tip, then
   * committed with its transaction hash; if the chain part fails, the
   * reservation is cancelled and the earned coins are held again.
   */
  async function spendCoins(amount: Amount, reason: string): Promise<CoinSpendResult> {
    const { backend: b, snap: s } = ready();
    const who = account();
    if (!ID_RE.test(reason)) throw new KitError("BAD_AMOUNT", `Spend reason "${reason}" must be an id like "revive".`);
    const raw = coinsRaw(amount);
    const done = (fromEarned: bigint, onChain: bigint, key: string | null): CoinSpendResult => ({ fromEarned, onChain, coins: fromRaw(raw, state.coin.decimals), key });
    const game = state.game ?? "";
    const c = state.coins;
    if (!b.hasReferee) {
      // No referee: wallet coins only.
      if (s.token.balance < raw) throw new KitError("INSUFFICIENT_BALANCE");
      await afterTx(() => b.spend(who, raw, memoKey(reason), s), () => undefined);
      return done(0n, raw, null);
    }
    if (c.mode === "prelaunch") {
      if (c.earned < raw) throw new KitError("INSUFFICIENT_BALANCE", "Not enough coins.");
      const key = spendKey();
      const r = await b.spendCoins(who, game, { amount: raw, reason, key, remainder: false });
      applySpend(r.coins, r.fromEarned, reason);
      return done(r.fromEarned, 0n, key);
    }
    if (c.earned + s.token.balance < raw) throw new KitError("INSUFFICIENT_BALANCE");
    const key = spendKey();
    const r = await b.spendCoins(who, game, { amount: raw, reason, key, remainder: true });
    if (r.remainder === 0n) {
      applySpend(r.coins, r.fromEarned, reason);
      return done(r.fromEarned, 0n, key);
    }
    let hashes: Hex[];
    try {
      if (s.token.balance < r.remainder) throw new KitError("INSUFFICIENT_BALANCE");
      hashes = await b.spend(who, r.remainder, memoKey(reason), s);
    } catch (err) {
      await b.cancelSpend(who, game, key).catch(() => undefined);
      await load().catch(() => undefined);
      throw toKitError(err);
    }
    const txHash = hashes.at(-1) ?? null;
    // The tip is paid: keep its key and hash until the referee has it, so a commit that cannot confirm now is retried on the next load.
    if (txHash) savePendingCommit(game, { key, txHash, account: who });
    try {
      await b.commitSpend(who, game, key, txHash);
    } catch (err) {
      if (commitSettled(err)) savePendingCommit(game, null, key);
      throw toKitError(err);
    }
    savePendingCommit(game, null, key);
    await load();
    return done(r.fromEarned, r.remainder, key);
  }

  /** A commit answer that settles a paid tip either way (applied, credited, or proven not to pay it). Anything else is retried. */
  function commitSettled(err: unknown): boolean {
    return err instanceof KitError && /did not pay this spend|already paid another spend|reverted|no such spend|committed with another transaction/.test(err.message);
  }

  /** On open: commit tips paid on chain whose commit never reached the referee (HTTP only; never on a timer). */
  async function retryPendingCommits(): Promise<number> {
    const b = backend;
    const game = state.game;
    const who = state.account;
    if (!b || !b.hasReferee || !game || !who) return 0;
    let done = 0;
    for (const p of loadPendingCommits(game)) {
      if (p.account.toLowerCase() !== who.toLowerCase()) continue;
      try {
        await b.commitSpend(who, game, p.key, p.txHash as Hex);
        savePendingCommit(game, null, p.key);
        done++;
      } catch (err) {
        if (commitSettled(err)) savePendingCommit(game, null, p.key);
      }
    }
    return done;
  }

  /** The referee's answer to a spend, or a local deduction when it sent no balance. Zero extra calls. */
  function applySpend(c: KitCoinsState | null, fromEarned: bigint, reason: string): void {
    if (c) return set({ coins: c });
    const cur = state.coins;
    set({ coins: { ...cur, earned: cur.earned - fromEarned, purchases: { ...cur.purchases, [reason]: (cur.purchases[reason] ?? 0) + 1 } } });
  }

  /** Coins buy and cash out at the market only: after graduation, never on the curve. */
  function notPrelaunch(): void {
    if (state.coins.mode === "prelaunch") throw new KitError("PRELAUNCH");
    if (snap && !snap.graduated) throw new KitError("PRELAUNCH", "The game's market opens at graduation; until then coins are play money.");
  }

  async function buyToken(usd: Amount): Promise<BuyQuote> {
    const { backend: b, snap: s, opts } = ready();
    const who = account();
    const usdgIn = toRaw(usd, USDG_DECIMALS);
    if (s.usdg < usdgIn) throw new KitError("INSUFFICIENT_BALANCE");
    const { mid, ...q } = buyPlan(usd);
    const slip = opts.slippageBps ?? 100;
    return afterTx(() => b.buyToken(who, usdgIn, minOut(q.tokenOut, slip), s, minOut(mid, slip)), () => q);
  }

  async function cashOut(amount: Amount): Promise<CashOutQuote> {
    const { backend: b, snap: s, opts } = ready();
    const who = account();
    const raw = tokenRaw(amount);
    if (s.token.balance < raw) throw new KitError("INSUFFICIENT_BALANCE");
    const q = cashOutQuote(amount);
    return afterTx(() => b.cashOut(who, raw, minOut(q.usdgOut, opts.slippageBps ?? 100), s), () => q);
  }

  /** Spendable coins: earned and unclaimed, plus the wallet's tokens once live. Pre-launch: play money only. */
  function coinBalanceRaw(): bigint {
    const c = state.coins;
    return c.mode === "prelaunch" ? c.earned : c.earned + state.token.balance;
  }

  /** Add attestations, newest wins, deduplicated by nonce. Only verified ones are kept (an unverified one would revert a whole claimBatch). Returns how many were new. */
  function addAttestations(atts: readonly KitAttestation[]): number {
    const known = new Set(state.pendingRewards.map((r) => r.attestation.nonce.toLowerCase()));
    const fresh = atts.filter((a) => a.verified === true && !known.has(a.nonce.toLowerCase()) && (!state.account || a.player.toLowerCase() === state.account.toLowerCase()) && BigInt(a.expiry) > BigInt(Math.floor(Date.now() / 1000)));
    if (fresh.length > 0) set({ pendingRewards: [...state.pendingRewards, ...fresh.map((a) => ({ rule: a.rule, amount: BigInt(a.amount), attestation: a }))] });
    return fresh.length;
  }

  const earn: KitEarn = {
    async report(input, opts) {
      const { backend: b } = ready();
      const who = account();
      if (typeof input?.event !== "string" || !ID_RE.test(input.event)) throw new KitError("REFEREE_REJECTED", `"${String(input?.event)}" is not a valid earn event id.`);
      const { granted, attestations, rewards, notice } = await b.report(who, state.game ?? "", input);
      addAttestations(attestations);
      // Held coins: credited locally from the answer, no extra call.
      const held = granted - attestations.reduce((n, a) => n + BigInt(a.amount), 0n);
      if (held > 0n) set({ coins: { ...state.coins, earned: state.coins.earned + held } });
      const result: EarnResult = { granted: granted > 0n, amount: granted, tokens: fromRaw(granted, state.token.decimals), ...(rewards ? { rewards } : {}), ...(notice ? { notice } : {}) };
      if (opts?.claim && granted > 0n && state.coins.mode !== "prelaunch") await claimEverything();
      return result;
    },
    accept(attestations) {
      ready();
      return addAttestations(attestations.filter(isAttestation));
    },
    async collect() {
      const { backend: b } = ready();
      return addAttestations(await b.collect(account()));
    },
    pending: () => state.pendingRewards,
    async claim(reward) {
      if (reward) return claimSome([reward]);
      const released = state.pendingRewards.length === 0 ? await releaseAll() : [];
      const r = state.pendingRewards[0];
      if (!r) throw new KitError("NOTHING_TO_CLAIM");
      return claimSome([r], released);
    },
    async claimAll() {
      return claimEverything();
    },
  };

  const kit: Kit = {
    init(opts) {
      if (initPromise) {
        if (options?.game === opts.game) return initPromise;
        return Promise.reject(new KitError("ALREADY_INITIALIZED", `Already initialized for "${options?.game}".`));
      }
      if (typeof opts?.game !== "string" || !SLUG_RE.test(opts.game)) return Promise.reject(new KitError("BAD_GAME_SLUG", `Got ${JSON.stringify(opts?.game)}.`));
      options = opts;
      initPromise = (async () => {
        try {
          // The live backend (and viem's client code) loads only when a live
          // game opens, so a page whose game never opens downloads none of it.
          backend = opts.mock ? createMockBackend(opts) : (await import("./live.js")).createLiveBackend(opts.game, opts);
        } catch (err) {
          const e = toKitError(err, "PLACEHOLDER_ADDRESS");
          set({ status: "error", error: e, game: opts.game });
          throw e;
        }
        set({ mode: backend.mode, game: opts.game, status: "loading" });
        backend.onAccountsChanged((a) => {
          set({ account: a, pendingRewards: [], coins: EMPTY_COINS, profile: null });
          void load().catch(() => undefined);
          if (profileWanted) wantProfile();
        });
        if (opts.mock || opts.provider) set({ account: await backend.connect(opts.provider) });
        const out = await load();
        // A tip paid in an earlier session whose commit never landed: commit it now (HTTP), and refresh only if one did.
        void retryPendingCommits().then((n) => (n > 0 ? load() : undefined)).catch(() => undefined);
        return out;
      })();
      initPromise.catch(() => {
        // Let a failed init be retried.
        initPromise = null;
        backend = null;
        options = null;
      });
      return initPromise;
    },

    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    refresh: () => load(),

    wallet: {
      async connect(provider) {
        if (!backend) throw new KitError("NOT_INITIALIZED");
        const a = await backend.connect(provider);
        set({ account: a });
        await load();
        return a;
      },
      disconnect() {
        backend?.disconnect();
        set({ account: null, pendingRewards: [], coins: EMPTY_COINS, profile: null });
        backend?.setSession(null);
        if (backend) void load().catch(() => undefined);
      },
      address: () => state.account,
      available: () => discoverWallets(),
      async signIn() {
        const { backend: b } = ready();
        const token = await b.signIn(account());
        // The guest's saves follow the player into the wallet's profile.
        await claimGuest().catch(() => loadProfile().catch(() => undefined));
        return token;
      },
      session: () => backend?.session() ?? null,
    },

    store: {
      list: () => state.skus,
      get: (id) => state.skus.find((s) => s.id === id),
      owns: (id) => (state.skus.find((s) => s.id === id)?.owned ?? 0n) > 0n || (state.coins.purchases[id] ?? 0) > 0,
      count: (id) => Number(state.skus.find((s) => s.id === id)?.owned ?? 0n) + (state.coins.purchases[id] ?? 0),
      async buy(id, opts) {
        const { backend: b, snap: s } = ready();
        const who = account();
        const item = sku(id);
        if (s.storeHalted) throw new KitError("STORE_HALTED");
        if (!item.active) throw new KitError("SKU_INACTIVE");
        if (item.kind === "permanent" && (item.owned > 0n || (state.coins.purchases[id] ?? 0) > 0)) return item;
        if (opts?.pay === "coins") {
          if (item.priceToken === null) throw new KitError("SKU_NOT_PRICED");
          await spendCoins(item.priceToken, id);
          return sku(id);
        }
        const payInToken = opts?.pay ? opts.pay === "token" : item.priceUsdg === null;
        const price = payInToken ? item.priceToken : item.priceUsdg;
        if (price === null) throw new KitError("SKU_NOT_PRICED");
        if ((payInToken ? s.token.balance : s.usdg) < price) throw new KitError("INSUFFICIENT_BALANCE");
        return afterTx(() => b.buySku(who, item, payInToken, s), () => sku(id));
      },
    },

    token: {
      symbol: () => state.token.symbol,
      balance: () => fromRaw(state.token.balance, state.token.decimals),
      balanceRaw: () => state.token.balance,
      priceUsd: () => state.token.priceUsd,
      graduated: () => state.token.graduated,
      curve: () => state.token.curve,
      valueUsd: () => (state.token.priceUsd === null ? null : fromRaw(state.token.balance, state.token.decimals) * state.token.priceUsd),
      quoteBuy: buyQuote,
      buy: (usd) => buyToken(usd),
      async spend(amount, reason) {
        const { backend: b, snap: s } = ready();
        const who = account();
        if (!ID_RE.test(reason)) throw new KitError("BAD_AMOUNT", `Spend reason "${reason}" must be an id like "revive".`);
        const raw = tokenRaw(amount);
        if (s.token.balance < raw) throw new KitError("INSUFFICIENT_BALANCE");
        await afterTx(() => b.spend(who, raw, memoKey(reason), s), () => undefined);
      },
      quoteCashOut: cashOutQuote,
      cashOut: (amount) => cashOut(amount),
    },

    coins: {
      name: () => state.coin.name || state.token.symbol,
      symbol: () => state.coin.symbol || state.token.symbol,
      logo: () => state.coin.logo,
      balance: () => fromRaw(coinBalanceRaw(), state.coin.decimals),
      balanceRaw: () => coinBalanceRaw(),
      earned: () => fromRaw(state.coins.earned, state.coin.decimals),
      claimable: () => fromRaw(state.coins.claimable, state.coin.decimals),
      mode: () => state.coins.mode,
      purchases: (reason) => state.coins.purchases[reason] ?? 0,
      format: (raw, digits = 0) => fromRaw(raw, state.coin.decimals).toLocaleString("en-US", { maximumFractionDigits: digits }),
      spend: (amount, reason) => spendCoins(amount, reason),
      async buy(usd) {
        notPrelaunch();
        return buyToken(usd);
      },
      claim: () => claimEverything(),
      async cashOut(amount) {
        notPrelaunch();
        return cashOut(amount);
      },
      quoteCashOut(amount) {
        notPrelaunch();
        return cashOutQuote(amount);
      },
      quoteBuy(usd) {
        notPrelaunch();
        return buyQuote(usd);
      },
    },

    profile: {
      get: () => wantProfile(),
      subscribe(listener) {
        wantProfile();
        let last = state.profile;
        const l = () => {
          if (state.profile === last) return;
          last = state.profile;
          listener(state.profile);
        };
        listeners.add(l);
        return () => void listeners.delete(l);
      },
      refresh: () => loadProfile(),
      owns: (id) => wantProfile()?.owned.includes(id) ?? false,
      level: (id) => wantProfile()?.meta[id] ?? 0,
      achieved: (id) => wantProfile()?.achievements.some((a) => a.id === id) ?? false,
      store: () => wantProfile()?.store ?? [],
      async setSettings(settings) {
        const { backend: b } = ready();
        if (!b.hasReferee || !state.game) throw new KitError("NO_REFEREE");
        const p = await b.profileWrite("/profile/settings", guestId(), { game: state.game, settings });
        if (p) set({ profile: p });
        return p;
      },
      async setName(name) {
        const { backend: b } = ready();
        if (!b.hasReferee || !state.game) throw new KitError("NO_REFEREE");
        const p = await b.profileWrite("/profile/name", guestId(), { game: state.game, displayName: name });
        if (p) set({ profile: p });
      },
      buy(id) {
        const cur = buying.get(id);
        if (cur) return cur;
        const p = buyItem(id).finally(() => buying.delete(id));
        buying.set(id, p);
        return p;
      },
      guestId: () => guestId(),
    },

    earn,
    rewards: earn,
    metadata: () => state.meta,

    format: {
      usd(n) {
        if (n === null || !Number.isFinite(n)) return "$-";
        const digits = Math.abs(n) >= 1 ? 2 : Math.abs(n) >= 0.01 ? 3 : 5;
        return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: digits })}`;
      },
      token(raw, digits = 2) {
        return fromRaw(raw, state.token.decimals).toLocaleString("en-US", { maximumFractionDigits: digits });
      },
    },

    reset() {
      state = EMPTY_STATE;
      backend = null;
      options = null;
      snap = null;
      initPromise = null;
      inflight = null;
      metaFor = null;
      profileWanted = false;
      profileFor = null;
      for (const l of listeners) l();
    },
  };
  return kit;
}
