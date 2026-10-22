// Live backend: Robinhood Chain through viem.
//
// RPC BUDGET (CLAUDE.md "RPC calls are the scarcest resource", spec §10):
//   - Finding the game costs nothing: its five addresses are CREATE3
//     addresses derived locally from the factory and the slug (derive.ts).
//   - load() is ONE eth_call: every read the game shows, plus the factory's
//     record that proves the derived addresses are this game's, goes through
//     one Multicall3 aggregate3 (batchSize 0, so viem never splits it).
//   - The two pool addresses (the token's v2 pair and the dollar pool) are
//     immutables. The first open in a browser learns them in that call and
//     reads their reserves in a second one; they are cached for good, so
//     every later open is one call.
//   - The curve's immutables (target, virtual reserves, fee, wallet cap)
//     ride in the first snapshot only and are cached for the session; its
//     moving numbers (reserve, sold, the wallet's net buys) and the token's
//     `graduated` flag are three more reads inside the same one call.
//   - Nothing here polls. The Kit core calls load() on init, after each of
//     the wallet's own transactions, and on an account switch. That is all.
//   - The configured RPC is wrapped in fallback([configured, public]).
//   - Coins: the referee's ledger is HTTP, never RPC. One GET on open (with
//     the snapshot, in parallel), the token metadata JSON once per session
//     (cached by its hash), and a POST only for the player's own action.
//
// CHAIN LAYER: every contract this file touches is behind the Backend
// interface (load, buySku, spend, buyToken, cashOut, claim). The launch
// model: a bonding curve until
// graduation (buys and sells through GameZap.buyOnCurve / sellOnCurve),
// then the game's v2 pool (GameZap.buyToken / sellToken). There is no
// floor and no redemption route.

import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  fallback,
  http,
  type Chain,
  type ContractFunctionParameters,
  type PublicClient,
  type TransactionReceipt,
  type Transport,
} from "viem";
import { createSiweMessage } from "viem/siwe";
import { erc20Abi, gameCurveAbi, gameFactoryAbi, gameTokenAbi, gameVaultAbi, gameZapAbi, rewardVaultAbi } from "./abi.js";
import { uniswapV2PairAbi } from "./abi-external.js";
import type { Backend, CoinSpend, Snapshot } from "./backend.js";
import { decodeDataJson, parseCoins, parseMetadata } from "./coins.js";
import { parseProfile } from "./profile.js";
import { deriveGame, type GameAddresses } from "./derive.js";
import { KitError, toKitError } from "./errors.js";
import { kitAddresses, kitChainConfig, ROBINHOOD_CHAIN_ID } from "./registry.generated.js";
import { RPC_HTTP_OPTIONS, retryTransientRead } from "./rpc-retry.js";
import type { Address, EarnReport, Eip1193Provider, Hex, KitAttestation, KitGameMeta, KitInitOptions, KitPendingReward, KitSku, SkuKind } from "./types.js";
import { curvePriceUsd, curveView } from "./curve.js";
import { priceUsd, skuKey, type CurvePool, type Pools } from "./units.js";
import { discoverWallets, ensureChain, requestAccount } from "./wallet.js";
import { isAttestation } from "./attestation.js";

type KitAddressName = keyof typeof kitAddresses;
const ZERO = "0x0000000000000000000000000000000000000000";
const DEADLINE_SECONDS = 20 * 60;
const KINDS: Record<number, SkuKind | undefined> = { 1: "permanent", 2: "consumable", 3: "pass" };

interface Step {
  label: string;
  to: Address;
  data: Hex;
}

/** Why a token payment waits (GameVault refuses it before graduation). */
const PRELAUNCH_TOKEN_PAYMENT = "Coins are play money until the game launches; wallet coins can be spent in the store from launch.";

/** Registry lookup with init-time overrides. Placeholders throw. */

export function resolveAddress(name: KitAddressName, overrides: KitInitOptions["addresses"]): Address {
  const o = overrides?.[name];
  if (o) return o;
  const e = kitAddresses[name];
  if (e.status !== "HUMAN-VERIFIED" || (e.address as string) === ZERO) throw new KitError("PLACEHOLDER_ADDRESS", `"${name}" is a PLACEHOLDER in the NetNet registry.`);
  return e.address;
}

function tryResolve(name: KitAddressName, overrides: KitInitOptions["addresses"]): Address | null {
  try {
    return resolveAddress(name, overrides);
  } catch {
    return null;
  }
}

