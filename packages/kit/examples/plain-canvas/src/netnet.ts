// NetNet Kit bootstrap, written by `npx @netnetcapital/kit add`.
// Edit freely outside the generated block. Guide for agents: https://cdn.jsdelivr.net/npm/@netnetcapital/kit@0.1.0/llms.txt
import { kit } from "@netnetcapital/kit";

// <kit:generated> from netnet.config.json by `npx @netnetcapital/kit sync`. Do not edit inside this block.
export const GAME = "comet-sweep";
export const REFEREE = undefined;
export type EarnEvent = "wave_cleared" | "wave_flawless";
export type SkuId = "skin_gold";
export const STORE = [{"id":"skin_gold","kind":"permanent","priceUsdg":"1.00"}] as const;
// </kit:generated>

// Mock mode runs everything with no chain: set VITE_NETNET_KIT_MOCK=1, or open the page with ?kit=mock.
const env = (import.meta as { env?: Record<string, string | undefined> }).env;
const MOCK = env?.VITE_NETNET_KIT_MOCK === "1" || (typeof location !== "undefined" && new URLSearchParams(location.search).get("kit") === "mock");

/** Call once when the game opens. One chain read, then none until the player transacts. */
export function startKit() {
  return kit.init({ game: GAME, mock: MOCK, referee: REFEREE, store: STORE });
}

/** Report an earn event where the player earns it, e.g. earn("wave_cleared"). The referee decides the payout. */
export function earn(event: EarnEvent, n = 1) {
  return kit.earn.report({ event, n }).catch((err: unknown) => {
    console.warn("[netnet-kit]", err);
    return null;
  });
}

export { kit };
