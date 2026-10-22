import { describe, expect, it } from "vitest";
import { initSim, KART_STATS } from "@netnetcapital/engine-sim";
import { KF } from "@netnetcapital/engine/game";
import { COSMETICS, racerAdapter, racerGame } from "../src/manifest.js";
import { COIN_PRICES, COSMETIC_SKUS, mockKit, TORQ_COIN, UPGRADE_SKUS } from "../src/store.js";

describe("TORQUEBAY store: priced in coins", () => {
  it("the game module prices every item in coins, at the prices the client shows", () => {
    const skus = Object.fromEntries(racerGame().manifest.skus);
    expect(skus).toEqual({
      turbo: { coins: 40 },
      tuned_engine: { coins: 40 },
      soft_tyres: { coins: 60 },
      skin_flame: { coins: 300, grants: { cosmetic: 1 } },
      skin_chrome: { coins: 500, grants: { cosmetic: 2 } },
      bumper_kit: { coins: 120, grants: { gear: "bumpers", loseBelow: 0.25 } },
    });
    for (const [id, coins] of Object.entries(COIN_PRICES)) expect(skus[id]?.coins).toBe(coins);
    for (const id of UPGRADE_SKUS) expect(racerGame().upgradeIds).toContain(id);
    for (const id of COSMETIC_SKUS) expect(COSMETICS[id]).toBeGreaterThan(0);
  });

  it("the coin carries the token's own name, symbol and logo", () => {
    const kit = mockKit({ earned: 0, wallet: 0, usdg: 0 }, {});
    expect([kit.coins.name(), kit.coins.symbol()]).toEqual(["Torq", "TORQ"]);
    expect(kit.coins.logo()).toBe(TORQ_COIN.logo);
  });

  it("the room applies a paid upgrade once a race, gear by its upgrade, and a paint job as a cosmetic", async () => {
    await initSim();
    const sim = racerAdapter();
    const w = sim.createWorld(1, "server");
    sim.addPlayer(w, 1);
    const level = (stat: string) => (((sim.snapshot(w).find((e) => e.owner === 1)?.values[KF.stats] ?? 0) >>> (KART_STATS.indexOf(stat as never) * 4)) & 0xf);
    expect(sim.command?.(w, 1, { name: "turbo" })).toBe(true);
    expect(level("might")).toBe(1);
    expect(sim.command?.(w, 1, { name: "turbo" })).toBe(false);
    // Gear only comes from the room at a staked race's start; a client cannot buy "bumpers" as a command price.
    expect(sim.command?.(w, 1, { name: "bumpers" })).toBe(true);
    expect(level("armor")).toBe(1);
    expect(sim.command?.(w, 1, { name: "not_an_item" })).toBe(false);
    expect(sim.command?.(w, 1, { name: "cosmetic", value: COSMETICS.skin_chrome ?? 0 })).toBe(true);
    expect((sim.snapshot(w).find((e) => e.owner === 1)?.values[KF.cosmetic] ?? 0) & 0xff).toBe(2);
  });
});
