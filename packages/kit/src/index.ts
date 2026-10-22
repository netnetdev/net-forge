// @netnetcapital/kit: a game token, a store, payments and earn for any
// browser game on Robinhood Chain. Start at llms.txt.

import { createKit, type Kit } from "./kit.js";

/** The Kit. One per page: `await kit.init({ game: "my-game" })`. */
export const kit: Kit = createKit();

export { createKit };
export type { Kit, KitEarn, KitProfileApi, KitStore, KitToken, KitWallet } from "./kit.js";
export { guestId, parseProfile, GUEST_KEY } from "./profile.js";
export type * from "./types.js";
export { KitError, KIT_ERRORS, isKitError, type KitErrorCode } from "./errors.js";
export { MOCK_ACCOUNT } from "./mock.js";
export { skuKey, memoKey, toRaw, fromRaw, USDG_DECIMALS, type Amount } from "./units.js";
export { defineConfig, validateConfig, CONFIG_FILE, type KitProjectConfig, type StoreItemConfig, type EarnRuleConfig } from "./config.js";
export type { WalletOption } from "./wallet.js";
export { KIT_VERSION } from "./version.js";
export { deriveGame, slugHash, type GameAddresses } from "./derive.js";
export { isAttestation } from "./attestation.js";
