/**
 * Store hooks (cabinet-launcher.md §7, "Coins" ruled 2026-10-15). BRINEWORKS
 * sells three shift upgrades (a store command named after the upgrade grants
 * one level for the rest of the shift), two finishes and one piece of
 * losable gear, all priced in coins. The Kit bridge lives in @netnetcapital/tabletop.
 */
export { mockKit } from "@netnetcapital/tabletop";
export type { KitStoreBridge, MockKit, SkuPrice } from "@netnetcapital/tabletop";

/** Coin prices the client is wired to (they match store.sku(...) in game.ts; the generator's gate keeps them). */
export const COIN_PRICES = { bellows: 40, long_rake: 40, quick_hands: 60, skin_saltwhite: 300, skin_rust: 500, brass_bellows: 150 } as const;
export const UPGRADE_SKUS = ["bellows", "long_rake", "quick_hands"] as const;
export const COSMETIC_SKUS = ["skin_saltwhite", "skin_rust"] as const;

/** The template's own coin until a creator renames it. */
export const BRINE_COIN = {
  name: "Brine",
  symbol: "BRINE",
  logo: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='15' fill='%235ec8ff'/%3E%3Cpath d='M16 6l7 9-7 11-7-11z' fill='%23f6fbff'/%3E%3Cpath d='M16 6l7 9h-14z' fill='%23d6eefc'/%3E%3C/svg%3E",
} as const;
