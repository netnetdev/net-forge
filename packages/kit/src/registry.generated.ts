// GENERATED from the NetNet address registry. Do not edit.
// A PLACEHOLDER entry throws on use (getKitAddress). Only NetNet promotes entries, in its address registry.

export type KitAddressStatus = "HUMAN-VERIFIED" | "PLACEHOLDER";
export interface KitAddressEntry { readonly address: `0x${string}`; readonly status: KitAddressStatus; readonly source: string }

export const kitAddresses = {
  multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11", status: "HUMAN-VERIFIED", source: "canonical Multicall3 address (https://www.multicall3.com, deterministic CREATE2 on every chain); confirmed present on Robinhood Chain 2026-08-27 via cast codesize == 3808 against the public RPC. Read " },
  USDG: { address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", status: "HUMAN-VERIFIED", source: "https://robinhoodchain.blockscout.com/address/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168?tab=contract (human, 2026-07-14; symbol/decimals verified via eth_call against the official RPC)" },
  gameFactory: { address: "0x0000000000000000000000000000000000000000", status: "PLACEHOLDER", source: "not in the registry yet (expected name: gameFactory)" },
  gameZap: { address: "0x0000000000000000000000000000000000000000", status: "PLACEHOLDER", source: "not in the registry yet (expected name: gameZap)" },
} as const satisfies Record<string, KitAddressEntry>;

export const kitChainConfig = {
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  blockExplorerUrl: "https://robinhoodchain.blockscout.com",
} as const;

export const ROBINHOOD_CHAIN_ID = 4663;
