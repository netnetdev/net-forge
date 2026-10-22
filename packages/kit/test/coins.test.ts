// kit.coins: earned first (off chain, no prompt), then the wallet on chain;
// pre-launch play money with the same API; the token's own name, symbol and
// logo; the session on every referee write; and the call budget.

import { decodeFunctionData } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gameVaultAbi, rewardVaultAbi } from "../src/abi.js";
import { createKit } from "../src/kit.js";
import { A, createFakeChain, E18, liveAddresses, STORE } from "./fake-chain.js";

let slugN = 0;
const slug = () => `coin-game-${++slugN}`;
const REFEREE = "https://rooms.example";

interface Req {
  method: string;
  path: string;
  auth: string | null;
  body: Record<string, unknown> | null;
}

/** An in-memory referee speaking apps/rooms' coin routes, behind a fetch mock. */
function fakeReferee(chain: ReturnType<typeof createFakeChain>, init: { earned?: bigint; mode?: "live" | "prelaunch" } = {}) {
  const reqs: Req[] = [];
  const st = { earned: init.earned ?? 0n, mode: init.mode ?? "live", claimable: 0n, purchases: {} as Record<string, number>, reserved: new Map<string, bigint>(), returned: [] as string[], tokens: new Set<string>(["tok-1"]), status: {} as Record<string, number> };
  let n = 0;
  const balance = () => ({ mode: st.mode, ledger: st.mode === "live" ? "earned" : "points", earned: st.earned.toString(), claimable: st.claimable.toString(), returning: "0", reserved: "0", purchases: st.purchases });
  const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, i) => {
    const url = new URL(String(input));
    const method = i?.method ?? "GET";
    const headers = new Headers(i?.headers);
    const body = typeof i?.body === "string" ? (JSON.parse(i.body) as Record<string, unknown>) : null;
    reqs.push({ method, path: url.host === "ipfs.io" ? `ipfs:${url.pathname}` : url.pathname, auth: headers.get("authorization"), body });
    if (url.host === "ipfs.io") return ok({ name: "Mech Pilot Coin", image: "ipfs://bafy-logo/mech.png" });
    const p = url.pathname;
    const forced = st.status[p];
    if (forced) {
      delete st.status[p];
      return ok({ error: "forced" }, forced);
    }
    if (p === "/auth/nonce") return ok({ nonce: "abc123nonce", domain: "play.example", uri: "https://play.example", chainId: 4663 });
    if (p === "/auth/sign-in") {
      st.tokens.add(`tok-${++n + 1}`);
      return ok({ token: `tok-${n + 1}` });
    }
    if (p.startsWith("/referee/coins/")) return ok(balance());
    if (p.startsWith("/referee/claims/") && method === "GET") return ok([]);
    const auth = headers.get("authorization")?.replace(/^Bearer /, "");
    if (!auth || !st.tokens.has(auth)) return ok({ error: "sign in first" }, 401);
    if (p === "/referee/report") {
      const g = BigInt(Number(body?.["units"] ?? 1)) * E18;
      st.earned += g;
      return ok({ attestations: [], granted: g.toString() });
    }
    if (p === "/referee/spend") {
      const amount = BigInt(String(body?.["amount"]));
      const allow = body?.["remainder"] === true;
      if (st.earned < amount && (!allow || st.mode === "prelaunch")) return ok({ error: "not enough coins" }, 402);
      const from = st.earned < amount ? st.earned : amount;
      st.earned -= from;
      const rem = amount - from;
      if (rem === 0n) st.purchases[String(body?.["reason"])] = (st.purchases[String(body?.["reason"])] ?? 0) + 1;
      else st.reserved.set(String(body?.["key"]), from);
      return ok({ key: body?.["key"], status: rem > 0n ? "reserved" : "committed", fromEarned: from.toString(), remainder: rem.toString(), balance: balance() });
    }
    if (p === "/referee/spend/commit") {
      st.reserved.delete(String(body?.["key"]));
      return ok({ status: "committed" });
    }
    if (p === "/referee/spend/cancel") {
      st.earned += st.reserved.get(String(body?.["key"])) ?? 0n;
      st.reserved.delete(String(body?.["key"]));
      return ok({ status: "cancelled" });
    }
    if (p === "/referee/claims/release") {
      if (st.mode === "prelaunch") return ok({ error: "coins are play money until the game launches" }, 409);
      const amount = st.earned;
      st.earned = 0n;
      st.claimable += amount;
      if (amount === 0n) return ok({ attestations: [] });
      return ok({ attestations: [{ vault: chain.game.rewardVault, rule: "wave", runId: `0x${"ab".repeat(32)}`, player: A.player, ruleId: 1, amount: amount.toString(), nonce: `0x${"0e".repeat(32)}`, paidEntry: false, expiry: String(Math.floor(Date.now() / 1000) + 900), verified: true, signature: `0x${"11".repeat(65)}` }] });
    }
    if (p === "/referee/claims/return") {
      st.returned.push(...((body?.["nonces"] as string[]) ?? []));
      return ok({ returning: 1 });
    }
    return ok({ error: "unknown" }, 404);
  });
  return { reqs, st, spy, writes: () => reqs.filter((r) => r.method === "POST") };
}

