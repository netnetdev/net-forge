// Mock backend: the whole Kit with no chain. Balances, the store, the
// quotes and the referee live in memory, so a game runs and every Kit call
// behaves the same way in local development and in CI. Makes zero network
// calls of any kind.

import type { Backend, Snapshot } from "./backend.js";
import { coinFromSlug } from "./coins.js";
import { emptyProfile } from "./profile.js";
import { KitError } from "./errors.js";
import type { Address, Hex, KitAttestation, KitCoinsState, KitInitOptions, KitProfile, KitSku } from "./types.js";
import { curvePriceUsd, curveView } from "./curve.js";
import { curveQuoteBuy, curveQuoteSell, priceUsd, quoteBuy, quoteCurveBuy, quoteCurveSell, quoteMarketSell, skuKey, toRaw, USDG_DECIMALS, type CurvePool, type Pools } from "./units.js";

/** The mock wallet. Not a real account; it only exists in memory. */
export const MOCK_ACCOUNT: Address = "0x000000000000000000000000000000000000c0de";
/** The mock reward vault attestations name. Not a real contract. */
const MOCK_VAULT: Address = "0x000000000000000000000000000000000000ba5e";

const TOKEN_DECIMALS = 18;
const E18 = 10n ** 18n;
const MOCK_TAX_BPS = 500;
/** Mock pools: about $0.06 a token. */
const MOCK_POOLS: Pools = {
  game: { token: 1_000_000n * E18, pairAsset: 2_000n * E18 },
  dollar: { pairAsset: 100_000n * E18, usdg: 3_000_000n * 10n ** 6n },
};
/** A mock bonding curve ($8k graduation at $30 a pair-asset unit, the
 *  middle curve, 1% fee, $500 wallet cap), a third of the way up. */
const MOCK_CURVE: CurvePool = {
  reserve: 90n * E18,
  sold: 0n,
  target: 8000n * E18 / 30n,
  virtualAsset: 4000n * E18 / 30n,
  virtualToken: 10_285_714n * E18,
  feeBps: 100n,
  walletCap: 500n * E18 / 30n,
};

