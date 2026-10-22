import { describe, expect, it } from "vitest";
import { validateConfig } from "../src/config.js";
import { keccak256, stringToBytes } from "viem";
import { fromRaw, memoKey, quoteBuy, quoteMarketSell, skuKey, toRaw, v2AmountOut } from "../src/units.js";
import { KIT_VERSION } from "../src/version.js";
import pkg from "../package.json" with { type: "json" };

const E18 = 10n ** 18n;
const pools = { game: { token: 1_000_000n * E18, pairAsset: 2_000n * E18 }, dollar: { pairAsset: 100_000n * E18, usdg: 3_000_000n * 10n ** 6n } };

describe("units", () => {
  it("parses decimals exactly", () => {
    expect(toRaw("0.25", 6)).toBe(250_000n);
    expect(toRaw(0.1, 18)).toBe(10n ** 17n);
    expect(toRaw(5n, 18)).toBe(5n);
    expect(() => toRaw(-1, 6)).toThrow(/BAD_AMOUNT/);
    expect(() => toRaw("1e5", 6)).toThrow(/BAD_AMOUNT/);
    expect(fromRaw(1_500_000n, 6)).toBe(1.5);
  });

  it("SKU ids are keccak256(bytes(id)) as GameVault.setSku assigns them; memos are padded ASCII", () => {
    expect(skuKey("skin_gold")).toBe(keccak256(stringToBytes("skin_gold")));
    expect(memoKey("revive")).toBe(`0x7265766976650000000000000000000000000000000000000000000000000000`);
  });

  it("quotes include the v2 fee and the transfer tax", () => {
    const gross = v2AmountOut(v2AmountOut(10_000_000n, pools.dollar.usdg, pools.dollar.pairAsset), pools.game.pairAsset, pools.game.token);
    expect(quoteBuy(10_000_000n, pools, 500n)).toBe((gross * 9500n) / 10000n);
    // $10 at $0.06 is about 166 tokens, less fees and 5% tax.
    expect(fromRaw(quoteBuy(10_000_000n, pools, 500n), 18)).toBeGreaterThan(155);
    expect(fromRaw(quoteBuy(10_000_000n, pools, 500n), 18)).toBeLessThan(160);
    // Selling 100 tokens: market about $6 less tax and fees (there is no floor route).
    expect(fromRaw(quoteMarketSell(100n * E18, pools, 500n), 6)).toBeCloseTo(5.66, 1);
  });
});

describe("config", () => {
  it("accepts a valid config and reports every problem in a bad one", () => {
    expect(validateConfig({ game: "comet-sweep", store: [{ id: "revive", label: "Revive", kind: "consumable", priceUsdg: "0.25" }], earn: [{ id: "wave_cleared", label: "Clear a wave" }] }).problems).toEqual([]);
    const bad = validateConfig({ game: "X", store: [{ id: "Revive", label: "", kind: "x" }], earn: [{ id: "a" }] });
    expect(bad.config).toBeNull();
    expect(bad.problems.length).toBeGreaterThanOrEqual(5);
  });

  it("version constant matches package.json", () => {
    expect(KIT_VERSION).toBe(pkg.version);
  });
});

describe("the bonding curve mirrors GameCurve", () => {
  // The $8k template at $10 a pair-asset unit: VA 400, target 800, VT 10,285,714.
  const c = { reserve: 0n, sold: 0n, target: 800n * E18, virtualAsset: 400n * E18, virtualToken: 10_285_714n * E18, feeBps: 100n, walletCap: 50n * E18 };

  it("the whole raise buys the curve's inventory; the graduating buy is clamped to the room left", async () => {
    const { curveQuoteBuy, curvePriceWad } = await import("../src/units.js");
    const q = curveQuoteBuy(10_000n * E18, c);
    expect(q.net).toBe(800n * E18);
    // fee on the clamp: ceil(room × 1% / 99%)
    expect(q.fee).toBe((800n * E18 * 100n - 1n) / 9_900n + 1n);
    expect(fromRaw(q.tokensOut, 18)).toBeCloseTo(6_857_142.67, 1);
    // First price 400 / 10,285,714; graduation price 9× that.
    const first = curvePriceWad(c);
    const last = curvePriceWad({ ...c, reserve: c.target, sold: q.tokensOut });
    expect(Number(last) / Number(first)).toBeCloseTo(9, 6);
  });

  it("a sell of what was bought returns less than went in (the fee both ways)", async () => {
    const { curveQuoteBuy, curveQuoteSell } = await import("../src/units.js");
    const q = curveQuoteBuy(10n * E18, c);
    const back = curveQuoteSell(q.tokensOut, { ...c, reserve: q.net, sold: q.tokensOut });
    expect(back).toBeLessThan(10n * E18);
    expect(fromRaw(back, 18)).toBeCloseTo(10 * 0.99 * 0.99, 3);
  });
});