async function live(o: { earned?: bigint; mode?: "live" | "prelaunch"; session?: string | null } = {}) {
  const game = slug();
  const chain = createFakeChain(game);
  const ref = fakeReferee(chain, o);
  // Prime the pool-address cache like any earlier visit.
  await createKit().init({ game, addresses: liveAddresses, transport: chain.transport, store: STORE });
  chain.reset();
  ref.reqs.length = 0;
  const kit = createKit();
  await kit.init({ game, addresses: liveAddresses, transport: chain.transport, store: STORE, provider: chain.wallet, referee: REFEREE, ...(o.session === null ? {} : { session: o.session ?? "tok-1" }) });
  await new Promise((r) => setTimeout(r, 0)); // the metadata fetch settles
  return { kit, chain, ref, game };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("kit.coins: spend ordering (earned first, then the wallet on chain)", () => {
  it("earned coins cover it: one referee POST with the session, no wallet prompt, no RPC", async () => {
    const { kit, chain, ref } = await live({ earned: 30n * E18 });
    expect(kit.coins.balance()).toBe(280); // 30 earned + 250 in the wallet
    chain.reset();
    const r = await kit.coins.spend(20, "revive");
    expect(r).toMatchObject({ fromEarned: 20n * E18, onChain: 0n, coins: 20 });
    // The spend's key is what a room accepts, once, as proof of the paid command.
    expect(r.key).toBe(ref.writes()[0]?.body?.["key"]);
    expect(chain.wallet.sent).toHaveLength(0);
    expect(chain.counts).toEqual({});
    expect(ref.writes().map((w) => [w.path, w.auth])).toEqual([["/referee/spend", "Bearer tok-1"]]);
    expect(kit.coins.earned()).toBe(10);
    expect(kit.coins.purchases("revive")).toBe(1);
  });

  it("short on earned: reserves it, tips only the remainder from the wallet (one confirmation), then commits with the hash", async () => {
    const { kit, chain, ref } = await live({ earned: 4n * E18 });
    chain.reset();
    const r = await kit.coins.spend(10, "revive");
    expect(r).toMatchObject({ fromEarned: 4n * E18, onChain: 6n * E18, coins: 10 });
    expect(chain.wallet.sent).toHaveLength(1); // allowance is ample: no approval
    const d = decodeFunctionData({ abi: gameVaultAbi, data: chain.wallet.sent[0]!.data });
    expect(d.functionName).toBe("tip");
    expect(d.args?.[0]).toBe(6n * E18);
    const writes = ref.writes();
    expect(writes.map((w) => w.path)).toEqual(["/referee/spend", "/referee/spend/commit"]);
    expect(writes[1]?.body?.["txHash"]).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("a paid tip whose commit cannot land now is kept (key + hash) and committed on the next open; it is never cancelled", async () => {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
    const { kit, chain, ref, game } = await live({ earned: 4n * E18 });
    ref.st.status["/referee/spend/commit"] = 429;
    await expect(kit.coins.spend(10, "revive")).rejects.toMatchObject({ code: "REFEREE_REJECTED" });
    expect(ref.writes().map((w) => w.path)).toEqual(["/referee/spend", "/referee/spend/commit"]);
    const first = ref.writes()[1]?.body;
    expect([...mem.keys()].some((k) => k.startsWith("netnet:kit:commits:v1:"))).toBe(true);
    // The next open (a reload): the same key and hash are committed, then the entry goes.
    ref.reqs.length = 0;
    const again = createKit();
    await again.init({ game, addresses: liveAddresses, transport: chain.transport, store: STORE, provider: chain.wallet, referee: REFEREE, session: "tok-1" });
    await vi.waitFor(() => expect(ref.writes().map((w) => w.path)).toEqual(["/referee/spend/commit"]));
    expect(ref.writes()[0]?.body).toMatchObject({ key: first?.["key"], txHash: first?.["txHash"] });
    await vi.waitFor(() => expect([...mem.keys()].some((k) => k.startsWith("netnet:kit:commits:v1:"))).toBe(false));
    vi.unstubAllGlobals();
  });

  it("a rejected chain remainder cancels the reservation: the earned coins are held again", async () => {
    const { kit, chain, ref } = await live({ earned: 4n * E18 });
    chain.wallet.rejectSends = true;
    await expect(kit.coins.spend(10, "revive")).rejects.toMatchObject({ code: "USER_REJECTED" });
    expect(ref.writes().map((w) => w.path)).toEqual(["/referee/spend", "/referee/spend/cancel"]);
    expect(ref.st.earned).toBe(4n * E18);
    expect(kit.coins.earned()).toBe(4);
  });

  it("refuses before any call when earned plus wallet is short", async () => {
    const { kit, chain, ref } = await live({ earned: 1n * E18 });
    chain.reset();
    await expect(kit.coins.spend(10_000, "revive")).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect(ref.writes()).toHaveLength(0);
    expect(chain.counts).toEqual({});
  });

  it("store.buy({ pay: 'coins' }) spends at the SKU's token price and owns it off chain", async () => {
    const { kit, ref } = await live({ earned: 12n * E18 });
    expect(kit.store.count("revive")).toBe(0);
    await kit.store.buy("revive", { pay: "coins" });
    expect(ref.writes()[0]?.body).toMatchObject({ amount: (10n * E18).toString(), reason: "revive" });
    expect(kit.store.count("revive")).toBe(1);
  });
});

describe("kit.coins: wallet coins before graduation (audit 5 L-3)", () => {
  it("a wallet spend and a token store buy throw PRELAUNCH before any prompt, never a raw NotGraduated revert", async () => {
    const game = slug();
    const chain = createFakeChain(game);
    chain.state.graduated = false;
    fakeReferee(chain, { earned: 0n });
    await createKit().init({ game, addresses: liveAddresses, transport: chain.transport, store: STORE });
    const kit = createKit();
    await kit.init({ game, addresses: liveAddresses, transport: chain.transport, store: STORE, provider: chain.wallet, referee: REFEREE, session: "tok-1" });
    await new Promise((r) => setTimeout(r, 0));
    await expect(kit.coins.spend(10, "revive")).rejects.toMatchObject({ code: "PRELAUNCH" });
    await expect(kit.store.buy("revive", { pay: "token" })).rejects.toMatchObject({ code: "PRELAUNCH" });
    expect(chain.wallet.sent).toHaveLength(0);
  });
});

describe("kit.coins: claim", () => {
  it("claims every earned coin: release (session), then one RewardVault transaction", async () => {
    const { kit, chain, ref } = await live({ earned: 7n * E18 });
    expect(await kit.coins.claim()).toBe(7);
    expect(ref.writes()[0]?.path).toBe("/referee/claims/release");
    const d = decodeFunctionData({ abi: rewardVaultAbi, data: chain.wallet.sent.at(-1)!.data });
    expect(d.functionName).toBe("claim");
    expect(d.args?.[0]).toMatchObject({ amount: 7n * E18, verified: true });
  });

  it("never submits an unverified attestation (RewardVault reverts NotVerified, and one sinks a whole claimBatch)", async () => {
    const { kit, chain, ref } = await live({ earned: 3n * E18 });
    const base = { vault: chain.game.rewardVault, rule: "wave", runId: `0x${"ab".repeat(32)}`, player: A.player, ruleId: 1, paidEntry: false, expiry: String(Math.floor(Date.now() / 1000) + 900), signature: `0x${"11".repeat(65)}` };
    const { verified: _omit, ...missing } = { ...base, amount: "5", nonce: `0x${"0c".repeat(32)}`, verified: true };
    ref.spy.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ attestations: [
        { ...base, amount: (3n * E18).toString(), nonce: `0x${"0a".repeat(32)}`, verified: true },
        { ...base, amount: "4", nonce: `0x${"0b".repeat(32)}`, verified: false },
        missing,
      ] }), { status: 200 }),
    );
    expect(await kit.coins.claim()).toBe(3);
    expect(chain.wallet.sent).toHaveLength(1);
    const d = decodeFunctionData({ abi: rewardVaultAbi, data: chain.wallet.sent[0]!.data });
    expect(d.functionName).toBe("claim");
    expect(d.args?.[0]).toMatchObject({ nonce: `0x${"0a".repeat(32)}`, verified: true });
  });

  it("a rejected claim hands the fresh signatures back", async () => {
    const { kit, chain, ref } = await live({ earned: 7n * E18 });
    chain.wallet.rejectSends = true;
    await expect(kit.coins.claim()).rejects.toMatchObject({ code: "USER_REJECTED" });
    expect(ref.writes().map((w) => w.path)).toEqual(["/referee/claims/release", "/referee/claims/return"]);
    expect(ref.st.returned).toEqual([`0x${"0e".repeat(32)}`]);
    expect(kit.earn.pending()).toHaveLength(0);
  });
});

