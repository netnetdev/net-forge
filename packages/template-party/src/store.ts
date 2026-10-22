/**
 * Store hooks (the Coins model): every
 * game has coins, 1 coin = 1 game token, shown under the token's own name,
 * symbol and logo. The store sells a revive (spent while downed), a
 * cosmetic disco palette (permanent) and a losable charm, priced in coins.
 *
 * `KitStoreBridge` is the slice of @netnetcapital/kit's `Kit` this game
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
export const COIN_PRICES = { revive: 50, skin_disco: 300 } as const;
/** What a revive costs, in coins. */
export const REVIVE_PRICE = COIN_PRICES.revive;
/** What the Disco palette costs, in coins. */
export const COSMETIC_PRICE = COIN_PRICES.skin_disco;

/** The template's own coin, as its token metadata names it until a creator renames it. */
export const ROMP_COIN = {
  name: "Romp",
  symbol: "ROMP",
  logo: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='15' fill='%23ff7ab8'/%3E%3Cpath d='M9 24 16 6l7 18z' fill='%23ffe066'/%3E%3Ccircle cx='13' cy='17' r='1.6' fill='%237ad7ff'/%3E%3Ccircle cx='18' cy='13' r='1.6' fill='%237affd4'/%3E%3Ccircle cx='19' cy='20' r='1.6' fill='%23c9a7ff'/%3E%3C/svg%3E",
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
  coin: { name: string; symbol: string; logo: string | null } = ROMP_COIN,
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
