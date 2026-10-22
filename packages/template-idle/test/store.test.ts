import { describe, expect, it } from "vitest";
import { COSMETICS, idleAdapter, idleManifest } from "../src/manifest.js";
import { BRINE_COIN, COIN_PRICES, COSMETIC_SKUS, mockKit, UPGRADE_SKUS } from "../src/store.js";

describe("BRINEWORKS store: priced in coins", () => {
  it("the game module prices every item in coins, at the prices the client shows", () => {
    const skus = Object.fromEntries(idleManifest().skus);
    for (const [id, coins] of Object.entries(COIN_PRICES)) expect(skus[id]?.coins).toBe(coins);
    expect(skus.brass_bellows?.grants).toEqual({ gear: "bellows", loseBelow: 0.25 });
    for (const id of UPGRADE_SKUS) expect(idleManifest().upgrades.has(id)).toBe(true);
    for (const id of COSMETIC_SKUS) expect(COSMETICS[id]).toBeGreaterThan(0);
  });

  it("a shift upgrade is one level, capped; finishes are looks", () => {
    const sim = idleAdapter();
    const w = sim.createWorld(1, "server");
    sim.addPlayer(w, 1);
    expect(sim.command?.(w, 1, { name: "bellows" })).toBe(true);
    expect(sim.command?.(w, 1, { name: "bellows" })).toBe(false);
    expect(sim.command?.(w, 1, { name: "cosmetic", value: 1 })).toBe(true);
    expect(w.avatars.get(1)?.cosmetic).toBe(1);
  });

  it("the coin carries the token's own name, symbol and logo", () => {
    const kit = mockKit({ earned: 0, wallet: 0, usdg: 0 }, {}, BRINE_COIN);
    expect(kit.coins.symbol()).toBe("BRINE");
    expect(kit.coins.logo()).toMatch(/^data:image\/svg\+xml/);
  });
});
