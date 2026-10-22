/**
 * Universal saves and the coin model, as the engine declares them
 * (cabinet-launcher.md rulings 2026-10-16, Q145 and Q146).
 *
 * A player's progress (achievements, unlocked keepers, today's goals,
 * titles, owned cosmetics and unlocks, meta upgrade levels, settings) is
 * kept per player on the room server, keyed by the signed-in wallet or a
 * guest id, never in the browser. The room grants achievements, goals and
 * titles from the authoritative sim, checks keeper picks against what the
 * profile has unlocked, and applies owned meta upgrades at the start of
 * every run. This module is the shared, pure part: what a game declares
 * that a profile can hold, and the rules both the server and clients use
 * (unlocks, today's goals, meta prices and caps). No I/O here.
 */
import type { GameManifest } from "../api/registry.js";
import { META_MAX_PER_STAT, META_MAX_TOTAL, type EconomyDef, type MetaStat, type MetaUpgradeDef, type SkuGrant } from "../api/schemas.js";

/** What a SKU is in the coin model: an in-run consumable, a look owned for good, or an unlock owned for good. */
export type SkuKind = "consumable" | "cosmetic" | "unlock" | "gear";

export interface ProfileSku {
  readonly id: string;
  readonly kind: SkuKind;
  /** Whole coins, or null when the SKU sells for dollars only. */
  readonly coins: number | null;
  readonly grants: SkuGrant | null;
}

/** What one game lets a profile hold, from its manifest. */
export interface ProfileSpec {
  /**
   * Keepers in index order (the index rides the input bits); `unlock` is the
   * achievement that opens it; `sold`: a store SKU sells it (then it has no
   * unlock, and it is open only once bought).
   */
  readonly keepers: readonly { readonly id: string; readonly unlock: string | null; readonly sold: boolean }[];
  readonly achievements: readonly string[];
  readonly missions: ReadonlyMap<string, { readonly when: string; readonly n: number }>;
  readonly titles: readonly string[];
  readonly skus: ReadonlyMap<string, ProfileSku>;
  readonly meta: ReadonlyMap<string, MetaUpgradeDef>;
  readonly economy: EconomyDef;
}

/** Event a run reports for a player's profile (the room writes it; the browser never does). */
export interface RunProgress {
  readonly player: number;
  readonly kind: "achievement" | "goal" | "title";
  /** The declared achievement, mission or title id. */
  readonly id: string;
}

/** Which keepers a profile may play (by index), from its achievements and owned unlocks. */
export interface ProfileUnlockState {
  readonly achievements: Iterable<string>;
  /** Achievements the profile holds only through the one-time local import: they never open a sold keeper. */
  readonly imported?: Iterable<string>;
  /** Owned SKU ids. */
  readonly owned: Iterable<string>;
}

export function skuKind(grants: SkuGrant | undefined | null): SkuKind {
  if (!grants) return "consumable";
  return "cosmetic" in grants ? "cosmetic" : "gear" in grants ? "gear" : "unlock";
}

/** Owned gear (losable, staked runs only): the SKU, the run upgrade it brings, and its loss line. */
export function ownedGear(spec: ProfileSpec, owned: Iterable<string>): Array<{ sku: string; upgrade: string; loseBelow: number; coins: number }> {
  const out: Array<{ sku: string; upgrade: string; loseBelow: number; coins: number }> = [];
  for (const id of owned) {
    const s = spec.skus.get(id);
    if (s?.grants && "gear" in s.grants) out.push({ sku: id, upgrade: s.grants.gear, loseBelow: s.grants.loseBelow, coins: s.coins ?? 0 });
  }
  return out;
}

/** The profile view of a manifest. */
export function profileSpec(m: GameManifest): ProfileSpec {
  const skus = new Map<string, ProfileSku>();
  const sold = new Set<string>();
  for (const [id, s] of m.skus) {
    skus.set(id, { id, kind: skuKind(s.grants), coins: s.coins ?? null, grants: s.grants ?? null });
    if (s.grants && "keeper" in s.grants) sold.add(s.grants.keeper);
  }
  return {
    keepers: [...m.keepers].map(([id, k]) => ({ id, unlock: k.unlock ?? null, sold: sold.has(id) })),
    achievements: [...m.achievements.keys()],
    missions: new Map([...m.missions].map(([id, d]) => [id, { when: d.when, n: d.n }])),
    titles: [...m.titles.keys()],
    skus,
    meta: m.metaUpgrades,
    economy: m.economy,
  };
}