export function buildTransport(opts: Pick<KitInitOptions, "rpcUrl" | "transport">): Transport {
  if (opts.transport) return opts.transport as Transport;
  const pub = kitChainConfig.rpcUrl;
  if (!opts.rpcUrl || opts.rpcUrl === pub) return http(pub, RPC_HTTP_OPTIONS);
  // A 403/429 on the configured leg moves to the public leg at once.
  return fallback([http(opts.rpcUrl, { ...RPC_HTTP_OPTIONS, retryCount: 0 }), http(pub, { ...RPC_HTTP_OPTIONS, retryCount: 1 })], { rank: false, retryCount: 0 });
}

export function buildChain(overrides: KitInitOptions["addresses"]): Chain {
  return {
    id: ROBINHOOD_CHAIN_ID,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [kitChainConfig.rpcUrl] } },
    blockExplorers: { default: { name: "Blockscout", url: kitChainConfig.blockExplorerUrl } },
    contracts: { multicall3: { address: resolveAddress("multicall3", overrides) } },
  };
}

/** Pool addresses are immutables; cached per token for good. */
interface PoolAddresses {
  gamePair: Address;
  dollarPair: Address;
  /** True when USDG is token0 of the dollar pool. */
  usdgIs0: boolean;
}

const CACHE_PREFIX = "netnet-kit:pools:v2:";
const memoryCache = new Map<string, PoolAddresses>();
const isAddr = (x: unknown): x is Address => typeof x === "string" && /^0x[0-9a-fA-F]{40}$/.test(x);