describe("kit.coins: the token's own name, symbol and logo", () => {
  it("live: symbol from the token, name and logo from its contractURI metadata (fetched once)", async () => {
    const { kit, ref } = await live();
    expect(kit.coins.symbol()).toBe("MECH");
    expect(kit.coins.name()).toBe("Mech Pilot Coin");
    expect(kit.coins.logo()).toBe("https://ipfs.io/ipfs/bafy-logo/mech.png");
    await kit.refresh();
    await kit.refresh();
    expect(ref.reqs.filter((r) => r.path.startsWith("ipfs:"))).toHaveLength(1);
  });

  it("mock: the game's own coin, never a generic COIN", async () => {
    const kit = createKit();
    await kit.init({ game: "comet-sweep", mock: true });
    expect(kit.coins.symbol()).toBe("COMET");
    expect(kit.coins.name()).toBe("Comet Sweep");
    const k2 = createKit();
    await k2.init({ game: "comet-sweep", mock: true, mockCoin: { name: "Ember", symbol: "EMBER", logo: "https://example.test/ember.png" } });
    await new Promise((r) => setTimeout(r, 0));
    expect([k2.coins.name(), k2.coins.symbol(), k2.coins.logo()]).toEqual(["Ember", "EMBER", "https://example.test/ember.png"]);
  });
});

