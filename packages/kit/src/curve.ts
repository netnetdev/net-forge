// The bonding curve in dollars: what the Kit shows players before
// graduation. Pure, no RPC. The pair asset never leaves this file.

import type { KitCurveState } from "./types.js";
import { curvePriceWad, fromRaw, PAIR_ASSET_DECIMALS, usdPerPairAsset, type CurvePool, type Pools } from "./units.js";

/** The curve's marginal price in dollars per whole token. */
export function curvePriceUsd(c: CurvePool, dollar: Pools["dollar"]): number | null {
  const usd = usdPerPairAsset(dollar);
  return usd === null ? null : fromRaw(curvePriceWad(c), PAIR_ASSET_DECIMALS) * usd;
}

/** The curve as players see it: dollars, never the pair asset. */
export function curveView(c: CurvePool & { netBought: bigint }, dollar: Pools["dollar"] | null): KitCurveState {
  const usd = dollar ? usdPerPairAsset(dollar) : null;
  const inUsd = (wei: bigint) => (usd === null ? null : fromRaw(wei, PAIR_ASSET_DECIMALS) * usd);
  const room = c.walletCap > c.netBought ? c.walletCap - c.netBought : 0n;
  return {
    progress: c.target > 0n ? Math.min(1, Number((c.reserve * 1_000_000n) / c.target) / 1_000_000) : 0,
    raisedUsd: inUsd(c.reserve),
    targetUsd: inUsd(c.target),
    walletCapUsd: inUsd(c.walletCap),
    walletRoomUsd: inUsd(room),
    feeBps: Number(c.feeBps),
  };
}