function readCache(key: string): PoolAddresses | null {
  const m = memoryCache.get(key);
  if (m) return m;
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PoolAddresses>;
    return isAddr(v.gamePair) && isAddr(v.dollarPair) && typeof v.usdgIs0 === "boolean" ? (v as PoolAddresses) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, v: PoolAddresses): void {
  memoryCache.set(key, v);
  try {
    globalThis.localStorage?.setItem(CACHE_PREFIX + key, JSON.stringify(v));
  } catch {
    // Private mode or blocked storage: the in-memory cache still holds it.
  }
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** A curve's immutables: read once per session per curve, never again. */
type CurveConstants = Pick<CurvePool, "target" | "virtualAsset" | "virtualToken" | "feeBps" | "walletCap">;
const curveConstants = new Map<string, CurveConstants>();

type Result = { status: "success" | "failure"; result?: unknown };

export function createLiveBackend(game: string, opts: KitInitOptions): Backend {
  const overrides = opts.addresses;
  const chain = buildChain(overrides);
  const client: PublicClient = createPublicClient({
    chain,
    transport: buildTransport(opts),
    batch: { multicall: { wait: 16, batchSize: 0 } },
  });
  const usdg = resolveAddress("USDG", overrides);
  const factory = resolveAddress("gameFactory", overrides);
  const g: GameAddresses = deriveGame(factory, game);
  const poolKey = `${ROBINHOOD_CHAIN_ID}:${g.token.toLowerCase()}`;
  const items = (opts.store ?? []).map((s) => ({ id: s.id, key: skuKey(s.id) }));
  let provider: Eip1193Provider | null = opts.provider ?? null;
  let accountListener: ((account: Address | null) => void) | null = null;
  const watched = new WeakSet<Eip1193Provider>();

  async function multicall(calls: readonly ContractFunctionParameters[]): Promise<readonly Result[]> {
    try {
      return await retryTransientRead(() => client.multicall({ contracts: calls, allowFailure: true, batchSize: 0 }));
    } catch (err) {
      throw new KitError("RPC_ERROR", "The snapshot read failed.", err);
    }
  }

  async function load(account: Address | null): Promise<Snapshot> {
    const zap = tryResolve("gameZap", overrides);
    const cached = readCache(poolKey);
    const consts = curveConstants.get(g.curve.toLowerCase()) ?? null;

    // Every read in ONE aggregate3. Results are read back by index, in order.
    const calls: ContractFunctionParameters[] = [
      { address: factory, abi: gameFactoryAbi, functionName: "gameOfToken", args: [g.token] },
      { address: g.token, abi: gameTokenAbi, functionName: "name" },
      { address: g.token, abi: gameTokenAbi, functionName: "symbol" },
      { address: g.token, abi: gameTokenAbi, functionName: "decimals" },
      { address: g.token, abi: gameTokenAbi, functionName: "taxBps" },
      { address: g.token, abi: gameTokenAbi, functionName: "tokenIsToken0" },
      { address: g.token, abi: gameTokenAbi, functionName: "contractURI" },
      { address: g.token, abi: gameTokenAbi, functionName: "metadataHash" },
      { address: g.token, abi: gameTokenAbi, functionName: "graduated" },
      { address: g.curve, abi: gameCurveAbi, functionName: "reserve" },
      { address: g.curve, abi: gameCurveAbi, functionName: "sold" },
      { address: g.store, abi: gameVaultAbi, functionName: "halted" },
      ...items.map((it) => ({ address: g.store, abi: gameVaultAbi, functionName: "sku", args: [it.key] }) as const),
    ];
    if (!consts) {
      for (const fn of ["TARGET", "VIRTUAL_ASSET", "VIRTUAL_TOKEN", "FEE_BPS", "WALLET_CAP"] as const) calls.push({ address: g.curve, abi: gameCurveAbi, functionName: fn });
    }
    if (cached) {
      calls.push({ address: cached.gamePair, abi: uniswapV2PairAbi, functionName: "getReserves" });
      calls.push({ address: cached.dollarPair, abi: uniswapV2PairAbi, functionName: "getReserves" });
    } else {
      calls.push({ address: g.token, abi: gameTokenAbi, functionName: "pair" });
      if (zap) calls.push({ address: zap, abi: gameZapAbi, functionName: "usdgWsnetPair" });
    }
    if (account) {
      calls.push(
        { address: g.token, abi: erc20Abi, functionName: "balanceOf", args: [account] },
        { address: usdg, abi: erc20Abi, functionName: "balanceOf", args: [account] },
        { address: g.store, abi: gameVaultAbi, functionName: "entitlementsOf", args: [account, items.map((it) => it.key)] },
        { address: usdg, abi: erc20Abi, functionName: "allowance", args: [account, g.store] },
        { address: g.token, abi: erc20Abi, functionName: "allowance", args: [account, g.store] },
      );
      if (zap) {
        calls.push(
          { address: usdg, abi: erc20Abi, functionName: "allowance", args: [account, zap] },
          { address: g.token, abi: erc20Abi, functionName: "allowance", args: [account, zap] },
        );
      }
      calls.push({ address: g.curve, abi: gameCurveAbi, functionName: "netBought", args: [account] });
    }

    const results = await multicall(calls);
    let i = 0;
    const next = <T>(fallbackValue: T): T => {
      const r = results[i++];
      return r && r.status === "success" ? (r.result as T) : fallbackValue;
    };

    // Trust nothing until the factory's own record names this token.
    const rec = next<{ token: Address; curve: Address; buybackVault: Address; rewardVault: Address; store: Address } | null>(null);
    if (!rec || !same(rec.token, g.token) || !same(rec.curve, g.curve) || !same(rec.buybackVault, g.buybackVault) || !same(rec.store, g.store) || !same(rec.rewardVault, g.rewardVault)) {
      throw new KitError("GAME_NOT_FOUND", `No launched game "${game}" on GameFactory.`);
    }
    const name = next<string>("");
    const symbol = next<string>("");
    const decimals = Number(next<number>(18));
    const taxBps = Number(next<bigint>(0n));
    const tokenIs0 = next<boolean>(true);
    const contractURI = next<string>("");
    const metadataHash = next<Hex>(`0x${"0".repeat(64)}`);
    const graduated = next<boolean>(false);
    const curveReserve = next<bigint | null>(null);
    const curveSold = next<bigint | null>(null);
    const halted = next<boolean>(false);
    const rawSkus = items.map(() => next<{ priceUsdg: bigint; priceToken: bigint; duration: number; kind: number } | null>(null));
    let constants = consts;
    if (!constants) {
      const target = next<bigint | null>(null), virtualAsset = next<bigint | null>(null), virtualToken = next<bigint | null>(null);
      const feeBps = next<bigint | null>(null), walletCap = next<bigint | null>(null);
      if (target && virtualAsset && virtualToken && feeBps !== null && walletCap) {
        constants = { target, virtualAsset, virtualToken, feeBps, walletCap };
        curveConstants.set(g.curve.toLowerCase(), constants);
      }
    }

    let reserves: { game: readonly [bigint, bigint, number] | null; dollar: readonly [bigint, bigint, number] | null } = { game: null, dollar: null };
    let pools: PoolAddresses | null = cached;
    if (cached) {
      reserves = { game: next(null), dollar: next(null) };
    } else {
      const gamePair = next<Address | null>(null);
      const dollarPair = zap ? next<Address | null>(null) : null;
      if (gamePair && dollarPair && gamePair !== ZERO && dollarPair !== ZERO) {
        // First open in this browser: learn the reserves (and the dollar
        // pool's orientation) in one more call, then never again.
        const extra = await multicall([
          { address: gamePair, abi: uniswapV2PairAbi, functionName: "getReserves" },
          { address: dollarPair, abi: uniswapV2PairAbi, functionName: "getReserves" },
          { address: dollarPair, abi: uniswapV2PairAbi, functionName: "token0" },
        ]);
        const d0 = extra[2]?.status === "success" ? (extra[2].result as Address) : null;
        if (d0) {
          pools = { gamePair, dollarPair, usdgIs0: same(d0, usdg) };
          writeCache(poolKey, pools);
        }
        reserves = {
          game: extra[0]?.status === "success" ? (extra[0].result as readonly [bigint, bigint, number]) : null,
          dollar: extra[1]?.status === "success" ? (extra[1].result as readonly [bigint, bigint, number]) : null,
        };
      }
    }

    let dollar: Pools["dollar"] | null = null;
    if (pools && reserves.dollar && reserves.dollar[0] > 0n && reserves.dollar[1] > 0n) {
      const dr = reserves.dollar;
      dollar = { usdg: pools.usdgIs0 ? dr[0] : dr[1], pairAsset: pools.usdgIs0 ? dr[1] : dr[0] };
    }
    let poolState: Pools | null = null;
    if (graduated && dollar && reserves.game && reserves.game[0] > 0n && reserves.game[1] > 0n) {
      const gr = reserves.game;
      poolState = { game: { token: tokenIs0 ? gr[0] : gr[1], pairAsset: tokenIs0 ? gr[1] : gr[0] }, dollar };
    }

    let tokenBal = 0n, usdgBal = 0n, usdgToVault = 0n, tokenToVault = 0n, usdgToZap = 0n, tokenToZap = 0n, netBought = 0n;
    let words: readonly bigint[] = [];
    if (account) {
      tokenBal = next<bigint>(0n);
      usdgBal = next<bigint>(0n);
      words = next<readonly bigint[]>([]);
      usdgToVault = next<bigint>(0n);
      tokenToVault = next<bigint>(0n);
      if (zap) {
        usdgToZap = next<bigint>(0n);
        tokenToZap = next<bigint>(0n);
      }
      netBought = next<bigint>(0n);
    }
    const curve = !graduated && constants && curveReserve !== null && curveSold !== null ? { ...constants, reserve: curveReserve, sold: curveSold, netBought } : null;

    const nowS = BigInt(Math.floor(Date.now() / 1000));
    const skus: KitSku[] = items.map((it, j) => {
      const s = rawSkus[j];
      const kind = KINDS[s?.kind ?? 0] ?? opts.store?.[j]?.kind ?? "consumable";
      const word = words[j] ?? 0n;
      const pass = kind === "pass";
      return {
        id: it.id,
        key: it.key,
        kind,
        priceUsdg: s && s.priceUsdg > 0n ? s.priceUsdg : null,
        priceToken: s && s.priceToken > 0n ? s.priceToken : null,
        active: !!s && s.kind !== 0 && (s.priceUsdg > 0n || s.priceToken > 0n),
        owned: pass ? (word > nowS ? 1n : 0n) : word,
        expiresAt: pass && word > 0n ? Number(word) : null,
      };
    });

    const meta: KitGameMeta | null = contractURI ? { name, contractURI, metadataHash } : null;
    return {
      token: {
        symbol,
        decimals,
        balance: tokenBal,
        priceUsd: poolState ? priceUsd(poolState, decimals) : curve && dollar ? curvePriceUsd(curve, dollar) : null,
        taxBps,
        graduated,
        curve: curve ? curveView(curve, dollar) : null,
      },
      usdg: usdgBal,
      skus,
      storeHalted: halted,
      meta,
      pools: poolState,
      dollar,
      graduated,
      curve,
      allowances: { usdgToVault, tokenToVault, usdgToZap, tokenToZap },
    };
  }

  async function signer(account: Address) {
    if (!provider) throw new KitError("NO_WALLET");
    await ensureChain(provider, ROBINHOOD_CHAIN_ID, kitChainConfig.rpcUrl, kitChainConfig.blockExplorerUrl);
    return createWalletClient({ account, chain, transport: custom(provider) });
  }

  /** Run a plan: estimate (which simulates) each step, prompt, wait for each receipt.
   *  Receipt waiting is the only repeated read, and it only runs for the
   *  wallet's own transaction. */
  async function run(account: Address, steps: Step[]): Promise<TransactionReceipt[]> {
    const wallet = await signer(account);
    const receipts: TransactionReceipt[] = [];
    for (const step of steps) {
      // The estimate is the simulation: a revert shows before the wallet
      // prompts. A step behind an approval is estimated once the approval
      // has landed (the loop waits for each receipt). The game contracts run
      // try/catch hooks (swap-back, buyback poke), so at exactly the
      // estimate the 63/64 rule can starve the inner call and revert: the
      // gas carries 50% + 200k on top (seen on the fork e2e).
      let gas: bigint;
      try {
        gas = await retryTransientRead(() => client.estimateGas({ account, to: step.to, data: step.data }));
      } catch (err) {
        throw toKitError(err);
      }
      gas = (gas * 3n) / 2n + 200_000n;
      let hash: Hex;
      try {
        hash = await wallet.sendTransaction({ account, chain, to: step.to, data: step.data, gas });
      } catch (err) {
        throw toKitError(err);
      }
      const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 1_000, timeout: 120_000 });
      if (receipt.status !== "success") throw new KitError("TX_REVERTED", `${step.label} reverted (${hash}).`);
      receipts.push(receipt);
    }
    return receipts;
  }
  const hashes = (rs: TransactionReceipt[]) => rs.map((r) => r.transactionHash);

  function approveStep(token: Address, spender: Address, amount: bigint, label = "Approve"): Step {
    return { label, to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }) };
  }
  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

  /** An attestation is only ever sent to this game's RewardVault, for this wallet, before it expires, and only when it is verified (the vault reverts NotVerified otherwise, and one such item sinks a whole claimBatch). */
  function usable(att: KitAttestation, account: Address): boolean {
    return att.verified === true && same(att.vault, g.rewardVault) && same(att.player, account) && BigInt(att.expiry) > BigInt(Math.floor(Date.now() / 1000));
  }

  function refereeUrl(path: string): string {
    if (!opts.referee) throw new KitError("NO_REFEREE");
    return `${opts.referee.replace(/\/+$/, "")}${path}`;
  }

  async function fetchAttestations(url: string, init?: RequestInit): Promise<KitAttestation[]> {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      throw new KitError("REFEREE_REJECTED", "The referee could not be reached.", err);
    }
    if (!res.ok) throw new KitError("REFEREE_REJECTED", `The referee answered ${res.status}.`);
    const body: unknown = await res.json();
    const list = Array.isArray(body) ? body : Array.isArray((body as { attestations?: unknown }).attestations) ? (body as { attestations: unknown[] }).attestations : [];
    return list.filter(isAttestation);
  }

  let session: string | null = opts.session ?? null;
  const metaCache = new Map<string, Promise<{ name: string | null; logo: string | null }>>();

  /** SIWE against the referee: its nonce, a message for its domain, one personal_sign, a session token. */
  async function signIn(account: Address): Promise<string> {
    if (!provider) throw new KitError("NO_WALLET");
    let n: { nonce?: unknown; domain?: unknown; uri?: unknown };
    try {
      const res = await fetch(refereeUrl("/auth/nonce"));
      if (!res.ok) throw new Error(`nonce ${res.status}`);
      n = (await res.json()) as typeof n;
    } catch (err) {
      throw new KitError("REFEREE_REJECTED", "The referee could not start a sign-in.", err);
    }
    if (typeof n.nonce !== "string") throw new KitError("REFEREE_REJECTED", "The referee sent no sign-in nonce.");
    const loc = (globalThis as { location?: { host?: string; origin?: string } }).location;
    const message = createSiweMessage({
      domain: typeof n.domain === "string" ? n.domain : loc?.host ?? "localhost",
      address: account,
      uri: typeof n.uri === "string" ? n.uri : loc?.origin ?? "http://localhost",
      version: "1",
      chainId: ROBINHOOD_CHAIN_ID,
      nonce: n.nonce,
      issuedAt: new Date(),
      statement: "Sign in to play and earn.",
    });
    let signature: unknown;
    try {
      signature = await provider.request({ method: "personal_sign", params: [message, account] });
    } catch (err) {
      throw toKitError(err);
    }
    const res = await fetch(refereeUrl("/auth/sign-in"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) }).catch((err: unknown) => {
      throw new KitError("REFEREE_REJECTED", "The referee could not be reached.", err);
    });
    const body = (await res.json().catch(() => ({}))) as { token?: unknown };
    if (!res.ok || typeof body.token !== "string") throw new KitError("REFEREE_REJECTED", `Sign-in failed (${res.status}).`);
    session = body.token;
    return body.token;
  }

  /** POST to the referee with the player's session; signs in once when there is none or it lapsed. */
  async function refereeJson(account: Address, path: string, body: unknown): Promise<unknown> {
    const url = refereeUrl(path);
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = session ?? (await signIn(account));
      let res: Response;
      try {
        res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      } catch (err) {
        throw new KitError("REFEREE_REJECTED", "The referee could not be reached.", err);
      }
      // 401: the session lapsed. 403: it is for another account (the wallet switched). Sign in again, once.
      if ((res.status === 401 || res.status === 403) && attempt === 0) {
        session = null;
        continue;
      }
      const out: unknown = await res.json().catch(() => null);
      if (res.status === 402) throw new KitError("INSUFFICIENT_BALANCE", typeof (out as { error?: unknown } | null)?.error === "string" ? `Not enough coins: ${(out as { error: string }).error}.` : "Not enough coins.");
      if (res.status === 409 && /play money/.test(String((out as { error?: unknown } | null)?.error))) throw new KitError("PRELAUNCH");
      if (!res.ok) throw new KitError("REFEREE_REJECTED", `The referee answered ${res.status}${typeof (out as { error?: unknown } | null)?.error === "string" ? `: ${(out as { error: string }).error}` : ""}.`);
      return out;
    }
    throw new KitError("REFEREE_REJECTED", "The referee refused the session.");
  }

  /** A profile call as the session (when there is one) or the guest; never prompts the wallet. */
  async function profileFetch(path: string, guest: string, body?: Record<string, unknown>): Promise<unknown> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (session) headers.authorization = `Bearer ${session}`;
    else headers["x-guest-id"] = guest;
    let res: Response;
    try {
      res = await fetch(refereeUrl(path), { method: body ? "POST" : "GET", headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch (err) {
      throw new KitError("REFEREE_REJECTED", "The referee could not be reached.", err);
    }
    const out: unknown = await res.json().catch(() => null);
    if (!res.ok) throw new KitError("REFEREE_REJECTED", `The referee answered ${res.status}${typeof (out as { error?: unknown } | null)?.error === "string" ? `: ${(out as { error: string }).error}` : ""}.`);
    return out;
  }

  const coinsOf = (b: unknown) => parseCoins((b as { balance?: unknown } | null)?.balance ?? b);
  const wei = (v: unknown): bigint => (typeof v === "string" && /^\d{1,78}$/.test(v) ? BigInt(v) : 0n);

  return {
    mode: "live",
    load,

    async connect(p?: Eip1193Provider): Promise<Address> {
      if (p) provider = p;
      if (!provider) {
        const found = await discoverWallets();
        const first = found[0];
        if (!first) throw new KitError("NO_WALLET", "No wallet found in this browser.");
        provider = first.provider;
      }
      const account = await requestAccount(provider);
      if (!watched.has(provider)) {
        watched.add(provider);
        provider.on?.("accountsChanged", (...args: unknown[]) => {
          const list = args[0];
          const nextAccount = Array.isArray(list) && typeof list[0] === "string" ? (list[0] as Address) : null;
          session = null; // a session belongs to one wallet
          accountListener?.(nextAccount);
        });
      }
      return account;
    },

    disconnect(): void {
      provider = opts.provider ?? null;
      session = opts.session ?? null;
    },

    onAccountsChanged(cb) {
      accountListener = cb;
    },

    async buySku(account, sku, inToken, snap) {
      const price = inToken ? sku.priceToken : sku.priceUsdg;
      if (price === null) throw new KitError("SKU_NOT_PRICED");
      // The store takes token payments only after graduation;
      // say so before the wallet prompts, never as a raw NotGraduated revert.
      if (inToken && !snap.graduated) throw new KitError("PRELAUNCH", PRELAUNCH_TOKEN_PAYMENT);
      const steps: Step[] = [];
      const allowance = inToken ? snap.allowances.tokenToVault : snap.allowances.usdgToVault;
      if (allowance < price) steps.push(approveStep(inToken ? g.token : usdg, g.store, price));
      steps.push({
        label: "Buy",
        to: g.store,
        data: encodeFunctionData({ abi: gameVaultAbi, functionName: "buy", args: [sku.key, 1n, inToken, price, account] }),
      });
      return hashes(await run(account, steps));
    },

    async spend(account, amount, memo, snap) {
      // A spend is a token tip: the tokens go to the vault's tokenSink (the
      // game's RewardVault). A transfer into the RewardVault is untaxed, so
      // the pool receives the whole amount. The store takes token tips only
      // after graduation.
      if (!snap.graduated) throw new KitError("PRELAUNCH", PRELAUNCH_TOKEN_PAYMENT);
      const steps: Step[] = [];
      // Approve up to what the wallet holds, so the next spend is one confirmation.
      if (snap.allowances.tokenToVault < amount) steps.push(approveStep(g.token, g.store, snap.token.balance > amount ? snap.token.balance : amount));
      steps.push({ label: "Spend", to: g.store, data: encodeFunctionData({ abi: gameVaultAbi, functionName: "tip", args: [amount, true, memo] }) });
      return hashes(await run(account, steps));
    },

    async buyToken(account, usdgIn, minTokenOut, snap, minMid) {
      // Graduated: the game's pool. Before: the bonding curve (any pair
      // asset the graduating buy does not use is refunded to the wallet).
      const zap = resolveAddress("gameZap", overrides);
      const steps: Step[] = [];
      if (snap.allowances.usdgToZap < usdgIn) steps.push(approveStep(usdg, zap, usdgIn));
      const data = snap.graduated
        ? encodeFunctionData({ abi: gameZapAbi, functionName: "buyToken", args: [g.token, usdgIn, minTokenOut, account, deadline()] })
        : encodeFunctionData({ abi: gameZapAbi, functionName: "buyOnCurve", args: [g.curve, usdgIn, minMid, minTokenOut, account, deadline()] });
      steps.push({ label: "Buy", to: zap, data });
      return hashes(await run(account, steps));
    },

    async cashOut(account, tokenIn, minUsdgOut, snap) {
      // Graduated: sell into the game's pool. Before: sell back to the
      // curve. There is no redemption route (no floor).
      const zap = resolveAddress("gameZap", overrides);
      const steps: Step[] = [];
      if (snap.allowances.tokenToZap < tokenIn) steps.push(approveStep(g.token, zap, tokenIn));
      const data = snap.graduated
        ? encodeFunctionData({ abi: gameZapAbi, functionName: "sellToken", args: [g.token, tokenIn, minUsdgOut, account, deadline()] })
        : encodeFunctionData({ abi: gameZapAbi, functionName: "sellOnCurve", args: [g.curve, tokenIn, minUsdgOut, account, deadline()] });
      steps.push({ label: snap.graduated ? "Cash out" : "Sell", to: zap, data });
      return hashes(await run(account, steps));
    },

    async report(account, gameSlug, input: EarnReport) {
      // The referee needs the player's own session (BYO reports without one were 401s).
      const body = await refereeJson(account, "/referee/report", { game: gameSlug, wallet: account, rule: input.event, units: input.n ?? 1, runId: input.runId ?? null, data: input.data ?? null });
      const b = (body ?? {}) as { granted?: unknown; attestations?: unknown; rewards?: unknown; notice?: unknown };
      const atts = Array.isArray(b.attestations) ? b.attestations.filter(isAttestation).filter((a) => usable(a, account)) : [];
      const granted = typeof b.granted === "string" && /^\d{1,78}$/.test(b.granted) ? BigInt(b.granted) : atts.reduce((n, a) => n + BigInt(a.amount), 0n);
      // The class is the referee's word; the Kit only passes it on (it never decides a payout).
      const rewards = b.rewards === "verified" || b.rewards === "unverified" ? b.rewards : undefined;
      const notice = typeof b.notice === "string" && b.notice.length > 0 && b.notice.length <= 200 ? b.notice : undefined;
      return { granted, attestations: atts, ...(rewards ? { rewards } : {}), ...(notice ? { notice } : {}) };
    },

    async collect(account) {
      const atts = await fetchAttestations(refereeUrl(`/referee/claims/${account}`));
      return atts.filter((a) => usable(a, account));
    },

    hasReferee: !!opts.referee,
    async profile(game, guest) {
      return parseProfile(await profileFetch(`/profile/game/${encodeURIComponent(game)}`, guest));
    },
    async profileWrite(path, guest, body) {
      const out = await profileFetch(path, guest, body);
      return typeof (out as { game?: unknown } | null)?.game === "string" ? parseProfile(out) : null;
    },
    async profileClaim(account, game, guest) {
      return parseProfile(await refereeJson(account, "/profile/claim", { guest, game }));
    },
    async profileRedeem(account, game, item, key, level) {
      return parseProfile(await refereeJson(account, "/profile/redeem", { game, item, ...(key ? { key } : {}), ...(level !== undefined ? { level } : {}) }));
    },

    async coins(account, gameSlug) {
      const url = refereeUrl(`/referee/coins/${encodeURIComponent(gameSlug)}/${account}`);
      let res: Response;
      try {
        res = await fetch(url);
      } catch (err) {
        throw new KitError("REFEREE_REJECTED", "The referee could not be reached.", err);
      }
      if (!res.ok) throw new KitError("REFEREE_REJECTED", `The referee answered ${res.status}.`);
      return parseCoins(await res.json());
    },

    async spendCoins(account, gameSlug, req): Promise<CoinSpend> {
      const b = (await refereeJson(account, "/referee/spend", { game: gameSlug, wallet: account, amount: req.amount.toString(), reason: req.reason, key: req.key, remainder: req.remainder })) as Record<string, unknown> | null;
      const status = b?.["status"] === "reserved" ? "reserved" : b?.["status"] === "cancelled" ? "cancelled" : "committed";
      return { status, fromEarned: wei(b?.["fromEarned"]), remainder: wei(b?.["remainder"]), coins: b?.["balance"] ? coinsOf(b) : null };
    },

    async commitSpend(account, game, key, txHash) {
      // The referee reads the payment's receipt once and wants it one block deep: a fresh one is a 409 to retry shortly.
      for (let attempt = 0; ; attempt++) {
        try {
          await refereeJson(account, "/referee/spend/commit", { game, wallet: account, key, txHash });
          return;
        } catch (err) {
          if (attempt >= 8 || !(err instanceof KitError) || !/not confirmed yet|could not be read/.test(err.message)) throw err;
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    },

    async cancelSpend(account, gameSlug, key) {
      await refereeJson(account, "/referee/spend/cancel", { game: gameSlug, wallet: account, key });
    },

    async release(account, gameSlug) {
      const b = (await refereeJson(account, "/referee/claims/release", { game: gameSlug, wallet: account })) as { attestations?: unknown } | null;
      return (Array.isArray(b?.attestations) ? b.attestations : []).filter(isAttestation).filter((a) => usable(a, account));
    },

    async returnClaims(account, gameSlug, nonces) {
      if (nonces.length === 0) return;
      await refereeJson(account, "/referee/claims/return", { game: gameSlug, wallet: account, nonces });
    },

    coinMetadata(meta) {
      const key = `${meta.metadataHash}|${meta.contractURI}`;
      let p = metaCache.get(key);
      if (!p) {
        p = (async () => {
          const inline = decodeDataJson(meta.contractURI);
          if (inline !== null) return parseMetadata(inline);
          const url = meta.contractURI.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${meta.contractURI.slice(7)}` : meta.contractURI;
          if (!/^https:\/\//i.test(url)) return { name: null, logo: null };
          try {
            const res = await fetch(url);
            return res.ok ? parseMetadata(await res.json()) : { name: null, logo: null };
          } catch {
            return { name: null, logo: null };
          }
        })();
        metaCache.set(key, p);
      }
      return p;
    },

    signIn,
    session: () => session,
    setSession(token) {
      session = token;
    },

    async claim(account, rewards) {
      const ok = rewards.filter((r) => usable(r.attestation, account));
      if (ok.length === 0) throw new KitError("NOTHING_TO_CLAIM", "No pending reward is for this wallet, this game and still before its expiry.");
      const reward = (a: KitAttestation) => ({ player: a.player, ruleId: a.ruleId, amount: BigInt(a.amount), nonce: a.nonce, paidEntry: a.paidEntry, expiry: BigInt(a.expiry), verified: a.verified });
      const data = ok.length === 1
        ? encodeFunctionData({ abi: rewardVaultAbi, functionName: "claim", args: [reward(ok[0]!.attestation), ok[0]!.attestation.signature] })
        : encodeFunctionData({ abi: rewardVaultAbi, functionName: "claimBatch", args: [ok.map((r) => reward(r.attestation)), ok.map((r) => r.attestation.signature)] });
      return hashes(await run(account, [{ label: "Claim", to: g.rewardVault, data }]));
    },
  };
}
