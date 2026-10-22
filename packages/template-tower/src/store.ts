/**
 * Store hooks (cabinet-launcher.md §7, "Coins" ruled 2026-10-15): every
 * game has coins, 1 coin = 1 game token, shown under the token's own name,
 * symbol and logo. COGSPIRE sells four run upgrades (a store command named
 * after the upgrade grants one level for the rest of the run), two finishes
 * (permanent) and one piece of losable gear, all priced in coins. The Kit
 * bridge and its in-memory stand-in live in @netnetcapital/tabletop.
 */
export { mockKit } from "@netnetcapital/tabletop";
export type { KitStoreBridge, MockKit, SkuPrice } from "@netnetcapital/tabletop";

/** Coin prices the client is wired to (they match store.sku(...) in game.ts; the generator's gate keeps them). */
export const COIN_PRICES = { overclock: 40, tempered_brass: 40, spyglass: 60, spare_bell: 50, skin_verdigris: 300, skin_gilt: 500, brass_gear: 150 } as const;
export type SkuId = keyof typeof COIN_PRICES;
/** Run upgrades: spent, applied by the room for the rest of the run. */
export const UPGRADE_SKUS = ["overclock", "tempered_brass", "spyglass", "spare_bell"] as const;
/** Cosmetic finishes: bought once, owned for good. */
export const COSMETIC_SKUS = ["skin_verdigris", "skin_gilt"] as const;

/** The template's own coin, as its token metadata names it until a creator renames it. */
export const COGSPIRE_COIN = {
  name: "Cog",
  symbol: "COG",
  logo: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='15' fill='%23f2b84b'/%3E%3Cpath d='M16 7l2 3 3-1 1 3 3 1-1 3 3 2-3 2 1 3-3 1-1 3-3-1-2 3-2-3-3 1-1-3-3-1 1-3-3-2 3-2-1-3 3-1 1-3 3 1z' fill='%233a2a14'/%3E%3Ccircle cx='16' cy='16' r='3.5' fill='%23f2b84b'/%3E%3C/svg%3E",
} as const;
