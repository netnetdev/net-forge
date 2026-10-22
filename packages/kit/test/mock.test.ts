// Mock mode: the whole API with no chain and no network.

import { describe, expect, it, vi } from "vitest";
import { createKit } from "../src/kit.js";
import { MOCK_ACCOUNT } from "../src/mock.js";

const STORE = [
  { id: "revive", kind: "consumable", priceUsdg: "0.25", priceToken: "5" },
  { id: "skin_gold", kind: "permanent", priceUsdg: "1.00" },
] as const;

describe("mock mode", () => {
  it("runs the full loop with zero network calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const kit = createKit();
    const seen: number[] = [];
    kit.subscribe(() => seen.push(kit.getState().updatedAt));
    await kit.init({ game: "comet-sweep", mock: true, store: STORE });
    expect(kit.getState().mode).toBe("mock");
    expect(kit.wallet.address()).toBe(MOCK_ACCOUNT);
    expect(kit.token.balance()).toBe(100);
    expect(kit.token.priceUsd()).toBeCloseTo(0.06, 10);

    const earned = await kit.earn.report({ event: "wave_cleared", n: 3 });
    expect(earned).toMatchObject({ granted: true, tokens: 3 });
    // Earned coins are held by the referee (spendable), not yet signed.
    expect(kit.earn.pending()).toHaveLength(0);
    expect(kit.coins.earned()).toBe(3);
    expect(kit.coins.balance()).toBe(103);
    expect(await kit.earn.claimAll()).toBe(3);
    expect(kit.token.balance()).toBe(103);
    expect(kit.coins.earned()).toBe(0);

    await kit.token.spend(5, "revive");
    expect(kit.token.balance()).toBe(98);

    await kit.store.buy("skin_gold");
    expect(kit.store.owns("skin_gold")).toBe(true);
    expect(kit.getState().usdg).toBe(24_000_000n);
    // A permanent item already owned is not bought twice.
    await kit.store.buy("skin_gold");
    expect(kit.getState().usdg).toBe(24_000_000n);

    await kit.store.buy("revive", { pay: "token" });
    expect(kit.store.count("revive")).toBe(1);
    expect(kit.token.balance()).toBe(93);

    const q = kit.token.quoteBuy(10);
    await kit.token.buy(10);
    expect(kit.token.balance()).toBeCloseTo(93 + q.tokens, 6);

    const c = kit.token.quoteCashOut(50);
    const before = kit.getState().usdg;
    await kit.token.cashOut(50);
    expect(kit.getState().usdg - before).toBe(c.usdgOut);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(seen.length).toBeGreaterThan(5);
  });

  it("errors are typed with a fix", async () => {
    const kit = createKit();
    await expect(kit.init({ game: "Bad Slug" })).rejects.toMatchObject({ code: "BAD_GAME_SLUG" });
    expect(() => kit.token.quoteBuy(1)).toThrow(/NOT_INITIALIZED/);
    await kit.init({ game: "comet-sweep", mock: true, store: STORE });
    await expect(kit.store.buy("nope")).rejects.toMatchObject({ code: "UNKNOWN_SKU" });
    await expect(kit.token.spend(1e9, "revive")).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    await expect(kit.token.spend(1, "Not An Id")).rejects.toMatchObject({ code: "BAD_AMOUNT" });
    try {
      await kit.store.buy("nope");
    } catch (e) {
      expect((e as { fix: string }).fix.length).toBeGreaterThan(10);
    }
  });

  it("init is idempotent for the same game (React StrictMode) and refuses a second game", async () => {
    const kit = createKit();
    const a = kit.init({ game: "comet-sweep", mock: true });
    const b = kit.init({ game: "comet-sweep", mock: true });
    expect(a).toBe(b);
    await a;
    await expect(kit.init({ game: "other-game", mock: true })).rejects.toMatchObject({ code: "ALREADY_INITIALIZED" });
  });
});
