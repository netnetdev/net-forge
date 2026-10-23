/**
 * Loads the game module once per process and compiles it. The room server,
 * the client, the bots and the tests all start here.
 */
import { collectManifest } from "@netforge/engine/game";
import type { GameManifest } from "@netforge/engine";
import { rulesAdapter, collectorGenre } from "@netforge/engine/rules";
import type { RulesInput, RulesWorld, CollectorState } from "@netforge/engine/rules";
import type { SimAdapter } from "@netforge/engine/net";
import "./game.js";

/** Content version: bump with any change to game.ts (hot swap compares it). */
export const GAME_VERSION = "mossbound-0.1.0";
export const GAME_NAME = "mossbound";
/** Room template (as the Net Forge room server names it) and place used by the client and the bots. */
export const TEMPLATE = "collector";
export const PLACE = "fen";

/**
 * Collected as soon as the module is imported: one process may load more
 * than one game module (the room server hosts every template), and each
 * manifest takes its own game before the next module declares.
 */
const MANIFEST = collectManifest();
let genre: ReturnType<typeof collectorGenre> | null = null;

/** The game's manifest (every declaration). */
export function collectorManifest(): GameManifest {
  return MANIFEST;
}

/** The compiled collector genre (marsh, creatures, moves). */
export function collectorGame(): ReturnType<typeof collectorGenre> {
  genre ??= collectorGenre(MANIFEST);
  return genre;
}

/** The SimAdapter the room server and the client both run. */
export function collectorAdapter(): SimAdapter<RulesWorld<CollectorState>, RulesInput> {
  return rulesAdapter(collectorGame(), MANIFEST, { name: GAME_NAME, version: GAME_VERSION });
}

/** Cosmetic ids for store SKUs (0 is the default finish). */
export const COSMETICS: Readonly<Record<string, number>> = { skin_lichen: 1, skin_amber: 2 };
