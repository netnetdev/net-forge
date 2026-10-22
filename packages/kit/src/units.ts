// Units, ids and the quote arithmetic. Pure functions, no RPC.
//
// Quotes are computed from the reserves the snapshot already read, so
// quoting a buy or a cash-out costs zero extra calls. The contract enforces
// the minimum out, so a stale quote can only fail safe.

import { keccak256, stringToBytes, stringToHex, type Hex } from "viem";
import { KitError } from "./errors.js";

export const USDG_DECIMALS = 6;
/** wsNET has 18 decimals. Internal only: no public value is ever in wsNET. */
export const PAIR_ASSET_DECIMALS = 18;
export const BPS = 10_000n;
/** Uniswap v2 swap fee: 0.3%. */
const V2_FEE_NUM = 997n;
const V2_FEE_DEN = 1000n;

/** A whole-unit amount (number or decimal string) or raw units (bigint). */
export type Amount = number | string | bigint;

/** Whole units to raw units, exact for decimal strings. */
export function toRaw(amount: Amount, decimals: number): bigint {
  if (typeof amount === "bigint") {
    if (amount <= 0n) throw new KitError("BAD_AMOUNT", `Got ${amount}.`);
    return amount;
  }
  const s = typeof amount === "number" ? numberToDecimal(amount) : amount.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new KitError("BAD_AMOUNT", `Got ${JSON.stringify(amount)}.`);
  const [whole = "0", frac = ""] = s.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
  if (raw <= 0n) throw new KitError("BAD_AMOUNT", `Got ${JSON.stringify(amount)}.`);
  return raw;
}

function numberToDecimal(n: number): string {
  if (!Number.isFinite(n) || n <= 0) throw new KitError("BAD_AMOUNT", `Got ${n}.`);
  // String(n) is the shortest exact round trip (0.1 stays "0.1"). Only very
  // small or large numbers use exponent notation; fall back to toFixed there.
  const s = String(n);
  if (!/e/i.test(s)) return s;
  return n.toFixed(20).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/** Raw units to a JS number in whole units (display only). */
export function fromRaw(raw: bigint, decimals: number): number {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const n = Number(whole) + Number(frac) / Number(base);
  return neg ? -n : n;
}

const ID = /^[a-z][a-z0-9_]{1,30}$/;

/** A SKU's on-chain id: keccak256(bytes(id)), as GameVault.setSku assigns it. */
export function skuKey(id: string): Hex {
  if (!ID.test(id)) throw new KitError("UNKNOWN_SKU", `"${id}" is not a valid id.`);
  return keccak256(stringToBytes(id));
}

/** A spend reason as the bytes32 memo GameVault.tip records: the ASCII id, right-padded. */
export function memoKey(reason: string): Hex {
  if (!ID.test(reason)) throw new KitError("BAD_AMOUNT", `Spend reason "${reason}" must be an id like "revive".`);
  return stringToHex(reason, { size: 32 });
}

/** Uniswap v2 getAmountOut. */
export function v2AmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const inWithFee = amountIn * V2_FEE_NUM;
  return (inWithFee * reserveOut) / (reserveIn * V2_FEE_DEN + inWithFee);
}

/** The reserves the quote math needs, already oriented. */
export interface Pools {
  /** Game token / pair asset pool: [token reserve, pair-asset reserve]. */
  game: { token: bigint; pairAsset: bigint };
  /** Pair asset / USDG pool: [pair-asset reserve, USDG reserve]. */
  dollar: { pairAsset: bigint; usdg: bigint };
}

export function applyBps(x: bigint, bps: bigint): bigint {
  return (x * (BPS - bps)) / BPS;
}

/** USDG in -> game token out, through the zap: USDG -> pair asset -> token,
 *  then the token's transfer tax on the way to the buyer. */
export function quoteBuy(usdgIn: bigint, pools: Pools, taxBps: bigint): bigint {
  const mid = v2AmountOut(usdgIn, pools.dollar.usdg, pools.dollar.pairAsset);
  const gross = v2AmountOut(mid, pools.game.pairAsset, pools.game.token);
  return applyBps(gross, taxBps);
}

/** Game token in -> USDG out through the market: the transfer into the pool
 *  pays the tax, then token -> pair asset -> USDG. */
export function quoteMarketSell(tokenIn: bigint, pools: Pools, taxBps: bigint): bigint {
  const net = applyBps(tokenIn, taxBps);
  const mid = v2AmountOut(net, pools.game.token, pools.game.pairAsset);
  return v2AmountOut(mid, pools.dollar.pairAsset, pools.dollar.usdg);
}

