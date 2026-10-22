/**
 * Monster collector declarations (game({ template: "collector" })). The
 * template already runs the walkable marsh, encounters in tall grass,
 * turn-based battles, catching, a team of three, XP and levels, the shared
 * warden fight, the dusk clock and the referee; a game declares its marsh,
 * its creatures and their moves.
 *
 *   marsh({ size: [28, 18], camp: [2, 9], starters: ["mossling", "cindertail", "puddlewump"],
 *     warden: { creature: "fenwarden", at: [25, 9], level: 12, hp: 900 },
 *     grass: [{ at: [6, 3, 5, 4], rate: 0.2, pool: [{ creature: "sporecap", weight: 2, level: [2, 4] }] }] });
 *   creature("mossling", { model: "style.lowpoly.frog", element: "root", hp: 46, atk: 48, def: 50, spd: 44, moves: ["leaf_lash", "sap_drink"] });
 *   move("leaf_lash", { element: "root", power: 40 });
 */
import { z } from "zod";
import { contentOf, declareContent } from "./registry.js";
import type { GameManifest } from "./registry.js";
import { assetIdSchema, GameDefinitionError, idSchema, parseOrThrow } from "./schemas.js";

/**
 * The four elements, a cycle: each one is strong against the next and weak
 * against the one before (root soaks tide, tide shorts spark, spark cracks
 * stone, stone crushes root). Strong hits deal 1.5x, weak ones 0.67x.
 */
export const ELEMENTS = ["root", "tide", "spark", "stone"] as const;
export type Element = (typeof ELEMENTS)[number];

const rect = z.tuple([z.number().int().min(0).max(63), z.number().int().min(0).max(63), z.number().int().min(1).max(64), z.number().int().min(1).max(64)]);
const cell = z.tuple([z.number().int().min(0).max(63), z.number().int().min(0).max(63)]);

export const marshSchema = z
  .object({
    /** Tiles across and down. Each tile is 2 m. */
    size: z.tuple([z.number().int().min(10).max(64), z.number().int().min(8).max(64)]),
    /** The camp tile: everyone starts here, and a team that faints comes back here. Standing on it heals. */
    camp: cell,
    /** Creatures a new player picks one of to start (declared creatures, 1 to 4). */
    starters: z.array(idSchema).min(1).max(4),
    /** Level the starter begins at. */
    starterLevel: z.number().int().min(1).max(30).default(3),
    /** Rocks, water and thickets nobody walks through: [x, y, width, height] in tiles. */
    blocked: z.array(rect).max(64).default([]),
    /** Water among the blocked rects is drawn as water: [x, y, width, height]. */
    water: z.array(rect).max(32).default([]),
    /** Tall grass: where wild creatures are met. `rate` is the chance a step into a new grass tile starts a battle. */
    grass: z
      .array(
        z
          .object({
            at: rect,
            rate: z.number().min(0.01).max(0.6).default(0.15),
            pool: z
              .array(z.object({ creature: idSchema, weight: z.number().min(0.01).max(100).default(1), level: z.tuple([z.number().int().min(1).max(50), z.number().int().min(1).max(50)]) }).strict())
              .min(1)
              .max(12),
          })
          .strict(),
      )
      .min(1)
      .max(24),
    /**
     * The warden: one creature everyone fights together. Its health is one
     * pool for the whole marsh (more players, more health). Beating it wins
     * the run for everyone who hurt it.
     */
    warden: z
      .object({
        creature: idSchema,
        at: cell,
        level: z.number().int().min(1).max(50),
        /** Health of the shared pool for one player; +50% a player past the first. */
        hp: z.number().int().min(10).max(1_000_000),
      })
      .strict(),
    /** Seconds until dusk: the run ends then, lost unless the warden fell. */
    dusk: z.number().min(120).max(3600).default(600),
    /** Snares each player starts a run with. */
    snares: z.number().int().min(0).max(50).default(6),
    /** Walking speed, metres a second. */
    walk: z.number().min(1).max(12).default(4.5),
  })
  .strict();

export const MOVE_EFFECTS = ["none", "drain", "heal", "guard"] as const;

/**
 * A move. power 0 to 200 (40 is a plain hit), accuracy 0.3 to 1. effect:
 * "drain" heals the user half the damage dealt, "heal" (power 0 allowed)
 * heals the user `amount` of its max health, "guard" halves the next hit
 * it takes.
 */
export const moveSchema = z
  .object({
    element: z.enum(ELEMENTS, { error: `elements are: ${ELEMENTS.join(", ")}` }),
    power: z.number().int().min(0).max(200),
    accuracy: z.number().min(0.3).max(1).default(1),
    effect: z.enum(MOVE_EFFECTS).default("none"),
    /** "heal": share of max health restored. */
    amount: z.number().min(0).max(1).default(0.3),
  })
  .strict();

/**
 * A creature. Base stats at level 1 (each grows 12% a level): hp, atk,
 * def, spd (who strikes first). catchRate 0.05 to 1 scales every snare.
 * boss: the warden kind (never caught, never met in grass).
 */
export const creatureSchema = z
  .object({
    model: assetIdSchema,
    element: z.enum(ELEMENTS, { error: `elements are: ${ELEMENTS.join(", ")}` }),
    hp: z.number().int().min(5).max(999),
    atk: z.number().int().min(5).max(999),
    def: z.number().int().min(5).max(999),
    spd: z.number().int().min(5).max(999),
    moves: z.array(idSchema).min(1).max(4),
    catchRate: z.number().min(0.05).max(1).default(0.8),
    boss: z.boolean().default(false),
    /** Height of the model, metres. */
    size: z.number().min(0.3).max(6).default(1),
  })
  .strict();

