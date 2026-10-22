import { describe, expect, it } from "vitest";
import { cardsAdapter, cardsManifest, COSMETICS } from "../src/manifest.js";
import { COIN_PRICES, COSMETIC_SKUS, INKWRIT_COIN, mockKit, UPGRADE_SKUS } from "../src/store.js";

describe("INKWRIT store: priced in coins", () => {
  it("the game module prices every item in coins, at the prices the client shows", () => {
    const skus = Object.fromEntries(cardsManifest().skus);
    expect(skus).toEqual({
      thick_vellum: { coins: 40 },
      sharp_nib: { coins: 60 },
      quick_ink: { coins: 40 },
      spare_page: { coins: 50 },
      skin_vermilion: { coins: 300, grants: { cosmetic: 1 } },
      skin_gold_leaf: { coins: 500, grants: { cosmetic: 2 } },
      bound_folio: { coins: 120, grants: { gear: "thick_vellum", loseBelow: 0.25 } },
    });
    for (const [id, coins] of Object.entries(COIN_PRICES)) expect(skus[id]?.coins).toBe(coins);
    for (const id of UPGRADE_SKUS) expect(cardsManifest().upgrades.has(id)).toBe(true);
    for (const id of COSMETIC_SKUS) expect(COSMETICS[id]).toBeGreaterThan(0);
  });

  it("a run upgrade is one level for the run; thick vellum raises the hero's health in the next duel", () => {
    const sim = cardsAdapter();
    const w = sim.createWorld(3, "server");
    sim.addPlayer(w, 1);
    sim.addPlayer(w, 2);
    expect(sim.command?.(w, 1, { name: "thick_vellum" })).toBe(true);
    expect(sim.command?.(w, 1, { name: "thick_vellum" })).toBe(false);
    for (let t = 0; t < 200 && w.state?.stage !== "duel"; t++) sim.step(w, new Map());
    const side = w.state?.duel?.sides.find((s) => s.player === 1);
    expect(side?.heroMax).toBe(25);
  });

  it("the coin carries the token's own name, symbol and logo", () => {
    const kit = mockKit({ earned: 0, wallet: 0, usdg: 0 }, {}, INKWRIT_COIN);
    expect(kit.coins.symbol()).toBe("INK");
    expect(kit.coins.logo()).toMatch(/^data:image\/svg\+xml/);
  });
});
