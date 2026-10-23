/**
 * Store hooks (the Coins model): every
 * game has coins, 1 coin = 1 game token, shown under the token's own name,
 * symbol and logo. TORQUEBAY sells three round upgrades (a store command
 * named after the upgrade grants one level for the rest of the round) and
 * two cosmetic finishes (permanent), all priced in coins.
 *
 * `KitStoreBridge` is the slice of @netforge/kit's `Kit` this game
 * calls, with the Kit's own names (`kit.coins.*`, `kit.store.owns/buy`), so
 * the real Kit drops in unchanged. Until a game's token is live `mockKit()`
 * stands in, in memory. Earned coins are spent first (off chain, no wallet
 * prompt), then the wallet, exactly as the Kit does.
 */
export interface KitStoreBridge {
  readonly store: {
    owns(id: string): boolean;
    count(id: string): number;
    buy(id: string, opts?: { pay?: "usdg" | "token" | "coins" }): Promise<unknown>;
  };
  readonly coins: {
    /** The token's own name, symbol and logo (its metadata). Never a generic "COIN". */
    name(): string;
    symbol(): string;
    logo(): string | null;
    /** Whole coins: earned (unclaimed) plus the wallet. */
    balance(): number;
    /** Earned first, then the wallet. `key` proves the paid room command (sent as the command's `proof`). */
    spend(amount: number, reason: string): Promise<{ key: string | null }>;
  };
}

/** Coin prices the client is wired to (they match store.sku(...) in game.ts; the generator's gate keeps them). */
export const COIN_PRICES = { turbo: 40, tuned_engine: 40, soft_tyres: 60, skin_flame: 300, skin_chrome: 500 } as const;
export type SkuId = keyof typeof COIN_PRICES;
/** Round upgrades: spent, applied by the room for the rest of the round. */
export const UPGRADE_SKUS = ["turbo", "tuned_engine", "soft_tyres"] as const;
/** Cosmetic finishes: bought once, owned for good. */
export const COSMETIC_SKUS = ["skin_flame", "skin_chrome"] as const;

/** The template's own coin, as its token metadata names it until a creator renames it. */
export const TORQ_COIN = {
  name: "Torq",
  symbol: "TORQ",
  logo: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='15' fill='%23ff5a1f'/%3E%3Ccircle cx='16' cy='16' r='9' fill='none' stroke='%23fff3d6' stroke-width='3'/%3E%3Cpath d='M16 7v6M16 19v6M7 16h6M19 16h6' stroke='%23fff3d6' stroke-width='3'/%3E%3C/svg%3E",
} as const;

export interface SkuPrice {
  readonly coins?: number;
  readonly usdg?: number;
}

export interface MockKit extends KitStoreBridge {
  /** Dollars left (mock only). */
  usdg(): number;
  /** Earned, unclaimed coins left (mock only). */
  earned(): number;
}

/** An in-memory Kit for local play and tests: starting balances, prices from game.ts. */
export function mockKit(
  start: { earned: number; wallet: number; usdg: number },
  prices: Readonly<Record<string, SkuPrice>>,
  coin: { name: string; symbol: string; logo: string | null } = TORQ_COIN,
): MockKit {
  let earned = start.earned;
  let wallet = start.wallet;
  let usdg = start.usdg;
  const owned = new Map<string, number>();
  let spends = 0;
  /** Earned first, then the wallet: the Kit's order. */
  const spend = (amount: number, reason: string) => {
    if (!Number.isInteger(amount) || amount <= 0 || earned + wallet < amount) throw new Error(`cannot spend ${amount} for ${reason}`);
    const fromEarned = Math.min(earned, amount);
    earned -= fromEarned;
    wallet -= amount - fromEarned;
    return { fromEarned, onChain: amount - fromEarned, key: `mock-spend-${++spends}` };
  };
  return {
    usdg: () => usdg,
    earned: () => earned,
    store: {
      owns: (id) => (owned.get(id) ?? 0) > 0,
      count: (id) => owned.get(id) ?? 0,
      async buy(id, opts) {
        const p = prices[id];
        if (!p) throw new Error(`no SKU "${id}"`);
        const payUsdg = opts?.pay === "usdg" || (opts?.pay === undefined && p.coins === undefined);
        if (payUsdg) {
          if (p.usdg === undefined || usdg < p.usdg) throw new Error("not enough USDG");
          usdg -= p.usdg;
        } else {
          if (p.coins === undefined) throw new Error(`"${id}" has no coin price`);
          spend(p.coins, id);
        }
        owned.set(id, (owned.get(id) ?? 0) + 1);
        return { id };
      },
    },
    coins: {
      name: () => coin.name,
      symbol: () => coin.symbol,
      logo: () => coin.logo,
      balance: () => earned + wallet,
      async spend(amount, reason) {
        return spend(amount, reason);
      },
    },
  };
}
