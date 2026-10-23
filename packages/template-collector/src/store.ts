/**
 * Store hooks (the Coins model): every
 * game has coins, 1 coin = 1 game token, shown under the token's own name,
 * symbol and logo. MOSSBOUND sells four run upgrades (a store command named
 * after the upgrade grants one level for the rest of the run), two finishes
 * (permanent) and one piece of losable gear, all priced in coins. The Kit
 * bridge and its in-memory stand-in live in @netforge/tabletop.
 */
export { mockKit } from "@netforge/tabletop";
export type { KitStoreBridge, MockKit, SkuPrice } from "@netforge/tabletop";

/** Coin prices the client is wired to (they match store.sku(...) in game.ts; the generator's gate keeps them). */
export const COIN_PRICES = { thornbark: 40, mossmail: 40, spare_snares: 60, fen_tonic: 50, skin_lichen: 300, skin_amber: 500, lucky_reed: 150 } as const;
export type SkuId = keyof typeof COIN_PRICES;
/** Run upgrades: spent, applied by the room for the rest of the run. */
export const UPGRADE_SKUS = ["thornbark", "mossmail", "spare_snares", "fen_tonic"] as const;
/** Cosmetic finishes: bought once, owned for good. */
export const COSMETIC_SKUS = ["skin_lichen", "skin_amber"] as const;

/** The template's own coin, as its token metadata names it until a creator renames it. */
export const MOSSBOUND_COIN = {
  name: "Moss",
  symbol: "MOSS",
  logo: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='15' fill='%237bc96f'/%3E%3Cpath d='M16 6c6 4 8 10 4 16-2 3-6 4-8 2-4-4-2-12 4-18z' fill='%23234a1e'/%3E%3Cpath d='M15 26c0-6 1-10 4-14' stroke='%237bc96f' stroke-width='1.5' fill='none'/%3E%3C/svg%3E",
} as const;