describe("kit.coins: pre-launch play money, same API", () => {
  it("balance and spend run on points; buy, claim and cash out wait for launch", async () => {
    const { kit, chain, ref } = await live({ earned: 20n * E18, mode: "prelaunch" });
    expect(kit.coins.mode()).toBe("prelaunch");
    expect(kit.coins.balance()).toBe(20); // the wallet's tokens are not play money
    await kit.coins.spend(5, "revive");
    expect(ref.writes()[0]?.body?.["remainder"]).toBe(false);
    expect(kit.coins.balance()).toBe(15);
    await expect(kit.coins.spend(50, "revive")).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    await expect(kit.coins.buy(5)).rejects.toMatchObject({ code: "PRELAUNCH" });
    await expect(kit.coins.claim()).rejects.toMatchObject({ code: "PRELAUNCH" });
    await expect(kit.coins.cashOut(5)).rejects.toMatchObject({ code: "PRELAUNCH" });
    expect(chain.wallet.sent).toHaveLength(0);
  });

  it("mock pre-launch behaves the same", async () => {
    const kit = createKit();
    await kit.init({ game: "comet-sweep", mock: true, mockMode: "prelaunch", mockBalances: { earned: 8 } });
    expect(kit.coins.balance()).toBe(8);
    await kit.coins.spend(3, "revive");
    expect(kit.coins.balance()).toBe(5);
    await expect(kit.coins.claim()).rejects.toMatchObject({ code: "PRELAUNCH" });
  });
});

describe("kit.coins: adversarial inputs", () => {
  it("refuses zero, negative, non-numeric amounts and bad reasons before any call", async () => {
    const { kit, chain, ref } = await live({ earned: 5n * E18 });
    chain.reset();
    for (const a of [0, -1, "-5", "1e3", "abc", 0n, -2n, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(kit.coins.spend(a as never, "revive")).rejects.toMatchObject({ code: "BAD_AMOUNT" });
    }
    await expect(kit.coins.spend(1, "Revive Now")).rejects.toMatchObject({ code: "BAD_AMOUNT" });
    expect(ref.writes()).toHaveLength(0);
    expect(chain.counts).toEqual({});
  });

  it("drops released attestations for another wallet or vault (a hostile referee cannot redirect a claim)", async () => {
    const { kit, chain, ref } = await live({ earned: 3n * E18 });
    ref.spy.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ attestations: [{ vault: A.zap, rule: "wave", runId: `0x${"ab".repeat(32)}`, player: A.player, ruleId: 1, amount: "1", nonce: `0x${"0f".repeat(32)}`, paidEntry: false, expiry: String(Math.floor(Date.now() / 1000) + 900), verified: true, signature: `0x${"11".repeat(65)}` }] }), { status: 200 }),
    );
    await expect(kit.coins.claim()).rejects.toMatchObject({ code: "NOTHING_TO_CLAIM" });
    expect(chain.wallet.sent).toHaveLength(0);
  });
});

