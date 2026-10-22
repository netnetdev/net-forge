/**
 * Loads the game module once per process and compiles it. The room server,
 * the client, the bots and the tests all start here.
 */
import { collectManifest } from "@netnetcapital/engine/game";
import type { GameManifest } from "@netnetcapital/engine";
import { rulesAdapter, cardsGenre } from "@netnetcapital/engine/rules";
import type { RulesInput, RulesWorld, CardsState } from "@netnetcapital/engine/rules";
import type { SimAdapter } from "@netnetcapital/engine/net";
import "./game.js";

/** Content version: bump with any change to game.ts (hot swap compares it). */
export const GAME_VERSION = "inkwrit-0.1.0";
export const GAME_NAME = "inkwrit";
/** Room template (apps/rooms world/templates.ts) and place used by the client and the bots. */
export const TEMPLATE = "cards";
export const PLACE = "study";

/**
 * Collected as soon as the module is imported: one process may load more
 * than one game module (the room server hosts every template), and each
 * manifest takes its own game before the next module declares.
 */
const MANIFEST = collectManifest();
let genre: ReturnType<typeof cardsGenre> | null = null;

/** The game's manifest (every declaration). */
export function cardsManifest(): GameManifest {
  return MANIFEST;
}

/** The compiled card battler genre (table, cards, AI). */
export function cardsGame(): ReturnType<typeof cardsGenre> {
  genre ??= cardsGenre(MANIFEST);
  return genre;
}

/** The SimAdapter the room server and the client both run. */
export function cardsAdapter(): SimAdapter<RulesWorld<CardsState>, RulesInput> {
  return rulesAdapter(cardsGame(), MANIFEST, { name: GAME_NAME, version: GAME_VERSION });
}

/** Cosmetic ids for store SKUs (0 is the default finish). */
export const COSMETICS: Readonly<Record<string, number>> = { skin_vermilion: 1, skin_gold_leaf: 2 };
