import { describe, expect, it } from "vitest";
import { COSMETICS, towerAdapter, towerManifest } from "../src/manifest.js";
import { COGSPIRE_COIN, COIN_PRICES, COSMETIC_SKUS, mockKit, UPGRADE_SKUS } from "../src/store.js";

describe("COGSPIRE store: priced in coins", () => {
  it("the game module prices every item in coins, at the prices the client shows", () => {
    const skus = Object.fromEntries(towerManifest().skus);
    expect(skus).toEqual({
      overclock: { coins: 40 },
      tempered_brass: { coins: 40 },
      spyglass: { coins: 60 },
      spare_bell: { coins: 50 },
      skin_verdigris: { coins: 300, grants: { cosmetic: 1 } },
      skin_gilt: { coins: 500, grants: { cosmetic: 2 } },
      brass_gear: { coins: 150, grants: { gear: "tempered_brass", loseBelow: 0.25 } },
    });
    for (const [id, coins] of Object.entries(COIN_PRICES)) expect(skus[id]?.coins).toBe(coins);
    for (const id of UPGRADE_SKUS) expect(towerManifest().upgrades.has(id)).toBe(true);
    for (const id of COSMETIC_SKUS) expect(COSMETICS[id]).toBeGreaterThan(0);
  });

  it("earned coins are spent first, then the wallet", async () => {
    const kit = mockKit({ earned: 30, wallet: 40, usdg: 0 }, Object.fromEntries(towerManifest().skus), COGSPIRE_COIN);
    expect(await kit.coins.spend(COIN_PRICES.overclock, "overclock")).toMatchObject({ fromEarned: 30, onChain: 10 });
    expect(kit.coins.balance()).toBe(30);
  });

  it("a run upgrade is one level for the run, capped; a finish is a look; gear is the room's to issue", () => {
    const sim = towerAdapter();
    const w = sim.createWorld(1, "server");
    sim.addPlayer(w, 1);
    expect(sim.command?.(w, 1, { name: "overclock" })).toBe(true);
    expect(sim.command?.(w, 1, { name: "overclock" })).toBe(false);
    expect(w.upgrades.get(1)?.get("overclock")).toBe(1);
    // The bells upgrade raises the team's lives on the next tick.
    const before = w.state?.lives ?? 0;
    expect(sim.command?.(w, 1, { name: "spare_bell" })).toBe(true);
    sim.step(w, new Map());
    expect(w.state?.lives).toBe(before + 5);
    expect(sim.command?.(w, 1, { name: "cosmetic", value: 2 })).toBe(true);
    expect(w.avatars.get(1)?.cosmetic).toBe(2);
    // Gear names its upgrade; the room issues it at a staked run's start (tempered_brass is also a SKU here).
    expect(sim.command?.(w, 1, { name: "tempered_brass" })).toBe(true);
    expect(sim.command?.(w, 1, { name: "not_a_thing" })).toBe(false);
  });

  it("the coin carries the token's own name, symbol and logo, never a generic COIN", () => {
    const kit = mockKit({ earned: 0, wallet: 0, usdg: 0 }, {}, COGSPIRE_COIN);
    expect(kit.coins.symbol()).toBe("COG");
    expect(kit.coins.name()).toBe("Cog");
    expect(kit.coins.logo()).toMatch(/^data:image\/svg\+xml/);
  });
});
