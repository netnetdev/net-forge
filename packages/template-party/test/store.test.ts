import { describe, expect, it } from "vitest";
import { partyGame } from "../src/manifest.js";
import { COIN_PRICES, COSMETIC_PRICE, ROMP_COIN, mockKit, REVIVE_PRICE } from "../src/store.js";

describe("ROMPHOUSE store: priced in coins", () => {
  it("the game module prices the revive and the cosmetic in coins, at the prices the client shows", () => {
    const skus = Object.fromEntries(partyGame().manifest.skus);
    expect(skus).toEqual({ revive: { coins: 50 }, skin_disco: { coins: 300, grants: { cosmetic: 1 } }, lucky_charm: { coins: 150, grants: { gear: "lucky_sock", loseBelow: 0.25 } } });
    expect(REVIVE_PRICE).toBe(50);
    expect(COSMETIC_PRICE).toBe(300);
    for (const [id, coins] of Object.entries(COIN_PRICES)) expect(skus[id]?.coins).toBe(coins);
  });

  it("earned coins are spent first, then the wallet", async () => {
    const kit = mockKit({ earned: 30, wallet: 40, usdg: 0 }, Object.fromEntries(partyGame().manifest.skus));
    expect(kit.coins.balance()).toBe(70);
    expect(await kit.coins.spend(REVIVE_PRICE, "revive")).toMatchObject({ fromEarned: 30, onChain: 20 });
    expect(kit.earned()).toBe(0);
    expect(kit.coins.balance()).toBe(20);
    await expect(kit.coins.spend(REVIVE_PRICE, "revive")).rejects.toThrow(/cannot spend/);
  });

  it("the cosmetic is bought with coins and owned", async () => {
    const kit = mockKit({ earned: 300, wallet: 0, usdg: 0 }, Object.fromEntries(partyGame().manifest.skus));
    await kit.store.buy("skin_disco", { pay: "coins" });
    expect(kit.store.owns("skin_disco")).toBe(true);
    expect(kit.coins.balance()).toBe(0);
  });

  it("the coin carries the token's own name, symbol and logo, never a generic COIN", () => {
    const kit = mockKit({ earned: 0, wallet: 0, usdg: 0 }, {});
    expect([kit.coins.name(), kit.coins.symbol()]).toEqual(["Romp", "ROMP"]);
    expect(kit.coins.logo()).toBe(ROMP_COIN.logo);
    expect(kit.coins.symbol()).not.toMatch(/^coins?$/i);
  });
});
