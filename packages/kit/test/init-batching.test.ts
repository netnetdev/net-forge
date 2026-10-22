// The RPC budget, asserted (spec §10, CLAUDE.md RPC rules), against fake
// contracts speaking the real generated ABIs:
//   - nothing before init,
//   - one eth_call per open (two on the first open in a browser, which
//     learns the immutable pool addresses),
//   - zero calls for every getter and quote,
//   - after the wallet's own transaction: one simulate + receipt + one snapshot,
//   - never a timer.

import { decodeFunctionData, getAddress } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gameVaultAbi, gameZapAbi, rewardVaultAbi } from "../src/abi.js";
import { createKit } from "../src/kit.js";
import { skuKey } from "../src/units.js";
import type { KitAttestation } from "../src/types.js";
import { A, createFakeChain, CURVE, E18, liveAddresses, STORE } from "./fake-chain.js";

let slugN = 0;
const slug = () => `mech-pilot-${++slugN}`;
const opts = (game: string, chain: ReturnType<typeof createFakeChain>, wallet = true) => ({
  game, addresses: liveAddresses, transport: chain.transport, store: STORE, ...(wallet ? { provider: chain.wallet } : {}),
});

afterEach(() => {
  vi.useRealTimers();
});

async function opened(withWallet = true) {
  const game = slug();
  const chain = createFakeChain(game);
  // Prime the pool-address cache like any earlier visit would.
  await createKit().init(opts(game, chain, false));
  chain.reset();
  const kit = createKit();
  await kit.init(opts(game, chain, withWallet));
  return { kit, chain, game };
}

