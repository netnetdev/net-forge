// The browser side of universal saves (Q146, ruled 2026-10-16): a guest id,
// wallet sign-in (SIWE over any EIP-1193 wallet) and the room server's
// profile routes. Progress lives on the server, keyed by the signed-in
// wallet or by the guest id; the browser keeps only the guest id and the
// session token, both conveniences. Plain fetch, no chain calls.

import { GUEST_ID_RE, type GameProfile } from './protocol.js';

/** Storage key for the guest id: shared by every game on one origin, like a Launcher guest. */
export const GUEST_KEY = 'netnet:guest:v1';
const SESSION_KEY = 'netnet:rooms-session:v1';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function randomGuest(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `g-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

let memoGuest: string | null = null;

/** This browser's guest id (made on first use). Storage blocked: one per page load. */
export function guestId(): string {
  if (memoGuest) return memoGuest;
  const s = storage();
  try {
    const have = s?.getItem(GUEST_KEY);
    if (have && GUEST_ID_RE.test(have)) return (memoGuest = have);
  } catch {
    /* blocked */
  }
  memoGuest = randomGuest();
  try {
    s?.setItem(GUEST_KEY, memoGuest);
  } catch {
    /* per page */
  }
  return memoGuest;
}

/** A fresh guest id: after a guest profile merges into a wallet, the old id is spent. */
export function rotateGuestId(): string {
  memoGuest = randomGuest();
  try {
    storage()?.setItem(GUEST_KEY, memoGuest);
  } catch {
    /* per page */
  }
  return memoGuest;
}

/** The saved session token for a rooms server, if it has not expired. */
export function savedSession(endpoint: string): { token: string; address: string } | null {
  try {
    const raw = storage()?.getItem(`${SESSION_KEY}:${endpoint}`);
    if (!raw) return null;
    const o = JSON.parse(raw) as { token?: unknown; address?: unknown; expiresAt?: unknown };
    if (typeof o.token !== 'string' || typeof o.address !== 'string' || typeof o.expiresAt !== 'number' || o.expiresAt <= Date.now() + 60_000) return null;
    return { token: o.token, address: o.address };
  } catch {
    return null;
  }
}

export function saveSession(endpoint: string, s: { token: string; address: string; expiresAt: number } | null): void {
  try {
    if (s) storage()?.setItem(`${SESSION_KEY}:${endpoint}`, JSON.stringify(s));
    else storage()?.removeItem(`${SESSION_KEY}:${endpoint}`);
  } catch {
    /* this page only */
  }
}

/** The slice of an EIP-1193 provider sign-in needs. */
export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function hexUtf8(text: string): string {
  return `0x${Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Sign in to a rooms server with a wallet: its nonce, an EIP-4361 message
 * for its domain, one personal_sign (no gas), a session token. Saved for
 * this endpoint until it expires.
 */
export async function signInWithWallet(endpoint: string, provider: Eip1193, statement = 'Sign in to save your progress.'): Promise<{ token: string; address: string; expiresAt: number }> {
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as unknown;
  const address = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : null;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('no wallet account');
  const n = (await (await fetch(`${endpoint}/auth/nonce`)).json()) as { nonce?: string; domain?: string; uri?: string; chainId?: number };
  if (!n.nonce || !n.domain || !n.uri || !n.chainId) throw new Error('the server sent no sign-in nonce');
  const now = new Date();
  const message = [
    `${n.domain} wants you to sign in with your Ethereum account:`,
    address,
    '',
    statement,
    '',
    `URI: ${n.uri}`,
    'Version: 1',
    `Chain ID: ${n.chainId}`,
    `Nonce: ${n.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${new Date(now.getTime() + 12 * 3600_000).toISOString()}`,
  ].join('\n');
  const signature = (await provider.request({ method: 'personal_sign', params: [hexUtf8(message), address] })) as string;
  const res = await fetch(`${endpoint}/auth/sign-in`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, signature }) });
  const body = (await res.json()) as { token?: string; address?: string; expiresAt?: number; error?: string };
  if (!res.ok || !body.token || !body.address || !body.expiresAt) throw new Error(body.error ?? `sign-in failed (${res.status})`);
  const out = { token: body.token, address: body.address, expiresAt: body.expiresAt };
  saveSession(endpoint, out);
  return out;
}

/** Who is asking: a signed-in session (bearer) or a guest id. */
export type ProfileAuth = { readonly session: string } | { readonly guest: string };

export interface LocalProgress {
  /** Achievement ids this browser reached before profiles. */
  readonly achievements?: readonly string[];
  /** Goals done today (UTC day) in this browser. */
  readonly goals?: { readonly day: number; readonly done: readonly string[] };
  /** Settings to carry over (the keeper pick, sound). */
  readonly settings?: Readonly<Record<string, unknown>>;
}

/** The room server's profile routes for one game. */
export class ProfileApi {
  constructor(
    readonly endpoint: string,
    readonly game: string,
  ) {}

  private headers(auth: ProfileAuth | null): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (auth && 'session' in auth) h.authorization = `Bearer ${auth.session}`;
    else if (auth) h['x-guest-id'] = auth.guest;
    return h;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, auth: ProfileAuth | null, body?: unknown): Promise<T> {
    const res = await fetch(`${this.endpoint}${path}`, { method, headers: this.headers(auth), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const out = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok || out === null) throw new Error(out?.error ?? `profile ${path} failed (${res.status})`);
    return out;
  }

  /** This game's profile for a session or a guest (an empty one before any progress). */
  get(auth: ProfileAuth): Promise<GameProfile> {
    return this.call('GET', `/profile/game/${encodeURIComponent(this.game)}`, auth);
  }

  /** One time per guest and game: carry progress this browser kept before profiles existed. */
  importLocal(guest: string, local: LocalProgress): Promise<GameProfile> {
    return this.call('POST', '/profile/import', { guest }, { game: this.game, ...local });
  }

  /** Merge a guest's progress into the signed-in wallet's profile (the guest id is spent: rotate it). */
  claim(session: string, guest: string): Promise<GameProfile> {
    return this.call('POST', '/profile/claim', { session }, { guest, game: this.game });
  }

  /** Replace this game's settings for the player (a small JSON object). */
  setSettings(auth: ProfileAuth, settings: Readonly<Record<string, unknown>>): Promise<GameProfile> {
    return this.call('POST', '/profile/settings', auth, { game: this.game, settings });
  }

  /** The display name the Launcher and end screens show (1-24 characters). */
  setName(auth: ProfileAuth, displayName: string): Promise<GameProfile> {
    return this.call('POST', '/profile/name', auth, { game: this.game, displayName });
  }

  /**
   * Turn a committed coin spend (kit.coins.spend(price, id) returned `key`)
   * into ownership: a cosmetic, an unlock, or the next level of a meta
   * upgrade. The server checks the price from the game's manifest.
   */
  redeem(session: string, item: string, key: string): Promise<GameProfile> {
    return this.call('POST', '/profile/redeem', { session }, { game: this.game, item, key });
  }
}