/** Mid price of one whole token in dollars, from the two pools. */
export function priceUsd(pools: Pools, tokenDecimals: number): number | null {
  const { game, dollar } = pools;
  if (game.token === 0n || dollar.pairAsset === 0n) return null;
  const pairPerToken = fromRaw(game.pairAsset, PAIR_ASSET_DECIMALS) / fromRaw(game.token, tokenDecimals);
  const usdPerPair = fromRaw(dollar.usdg, USDG_DECIMALS) / fromRaw(dollar.pairAsset, PAIR_ASSET_DECIMALS);
  return pairPerToken * usdPerPair;
}

/** Dollars per whole pair-asset unit, from the dollar pool. */
export function usdPerPairAsset(dollar: Pools["dollar"]): number | null {
  if (dollar.pairAsset === 0n || dollar.usdg === 0n) return null;
  return fromRaw(dollar.usdg, USDG_DECIMALS) / fromRaw(dollar.pairAsset, PAIR_ASSET_DECIMALS);
}

// ---- The bonding curve (GameCurve.sol in the NetNet contracts), mirrored exactly ----

/** The curve numbers the quotes need, in pair-asset wei and token wei. */
export interface CurvePool {
  /** Real pair asset the curve holds (wei). */
  reserve: bigint;
  /** Tokens the curve has sold (wei). */
  sold: bigint;
  /** Graduation: the reserve that ends the curve (wei). */
  target: bigint;
  virtualAsset: bigint;
  virtualToken: bigint;
  /** Curve trade fee, bps, taken from the pair-asset side both ways. */
  feeBps: bigint;
  /** Per-wallet cap on net pair asset put in (wei). */
  walletCap: bigint;
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return a === 0n ? 0n : (a - 1n) / b + 1n;
}

/** GameCurve.quoteBuy: tokens out, pair asset into the reserve, and the fee.
 *  The graduating buy is clamped to the room left (the rest is refunded). */
export function curveQuoteBuy(assetIn: bigint, c: CurvePool): { tokensOut: bigint; net: bigint; fee: bigint } {
  if (assetIn <= 0n) return { tokensOut: 0n, net: 0n, fee: 0n };
  let fee = ceilDiv(assetIn * c.feeBps, BPS);
  let net = assetIn - fee;
  const room = c.target - c.reserve;
  if (net >= room) {
    net = room;
    fee = ceilDiv(room * c.feeBps, BPS - c.feeBps);
    if (net + fee > assetIn) fee = assetIn - net;
  }
  const k = c.virtualAsset * c.virtualToken;
  const y = c.virtualToken - c.sold;
  const tokensOut = y - ceilDiv(k, c.virtualAsset + c.reserve + net);
  return { tokensOut: tokensOut > 0n ? tokensOut : 0n, net, fee };
}

/** GameCurve.quoteSell: pair asset out after the fee. */
export function curveQuoteSell(tokenIn: bigint, c: CurvePool): bigint {
  if (tokenIn <= 0n || tokenIn > c.sold) return 0n;
  const k = c.virtualAsset * c.virtualToken;
  const gross = c.virtualAsset + c.reserve - ceilDiv(k, c.virtualToken - c.sold + tokenIn);
  return gross - ceilDiv(gross * c.feeBps, BPS);
}

/** GameCurve.priceWad: the marginal price, pair-asset wei per 1e18 token wei. */
export function curvePriceWad(c: CurvePool): bigint {
  const x = c.virtualAsset + c.reserve;
  return (x * x * 10n ** 18n) / (c.virtualAsset * c.virtualToken);
}

/** USDG in -> tokens through GameZap.buyOnCurve: USDG -> pair asset on the
 *  dollar pool, then the curve (untaxed before graduation). */
export function quoteCurveBuy(usdgIn: bigint, dollar: Pools["dollar"], c: CurvePool): { mid: bigint; tokensOut: bigint; net: bigint; fee: bigint } {
  const mid = v2AmountOut(usdgIn, dollar.usdg, dollar.pairAsset);
  return { mid, ...curveQuoteBuy(mid, c) };
}

/** Tokens in -> USDG through GameZap.sellOnCurve. */
export function quoteCurveSell(tokenIn: bigint, dollar: Pools["dollar"], c: CurvePool): bigint {
  return v2AmountOut(curveQuoteSell(tokenIn, c), dollar.pairAsset, dollar.usdg);
}

/** Slippage floor for a quote. Default 1%. */
export function minOut(quote: bigint, slippageBps: number): bigint {
  return applyBps(quote, BigInt(Math.max(0, Math.min(5_000, Math.round(slippageBps)))));
}