/** UTC day number (days since 1970-01-01): daily goals roll over at 00:00 UTC. */
export function utcDay(ms: number): number {
  return Math.floor(ms / 86_400_000);
}

/** Today's goals: `n` of the declared missions, the same for everyone on a UTC day. */
export function todaysGoals(ids: readonly string[], day: number, n = 3): string[] {
  const pool = [...ids];
  const out: string[] = [];
  let h = (day * 2654435761) >>> 0;
  while (out.length < n && pool.length > 0) {
    h = (Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    out.push(...pool.splice(h % pool.length, 1));
  }
  return out;
}

/**
 * Keeper indices a profile may play: free keepers, keepers whose achievement
 * it reached, keepers it bought. A sold keeper opens only by purchase: an
 * imported achievement never opens it (defense in depth; the build already
 * refuses a keeper that is both earned and sold).
 */
export function openKeepers(spec: ProfileSpec, state: ProfileUnlockState): number[] {
  const reached = new Set(state.achievements);
  const imported = new Set(state.imported ?? []);
  const bought = new Set<string>();
  for (const id of state.owned) {
    const g = spec.skus.get(id)?.grants;
    if (g && "keeper" in g) bought.add(g.keeper);
  }
  const out: number[] = [];
  spec.keepers.forEach((k, i) => {
    if (bought.has(k.id)) return void out.push(i);
    if (k.sold) {
      if (k.unlock !== null && reached.has(k.unlock) && !imported.has(k.unlock)) out.push(i);
      return;
    }
    if (k.unlock === null || reached.has(k.unlock)) out.push(i);
  });
  return out;
}

/** Cosmetic ids a profile owns (0, the default look, always). */
export function ownedCosmetics(spec: ProfileSpec, owned: Iterable<string>): number[] {
  const out = new Set<number>([0]);
  for (const id of owned) {
    const g = spec.skus.get(id)?.grants;
    if (g && "cosmetic" in g) out.add(g.cosmetic);
  }
  return [...out].sort((a, b) => a - b);
}

/** Coins for the next level of a meta upgrade from `level` (0 = none owned), or null at the top. Geometric: cost x growth^level. */
export function metaPrice(def: MetaUpgradeDef, level: number): number | null {
  if (!Number.isInteger(level) || level < 0 || level >= def.levels) return null;
  return Math.round(def.cost * Math.pow(def.growth, level));
}

/**
 * The stat bonus a profile's meta levels give, with the engine's caps
 * applied again (+15% per stat, +30% in total, scaled down evenly past
 * it), whatever the declarations or the stored levels say.
 */
export function metaBonus(spec: ProfileSpec, levels: Readonly<Record<string, number>>): Partial<Record<MetaStat, number>> {
  const out: Partial<Record<MetaStat, number>> = {};
  for (const [id, def] of spec.meta) {
    const lv = Math.max(0, Math.min(def.levels, Math.floor(levels[id] ?? 0)));
    if (lv > 0) out[def.stat] = (out[def.stat] ?? 0) + def.step * lv;
  }
  let total = 0;
  for (const k of Object.keys(out) as MetaStat[]) {
    out[k] = Math.min(META_MAX_PER_STAT, out[k] ?? 0);
    total += out[k] ?? 0;
  }
  if (total > META_MAX_TOTAL) for (const k of Object.keys(out) as MetaStat[]) out[k] = ((out[k] ?? 0) * META_MAX_TOTAL) / total;
  return out;
}

/** Meta levels as one integer (3 bits per upgrade, declaration order), the payload of the room's "meta" sim command. */
export function packMeta(spec: ProfileSpec, levels: Readonly<Record<string, number>>): number {
  let v = 0;
  let i = 0;
  for (const [id, def] of spec.meta) {
    const lv = Math.max(0, Math.min(def.levels, 7, Math.floor(levels[id] ?? 0)));
    v += lv * Math.pow(8, i++);
  }
  return v;
}

export function unpackMeta(spec: ProfileSpec, value: number): Record<string, number> {
  const out: Record<string, number> = {};
  let v = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  for (const [id, def] of spec.meta) {
    const lv = Math.min(def.levels, v % 8);
    if (lv > 0) out[id] = lv;
    v = Math.floor(v / 8);
  }
  return out;
}

/** Room command names a client may never send: the room issues them from the profile. */
export const RESERVED_COMMANDS: ReadonlySet<string> = new Set(["meta"]);
