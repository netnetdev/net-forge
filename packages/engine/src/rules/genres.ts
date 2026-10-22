/**
 * Board genres by engine template (game({ template })). The room server,
 * the headless harness, the gate and the template clients all build a
 * genre from a game's manifest here. Each template adds one line.
 */
import type { GameManifest } from "../api/registry.js";
import type { RulesGenre } from "./kit.js";
import { idleGenre } from "./idle.js";
import { collectorGenre } from "./collector.js";
import { towerGenre } from "./tower.js";
import { cardsGenre } from "./cards.js";

type Factory = (m: GameManifest) => RulesGenre<unknown>;

const GENRES: Readonly<Record<string, Factory>> = {
  "tower-defense": (m) => towerGenre(m) as RulesGenre<unknown>,
  idle: (m) => idleGenre(m) as RulesGenre<unknown>,
  cards: (m) => cardsGenre(m) as RulesGenre<unknown>,
  collector: (m) => collectorGenre(m) as RulesGenre<unknown>,
};

/**
 * The content kind each genre labels in names.json "weapons" (the model's
 * labels file keeps one table for a game's tools: towers, cards, moves).
 */
const LABELLED: Readonly<Record<string, string>> = {
  "tower-defense": "tower",
  idle: "plant",
  cards: "card",
  collector: "creature",
};

/** Ids of the content players read labels for (towers, cards...), in declaration order. */
export function labelledContent(m: GameManifest): string[] {
  const kind = LABELLED[m.game.template];
  if (!kind) return [];
  return [...m.content.keys()].filter((k) => k.startsWith(`${kind}:`)).map((k) => k.slice(kind.length + 1));
}

/** True when a template plays on a board genre (not engine-sim's action world). */
export function isRulesTemplate(template: string): boolean {
  return Object.prototype.hasOwnProperty.call(GENRES, template);
}

/** The genre for a game manifest; throws GameDefinitionError lines through the genre's compile. */
export function genreFor(m: GameManifest): RulesGenre<unknown> {
  const f = GENRES[m.game.template];
  if (!f) throw new Error(`template "${m.game.template}" is not a board genre`);
  return f(m);
}
