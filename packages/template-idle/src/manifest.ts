/**
 * Loads the game module once per process and compiles it. The room server,
 * the client, the bots and the tests all start here.
 */
import { collectManifest } from "@netforge/engine/game";
import type { GameManifest } from "@netforge/engine";
import { rulesAdapter, idleGenre } from "@netforge/engine/rules";
import type { RulesInput, RulesWorld, IdleState } from "@netforge/engine/rules";
import type { SimAdapter } from "@netforge/engine/net";
import "./game.js";

/** Content version: bump with any change to game.ts (hot swap compares it). */
export const GAME_VERSION = "brineworks-0.1.0";
export const GAME_NAME = "brineworks";
/** Room template (as the Net Forge room server names it) and place used by the client and the bots. */
export const TEMPLATE = "idle";
export const PLACE = "flat";

/**
 * Collected as soon as the module is imported: one process may load more
 * than one game module (the room server hosts every template), and each
 * manifest takes its own game before the next module declares.
 */
const MANIFEST = collectManifest();
let genre: ReturnType<typeof idleGenre> | null = null;

/** The game's manifest (every declaration). */
export function idleManifest(): GameManifest {
  return MANIFEST;
}

/** The compiled idle genre (flat, plants). */
export function idleGame(): ReturnType<typeof idleGenre> {
  genre ??= idleGenre(MANIFEST);
  return genre;
}

/** The SimAdapter the room server and the client both run. */
export function idleAdapter(): SimAdapter<RulesWorld<IdleState>, RulesInput> {
  return rulesAdapter(idleGame(), MANIFEST, { name: GAME_NAME, version: GAME_VERSION });
}

/** Cosmetic ids for store SKUs (0 is the default finish). */
export const COSMETICS: Readonly<Record<string, number>> = { skin_saltwhite: 1, skin_rust: 2 };
