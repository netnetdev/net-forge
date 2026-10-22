/**
 * Tower defense declarations (game({ template: "tower-defense" })). The
 * template already runs the board, the path, the waves, targeting, gold,
 * co-op and the referee; a game declares its board, its towers and its
 * waves. Creeps are ordinary prefab(...)s: model, health, speed (m/s),
 * value (the gold bounty), damage (lives a leak costs, default 1) and boss.
 *
 *   towerBoard({ size: [18, 12], path: [[0, 2], [7, 2], [7, 9], [17, 9]], lives: 20, gold: 120 });
 *   tower("bolt_post", { model: "style.lowpoly.turret", kind: "bolt", cost: 40, damage: 9, rate: 1.6, range: 3,
 *     levels: [{ cost: 45, damage: 15 }, { cost: 80, damage: 26, range: 3.6 }] });
 *   waves({ total: 20, groups: [{ prefab: "rustling", count: 8, grow: 1.5, gap: 0.8 }] });
 */
import { z } from "zod";
import { contentOf, declareContent } from "./registry.js";
import type { GameManifest } from "./registry.js";
import { assetIdSchema, feelSchema, GameDefinitionError, idSchema, parseOrThrow } from "./schemas.js";

const cell = z.tuple([z.number().int().min(0).max(39), z.number().int().min(0).max(39)]);

export const towerBoardSchema = z
  .object({
    /** Tiles across and down. Each tile is 2 m. */
    size: z.tuple([z.number().int().min(8).max(32), z.number().int().min(6).max(24)]),
    /** The creeps' road: tile waypoints joined by straight runs (each step changes x or y, not both). Starts and ends on the board's edge. */
    path: z.array(cell).min(2).max(24),
    /** Tiles nobody can build on (rocks, ruins). */
    blocked: z.array(cell).max(96).default([]),
    /** Leaks the team can take before the run is lost. */
    lives: z.number().int().min(1).max(200).default(20),
    /** Gold each player starts a run with (gold is the run's own money, never coins). */
    gold: z.number().int().min(0).max(100_000).default(100),
    /** Seconds to build before the first wave. */
    prep: z.number().min(3).max(120).default(15),
    /** Seconds between waves (everyone pressing Ready skips the rest, for gold). */
    breather: z.number().min(2).max(120).default(10),
    /** Share of every bounty paid to each other player too (co-op), 0..1. */
    share: z.number().min(0).max(1).default(0.25),
    /** Gold each player gets for a cleared wave: base + perWave x wave. */
    waveGold: z.object({ base: z.number().int().min(0).max(10_000), perWave: z.number().int().min(0).max(10_000) }).strict().default({ base: 10, perWave: 2 }),
    /** Fraction of a tower's cost a sale returns. */
    refund: z.number().min(0).max(1).default(0.6),
  })
  .strict();

export const TOWER_KINDS = ["bolt", "splash", "frost", "chain"] as const;

const towerLevelSchema = z
  .object({
    cost: z.number().int().min(1).max(100_000),
    damage: z.number().min(0).max(1_000_000).optional(),
    rate: z.number().min(0.1).max(20).optional(),
    range: z.number().min(1).max(12).optional(),
    radius: z.number().min(0.2).max(4).optional(),
    slow: z.number().min(0).max(0.9).optional(),
    chains: z.number().int().min(1).max(8).optional(),
  })
  .strict();

/**
 * A tower. kind "bolt" hits one creep; "splash" hits every creep within
 * `radius` tiles of its target; "frost" hits and slows (`slow` 0..0.9 for
 * `slowSeconds`); "chain" jumps to `chains` creeps in a row, 30% weaker a
 * jump. Damage per hit, rate in shots a second, range and radius in tiles.
 * `levels` are the upgrades, each one's cost and what it changes.
 */
export const towerSchema = z
  .object({
    model: assetIdSchema,
    kind: z.enum(TOWER_KINDS, { error: `tower kinds are: ${TOWER_KINDS.join(", ")}` }),
    cost: z.number().int().min(1).max(100_000),
    damage: z.number().min(0).max(1_000_000),
    rate: z.number().min(0.1).max(20),
    range: z.number().min(1).max(12),
    radius: z.number().min(0.2).max(4).default(1),
    slow: z.number().min(0).max(0.9).default(0),
    slowSeconds: z.number().min(0.2).max(10).default(1.5),
    chains: z.number().int().min(1).max(8).default(3),
    levels: z.array(towerLevelSchema).max(4).default([]),
    feel: feelSchema.optional(),
  })
  .strict();

const waveGroupSchema = z
  .object({
    /** A declared prefab (the creep). */
    prefab: idSchema,
    /** First wave it comes in (1-based). */
    from: z.number().int().min(1).default(1),
    /** Last wave it comes in. */
    until: z.number().int().min(1).optional(),
    /** Comes every this many waves from `from` (a boss every 5: from 5, every 5). */
    every: z.number().int().min(1).default(1),
    /** How many in its first wave. */
    count: z.number().min(1).max(500),
    /** How many more each later wave it comes in. */
    grow: z.number().min(0).max(50).default(0),
    /** Seconds between two of them. */
    gap: z.number().min(0.05).max(10).default(0.8),
    /** Seconds into the wave the group starts. */
    delay: z.number().min(0).max(60).default(0),
  })
  .strict();

