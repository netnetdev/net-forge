// Wallet seam, the same approach as the NetNet apps (packages/sdk/src/wallet.ts):
// EIP-6963 discovery so the player picks among installed wallets, a legacy
// `window.ethereum` door only when nothing announces, and any EIP-1193
// provider accepted directly (Privy's embedded wallet, WalletConnect).
//
// Nothing here touches the RPC. Discovery is DOM events; connecting is the
// wallet's own `eth_requestAccounts`.

import { KitError } from "./errors.js";
import type { Address, Eip1193Provider } from "./types.js";

export interface WalletOption {
  /** Reverse-DNS id, e.g. "io.metamask". */
  rdns: string;
  name: string;
  /** Data-URI icon, safe for <img src>. */
  icon: string;
  provider: Eip1193Provider;
}

interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

const roster = new Map<string, WalletOption>();
let listening = false;

function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("eip6963:announceProvider", (ev: Event) => {
    const detail = (ev as CustomEvent<Eip6963Detail>).detail;
    if (!detail?.info?.rdns || typeof detail.provider?.request !== "function") return;
    roster.set(detail.info.rdns, { rdns: detail.info.rdns, name: detail.info.name, icon: detail.info.icon, provider: detail.provider });
  });
}

/** Ask installed wallets to announce themselves, then list them. */
export async function discoverWallets(waitMs = 120): Promise<WalletOption[]> {
  if (typeof window === "undefined") return [];
  listen();
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((r) => setTimeout(r, waitMs));
  const list = [...roster.values()];
  if (list.length > 0) return list;
  const legacy = (window as { ethereum?: Eip1193Provider }).ethereum;
  return legacy && typeof legacy.request === "function" ? [{ rdns: "injected", name: "Browser wallet", icon: "", provider: legacy }] : [];
}

/** Request accounts from a provider. Must run from a user gesture in most wallets. */
export async function requestAccount(provider: Eip1193Provider): Promise<Address> {
  let accounts: unknown;
  try {
    accounts = await provider.request({ method: "eth_requestAccounts" });
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === 4001) throw new KitError("USER_REJECTED", undefined, err);
    throw new KitError("NO_WALLET", "The wallet did not return an account.", err);
  }
  const first = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof first !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(first)) throw new KitError("NO_WALLET", "The wallet returned no account.");
  return first as Address;
}

/** Wallets may answer eth_chainId in hex or, wrongly, in decimal. */
export function parseChainId(x: unknown): number {
  if (typeof x === "number") return x;
  if (typeof x !== "string") return NaN;
  return x.startsWith("0x") || x.startsWith("0X") ? parseInt(x, 16) : parseInt(x, 10);
}

/** Switch the wallet to Robinhood Chain, adding it if the wallet lacks it. */
export async function ensureChain(provider: Eip1193Provider, chainId: number, rpcUrl: string, explorerUrl: string): Promise<void> {
  const hex = `0x${chainId.toString(16)}`;
  if (parseChainId(await provider.request({ method: "eth_chainId" })) === chainId) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === 4001) throw new KitError("USER_REJECTED", undefined, err);
    if (code !== 4902) throw new KitError("WRONG_CHAIN", undefined, err);
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: hex, chainName: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: [rpcUrl], blockExplorerUrls: [explorerUrl] }],
    });
  }
  if (parseChainId(await provider.request({ method: "eth_chainId" })) !== chainId) throw new KitError("WRONG_CHAIN");
}
