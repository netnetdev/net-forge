// A fake Robinhood Chain behind a viem custom transport. It answers
// Multicall3 aggregate3 and plain eth_call against fake game contracts that
// use the real generated ABIs, at the CREATE3 addresses the factory would
// give the slug, and counts every JSON-RPC method so tests can assert
// exactly how many billed calls the Kit makes.
//
// Addresses here are local test fixtures, not real deployments.

import {
  custom, decodeFunctionData, encodeFunctionResult, keccak256, stringToBytes,
  type Abi, type Hex, type Transport,
} from "viem";
import { erc20Abi, gameCurveAbi, gameFactoryAbi, gameTokenAbi, gameVaultAbi, gameZapAbi, rewardVaultAbi } from "../src/abi.js";
import { multicall3Abi, uniswapV2PairAbi } from "../src/abi-external.js";
import { deriveGame, type GameAddresses } from "../src/derive.js";
import type { Address, Eip1193Provider } from "../src/types.js";

const fixture = (n: number): Address => `0x${n.toString(16).padStart(40, "0")}`;
export const E18 = 10n ** 18n;

export const A = {
  multicall3: fixture(0x3c),
  factory: fixture(0xfa),
  pair: fixture(0x9a),
  dollarPair: fixture(0xd9),
  usdg: fixture(0x05),
  wsnet: fixture(0x55),
  zap: fixture(0x2a),
  creator: fixture(0xc1),
  player: fixture(0xbeef),
} as const;

export const liveAddresses = { gameFactory: A.factory, gameZap: A.zap, USDG: A.usdg, multicall3: A.multicall3 };

export const STORE = [
  { id: "revive", kind: "consumable", priceUsdg: "0.50", priceToken: "10" },
  { id: "skin_gold", kind: "permanent", priceUsdg: "2.00" },
  { id: "season_pass", kind: "pass", priceUsdg: "5.00", duration: 604800 },
] as const;

export interface FakeChainState {
  tokenBalance: bigint;
  usdgBalance: bigint;
  /** Entitlement words by SKU id. */
  words: Record<string, bigint>;
  allowance: bigint;
  /** When false, the factory has no record of the game. */
  launched: boolean;
  /** False: the bonding curve is running (the pool is empty). */
  graduated: boolean;
  /** The curve's reserve and tokens sold (wei). */
  curveReserve: bigint;
  curveSold: bigint;
  /** The player's net curve buys (wei of pair asset). */
  netBought: bigint;
}

/** The fixture curve: $8k at $30 a pair-asset unit, the middle curve, 1% fee, $500 cap. */
export const CURVE = {
  target: (8000n * E18) / 30n,
  virtualAsset: (4000n * E18) / 30n,
  virtualToken: 10_285_714n * E18,
  feeBps: 100n,
  walletCap: (500n * E18) / 30n,
} as const;

export interface FakeChain {
  transport: Transport;
  game: GameAddresses;
  counts: Record<string, number>;
  /** eth_call payload sizes, one per eth_call. */
  aggregateSizes: number[];
  /** Function names each eth_call carried, one list per eth_call. */
  calls: string[][];
  state: FakeChainState;
  reset(): void;
  wallet: Eip1193Provider & { sent: Array<{ to: string; data: Hex; gas: bigint | null }>; signed: string[]; rejectSends: boolean };
}

type Handler = (fn: string, args: readonly unknown[]) => { abi: Abi; result: unknown } | null;
const same = (a: unknown, b: string) => String(a).toLowerCase() === b.toLowerCase();
const skuId = (id: string) => keccak256(stringToBytes(id));