export const wavesSchema = z
  .object({
    /** Waves to clear to win the run. */
    total: z.number().int().min(1).max(100),
    groups: z.array(waveGroupSchema).min(1).max(12),
    /** Creep health grows by this much a wave: health x (1 + health x (wave - 1)). */
    health: z.number().min(0).max(2).default(0.1),
  })
  .strict();

export type TowerBoardInput = z.input<typeof towerBoardSchema>;
export type TowerBoardDef = z.output<typeof towerBoardSchema>;
export type TowerInput = z.input<typeof towerSchema>;
export type TowerDef = z.output<typeof towerSchema>;
export type WavesInput = z.input<typeof wavesSchema>;
export type WavesDef = z.output<typeof wavesSchema>;

/** The board: its size, the creeps' road, lives and starting gold (one per game). */
export function towerBoard(def: TowerBoardInput): TowerBoardDef {
  const parsed = parseOrThrow(towerBoardSchema, def, "towerBoard()");
  declareContent("towerBoard", "board", parsed);
  return parsed;
}

/** A tower players build (at most 8). */
export function tower(id: string, def: TowerInput): TowerDef {
  parseOrThrow(idSchema, id, "tower id");
  const parsed = parseOrThrow(towerSchema, def, `tower("${id}")`);
  declareContent("tower", id, parsed);
  return parsed;
}

/** The waves (one per game). */
export function waves(def: WavesInput): WavesDef {
  const parsed = parseOrThrow(wavesSchema, def, "waves()");
  declareContent("waves", "waves", parsed);
  return parsed;
}

/** Store upgrade stats a tower defense game reads: tower damage, fire rate, range, and team lives. */
export const TOWER_STATS = ["might", "haste", "area", "maxHealth"] as const;

/** The tower defense content of a manifest, cross-checked (one line per issue). */
export function towerContent(m: GameManifest): { board: TowerBoardDef; towers: [string, TowerDef][]; waves: WavesDef } {
  const issues: string[] = [];
  const board = contentOf<TowerBoardDef>(m, "towerBoard")[0]?.[1];
  const towers = contentOf<TowerDef>(m, "tower");
  const wv = contentOf<WavesDef>(m, "waves")[0]?.[1];
  if (!board) issues.push("declare the board: towerBoard({ size, path, lives, gold })");
  if (!wv) issues.push("declare the waves: waves({ total, groups: [{ prefab, count, grow, gap }] })");
  if (towers.length === 0) issues.push('declare at least one tower: tower("bolt_post", { model, kind: "bolt", cost, damage, rate, range })');
  if (towers.length > 8) issues.push("at most 8 towers per game");
  if (m.weapons.size > 0) issues.push("weapon(...) is for the survivor and arena templates; a tower defense game declares tower(...)");
  for (const [id, u] of m.upgrades) if (!(TOWER_STATS as readonly string[]).includes(u.stat)) issues.push(`upgrade("${id}") raises ${u.stat}; tower defense reads ${TOWER_STATS.join(", ")} (tower damage, fire rate, range, team lives)`);
  if (board) {
    const [w, h] = board.size;
    const inside = ([x, y]: readonly [number, number]) => x >= 0 && y >= 0 && x < w && y < h;
    for (const p of board.path) if (!inside(p)) issues.push(`towerBoard path point [${p[0]}, ${p[1]}] is off the ${w} x ${h} board`);
    for (let i = 1; i < board.path.length; i++) {
      const a = board.path[i - 1] as [number, number];
      const b = board.path[i] as [number, number];
      if (a[0] !== b[0] && a[1] !== b[1]) issues.push(`towerBoard path steps from [${a[0]}, ${a[1]}] to [${b[0]}, ${b[1]}] diagonally; each step changes x or y, not both`);
      if (a[0] === b[0] && a[1] === b[1]) issues.push(`towerBoard path repeats [${a[0]}, ${a[1]}]`);
    }
    const edge = ([x, y]: readonly [number, number]) => x === 0 || y === 0 || x === w - 1 || y === h - 1;
    const first = board.path[0];
    const last = board.path[board.path.length - 1];
    if (first && !edge(first)) issues.push("the path starts on the board's edge (where creeps come in)");
    if (last && !edge(last)) issues.push("the path ends on the board's edge (the spire stands there)");
  }
  if (wv) {
    for (const g of wv.groups) {
      const p = m.prefabs.get(g.prefab);
      if (!p) issues.push(`waves group "${g.prefab}" is not a declared prefab`);
      else if (p.kind === "pickup") issues.push(`waves group "${g.prefab}" is a pickup, not a creep`);
      if (g.until !== undefined && g.until < g.from) issues.push(`waves group "${g.prefab}": until must not be before from`);
      if (g.from > wv.total) issues.push(`waves group "${g.prefab}" starts at wave ${g.from}, after the last wave (${wv.total})`);
    }
  }
  if (issues.length > 0 || !board || !wv) throw new GameDefinitionError("tower defense", issues);
  return { board, towers, waves: wv };
}