describe("init: one Multicall3 eth_call", () => {
  it("makes zero calls before init", async () => {
    const chain = createFakeChain(slug());
    createKit();
    await new Promise((r) => setTimeout(r, 30));
    expect(chain.counts).toEqual({});
  });

  it("first open in a browser: two calls; every later open: one", async () => {
    const game = slug();
    const chain = createFakeChain(game);
    const kit = createKit();
    const state = await kit.init(opts(game, chain));
    expect(state.status).toBe("ready");
    expect(chain.counts["eth_call"]).toBe(2);
    expect(Object.keys(chain.counts)).toEqual(["eth_call"]);

    chain.reset();
    await createKit().init(opts(game, chain));
    expect(chain.counts["eth_call"]).toBe(1);
    expect(chain.aggregateSizes).toHaveLength(1);
  });

  it("the one call verifies the factory record and carries every read", async () => {
    const { chain } = await opened();
    const names = chain.calls[0] ?? [];
    expect(names[0]).toBe("gameOfToken");
    for (const fn of ["contractURI", "metadataHash", "graduated", "reserve", "sold", "netBought", "halted", "sku", "getReserves", "balanceOf", "entitlementsOf", "allowance"]) expect(names).toContain(fn);
    // The curve's immutables were learned on the first open and cached for the session.
    expect(names).not.toContain("TARGET");
    expect(names).not.toContain("backingPerToken");
    expect(names.filter((n) => n === "sku")).toHaveLength(STORE.length);
    // Addresses are derived locally: no lookup call and no predict() call.
    expect(names).not.toContain("gameBySlug");
    expect(names).not.toContain("predict");
  });

  it("refuses a game the factory does not name", async () => {
    const game = slug();
    const chain = createFakeChain(game);
    chain.state.launched = false;
    await expect(createKit().init(opts(game, chain))).rejects.toMatchObject({ code: "GAME_NOT_FOUND" });
    expect(chain.counts["eth_call"]).toBe(1);
  });

  it("decodes balances, entitlements, passes, price and metadata", async () => {
    const { kit } = await opened();
    expect(kit.wallet.address()).toBe(A.player);
    expect(kit.token.symbol()).toBe("MECH");
    expect(kit.token.balance()).toBe(250);
    expect(kit.getState().usdg).toBe(40n * 10n ** 6n);
    expect(kit.getState().token.taxBps).toBe(500);
    expect(kit.token.priceUsd()).toBeCloseTo(0.06, 10);
    expect(kit.token.graduated()).toBe(true);
    expect(kit.token.curve()).toBeNull();
    expect(kit.store.owns("skin_gold")).toBe(true);
    expect(kit.store.owns("revive")).toBe(false);
    expect(kit.store.get("season_pass")).toMatchObject({ kind: "pass", active: true, owned: 0n, expiresAt: null });
    expect(kit.metadata()).toMatchObject({ name: "Mech Pilot", contractURI: "ipfs://bafy-mech/contract.json" });
    expect(JSON.stringify(kit.getState(), (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toMatch(/wsnet/i);
  });

  it("a running pass reads as owned, an expired one does not", async () => {
    const game = slug();
    const chain = createFakeChain(game);
    chain.state.words = { season_pass: BigInt(Math.floor(Date.now() / 1000) + 3600) };
    const kit = createKit();
    await kit.init(opts(game, chain));
    expect(kit.store.owns("season_pass")).toBe(true);
    chain.state.words = { season_pass: 1000n };
    await kit.refresh();
    expect(kit.store.owns("season_pass")).toBe(false);
  });

  it("getters and quotes cost zero calls", async () => {
    const { kit, chain } = await opened();
    chain.reset();
    for (let frame = 0; frame < 600; frame++) {
      kit.token.balance();
      kit.store.owns("skin_gold");
      kit.token.priceUsd();
      kit.metadata();
    }
    expect(kit.token.quoteBuy(12).tokens).toBeGreaterThan(0);
    expect(kit.token.quoteCashOut(100).usd).toBeGreaterThan(0);
    expect(chain.counts).toEqual({});
  });

  it("never polls: no calls while idle", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { chain } = await opened();
    chain.reset();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(chain.counts).toEqual({});
  });

  it("concurrent refreshes share one call", async () => {
    const { kit, chain } = await opened();
    chain.reset();
    await Promise.all([kit.refresh(), kit.refresh(), kit.refresh()]);
    expect(chain.counts["eth_call"]).toBe(1);
  });
});

describe("writes: the real signatures, and one read after the wallet's own transaction", () => {
  it("store.buy calls GameVault.buy(skuId, 1, inToken, maxTotal, to)", async () => {
    const { kit, chain } = await opened();
    chain.reset();
    chain.state.words = { skin_gold: 1n, revive: 1n };
    const item = await kit.store.buy("revive");
    expect(item.owned).toBe(1n);
    const tx = chain.wallet.sent[0]!;
    expect(tx.to.toLowerCase()).toBe(chain.game.store.toLowerCase());
    const d = decodeFunctionData({ abi: gameVaultAbi, data: tx.data });
    expect(d.functionName).toBe("buy");
    expect(d.args).toEqual([skuKey("revive"), 1n, false, 500_000n, getAddress(A.player)]);
    expect(chain.counts["eth_estimateGas"]).toBe(1); // the estimate is the simulation
    expect(chain.counts["eth_call"]).toBe(1); // one snapshot
    expect(tx.gas).toBe(BigInt(0x30000) * 3n / 2n + 200_000n); // headroom over the estimate
    expect(chain.counts["eth_getTransactionReceipt"]).toBeGreaterThanOrEqual(1);
  });

  it("spend tips tokens to the vault's sink, approving first when short", async () => {
    const game = slug();
    const chain = createFakeChain(game);
    chain.state.allowance = 0n;
    const kit = createKit();
    await kit.init(opts(game, chain));
    chain.reset();
    await kit.token.spend(10, "revive");
    expect(chain.wallet.sent).toHaveLength(2);
    expect(chain.wallet.sent[0]!.to.toLowerCase()).toBe(chain.game.token.toLowerCase());
    const d = decodeFunctionData({ abi: gameVaultAbi, data: chain.wallet.sent[1]!.data });
    expect(d.functionName).toBe("tip");
    expect(d.args?.[0]).toBe(10n * E18);
    expect(d.args?.[1]).toBe(true);
    expect(chain.counts["eth_estimateGas"]).toBe(2); // each step estimated once the one before it landed
    expect(chain.counts["eth_call"]).toBe(1); // one snapshot
  });

  it("refuses before sending when the balance is short", async () => {
    const { kit, chain } = await opened();
    chain.reset();
    await expect(kit.token.spend(10_000, "revive")).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect(chain.wallet.sent).toHaveLength(0);
    expect(chain.counts).toEqual({});
  });

  it("token.buy calls GameZap.buyToken with a deadline", async () => {
    const { kit, chain } = await opened();
    await kit.token.buy(5);
    const d = decodeFunctionData({ abi: gameZapAbi, data: chain.wallet.sent.at(-1)!.data });
    expect(d.functionName).toBe("buyToken");
    expect(d.args?.[0]).toBe(chain.game.token);
    expect(d.args?.[1]).toBe(5_000_000n);
    expect(Number(d.args?.[4])).toBeGreaterThan(Date.now() / 1000);
  });

  it("cash-out sells into the pool through GameZap.sellToken; there is no redemption route", async () => {
    const { kit, chain } = await opened();
    chain.reset();
    expect(kit.token.quoteCashOut(100).route).toBe("market");
    await kit.token.cashOut(100);
    const d = decodeFunctionData({ abi: gameZapAbi, data: chain.wallet.sent.at(-1)!.data });
    expect(d.functionName).toBe("sellToken");
    expect(chain.calls.flat()).not.toContain("REDEMPTION_FEE_BPS");
  });
});

describe("before graduation: the bonding curve", () => {
  async function onCurve(netBought = 0n) {
    const game = slug();
    const chain = createFakeChain(game);
    chain.state.graduated = false;
    chain.state.curveReserve = CURVE.target / 4n;
    chain.state.curveSold = 2_000_000n * E18;
    chain.state.netBought = netBought;
    chain.state.usdgBalance = 1_000n * 10n ** 6n;
    const kit = createKit();
    await kit.init(opts(game, chain));
    chain.reset();
    return { kit, chain };
  }

  it("reads graduation, the curve in dollars and the curve price in the same one call", async () => {
    const { kit } = await onCurve();
    expect(kit.token.graduated()).toBe(false);
    const c = kit.token.curve();
    expect(c?.progress).toBeCloseTo(0.25, 5);
    expect(c?.targetUsd).toBeCloseTo(8000, 4);
    expect(c?.raisedUsd).toBeCloseTo(2000, 4);
    expect(c?.walletCapUsd).toBeCloseTo(500, 4);
    expect(c?.walletRoomUsd).toBeCloseTo(500, 4);
    expect(c?.feeBps).toBe(100);
    // (VA + reserve)^2 / K at $30 a pair-asset unit.
    const x = Number(CURVE.virtualAsset + CURVE.target / 4n) / 1e18;
    expect(kit.token.priceUsd()).toBeCloseTo(((x * x) / ((Number(CURVE.virtualAsset) / 1e18) * (Number(CURVE.virtualToken) / 1e18))) * 30, 9);
  });

  it("token.buy goes through GameZap.buyOnCurve with both min-outs and a deadline", async () => {
    const { kit, chain } = await onCurve();
    const q = kit.token.quoteBuy(50);
    expect(q.route).toBe("curve");
    expect(q.tokens).toBeGreaterThan(0);
    await kit.token.buy(50);
    const d = decodeFunctionData({ abi: gameZapAbi, data: chain.wallet.sent.at(-1)!.data });
    expect(d.functionName).toBe("buyOnCurve");
    expect(d.args?.[0]).toBe(chain.game.curve);
    expect(d.args?.[1]).toBe(50_000_000n);
    expect(d.args?.[2] as bigint).toBeGreaterThan(0n); // min pair asset from the dollar leg
    expect(d.args?.[3]).toBe((q.tokenOut * 9_900n) / 10_000n);
    expect(d.args?.[4]).toBe(getAddress(A.player));
    expect(Number(d.args?.[5])).toBeGreaterThan(Date.now() / 1000);
    expect(chain.counts["eth_estimateGas"]).toBe(1);
    expect(chain.counts["eth_call"]).toBe(1); // one snapshot
  });

  it("refuses a buy over the wallet's $500 cap before any prompt", async () => {
    const { kit, chain } = await onCurve(CURVE.walletCap - CURVE.walletCap / 10n);
    expect(kit.token.curve()?.walletRoomUsd).toBeCloseTo(50, 4);
    await expect(kit.token.buy(100)).rejects.toMatchObject({ code: "WALLET_CAP" });
    expect(chain.wallet.sent).toHaveLength(0);
    expect(chain.counts).toEqual({});
  });

  it("token.cashOut sells back to the curve through GameZap.sellOnCurve", async () => {
    const { kit, chain } = await onCurve();
    expect(kit.token.quoteCashOut(100).route).toBe("curve");
    await kit.token.cashOut(100);
    const d = decodeFunctionData({ abi: gameZapAbi, data: chain.wallet.sent.at(-1)!.data });
    expect(d.functionName).toBe("sellOnCurve");
    expect(d.args?.[0]).toBe(chain.game.curve);
    expect(d.args?.[1]).toBe(100n * E18);
  });

  it("coins buy and cash out only at the market (sellToken), never on the curve", async () => {
    const { kit, chain } = await onCurve();
    await expect(kit.coins.buy(5)).rejects.toMatchObject({ code: "PRELAUNCH" });
    await expect(kit.coins.cashOut(5)).rejects.toMatchObject({ code: "PRELAUNCH" });
    expect(() => kit.coins.quoteCashOut(5)).toThrow(/PRELAUNCH/);
    expect(chain.wallet.sent).toHaveLength(0);
  });
});

describe("earn: the room server's attestations", () => {
  const att = (chain: ReturnType<typeof createFakeChain>, over: Partial<KitAttestation> = {}): KitAttestation => ({
    vault: chain.game.rewardVault, rule: "wave_cleared", runId: `0x${"ab".repeat(32)}`, player: A.player, ruleId: 7,
    amount: (3n * E18).toString(), nonce: `0x${"01".repeat(32)}`, paidEntry: false, expiry: String(Math.floor(Date.now() / 1000) + 600),
    verified: true, signature: `0x${"11".repeat(65)}`, ...over,
  });

  it("accepts attestations from the room socket and claims them with RewardVault.claim(Reward, sig)", async () => {
    const { kit, chain } = await opened();
    const sent = att(chain); // one expiry, so a second boundary mid-test cannot change it
    expect(kit.earn.accept([sent, { junk: true }])).toBe(1);
    expect(kit.earn.accept([att(chain)])).toBe(0); // same nonce
    chain.reset();
    expect(await kit.earn.claim()).toBe(3);
    const tx = chain.wallet.sent.at(-1)!;
    expect(tx.to.toLowerCase()).toBe(chain.game.rewardVault.toLowerCase());
    const d = decodeFunctionData({ abi: rewardVaultAbi, data: tx.data });
    expect(d.functionName).toBe("claim");
    expect(d.args?.[0]).toEqual({ player: getAddress(A.player), ruleId: 7, amount: 3n * E18, nonce: `0x${"01".repeat(32)}`, paidEntry: false, expiry: BigInt(sent.expiry), verified: true });
    expect(kit.earn.pending()).toHaveLength(0);
  });

  it("claimAll is one claimBatch transaction", async () => {
    const { kit, chain } = await opened();
    kit.earn.accept([att(chain), att(chain, { nonce: `0x${"02".repeat(32)}`, amount: E18.toString() })]);
    expect(await kit.earn.claimAll()).toBe(4);
    expect(decodeFunctionData({ abi: rewardVaultAbi, data: chain.wallet.sent.at(-1)!.data }).functionName).toBe("claimBatch");
  });

  it("never keeps or submits an unverified attestation (one would revert the whole claimBatch)", async () => {
    const { kit, chain } = await opened();
    const { verified: _omit, ...noField } = att(chain, { nonce: `0x${"07".repeat(32)}` });
    expect(kit.earn.accept([att(chain, { verified: false, nonce: `0x${"06".repeat(32)}` }), noField, { ...noField, verified: "true" }])).toBe(0);
    expect(kit.earn.pending()).toHaveLength(0);
    expect(kit.earn.accept([att(chain), att(chain, { verified: false, nonce: `0x${"08".repeat(32)}` })])).toBe(1);
    chain.reset();
    expect(await kit.earn.claimAll()).toBe(3);
    expect(chain.wallet.sent).toHaveLength(1);
    const d = decodeFunctionData({ abi: rewardVaultAbi, data: chain.wallet.sent[0]!.data });
    expect(d.functionName).toBe("claim");
    expect(d.args?.[0]).toMatchObject({ nonce: `0x${"01".repeat(32)}`, verified: true });
  });

  it("never sends an attestation for another vault, wallet or after expiry", async () => {
    const { kit, chain } = await opened();
    kit.earn.accept([att(chain, { vault: A.zap, nonce: `0x${"03".repeat(32)}` })]);
    await expect(kit.earn.claim()).rejects.toMatchObject({ code: "NOTHING_TO_CLAIM" });
    expect(kit.earn.accept([att(chain, { player: A.creator, nonce: `0x${"04".repeat(32)}` })])).toBe(0);
    expect(kit.earn.accept([att(chain, { expiry: "1000", nonce: `0x${"05".repeat(32)}` })])).toBe(0);
    expect(chain.wallet.sent).toHaveLength(0);
  });

  it("collect() fetches leftover claims from GET /referee/claims/:wallet with no chain call", async () => {
    const game = slug();
    const chain = createFakeChain(game);
    const urls: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      urls.push(String(input));
      return new Response(JSON.stringify([att(chain)]), { status: 200 });
    });
    const kit = createKit();
    await kit.init({ ...opts(game, chain), referee: "https://rooms.example/" });
    chain.reset();
    urls.length = 0;
    expect(await kit.earn.collect()).toBe(1);
    expect(urls).toEqual([`https://rooms.example/referee/claims/${A.player}`]);
    expect(chain.counts).toEqual({});
    fetchSpy.mockRestore();
  });
});

describe("placeholders throw", () => {
  it("init without a deployed GameFactory fails with PLACEHOLDER_ADDRESS", async () => {
    const chain = createFakeChain(slug());
    const kit = createKit();
    await expect(kit.init({ game: slug(), transport: chain.transport })).rejects.toMatchObject({ code: "PLACEHOLDER_ADDRESS" });
    expect(chain.counts).toEqual({});
  });
});
