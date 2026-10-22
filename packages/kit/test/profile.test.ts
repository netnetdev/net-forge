// kit.profile: the player's saves kept by the referee, the coin
// model's permanent store, lazy loading (no read, no call), and the
// guest merge at sign-in.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createKit } from "../src/kit.js";
import { parseProfile } from "../src/profile.js";
import { A, createFakeChain, E18, liveAddresses, STORE } from "./fake-chain.js";

let n = 0;
const slug = () => `profile-game-${++n}`;
const REFEREE = "https://rooms.example";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("kit.profile in mock mode", () => {
  it("buys a look, an unlock and a meta level with coins; settings and names round-trip", async () => {
    const kit = createKit();
    await kit.init({
      game: slug(),
      mock: true,
      mockBalances: { earned: 1000 },
      mockProfile: {
        keepers: ["lamp"],
        store: [
          { id: "skin_gold", kind: "cosmetic", coins: 300, owned: false, cosmetic: 1 },
          { id: "unlock_ranger", kind: "unlock", coins: 400, owned: false, keeper: "ranger" },
          { id: "hearth", kind: "meta", coins: 100, owned: false, stat: "maxHealth", step: 0.05, level: 0, levels: 3, bonus: 0 },
        ],
      },
    });
    expect(kit.profile.get()).toBeNull(); // the first read starts the load
    await vi.waitFor(() => expect(kit.profile.get()).not.toBeNull());
    expect(kit.profile.store().map((i) => i.id)).toEqual(["skin_gold", "unlock_ranger", "hearth"]);
    await kit.profile.buy("skin_gold");
    await kit.profile.buy("unlock_ranger");
    await kit.profile.buy("hearth");
    expect(kit.profile.owns("skin_gold")).toBe(true);
    expect(kit.profile.get()?.keepers).toEqual(["lamp", "ranger"]);
    expect(kit.profile.level("hearth")).toBe(1);
    expect(kit.coins.earned()).toBe(1000 - 300 - 400 - 100);
    await expect(kit.profile.buy("skin_gold")).rejects.toMatchObject({ code: "SKU_NOT_PRICED" });
    await kit.profile.setSettings({ keeper: "ranger" });
    expect(kit.profile.get()?.settings).toEqual({ keeper: "ranger" });
    await kit.profile.setName("Nova");
    expect(kit.profile.get()?.displayName).toBe("Nova");
  });
});

describe("kit.profile live: HTTP to the referee, never RPC, never before it is read", () => {
  function referee() {
    const reqs: { method: string; path: string; auth: string | null; guest: string | null; body: Record<string, unknown> | null }[] = [];
    const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, i) => {
      const url = new URL(String(input));
      const headers = new Headers(i?.headers);
      const body = typeof i?.body === "string" ? (JSON.parse(i.body) as Record<string, unknown>) : null;
      reqs.push({ method: i?.method ?? "GET", path: url.pathname, auth: headers.get("authorization"), guest: headers.get("x-guest-id"), body });
      const p = url.pathname;
      if (p.startsWith("/profile/game/")) return ok({ game: p.split("/")[3], kind: headers.get("authorization") ? "wallet" : "guest", achievements: [{ id: "ember", at: 1, source: "sim" }], keepers: ["lamp", "spark"], goals: { day: 1, today: ["tide"], done: [] } });
      if (p.startsWith("/referee/coins/")) return ok({ mode: "live", earned: "0", claimable: "0", returning: "0", reserved: "0", purchases: {} });
      return ok({ error: "unknown" }, 404);
    });
    return reqs;
  }

  it("a game that never reads kit.profile makes no profile call; the first read makes one GET as the guest", async () => {
    const game = slug();
    const chain = createFakeChain(game);
    const reqs = referee();
    const kit = createKit();
    await kit.init({ game, addresses: liveAddresses, transport: chain.transport, store: STORE, referee: REFEREE });
    expect(reqs.filter((r) => r.path.startsWith("/profile"))).toHaveLength(0);
    const rpcBefore = chain.counts.eth_call ?? 0;
    kit.profile.get();
    kit.profile.achieved("ember");
    await vi.waitFor(() => expect(kit.profile.achieved("ember")).toBe(true));
    const calls = reqs.filter((r) => r.path.startsWith("/profile"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "GET", auth: null, guest: kit.profile.guestId() });
    expect(chain.counts.eth_call ?? 0).toBe(rpcBefore); // no chain read for saves
    expect(kit.profile.get()?.keepers).toEqual(["lamp", "spark"]);
  });
});

