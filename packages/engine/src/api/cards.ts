/**
 * Card battler declarations (game({ template: "cards" })). The template
 * already runs the duel (heroes, mana, draws, a board of units, spells,
 * guards, the turn timer), the gauntlet of duels with a draft between
 * them, the server-side shuffle, hidden hands, the AI opponents and the
 * referee. A game declares its table rules and its cards.
 *
 *   cardTable({ health: 20, duels: 4, starter: ["blot_imp", "blot_imp", ...], ai: [{ health: 14, smart: 0.3 }] });
 *   card("ink_frog", { model: "style.lowpoly.frog", kind: "unit", cost: 2, attack: 2, health: 3 });
 *   card("splash", { model: "style.lowpoly.crystal", kind: "spell", cost: 1, effect: { kind: "damage", amount: 2, target: "enemy" } });
 */
import { z } from "zod";
import { contentOf, declareContent } from "./registry.js";
import type { GameManifest } from "./registry.js";
import { assetIdSchema, GameDefinitionError, idSchema, parseOrThrow } from "./schemas.js";

export const EFFECT_KINDS = ["damage", "heal", "draw", "buff"] as const;
/**
 * Who an effect hits. "enemy": the player picks an enemy unit or the enemy
 * hero; "enemy_hero"; "all_enemies": every enemy unit; "own_hero";
 * "own_unit": the player picks one of their units; "all_own": every unit
 * they have. draw ignores the target.
 */
export const EFFECT_TARGETS = ["enemy", "enemy_hero", "all_enemies", "own_hero", "own_unit", "all_own"] as const;

export const cardEffectSchema = z
  .object({
    kind: z.enum(EFFECT_KINDS, { error: `effect kinds are: ${EFFECT_KINDS.join(", ")}` }),
    /** Damage, healing, cards drawn, or attack and health added (buff). */
    amount: z.number().int().min(1).max(30),
    target: z.enum(EFFECT_TARGETS, { error: `effect targets are: ${EFFECT_TARGETS.join(", ")}` }).default("enemy"),
  })
  .strict();

/**
 * A card. A "unit" stands on the board with attack and health; `guard`
 * units must be attacked first; `rush` units may attack the turn they are
 * played. A unit's `effect` happens when it is played. A "spell" is only
 * its effect. cost is mana (0 to 10).
 */
export const cardSchema = z
  .object({
    model: assetIdSchema,
    kind: z.enum(["unit", "spell"]),
    cost: z.number().int().min(0).max(10),
    attack: z.number().int().min(0).max(30).default(0),
    health: z.number().int().min(0).max(60).default(0),
    guard: z.boolean().default(false),
    rush: z.boolean().default(false),
    effect: cardEffectSchema.optional(),
  })
  .strict()
  .refine((c) => c.kind === "spell" || c.health >= 1, "a unit needs health of at least 1")
  .refine((c) => c.kind === "unit" || c.effect !== undefined, "a spell needs an effect");

export const cardTableSchema = z
  .object({
    /** Each hero's health at the start of a duel. */
    health: z.number().int().min(5).max(100).default(20),
    /** Cards in hand at the start of a duel (the second player draws one more). */
    startHand: z.number().int().min(1).max(7).default(3),
    handMax: z.number().int().min(3).max(10).default(7),
    boardMax: z.number().int().min(1).max(7).default(5),
    /** Mana rises by one a turn up to this. */
    manaMax: z.number().int().min(1).max(10).default(10),
    /** Seconds a turn lasts before it ends by itself. */
    turnSeconds: z.number().min(10).max(120).default(30),
    /** Seconds to pick a card between duels (the best card is picked for a player who does not). */
    draftSeconds: z.number().min(5).max(60).default(15),
    /** Duels in a run (the gauntlet). A draft follows every duel but the last. */
    duels: z.number().int().min(1).max(12).default(4),
    /** Each player's starting deck: declared card ids, 8 to 30 cards. */
    starter: z.array(idSchema).min(8).max(30),
    /** Cards the draft offers (default: every declared card). */
    pool: z.array(idSchema).max(60).optional(),
    /**
     * The AI opponents of the gauntlet, in order: duel n against the AI uses
     * tier n (the last tier repeats). health is the AI hero's health; smart
     * (0 to 1) how often it plays its best move.
     */
    ai: z
      .array(z.object({ health: z.number().int().min(5).max(100), smart: z.number().min(0).max(1) }).strict())
      .min(1)
      .max(12),
    /** Turns a duel may last before it ends in a draw. */
    turnCap: z.number().int().min(10).max(200).default(40),
  })
  .strict();

export type CardInput = z.input<typeof cardSchema>;
export type CardDef = z.output<typeof cardSchema>;
export type CardTableInput = z.input<typeof cardTableSchema>;
export type CardTableDef = z.output<typeof cardTableSchema>;

/** The table: hero health, hand and board sizes, the gauntlet, the starter deck and the AI tiers (one per game). */
export function cardTable(def: CardTableInput): CardTableDef {
  const parsed = parseOrThrow(cardTableSchema, def, "cardTable()");
  declareContent("cardTable", "table", parsed);
  return parsed;
}

/** A card (at most 40). */
export function card(id: string, def: CardInput): CardDef {
  parseOrThrow(idSchema, id, "card id");
  const parsed = parseOrThrow(cardSchema, def, `card("${id}")`);
  declareContent("card", id, parsed);
  return parsed;
}

/** Store upgrade stats a card battler reads: hero health, unit attack, starting mana, starting hand. */
export const CARD_STATS = ["maxHealth", "might", "haste", "amount"] as const;

/** The card battler content of a manifest, cross-checked (one line per issue). */
export function cardsContent(m: GameManifest): { table: CardTableDef; cards: [string, CardDef][] } {
  const issues: string[] = [];
  const table = contentOf<CardTableDef>(m, "cardTable")[0]?.[1];
  const cards = contentOf<CardDef>(m, "card");
  if (!table) issues.push("declare the table: cardTable({ health, duels, starter: [...], ai: [{ health, smart }] })");
  if (cards.length < 4) issues.push('declare at least 4 cards: card("ink_frog", { model, kind: "unit", cost, attack, health })');
  if (cards.length > 40) issues.push("at most 40 cards per game");
  if (m.weapons.size > 0) issues.push("weapon(...) is for the survivor and arena templates; a card battler declares card(...)");
  if (m.game.players.max > 2) issues.push("players.max is at most 2: a duel is one against one");
  for (const [id, u] of m.upgrades) if (!(CARD_STATS as readonly string[]).includes(u.stat)) issues.push(`upgrade("${id}") raises ${u.stat}; a card battler reads ${CARD_STATS.join(", ")} (hero health, unit attack, starting mana, starting hand)`);
  const ids = new Set(cards.map(([id]) => id));
  if (table) {
    for (const id of table.starter) if (!ids.has(id)) issues.push(`cardTable starter has "${id}", which is not a declared card`);
    for (const id of table.pool ?? []) if (!ids.has(id)) issues.push(`cardTable pool has "${id}", which is not a declared card`);
    if (!table.starter.some((id) => cards.find(([c]) => c === id)?.[1].kind === "unit")) issues.push("the starter deck needs at least one unit card");
    if (!table.starter.some((id) => (cards.find(([c]) => c === id)?.[1].cost ?? 99) <= 2)) issues.push("the starter deck needs cards costing 2 or less, or the first turns have nothing to play");
  }
  if (issues.length > 0 || !table) throw new GameDefinitionError("card battler", issues);
  return { table, cards };
}
