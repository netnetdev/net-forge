/**
 * Store hooks (cabinet-launcher.md §7, "Coins" ruled 2026-10-15): every
 * game has coins, 1 coin = 1 game token, shown under the token's own name,
 * symbol and logo. INKWRIT sells four run upgrades (a store command named
 * after the upgrade grants one level for the rest of the run), two quill
 * finishes (permanent) and one piece of losable gear, all priced in coins.
 * The Kit bridge and its in-memory stand-in live in @netnetcapital/tabletop.
 */
export { mockKit } from "@netnetcapital/tabletop";
export type { KitStoreBridge, MockKit, SkuPrice } from "@netnetcapital/tabletop";

/** Coin prices the client is wired to (they match store.sku(...) in game.ts; the generator's gate keeps them). */
export const COIN_PRICES = { thick_vellum: 40, sharp_nib: 60, quick_ink: 40, spare_page: 50, skin_vermilion: 300, skin_gold_leaf: 500, bound_folio: 120 } as const;
/** Run upgrades: spent, applied by the room for the rest of the run. */
export const UPGRADE_SKUS = ["thick_vellum", "sharp_nib", "quick_ink", "spare_page"] as const;
/** Cosmetic finishes: bought once, owned for good. */
export const COSMETIC_SKUS = ["skin_vermilion", "skin_gold_leaf"] as const;

/** The template's own coin, as its token metadata names it until a creator renames it. */
export const INKWRIT_COIN = {
  name: "Ink",
  symbol: "INK",
  logo: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='15' fill='%231f3550'/%3E%3Cpath d='M16 5c4 6 7 10 7 14a7 7 0 0 1-14 0c0-4 3-8 7-14z' fill='%23e8dcc0'/%3E%3C/svg%3E",
} as const;