export function createMockBackend(opts: KitInitOptions): Backend {
  let token = toRaw(opts.mockBalances?.token ?? 100, TOKEN_DECIMALS);
  let usdg = toRaw(opts.mockBalances?.usdg ?? 25, USDG_DECIMALS);
  // The mock referee's coin ledger, as apps/rooms referee/coins.ts keeps it.
  const prelaunch = opts.mockMode === "prelaunch";
  let earned = opts.mockBalances?.earned ? toRaw(opts.mockBalances.earned, TOKEN_DECIMALS) : 0n;
  const issued = new Map<Hex, KitAttestation>();
  const purchases: Record<string, number> = {};
  const spends = new Map<string, { status: "committed" | "reserved" | "cancelled"; fromEarned: bigint; remainder: bigint; reason: string; amount: bigint }>();
  const coin = { ...coinFromSlug(opts.game), ...(opts.mockCoin ?? {}) };
  let session: string | null = opts.session ?? null;
  // The mock referee's profile store: one per page (a guest and its wallet share it once claimed).
  const profileStore = (opts.mockProfile?.store ?? []).map((i) => ({ ...i }));
  const profile: KitProfile = {
    ...emptyProfile(opts.game, "guest"),
    achievements: (opts.mockProfile?.achievements ?? []).map((id) => ({ id, at: 0, source: "sim" as const })),
    keepers: [...(opts.mockProfile?.keepers ?? [])],
  };
  const snapshotProfile = (): KitProfile => ({ ...profile, store: profileStore.map((i) => ({ ...i })), owned: [...profile.owned], meta: { ...profile.meta }, settings: { ...profile.settings } });
  const words = new Map<string, bigint>();
  const skus = (opts.store ?? []).map((s) => ({
    id: s.id,
    key: skuKey(s.id),
    kind: s.kind,
    duration: BigInt(s.duration ?? 0),
    priceUsdg: s.priceUsdg ? toRaw(s.priceUsdg, USDG_DECIMALS) : null,
    priceToken: s.priceToken ? toRaw(s.priceToken, TOKEN_DECIMALS) : null,
  }));
  let connected = false;
  // Mock "prelaunch" runs the bonding curve; "live" is graduated.
  const curve: CurvePool & { netBought: bigint } = { ...MOCK_CURVE, netBought: 0n };
  curve.sold = curveQuoteBuy(curve.reserve, { ...MOCK_CURVE, reserve: 0n }).tokensOut;
  const graduated = !prelaunch;
  let txCount = 0;
  let runs = 0;
  const hash = (): Hex => `0x${(++txCount).toString(16).padStart(64, "0")}`;
  const now = () => BigInt(Math.floor(Date.now() / 1000));

  function snapshot(account: Address | null): Snapshot {
    const mine = account !== null && connected;
    const list: KitSku[] = skus.map((s) => {
      const word = mine ? words.get(s.id) ?? 0n : 0n;
      const pass = s.kind === "pass";
      return {
        id: s.id,
        key: s.key,
        kind: s.kind,
        priceUsdg: s.priceUsdg,
        priceToken: s.priceToken,
        active: true,
        owned: pass ? (word > now() ? 1n : 0n) : word,
        expiresAt: pass && word > 0n ? Number(word) : null,
      };
    });
    return {
      token: {
        symbol: coin.symbol,
        decimals: TOKEN_DECIMALS,
        balance: mine ? token : 0n,
        priceUsd: graduated ? priceUsd(MOCK_POOLS, TOKEN_DECIMALS) : curvePriceUsd(curve, MOCK_POOLS.dollar),
        taxBps: MOCK_TAX_BPS,
        graduated,
        curve: graduated ? null : curveView({ ...curve, netBought: mine ? curve.netBought : 0n }, MOCK_POOLS.dollar),
      },
      usdg: mine ? usdg : 0n,
      skus: list,
      storeHalted: false,
      meta: null,
      pools: graduated ? MOCK_POOLS : null,
      dollar: MOCK_POOLS.dollar,
      graduated,
      curve: graduated ? null : { ...curve },
      // The mock has no approvals; allowances read as unlimited.
      allowances: { usdgToVault: 2n ** 255n, tokenToVault: 2n ** 255n, usdgToZap: 2n ** 255n, tokenToZap: 2n ** 255n },
    };
  }

  function debitToken(x: bigint): void {
    if (token < x) throw new KitError("INSUFFICIENT_BALANCE", "The mock wallet does not hold enough tokens.");
    token -= x;
  }
  function debitUsdg(x: bigint): void {
    if (usdg < x) throw new KitError("INSUFFICIENT_BALANCE", "The mock wallet does not hold enough dollars.");
    usdg -= x;
  }

  return {
    mode: "mock",
    async load(account) {
      return snapshot(account);
    },
    async connect() {
      connected = true;
      return MOCK_ACCOUNT;
    },
    disconnect() {
      connected = false;
    },
    onAccountsChanged() {
      // The mock wallet never switches accounts.
    },
    async buySku(_account, sku, inToken) {
      const s = skus.find((x) => x.id === sku.id);
      const price = inToken ? sku.priceToken : sku.priceUsdg;
      if (!s || price === null) throw new KitError("SKU_NOT_PRICED");
      if (inToken) debitToken(price);
      else debitUsdg(price);
      const word = words.get(s.id) ?? 0n;
      if (s.kind === "permanent") words.set(s.id, 1n);
      else if (s.kind === "consumable") words.set(s.id, word + 1n);
      else words.set(s.id, (word > now() ? word : now()) + s.duration);
      return [hash()];
    },
    async spend(_account, amount) {
      debitToken(amount);
      return [hash()];
    },
    async buyToken(_account, usdgIn, minTokenOut) {
      if (!graduated) {
        const q = quoteCurveBuy(usdgIn, MOCK_POOLS.dollar, curve);
        if (q.tokensOut < minTokenOut) throw new KitError("TX_REVERTED", "Slippage: the mock curve returned less than the minimum.");
        if (curve.netBought + q.net > curve.walletCap) throw new KitError("WALLET_CAP");
        debitUsdg(usdgIn);
        curve.reserve += q.net;
        curve.sold += q.tokensOut;
        curve.netBought += q.net;
        token += q.tokensOut;
        return [hash()];
      }
      const out = quoteBuy(usdgIn, MOCK_POOLS, BigInt(MOCK_TAX_BPS));
      if (out < minTokenOut) throw new KitError("TX_REVERTED", "Slippage: the mock pool returned less than the minimum.");
      debitUsdg(usdgIn);
      token += out;
      return [hash()];
    },
    async cashOut(_account, tokenIn, minUsdgOut) {
      if (!graduated) {
        const out = quoteCurveSell(tokenIn, MOCK_POOLS.dollar, curve);
        if (out < minUsdgOut) throw new KitError("TX_REVERTED", "Slippage: the mock curve returned less than the minimum.");
        debitToken(tokenIn);
        const assetOut = curveQuoteSell(tokenIn, curve);
        curve.reserve -= assetOut;
        curve.netBought = curve.netBought > assetOut ? curve.netBought - assetOut : 0n;
        curve.sold -= tokenIn;
        usdg += out;
        return [hash()];
      }
      const out = quoteMarketSell(tokenIn, MOCK_POOLS, BigInt(MOCK_TAX_BPS));
      if (out < minUsdgOut) throw new KitError("TX_REVERTED", "Slippage: the mock pool returned less than the minimum.");
      debitToken(tokenIn);
      usdg += out;
      return [hash()];
    },
    async report(account, _game, input) {
      // The mock referee grants one coin per unit, held (spendable now,
      // claimable later). The real referee decides from server state and
      // the vault enforces the daily caps (spec §8).
      const n = Math.max(1, Math.floor(input.n ?? 1));
      const amount = BigInt(n) * E18;
      void account;
      earned += amount;
      return { granted: amount, attestations: [] };
    },
    async collect() {
      return [...issued.values()];
    },
    async claim(_account, rewards) {
      if (rewards.length === 0) throw new KitError("NOTHING_TO_CLAIM");
      for (const r of rewards) {
        if (!issued.delete(r.attestation.nonce)) continue;
        token += r.amount;
      }
      return [hash()];
    },

    hasReferee: true,
    async coins(): Promise<KitCoinsState> {
      const claimable = [...issued.values()].reduce((n, a) => n + BigInt(a.amount), 0n);
      return { mode: prelaunch ? "prelaunch" : "live", earned, claimable, returning: 0n, reserved: [...spends.values()].filter((x) => x.status === "reserved").reduce((n, x) => n + x.fromEarned, 0n), purchases: { ...purchases } };
    },
    async spendCoins(_account, _game, req) {
      const prior = spends.get(req.key);
      if (prior) {
        if (prior.amount !== req.amount || prior.reason !== req.reason) throw new KitError("REFEREE_REJECTED", "This key was used for another spend.");
        return { status: prior.status, fromEarned: prior.fromEarned, remainder: prior.remainder, coins: null };
      }
      if (earned < req.amount && (prelaunch || !req.remainder)) throw new KitError("INSUFFICIENT_BALANCE", "Not enough coins.");
      const fromEarned = earned < req.amount ? earned : req.amount;
      earned -= fromEarned;
      const remainder = req.amount - fromEarned;
      const status = remainder > 0n ? "reserved" : "committed";
      spends.set(req.key, { status, fromEarned, remainder, reason: req.reason, amount: req.amount });
      if (status === "committed") purchases[req.reason] = (purchases[req.reason] ?? 0) + 1;
      return { status, fromEarned, remainder, coins: null };
    },
    async commitSpend(_account, _game, key) {
      const s = spends.get(key);
      if (!s || s.status === "cancelled") throw new KitError("REFEREE_REJECTED", "No such reservation.");
      if (s.status === "reserved") {
        s.status = "committed";
        purchases[s.reason] = (purchases[s.reason] ?? 0) + 1;
      }
    },
    async cancelSpend(_account, _game, key) {
      const s = spends.get(key);
      if (!s || s.status !== "reserved") return;
      s.status = "cancelled";
      earned += s.fromEarned;
    },
    async release(account) {
      if (prelaunch) throw new KitError("PRELAUNCH");
      if (earned > 0n) {
        runs++;
        const id: Hex = `0x${runs.toString(16).padStart(64, "0")}`;
        issued.set(id, {
          vault: MOCK_VAULT,
          rule: "earned",
          runId: id,
          player: account,
          ruleId: 1,
          amount: earned.toString(),
          nonce: id,
          paidEntry: false,
          expiry: String(Math.floor(Date.now() / 1000) + 900),
          verified: true,
          signature: "0x",
        });
        earned = 0n;
      }
      return [...issued.values()];
    },
    async returnClaims(_account, _game, nonces) {
      // The mock has no chain to prove a signature dead: returns are immediate.
      for (const n of nonces) {
        const a = issued.get(n);
        if (!a) continue;
        issued.delete(n);
        earned += BigInt(a.amount);
      }
    },
    async coinMetadata() {
      return { name: coin.name, logo: coin.logo ?? null };
    },
    async profile() {
      return snapshotProfile();
    },
    async profileWrite(path, _guest, body) {
      if (path === "/profile/name") profile.displayName = typeof body.displayName === "string" ? body.displayName.slice(0, 24) : profile.displayName;
      else profile.settings = { ...(typeof body.settings === "object" && body.settings !== null ? (body.settings as Record<string, unknown>) : {}) };
      return snapshotProfile();
    },
    async profileClaim() {
      profile.kind = "wallet";
      return snapshotProfile();
    },
    async profileRedeem(_account, _game, item, key) {
      // As the referee: play money buys only in-run items; looks, unlocks and upgrades open at launch.
      if (prelaunch) throw new KitError("PRELAUNCH", "Looks, unlocks and upgrades open at launch; before it, play money buys only in-run items.");
      const s = key ? spends.get(key) : undefined;
      const it = profileStore.find((i) => i.id === item);
      if (!it || it.coins === null) throw new KitError("UNKNOWN_SKU", `"${item}" is not in this game's permanent store.`);
      if (!s || s.status !== "committed" || s.reason !== item || s.amount < toRaw(it.coins, TOKEN_DECIMALS)) throw new KitError("INSUFFICIENT_BALANCE", "No committed spend at this item's price.");
      if (key) spends.delete(key);
      if (it.kind === "meta") {
        const level = (profile.meta[item] ?? 0) + 1;
        profile.meta[item] = level;
        it.level = level;
        it.owned = true;
        if (level >= (it.levels ?? level)) it.coins = null;
      } else {
        profile.owned.push(item);
        it.owned = true;
        it.coins = null;
        if (it.keeper) profile.keepers.push(it.keeper);
        if (it.cosmetic !== undefined) profile.cosmetics.push(it.cosmetic);
      }
      return snapshotProfile();
    },
    async signIn() {
      session = "mock-session";
      return session;
    },
    session: () => session,
    setSession(t) {
      session = t;
    },
  };
}