export type MarshInput = z.input<typeof marshSchema>;
export type MarshDef = z.output<typeof marshSchema>;
export type MoveInput = z.input<typeof moveSchema>;
export type MoveDef = z.output<typeof moveSchema>;
export type CreatureInput = z.input<typeof creatureSchema>;
export type CreatureDef = z.output<typeof creatureSchema>;

/** The marsh: its size, camp, starters, grass, blocked tiles and warden (one per game). */
export function marsh(def: MarshInput): MarshDef {
  const parsed = parseOrThrow(marshSchema, def, "marsh()");
  declareContent("marsh", "marsh", parsed);
  return parsed;
}

/** A creature players meet, fight and catch (at most 24). */
export function creature(id: string, def: CreatureInput): CreatureDef {
  parseOrThrow(idSchema, id, "creature id");
  const parsed = parseOrThrow(creatureSchema, def, `creature("${id}")`);
  declareContent("creature", id, parsed);
  return parsed;
}

/** A move creatures use in battle (at most 48). */
export function move(id: string, def: MoveInput): MoveDef {
  parseOrThrow(idSchema, id, "move id");
  const parsed = parseOrThrow(moveSchema, def, `move("${id}")`);
  declareContent("move", id, parsed);
  return parsed;
}

/** Store upgrade stats a collector game reads: team attack, team health, team defence, extra snares, healing between battles. */
export const COLLECTOR_STATS = ["might", "maxHealth", "armor", "amount", "regen"] as const;

/** The collector content of a manifest, cross-checked (one line per issue). */
export function collectorContent(m: GameManifest): { marsh: MarshDef; creatures: [string, CreatureDef][]; moves: [string, MoveDef][] } {
  const issues: string[] = [];
  const mm = contentOf<MarshDef>(m, "marsh")[0]?.[1];
  const creatures = contentOf<CreatureDef>(m, "creature");
  const moves = contentOf<MoveDef>(m, "move");
  const cs = new Map(creatures);
  const ms = new Map(moves);
  if (!mm) issues.push('declare the marsh: marsh({ size, camp, starters, grass, warden })');
  if (creatures.length === 0) issues.push('declare at least one creature: creature("mossling", { model, element, hp, atk, def, spd, moves })');
  if (creatures.length > 24) issues.push("at most 24 creatures per game");
  if (moves.length > 48) issues.push("at most 48 moves per game");
  if (m.weapons.size > 0) issues.push("weapon(...) is for the survivor and arena templates; a collector game declares creature(...) and move(...)");
  for (const [id, u] of m.upgrades) if (!(COLLECTOR_STATS as readonly string[]).includes(u.stat)) issues.push(`upgrade("${id}") raises ${u.stat}; a collector reads ${COLLECTOR_STATS.join(", ")} (team attack, team health, team defence, extra snares, healing between battles)`);
  for (const [id, c] of creatures) for (const mv of c.moves) if (!ms.has(mv)) issues.push(`creature("${id}") knows "${mv}", which is not a declared move`);
  if (mm) {
    const [w, h] = mm.size;
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
    const blocked = (x: number, y: number) => mm.blocked.some(([bx, by, bw, bh]) => x >= bx && y >= by && x < bx + bw && y < by + bh);
    if (!inside(mm.camp[0], mm.camp[1])) issues.push(`marsh camp [${mm.camp[0]}, ${mm.camp[1]}] is off the ${w} x ${h} marsh`);
    else if (blocked(mm.camp[0], mm.camp[1])) issues.push("marsh camp stands on a blocked tile");
    if (!inside(mm.warden.at[0], mm.warden.at[1])) issues.push(`marsh warden at [${mm.warden.at[0]}, ${mm.warden.at[1]}] is off the marsh`);
    else if (blocked(mm.warden.at[0], mm.warden.at[1])) issues.push("the warden stands on a blocked tile");
    const wc = cs.get(mm.warden.creature);
    if (!wc) issues.push(`marsh warden "${mm.warden.creature}" is not a declared creature`);
    else if (!wc.boss) issues.push(`the warden "${mm.warden.creature}" needs boss: true`);
    for (const s of mm.starters) {
      const c = cs.get(s);
      if (!c) issues.push(`marsh starter "${s}" is not a declared creature`);
      else if (c.boss) issues.push(`marsh starter "${s}" is a boss`);
    }
    for (const g of mm.grass) {
      const [gx, gy, gw, gh] = g.at;
      if (!inside(gx, gy) || !inside(gx + gw - 1, gy + gh - 1)) issues.push(`grass at [${g.at.join(", ")}] runs off the marsh`);
      for (const p of g.pool) {
        const c = cs.get(p.creature);
        if (!c) issues.push(`grass pool "${p.creature}" is not a declared creature`);
        else if (c.boss) issues.push(`grass pool "${p.creature}" is a boss; bosses are never met in grass`);
        if (p.level[0] > p.level[1]) issues.push(`grass pool "${p.creature}": level [min, max] needs min <= max`);
      }
    }
    for (const [bx, by, bw, bh] of mm.blocked) if (!inside(bx, by) || !inside(bx + bw - 1, by + bh - 1)) issues.push(`blocked [${bx}, ${by}, ${bw}, ${bh}] runs off the marsh`);
  }
  if (issues.length > 0 || !mm) throw new GameDefinitionError("collector", issues);
  return { marsh: mm, creatures, moves };
}
