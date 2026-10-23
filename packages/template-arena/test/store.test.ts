import { describe, expect, it } from "vitest";
import { initSim, listPlayers } from "@netforge/engine-sim";
import { arenaAdapter, arenaGame, COSMETICS } from "../src/manifest.js";
import { COIN_PRICES, COSMETIC_SKUS, mockKit, UPGRADE_SKUS, VOLT_COIN } from "../src/store.js";

describe("VOLTYARD store: priced in coins", () => {
  it("the game module prices every item in coins, at the prices the client shows", () => {
    const skus = Object.fromEntries(arenaGame().manifest.skus);
    expect(skus).toEqual({
      plating: { coins: 40 },
      servo: { coins: 40 },
      capacitor: { coins: 60 },
      skin_neon: { coins: 300, grants: { cosmetic: 1 } },
      skin_chrome: { coins: 500, grants: { cosmetic: 2 } },
      plating_kit: { coins: 120, grants: { gear: "plating", loseBelow: 0.25 } },
    });
    for (const [id, coins] of Object.entries(COIN_PRICES)) expect(skus[id]?.coins).toBe(coins);
    // Every round upgrade is a declared upgrade (the room grants it by name); every finish has a cosmetic id.
    for (const id of UPGRADE_SKUS) expect(arenaGame().upgradeIds).toContain(id);
    for (const id of COSMETIC_SKUS) expect(COSMETICS[id]).toBeGreaterThan(0);
  });

  it("earned coins are spent first, then the wallet", async () => {
    const kit = mockKit({ earned: 30, wallet: 40, usdg: 0 }, Object.fromEntries(arenaGame().manifest.skus));
    expect(kit.coins.balance()).toBe(70);
    expect(await kit.coins.spend(COIN_PRICES.plating, "plating")).toMatchObject({ fromEarned: 30, onChain: 10 });
    expect(kit.earned()).toBe(0);
    expect(kit.coins.balance()).toBe(30);
    await expect(kit.coins.spend(COIN_PRICES.capacitor, "capacitor")).rejects.toThrow(/cannot spend/);
  });

  it("a finish is bought with coins and owned", async () => {
    const kit = mockKit({ earned: 300, wallet: 0, usdg: 0 }, Object.fromEntries(arenaGame().manifest.skus));
    await kit.store.buy("skin_neon", { pay: "coins" });
    expect(kit.store.owns("skin_neon")).toBe(true);
    expect(kit.coins.balance()).toBe(0);
  });

  it("the coin carries the token's own name, symbol and logo, never a generic COIN", () => {
    const kit = mockKit({ earned: 0, wallet: 0, usdg: 0 }, {});
    expect([kit.coins.name(), kit.coins.symbol()]).toEqual(["Volt", "VOLT"]);
    expect(kit.coins.logo()).toBe(VOLT_COIN.logo);
    expect(kit.coins.symbol()).not.toMatch(/^coins?$/i);
  });

  it("the room applies a paid upgrade once a round, and a finish as a cosmetic", async () => {
    await initSim();
    const sim = arenaAdapter();
    const w = sim.createWorld(1, "server");
    sim.addPlayer(w, 1);
    const me = () => listPlayers(w.sim).find((p) => p.playerId === 1);
    expect(me()?.maxHealth).toBe(100);
    expect(sim.command?.(w, 1, { name: "plating" })).toBe(true);
    expect(me()?.maxHealth).toBe(125);
    expect(me()?.health).toBe(125);
    expect(sim.command?.(w, 1, { name: "plating" })).toBe(false);
    expect(sim.command?.(w, 1, { name: "servo" })).toBe(true);
    expect(sim.command?.(w, 1, { name: "not_an_item" })).toBe(false);
    expect(sim.command?.(w, 1, { name: "cosmetic", value: COSMETICS.skin_chrome ?? 0 })).toBe(true);
    expect(sim.snapshot(w).find((e) => e.kind === 1 && e.owner === 1)?.values[12]).toBe(2);
    sim.disposeWorld?.(w);
  });
});