describe("kit.profile.buy: one at a time, priced fresh, retried, never with play money", () => {
  it("in mock mode before launch, play money never buys a permanent item", async () => {
    const kit = createKit();
    await kit.init({ game: slug(), mock: true, mockMode: "prelaunch", mockBalances: { earned: 1000 }, mockProfile: { store: [{ id: "skin_gold", kind: "cosmetic", coins: 300, owned: false, cosmetic: 1 }] } });
    await expect(kit.profile.buy("skin_gold")).rejects.toMatchObject({ code: "PRELAUNCH" });
  });

  it("serializes buys of one item, refreshes the price first, and retries a redeem that never reached the referee with the same key", async () => {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
    const game = slug();
    const chain = createFakeChain(game);
    const reqs: { path: string; body: Record<string, unknown> | null }[] = [];
    let owned = false;
    let dropNextRedeem = true;
    const profile = () => ({ game, kind: "wallet", keepers: ["lamp"], owned: owned ? ["skin_gold"] : [], store: [{ id: "skin_gold", kind: "cosmetic", coins: owned ? null : 300, owned, cosmetic: 1 }], credit: 0 });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, i) => {
      const url = new URL(String(input));
      const body = typeof i?.body === "string" ? (JSON.parse(i.body) as Record<string, unknown>) : null;
      reqs.push({ path: url.pathname, body });
      const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (url.pathname.startsWith("/referee/coins/")) return ok({ mode: "live", earned: (1000n * E18).toString(), claimable: "0", returning: "0", reserved: "0", purchases: {} });
      if (url.pathname === "/referee/spend") return ok({ key: body?.["key"], status: "committed", fromEarned: body?.["amount"], remainder: "0" });
      if (url.pathname.startsWith("/profile/game/")) return ok(profile());
      if (url.pathname === "/profile/redeem") {
        if (dropNextRedeem) {
          dropNextRedeem = false;
          throw new TypeError("network down");
        }
        owned = true;
        return ok(profile());
      }
      return new Response(JSON.stringify({ error: "unknown" }), { status: 404 });
    });
    const kit = createKit();
    await kit.init({ game, addresses: liveAddresses, transport: chain.transport, store: STORE, provider: chain.wallet, referee: REFEREE, session: "tok-1" });
    await expect(kit.profile.buy("skin_gold")).rejects.toMatchObject({ code: "REFEREE_REJECTED" });
    const spends = () => reqs.filter((r) => r.path === "/referee/spend");
    expect(spends()).toHaveLength(1);
    const key = spends()[0]?.body?.["key"];
    // Two taps at once: one buy; it retries the same spend's redeem and spends nothing new.
    const [a, b] = [kit.profile.buy("skin_gold"), kit.profile.buy("skin_gold")];
    expect(a).toBe(b);
    expect((await a).owned).toEqual(["skin_gold"]);
    expect(spends()).toHaveLength(1);
    const redeems = reqs.filter((r) => r.path === "/profile/redeem");
    expect(redeems.map((r) => r.body?.["key"])).toEqual([key, key]);
    // The price was read fresh (a profile GET) before the first spend.
    expect(reqs.findIndex((r) => r.path.startsWith("/profile/game/"))).toBeLessThan(reqs.findIndex((r) => r.path === "/referee/spend"));
    vi.unstubAllGlobals();
  });
});

