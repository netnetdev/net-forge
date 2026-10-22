// Saved progress for local play, in memory only: achievements, goals and
// titles the sim reports, the looks and unlocks bought with play money,
// settings and a display name. Everything is gone when `kit play` stops.
// Nothing here is a wallet, a balance or a claim.

import { metaPrice, openKeepers, ownedCosmetics, todaysGoals, utcDay, type ProfileSpec } from "@netnetcapital/engine/game";
import type { GameProfile, ProfileStoreItem } from "@netnetcapital/engine/net";

interface Saved {
  readonly achievements: Map<string, number>;
  readonly goals: Map<number, Set<string>>;
  readonly titles: Map<string, number>;
  readonly owned: Set<string>;
  readonly meta: Record<string, number>;
  settings: Record<string, unknown>;
  displayName: string | null;
}

const GUEST_RE = /^[A-Za-z0-9_-]{16,80}$/;

export function isGuestId(v: unknown): v is string {
  return typeof v === "string" && GUEST_RE.test(v);
}

export class LocalProfiles {
  private readonly byId = new Map<string, Saved>();
  private readonly listeners = new Set<(id: string) => void>();

  constructor(
    private readonly game: string,
    private readonly spec: ProfileSpec | null,
    private readonly now: () => number = Date.now,
  ) {}

  onChange(fn: (id: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private saved(id: string): Saved {
    let s = this.byId.get(id);
    if (!s) {
      s = { achievements: new Map(), goals: new Map(), titles: new Map(), owned: new Set(), meta: {}, settings: {}, displayName: null };
      this.byId.set(id, s);
    }
    return s;
  }

  private changed(id: string): void {
    for (const fn of this.listeners) fn(id);
  }

  /** Keeper indices this profile may pick (null: the game has no keepers). */
  keepers(id: string | null): number[] | null {
    const spec = this.spec;
    if (!spec || spec.keepers.length === 0) return null;
    const s = id ? this.saved(id) : null;
    return openKeepers(spec, { achievements: s ? s.achievements.keys() : [], owned: s ? s.owned : [] });
  }

  ownsCosmetic(id: string | null, value: number): boolean {
    if (value === 0) return true;
    if (!this.spec || !id) return false;
    return ownedCosmetics(this.spec, this.saved(id).owned).includes(value);
  }

  record(id: string, kind: "achievement" | "goal" | "title", item: string): void {
    const s = this.saved(id);
    if (kind === "achievement") {
      if (s.achievements.has(item)) return;
      s.achievements.set(item, this.now());
    } else if (kind === "goal") {
      const day = utcDay(this.now());
      const set = s.goals.get(day) ?? new Set<string>();
      if (set.has(item)) return;
      set.add(item);
      s.goals.set(day, set);
    } else {
      s.titles.set(item, (s.titles.get(item) ?? 0) + 1);
    }
    this.changed(id);
  }

  /** A permanent SKU bought with play money (POST /profile/redeem): the look or unlock is owned from now on. */
  redeem(id: string, item: string): { ok: boolean; error?: string } {
    const def = this.spec?.meta.get(item);
    if (def) {
      const s = this.saved(id);
      const level = s.meta[item] ?? 0;
      if (level >= def.levels) return { ok: false, error: "at the top level" };
      s.meta[item] = level + 1;
      this.changed(id);
      return { ok: true };
    }
    const sku = this.spec?.skus.get(item);
    if (!sku) return { ok: false, error: "no such item" };
    const s = this.saved(id);
    if (sku.kind === "consumable") return { ok: false, error: "a run upgrade is bought in the run" };
    s.owned.add(item);
    this.changed(id);
    return { ok: true };
  }

  /** Meta upgrade levels owned (bought with play money). */
  metaLevels(id: string | null): Readonly<Record<string, number>> {
    return id ? { ...this.saved(id).meta } : {};
  }

  settings(id: string, settings: unknown): void {
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return;
    if (JSON.stringify(settings).length > 8192) return;
    this.saved(id).settings = { ...(settings as Record<string, unknown>) };
    this.changed(id);
  }

  name(id: string, displayName: unknown): void {
    if (typeof displayName !== "string") return;
    const n = displayName.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 24);
    this.saved(id).displayName = n || null;
    this.changed(id);
  }

  view(id: string | null): GameProfile {
    const spec = this.spec;
    const day = utcDay(this.now());
    const today = spec ? todaysGoals([...spec.missions.keys()], day) : [];
    const s = id ? this.saved(id) : null;
    const owned = s ? [...s.owned] : [];
    const keeperIdx = this.keepers(id) ?? [];
    return {
      game: this.game,
      kind: id ? "guest" : null,
      wallet: null,
      displayName: s?.displayName ?? null,
      achievements: s ? [...s.achievements].map(([a, at]) => ({ id: a, at, source: "sim" as const })) : [],
      keepers: spec ? keeperIdx.map((i) => spec.keepers[i]?.id ?? "").filter(Boolean) : [],
      owned,
      cosmetics: spec ? ownedCosmetics(spec, owned) : [0],
      meta: s ? { ...s.meta } : {},
      goals: { day, today, done: s ? [...(s.goals.get(day) ?? [])].filter((g) => today.includes(g)) : [] },
      titles: s ? Object.fromEntries(s.titles) : {},
      settings: s ? { ...s.settings } : {},
      store: spec ? this.store(owned, s?.meta ?? {}) : [],
      imported: false,
      credit: 0,
      totals: { achievements: s?.achievements.size ?? 0, titles: s ? [...s.titles.values()].reduce((a, b) => a + b, 0) : 0, games: s ? 1 : 0 },
    };
  }

  private store(owned: readonly string[], meta: Readonly<Record<string, number>>): ProfileStoreItem[] {
    const spec = this.spec;
    if (!spec) return [];
    const have = new Set(owned);
    const out: ProfileStoreItem[] = [];
    for (const sku of spec.skus.values()) {
      if (sku.kind === "consumable" || !sku.grants) continue;
      const g = sku.grants;
      const mine = have.has(sku.id);
      if ("cosmetic" in g) out.push({ id: sku.id, kind: "cosmetic", coins: mine ? null : sku.coins, owned: mine, cosmetic: g.cosmetic });
      else if ("keeper" in g) out.push({ id: sku.id, kind: "unlock", coins: mine ? null : sku.coins, owned: mine, keeper: g.keeper });
      else if ("gear" in g) out.push({ id: sku.id, kind: "gear", coins: mine ? null : sku.coins, owned: mine, gear: g.gear, loseBelow: g.loseBelow });
    }
    for (const [id, def] of spec.meta) {
      const level = meta[id] ?? 0;
      out.push({ id, kind: "meta", coins: metaPrice(def, level), owned: level > 0, stat: def.stat, step: def.step, level, levels: def.levels, bonus: level * def.step });
    }
    return out;
  }
}
