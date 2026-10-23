import { describe, expect, it } from "vitest";
import { initSim, PLAT_STATS } from "@netforge/engine-sim";
import { PF } from "@netforge/engine/game";
import { COSMETICS, platformerAdapter, platformerGame } from "../src/manifest.js";
import { COIN_PRICES, COSMETIC_SKUS, mockKit, PLUME_COIN, UPGRADE_SKUS } from "../src/store.js";

describe("SKYLEDGE store: priced in coins", () => {
  it("the game module prices every item in coins, at the prices the client shows", () => {
    const skus = Object.fromEntries(platformerGame().manifest.skus);
    expect(skus).toEqual({
      feather: { coins: 40 },
      sprint: { coins: 40 },
      shield: { coins: 60 },
      skin_sunset: { coins: 300, grants: { cosmetic: 1 } },
      skin_frost: { coins: 500, grants: { cosmetic: 2 } },
      shield_charm: { coins: 120, grants: { gear: "shield", loseBelow: 0.25 } },
    });
    for (const [id, coins] of Object.entries(COIN_PRICES)) expect(skus[id]?.coins).toBe(coins);
    for (const id of UPGRADE_SKUS) expect(platformerGame().upgradeIds).toContain(id);
    for (const id of COSMETIC_SKUS) expect(COSMETICS[id]).toBeGreaterThan(0);
  });

  it("earned coins are spent first, then the wallet", async () => {
    const kit = mockKit({ earned: 30, wallet: 40, usdg: 0 }, Object.fromEntries(platformerGame().manifest.skus));
    expect(kit.coins.balance()).toBe(70);
    expect(await kit.coins.spend(COIN_PRICES.feather, "feather")).toMatchObject({ fromEarned: 30, onChain: 10 });
    expect(kit.coins.balance()).toBe(30);
    await expect(kit.coins.spend(COIN_PRICES.shield, "shield")).rejects.toThrow(/cannot spend/);
  });

  it("the coin carries the token's own name, symbol and logo, never a generic COIN", () => {
    const kit = mockKit({ earned: 0, wallet: 0, usdg: 0 }, {});
    expect([kit.coins.name(), kit.coins.symbol()]).toEqual(["Plume", "PLUME"]);
    expect(kit.coins.logo()).toBe(PLUME_COIN.logo);
  });

  it("the room applies a paid upgrade once a round, gear by its upgrade, and an outfit as a cosmetic", async () => {
    await initSim();
    const sim = platformerAdapter();
    const w = sim.createWorld(1, "server");
    sim.addPlayer(w, 1);
    const level = (stat: string) => {
      const v = sim.snapshot(w).find((e) => e.owner === 1)?.values[PF.stats] ?? 0;
      return (v >>> (PLAT_STATS.indexOf(stat as never) * 4)) & 0xf;
    };
    expect(sim.command?.(w, 1, { name: "feather" })).toBe(true);
    expect(level("amount")).toBe(1);
    expect(sim.command?.(w, 1, { name: "feather" })).toBe(false);
    expect(sim.command?.(w, 1, { name: "shield" })).toBe(true);
    expect(level("maxHealth")).toBe(1);
    expect(sim.command?.(w, 1, { name: "not_an_item" })).toBe(false);
    expect(sim.command?.(w, 1, { name: "cosmetic", value: COSMETICS.skin_frost ?? 0 })).toBe(true);
    expect((sim.snapshot(w).find((e) => e.owner === 1)?.values[PF.cosmetic] ?? 0) & 0xff).toBe(2);
  });
});