export function createFakeChain(slug: string): FakeChain {
  const g = deriveGame(A.factory, slug);
  const counts: Record<string, number> = {};
  const aggregateSizes: number[] = [];
  const calls: string[][] = [];
  const state: FakeChainState = {
    tokenBalance: 250n * E18, usdgBalance: 40n * 10n ** 6n, words: { skin_gold: 1n }, allowance: 2n ** 200n, launched: true,
    graduated: true, curveReserve: CURVE.target, curveSold: 6_857_142n * E18, netBought: 0n,
  };
  const record = { token: g.token, curve: g.curve, buybackVault: g.buybackVault, rewardVault: g.rewardVault, store: g.store, creator: A.creator, templateVersion: 1, launchedAt: 1n };
  const zeroRecord = { token: fixture(0), curve: fixture(0), buybackVault: fixture(0), rewardVault: fixture(0), store: fixture(0), creator: fixture(0), templateVersion: 0, launchedAt: 0n };
  const skus: Record<string, { priceUsdg: bigint; priceToken: bigint; duration: number; kind: number }> = {
    [skuId("revive")]: { priceUsdg: 500_000n, priceToken: 10n * E18, duration: 0, kind: 2 },
    [skuId("skin_gold")]: { priceUsdg: 2_000_000n, priceToken: 0n, duration: 0, kind: 1 },
    [skuId("season_pass")]: { priceUsdg: 5_000_000n, priceToken: 0n, duration: 604800, kind: 3 },
  };

  const handlers: Record<string, Handler> = {
    [A.factory.toLowerCase()]: (fn, args) =>
      fn === "gameOfToken"
        ? { abi: gameFactoryAbi as Abi, result: state.launched && same(args[0], g.token) ? record : zeroRecord }
        : fn === "gameBySlug" ? { abi: gameFactoryAbi as Abi, result: state.launched ? record : zeroRecord } : null,
    [g.token.toLowerCase()]: (fn, args) => {
      const abi = gameTokenAbi as Abi;
      if (!state.launched) return null;
      if (fn === "balanceOf") return { abi, result: same(args[0], A.player) ? state.tokenBalance : 0n };
      if (fn === "allowance") return { abi, result: state.allowance };
      if (fn === "name") return { abi, result: "Mech Pilot" };
      if (fn === "symbol") return { abi, result: "MECH" };
      if (fn === "decimals") return { abi, result: 18 };
      if (fn === "taxBps") return { abi, result: 500n };
      if (fn === "tokenIsToken0") return { abi, result: true };
      if (fn === "pair") return { abi, result: A.pair };
      if (fn === "contractURI") return { abi, result: "ipfs://bafy-mech/contract.json" };
      if (fn === "metadataHash") return { abi, result: keccak256(stringToBytes("mech metadata")) };
      if (fn === "graduated") return { abi, result: state.graduated };
      return null;
    },
    [g.curve.toLowerCase()]: (fn) => {
      const abi = gameCurveAbi as Abi;
      if (!state.launched) return null;
      if (fn === "reserve") return { abi, result: state.curveReserve };
      if (fn === "sold") return { abi, result: state.curveSold };
      if (fn === "netBought") return { abi, result: state.netBought };
      if (fn === "TARGET") return { abi, result: CURVE.target };
      if (fn === "VIRTUAL_ASSET") return { abi, result: CURVE.virtualAsset };
      if (fn === "VIRTUAL_TOKEN") return { abi, result: CURVE.virtualToken };
      if (fn === "FEE_BPS") return { abi, result: CURVE.feeBps };
      if (fn === "WALLET_CAP") return { abi, result: CURVE.walletCap };
      return null;
    },
    [A.usdg.toLowerCase()]: (fn, args) => {
      const abi = erc20Abi as Abi;
      if (fn === "balanceOf") return { abi, result: same(args[0], A.player) ? state.usdgBalance : 0n };
      if (fn === "allowance") return { abi, result: state.allowance };
      return null;
    },
    [g.store.toLowerCase()]: (fn, args) => {
      const abi = gameVaultAbi as Abi;
      if (fn === "sku") return { abi, result: skus[String(args[0])] ?? { priceUsdg: 0n, priceToken: 0n, duration: 0, kind: 0 } };
      if (fn === "halted") return { abi, result: false };
      if (fn === "entitlementsOf") {
        const ids = args[1] as readonly Hex[];
        const byKey = Object.fromEntries(Object.entries(state.words).map(([k, v]) => [skuId(k), v]));
        return { abi, result: ids.map((k) => byKey[k] ?? 0n) };
      }
      if (fn === "buy" || fn === "tip") return { abi, result: 1n };
      return null;
    },
    [g.rewardVault.toLowerCase()]: (fn) => (fn === "claim" || fn === "claimBatch" ? { abi: rewardVaultAbi as Abi, result: fn === "claim" ? undefined : 1n } : null),
    [A.zap.toLowerCase()]: (fn) => {
      const abi = gameZapAbi as Abi;
      if (fn === "usdgWsnetPair") return { abi, result: A.dollarPair };
      if (fn === "wsnet") return { abi, result: A.wsnet };
      if (fn === "buyToken" || fn === "sellToken" || fn === "sellWsnet" || fn === "buyOnCurve" || fn === "sellOnCurve") return { abi, result: 1n };
      return null;
    },
    [A.pair.toLowerCase()]: (fn) => {
      const abi = uniswapV2PairAbi as Abi;
      // token0 = the game token. 1,000,000 tokens : 2,000 pair asset; empty before graduation.
      if (fn === "getReserves") return { abi, result: state.graduated ? [1_000_000n * E18, 2_000n * E18, 0] : [0n, 0n, 0] };
      if (fn === "token0") return { abi, result: g.token };
      return null;
    },
    [A.dollarPair.toLowerCase()]: (fn) => {
      const abi = uniswapV2PairAbi as Abi;
      // token0 = USDG. 3,000,000 USDG : 100,000 pair asset ($30 each).
      if (fn === "getReserves") return { abi, result: [3_000_000n * 10n ** 6n, 100_000n * E18, 0] };
      if (fn === "token0") return { abi, result: A.usdg };
      return null;
    },
  };

  const allAbis: Abi[] = [gameFactoryAbi, gameTokenAbi, gameCurveAbi, gameVaultAbi, gameZapAbi, rewardVaultAbi, uniswapV2PairAbi] as Abi[];

  function answer(to: string, data: Hex, names: string[]): { ok: boolean; data: Hex } {
    const h = handlers[to.toLowerCase()];
    for (const abi of allAbis) {
      let decoded: { functionName: string; args?: readonly unknown[] };
      try {
        decoded = decodeFunctionData({ abi, data }) as { functionName: string; args?: readonly unknown[] };
      } catch {
        continue;
      }
      names.push(decoded.functionName);
      const r = h?.(decoded.functionName, decoded.args ?? []);
      if (!r) return { ok: false, data: "0x" };
      if (r.result === undefined) return { ok: true, data: "0x" };
      const out = encodeFunctionResult({ abi: r.abi, functionName: decoded.functionName, result: r.result } as Parameters<typeof encodeFunctionResult>[0]);
      return { ok: true, data: out };
    }
    return { ok: false, data: "0x" };
  }

  const sent: Array<{ to: string; data: Hex; gas: bigint | null }> = [];
  const receipt = (hash: Hex) => {
    const tx = sent[Number(BigInt(hash)) - 1];
    const logs: unknown[] = [];
    return {
      blockHash: `0x${"1".repeat(64)}`, blockNumber: "0x10", contractAddress: null, cumulativeGasUsed: "0x1", effectiveGasPrice: "0x1",
      from: A.player, gasUsed: "0x1", logs, logsBloom: `0x${"0".repeat(512)}`, status: "0x1", to: tx?.to ?? g.store, transactionHash: hash,
      transactionIndex: "0x0", type: "0x2",
    };
  };

  const transport = custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      counts[method] = (counts[method] ?? 0) + 1;
      const p = (params ?? []) as unknown[];
      if (method === "eth_chainId") return "0x1237";
      if (method === "eth_blockNumber") return "0x10";
      if (method === "eth_getTransactionReceipt") return receipt(p[0] as Hex);
      if (method === "eth_getBlockByNumber") return { number: "0x10", hash: `0x${"1".repeat(64)}`, timestamp: "0x1", transactions: [] };
      if (method === "eth_estimateGas") {
        const call = p[0] as { to: string; data: Hex };
        const isApprove = call.data.startsWith("0x095ea7b3");
        if (!isApprove && !answer(call.to, call.data, []).ok) throw new Error("execution reverted");
        return "0x30000";
      }
      if (method === "eth_call") {
        const call = p[0] as { to: string; data: Hex };
        aggregateSizes.push((call.data.length - 2) / 2);
        const names: string[] = [];
        calls.push(names);
        if (call.to.toLowerCase() === A.multicall3.toLowerCase()) {
          const { args } = decodeFunctionData({ abi: multicall3Abi, data: call.data });
          const list = args[0] as ReadonlyArray<{ target: Address; allowFailure: boolean; callData: Hex }>;
          const results = list.map((c) => {
            const r = answer(c.target, c.callData, names);
            return { success: r.ok, returnData: r.data };
          });
          return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: results });
        }
        const r = answer(call.to, call.data, names);
        if (!r.ok) throw new Error("execution reverted");
        return r.data;
      }
      throw new Error(`fake chain: unhandled ${method}`);
    },
  });

  let txn = 0;
  const wallet: FakeChain["wallet"] = {
    sent,
    signed: [],
    rejectSends: false,
    async request({ method, params }) {
      const p = (params ?? []) as unknown[];
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [A.player];
      if (method === "eth_chainId") return "0x1237";
      if (method === "personal_sign") {
        wallet.signed.push(String(p[0]));
        return `0x${"5a".repeat(65)}`;
      }
      if (method === "eth_sendTransaction") {
        if (wallet.rejectSends) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
        const tx = p[0] as { to: string; data: Hex; gas?: Hex };
        sent.push({ to: tx.to, data: tx.data, gas: tx.gas ? BigInt(tx.gas) : null });
        return `0x${(++txn).toString(16).padStart(64, "0")}`;
      }
      throw new Error(`fake wallet: unhandled ${method}`);
    },
  };

  return {
    transport,
    game: g,
    counts,
    aggregateSizes,
    calls,
    state,
    wallet,
    reset() {
      for (const k of Object.keys(counts)) delete counts[k];
      aggregateSizes.length = 0;
      calls.length = 0;
    },
  };
}
