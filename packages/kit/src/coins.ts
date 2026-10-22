// Coins: the game's token as players meet it in play (cabinet-launcher.md
// "Coins", ruled 2026-10-15). 1 coin = 1 token. A coin is always shown under
// the token's OWN name, symbol and logo (its metadata), never a generic
// "COIN". Pure helpers shared by the live and mock backends; no I/O here.

import type { KitCoinsState } from "./types.js";

export const EMPTY_COINS: KitCoinsState = { mode: null, earned: 0n, claimable: 0n, returning: 0n, reserved: 0n, purchases: {} };

const WEI = /^\d{1,78}$/;
const big = (v: unknown): bigint => (typeof v === "string" && WEI.test(v) ? BigInt(v) : 0n);

/** The referee's GET /referee/coins body (untrusted JSON) as Kit state. */
export function parseCoins(body: unknown): KitCoinsState {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const purchases: Record<string, number> = {};
  const p = b["purchases"];
  if (typeof p === "object" && p !== null) {
    for (const [k, v] of Object.entries(p)) if (/^[a-z][a-z0-9_]{1,30}$/.test(k) && typeof v === "number" && Number.isSafeInteger(v) && v >= 0) purchases[k] = v;
  }
  return {
    mode: b["mode"] === "prelaunch" ? "prelaunch" : b["mode"] === "live" ? "live" : null,
    earned: big(b["earned"]),
    claimable: big(b["claimable"]),
    returning: big(b["returning"]),
    reserved: big(b["reserved"]),
    purchases,
  };
}

/** ipfs:// and ar:// to an https gateway; http(s) and data:image as they are; anything else is not a logo. */
export function resolveUri(uri: string): string | null {
  const u = uri.trim();
  if (/^ipfs:\/\//i.test(u)) return `https://ipfs.io/ipfs/${u.replace(/^ipfs:\/\/(ipfs\/)?/i, "")}`;
  if (/^ar:\/\//i.test(u)) return `https://arweave.net/${u.slice(5)}`;
  if (/^https:\/\//i.test(u) || /^data:image\//i.test(u)) return u;
  return null;
}

/** ERC-7572 contract metadata: { name, image, ... }. Untrusted. */
export function parseMetadata(body: unknown): { name: string | null; logo: string | null } {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const name = typeof b["name"] === "string" && b["name"].trim().length > 0 ? b["name"].trim().slice(0, 64) : null;
  const image = typeof b["image"] === "string" ? b["image"] : typeof b["logo"] === "string" ? b["logo"] : null;
  return { name, logo: image ? resolveUri(image) : null };
}

/** A data: URI's JSON (contractURI may be inline), else null. */
export function decodeDataJson(uri: string): unknown {
  const m = /^data:application\/json(;base64)?,(.*)$/is.exec(uri.trim());
  if (!m) return null;
  try {
    const text = m[1] ? atob(m[2] ?? "") : decodeURIComponent(m[2] ?? "");
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** A mock coin's name and symbol from the game slug ("comet-sweep" -> "Comet Sweep", "COMET"). */
export function coinFromSlug(slug: string): { name: string; symbol: string } {
  const words = slug.split("-").filter(Boolean);
  const name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || slug;
  const symbol = (words[0] ?? slug).replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase() || "GAME";
  return { name, symbol };
}

/** A random idempotency key for one spend (the referee accepts [A-Za-z0-9_-]{8,64}). */
export function spendKey(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `k${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
