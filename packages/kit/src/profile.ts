// Universal saves: the player's
// profile is kept by the referee (the rooms server), keyed by the signed-in
// wallet or by a guest id, never by the browser. Pure helpers shared by the
// live and mock backends; no I/O here. Profile calls are HTTP to the
// referee, never RPC.

import type { KitProfile, KitProfileStoreItem } from "./types.js";

/** The guest id's storage key: the same one the engine's clients use, so one origin has one guest. */
export const GUEST_KEY = "netnet:guest:v1";
const GUEST_RE = /^[A-Za-z0-9_-]{16,80}$/;

let memo: string | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function fresh(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `g-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** This browser's guest id (made on first use; per page when storage is blocked). */
export function guestId(): string {
  if (memo) return memo;
  try {
    const have = storage()?.getItem(GUEST_KEY);
    if (have && GUEST_RE.test(have)) return (memo = have);
  } catch {
    /* blocked */
  }
  memo = fresh();
  try {
    storage()?.setItem(GUEST_KEY, memo);
  } catch {
    /* per page */
  }
  return memo;
}

/** After the guest's progress merged into a wallet, its id is spent: start a new one. */
export function rotateGuestId(): string {
  memo = fresh();
  try {
    storage()?.setItem(GUEST_KEY, memo);
  } catch {
    /* per page */
  }
  return memo;
}

const ID = /^[a-z][a-z0-9_]{0,47}$/;
const str = (v: unknown, re = ID): string | null => (typeof v === "string" && re.test(v) ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => x !== null).slice(0, 500) : []);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function storeItem(v: unknown): KitProfileStoreItem | null {
  const o = rec(v);
  const id = str(o.id);
  const kind = o.kind === "cosmetic" || o.kind === "unlock" || o.kind === "meta" ? o.kind : null;
  if (!id || !kind) return null;
  const n = (k: string) => num(o[k]);
  return {
    id,
    kind,
    coins: n("coins"),
    owned: o.owned === true,
    ...(n("cosmetic") !== null ? { cosmetic: n("cosmetic") as number } : {}),
    ...(str(o.keeper) ? { keeper: str(o.keeper) as string } : {}),
    ...(typeof o.stat === "string" ? { stat: o.stat.slice(0, 16) } : {}),
    ...(n("step") !== null ? { step: n("step") as number } : {}),
    ...(n("level") !== null ? { level: n("level") as number } : {}),
    ...(n("levels") !== null ? { levels: n("levels") as number } : {}),
    ...(n("bonus") !== null ? { bonus: n("bonus") as number } : {}),
  };
}

/** The referee's GET /profile/game/:game body (untrusted JSON) as Kit state. */
export function parseProfile(body: unknown): KitProfile {
  const b = rec(body);
  const goals = rec(b.goals);
  const totals = rec(b.totals);
  const meta: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec(b.meta))) if (ID.test(k) && typeof v === "number" && Number.isInteger(v) && v >= 0) meta[k] = v;
  const titles: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec(b.titles))) if (ID.test(k) && typeof v === "number" && Number.isInteger(v) && v >= 0) titles[k] = v;
  const achievements = Array.isArray(b.achievements)
    ? b.achievements.flatMap((a) => {
        const o = rec(a);
        const id = str(o.id);
        return id ? [{ id, at: num(o.at) ?? 0, source: o.source === "import" ? ("import" as const) : ("sim" as const) }] : [];
      })
    : [];
  return {
    game: typeof b.game === "string" ? b.game.slice(0, 64) : "",
    kind: b.kind === "wallet" ? "wallet" : b.kind === "guest" ? "guest" : null,
    displayName: typeof b.displayName === "string" ? b.displayName.slice(0, 24) : null,
    achievements,
    keepers: strs(b.keepers),
    owned: strs(b.owned),
    cosmetics: Array.isArray(b.cosmetics) ? b.cosmetics.filter((c): c is number => typeof c === "number" && Number.isInteger(c)) : [0],
    meta,
    goals: { day: num(goals.day) ?? 0, today: strs(goals.today), done: strs(goals.done) },
    titles,
    settings: rec(b.settings),
    store: Array.isArray(b.store) ? b.store.map(storeItem).filter((x): x is KitProfileStoreItem => x !== null) : [],
    imported: b.imported === true,
    credit: Math.max(0, num(b.credit) ?? 0),
    totals: { achievements: num(totals.achievements) ?? 0, titles: num(totals.titles) ?? 0, games: num(totals.games) ?? 0 },
  };
}

/** A purchase whose redeem did not reach the referee: kept so the next buy retries it before spending again. */
export interface PendingRedeem {
  key: string;
  level?: number;
  account: string;
}

const pendingKey = (game: string, item: string) => `netnet:kit:redeem:v1:${game}:${item}`;

export function loadPendingRedeem(game: string, item: string): PendingRedeem | null {
  try {
    const raw = storage()?.getItem(pendingKey(game, item));
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<PendingRedeem>;
    return typeof o.key === "string" && typeof o.account === "string" ? { key: o.key, account: o.account, ...(typeof o.level === "number" ? { level: o.level } : {}) } : null;
  } catch {
    return null;
  }
}

export function savePendingRedeem(game: string, item: string, p: PendingRedeem | null): void {
  try {
    if (p) storage()?.setItem(pendingKey(game, item), JSON.stringify(p));
    else storage()?.removeItem(pendingKey(game, item));
  } catch {
    /* this page only */
  }
}

/** A coin spend whose chain tip was paid but whose commit has not reached the referee yet. */
export interface PendingCommit {
  key: string;
  txHash: string;
  account: string;
}

const commitsKey = (game: string) => `netnet:kit:commits:v1:${game}`;

export function loadPendingCommits(game: string): PendingCommit[] {
  try {
    const raw = storage()?.getItem(commitsKey(game));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((p): p is PendingCommit => typeof p?.key === "string" && typeof p?.txHash === "string" && typeof p?.account === "string").slice(0, 50) : [];
  } catch {
    return [];
  }
}

/** Add `p`, or (with null) drop the entry for `key`. */
export function savePendingCommit(game: string, p: PendingCommit | null, key?: string): void {
  try {
    const rest = loadPendingCommits(game).filter((x) => x.key !== (p?.key ?? key));
    const next = p ? [...rest, p] : rest;
    if (next.length === 0) storage()?.removeItem(commitsKey(game));
    else storage()?.setItem(commitsKey(game), JSON.stringify(next));
  } catch {
    /* this page only */
  }
}

/** An empty profile (no referee, or nothing saved yet). */
export function emptyProfile(game: string, kind: KitProfile["kind"] = null): KitProfile {
  return { game, kind, displayName: null, achievements: [], keepers: [], owned: [], cosmetics: [0], meta: {}, goals: { day: 0, today: [], done: [] }, titles: {}, settings: {}, store: [], imported: false, credit: 0, totals: { achievements: 0, titles: 0, games: 0 } };
}