describe("the referee session", () => {
  it("BYO report() carries the session (it was a 401 without one)", async () => {
    const { kit, ref } = await live();
    const r = await kit.earn.report({ event: "wave_cleared", n: 2 });
    expect(r).toMatchObject({ granted: true, tokens: 2 });
    const w = ref.writes()[0];
    expect(w?.path).toBe("/referee/report");
    expect(w?.auth).toBe("Bearer tok-1");
    // Held: spendable at once, no extra call.
    expect(kit.coins.earned()).toBe(2);
  });

  it("an unverified game (ruled 2026-10-20): the referee grants nothing and the Kit passes its notice on", async () => {
    const { kit, ref } = await live();
    ref.spy.mockImplementationOnce(async () => new Response(JSON.stringify({ attestations: [], granted: "0", rewards: "unverified", notice: "Rewards need a verified build." }), { status: 200 }));
    const r = await kit.earn.report({ event: "wave_cleared", n: 2 });
    expect(r).toEqual({ granted: false, amount: 0n, tokens: 0, rewards: "unverified", notice: "Rewards need a verified build." });
    expect(kit.coins.earned()).toBe(0);
  });

  it("the Kit never invents a class: an unknown value from the referee is dropped", async () => {
    const { kit, ref } = await live();
    ref.spy.mockImplementationOnce(async () => new Response(JSON.stringify({ attestations: [], granted: "0", rewards: "trusted" }), { status: 200 }));
    const r = await kit.earn.report({ event: "wave_cleared" });
    expect(r.rewards).toBeUndefined();
  });

  it("with no session the Kit signs in once (SIWE for the referee's domain), then reports", async () => {
    const { kit, chain, ref } = await live({ session: null });
    await kit.earn.report({ event: "wave_cleared" });
    expect(ref.reqs.map((r) => r.path).filter((p) => !p.startsWith("ipfs:") && !p.startsWith("/referee/coins"))).toEqual(["/auth/nonce", "/auth/sign-in", "/referee/report"]);
    expect(chain.wallet.signed).toHaveLength(1);
    expect(chain.wallet.signed[0]).toMatch(/^play\.example wants you to sign in/);
    expect(ref.writes().at(-1)?.auth).toBe("Bearer tok-2");
    expect(kit.wallet.session()).toBe("tok-2");
    await kit.earn.report({ event: "wave_cleared" });
    expect(chain.wallet.signed).toHaveLength(1);
  });

  it("a lapsed session (401) signs in again once and retries", async () => {
    const { kit, chain, ref } = await live({ session: "stale" });
    await kit.coins.spend(1, "revive").catch(() => undefined);
    expect(chain.wallet.signed).toHaveLength(1);
    expect(ref.writes().filter((w) => w.path === "/referee/spend").map((w) => w.auth)).toEqual(["Bearer stale", "Bearer tok-2"]);
  });
});

describe("the call budget is unchanged", () => {
  it("open: one eth_call; the referee ledger and metadata are HTTP, not RPC; idle and every getter: zero", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { kit, chain, ref } = await live({ earned: 5n * E18 });
    expect(chain.counts).toEqual({ eth_call: 1 });
    expect(ref.reqs.map((r) => r.path)).toEqual([`/referee/coins/${kit.getState().game}/${A.player}`, "ipfs:/ipfs/bafy-mech/contract.json"]);
    chain.reset();
    ref.reqs.length = 0;
    for (let f = 0; f < 600; f++) {
      kit.coins.balance();
      kit.coins.earned();
      kit.coins.symbol();
      kit.coins.logo();
      kit.store.owns("revive");
    }
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(chain.counts).toEqual({});
    expect(ref.reqs).toHaveLength(0);
  });

  it("a game with no wallet makes no referee call", async () => {
    const game = slug();
    const chain = createFakeChain(game);
    const ref = fakeReferee(chain);
    await createKit().init({ game, addresses: liveAddresses, transport: chain.transport, store: STORE, referee: REFEREE });
    expect(ref.reqs.filter((r) => r.path.startsWith("/referee"))).toHaveLength(0);
  });
});