describe("kit.profile.buy keeps the spend key until the referee settles it", () => {
  async function liveKit(redeem: (n: number, body: Record<string, unknown> | null) => Response) {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
    const game = slug();
    const chain = createFakeChain(game);
    const reqs: { path: string; body: Record<string, unknown> | null }[] = [];
    let redeems = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, i) => {
      const url = new URL(String(input));
      const body = typeof i?.body === "string" ? (JSON.parse(i.body) as Record<string, unknown>) : null;
      reqs.push({ path: url.pathname, body });
      const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (url.pathname.startsWith("/referee/coins/")) return ok({ mode: "live", earned: (1000n * E18).toString(), claimable: "0", returning: "0", reserved: "0", purchases: {} });
      if (url.pathname === "/referee/spend") return ok({ key: body?.["key"], status: "committed", fromEarned: body?.["amount"], remainder: "0" });
      if (url.pathname.startsWith("/profile/game/")) return ok({ game, kind: "wallet", store: [{ id: "skin_gold", kind: "cosmetic", coins: 300, owned: false, cosmetic: 1 }], credit: 0 });
      if (url.pathname === "/profile/redeem") return redeem(++redeems, body);
      return new Response(JSON.stringify({ error: "unknown" }), { status: 404 });
    });
    const kit = createKit();
    await kit.init({ game, addresses: liveAddresses, transport: chain.transport, store: STORE, provider: chain.wallet, referee: REFEREE, session: "tok-1" });
    return { kit, reqs, spends: () => reqs.filter((r) => r.path === "/referee/spend") };
  }
  const owned = (game = "g") => new Response(JSON.stringify({ game, kind: "wallet", owned: ["skin_gold"], store: [{ id: "skin_gold", kind: "cosmetic", coins: null, owned: true }], credit: 0 }), { status: 200 });

  it("a 429 (or a 5xx) keeps the key; the retry redeems the same spend, with no second spend", async () => {
    const { kit, reqs, spends } = await liveKit((n) => (n === 1 ? new Response(JSON.stringify({ error: "slow down" }), { status: 429 }) : n === 2 ? new Response("{}", { status: 503 }) : owned()));
    await expect(kit.profile.buy("skin_gold")).rejects.toMatchObject({ code: "REFEREE_REJECTED" });
    await expect(kit.profile.buy("skin_gold")).rejects.toMatchObject({ code: "REFEREE_REJECTED" });
    expect((await kit.profile.buy("skin_gold")).owned).toEqual(["skin_gold"]);
    expect(spends()).toHaveLength(1);
    const keys = reqs.filter((r) => r.path === "/profile/redeem").map((r) => r.body?.["key"]);
    expect(new Set(keys).size).toBe(1);
    vi.unstubAllGlobals();
  });

  it("a refund answer (the coins were returned) clears the key: the next buy pays afresh", async () => {
    const { kit, spends } = await liveKit((n) => (n === 1 ? new Response(JSON.stringify({ error: '"skin_gold" costs 300 coins now; the coins were returned' }), { status: 402 }) : owned()));
    await expect(kit.profile.buy("skin_gold")).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect((await kit.profile.buy("skin_gold")).owned).toEqual(["skin_gold"]);
    expect(spends()).toHaveLength(2);
    vi.unstubAllGlobals();
  });
});

describe("parseProfile: the referee's JSON is untrusted", () => {
  it("drops malformed ids, keeps numbers numeric", () => {
    const p = parseProfile({ kind: "admin", achievements: [{ id: "<x>" }, { id: "ember", at: 2 }], keepers: ["ok", 5, "Bad Id"], meta: { hearth: 2, bad: -1 }, store: [{ id: "s", kind: "meta", coins: 10 }, { id: "x", kind: "weird" }] });
    expect(p.kind).toBeNull();
    expect(p.achievements).toEqual([{ id: "ember", at: 2, source: "sim" }]);
    expect(p.keepers).toEqual(["ok"]);
    expect(p.meta).toEqual({ hearth: 2 });
    expect(p.store).toEqual([{ id: "s", kind: "meta", coins: 10, owned: false }]);
  });
});

void A;
void E18;
