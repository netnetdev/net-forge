import { describe, expect, it } from "vitest";
import { collectorAdapter, collectorManifest, COSMETICS } from "../src/manifest.js";
import { COIN_PRICES, COSMETIC_SKUS, mockKit, MOSSBOUND_COIN, UPGRADE_SKUS } from "../src/store.js";

describe("MOSSBOUND store: priced in coins", () => {
  it("the game module prices every item in coins, at the prices the client shows", () => {
    const skus = Object.fromEntries(collectorManifest().skus);
    expect(skus).toEqual({
      thornbark: { coins: 40 },
      mossmail: { coins: 40 },
      spare_snares: { coins: 60 },
      fen_tonic: { coins: 50 },
      skin_lichen: { coins: 300, grants: { cosmetic: 1 } },
      skin_amber: { coins: 500, grants: { cosmetic: 2 } },
      lucky_reed: { coins: 150, grants: { gear: "thornbark", loseBelow: 0.25 } },
    });
    for (const [id, coins] of Object.entries(COIN_PRICES)) expect(skus[id]?.coins).toBe(coins);
    for (const id of UPGRADE_SKUS) expect(collectorManifest().upgrades.has(id)).toBe(true);
    for (const id of COSMETIC_SKUS) expect(COSMETICS[id]).toBeGreaterThan(0);
  });

  it("run upgrades are one level, capped; spare snares arrive on the next tick", () => {
    const sim = collectorAdapter();
    const w = sim.createWorld(1, "server");
    sim.addPlayer(w, 1);
    const before = w.state?.keepers.get(1)?.snares ?? 0;
    expect(sim.command?.(w, 1, { name: "spare_snares" })).toBe(true);
    expect(sim.command?.(w, 1, { name: "spare_snares" })).toBe(false);
    sim.step(w, new Map());
    expect(w.state?.keepers.get(1)?.snares).toBe(before + 3);
    expect(sim.command?.(w, 1, { name: "cosmetic", value: 1 })).toBe(true);
    expect(sim.command?.(w, 1, { name: "nope" })).toBe(false);
  });

  it("the coin carries the token's own name, symbol and logo", () => {
    const kit = mockKit({ earned: 0, wallet: 0, usdg: 0 }, {}, MOSSBOUND_COIN);
    expect(kit.coins.symbol()).toBe("MOSS");
    expect(kit.coins.logo()).toMatch(/^data:image\/svg\+xml/);
  });
});
