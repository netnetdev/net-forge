/**
 * Loads the game module once per process and compiles it. The room server,
 * the client, the bots and the tests all start here.
 */
import { collectManifest, compileGame, engineSimAdapter } from "@netforge/engine/game";
import type { CompiledGame, EngineRoomWorld, RunnerOptions } from "@netforge/engine/game";
import type { SimAdapter } from "@netforge/engine/net";
import type { InputCommand } from "@netforge/engine-sim";
import "./game.js";

/** Content version: bump with any change to game.ts (hot swap compares it). */
export const GAME_VERSION = "voltyard-0.1.1";
export const GAME_NAME = "voltyard";
/** Room template (as the Net Forge room server names it) and place used by the client and the bots. */
export const TEMPLATE = "shooter";
export const PLACE = "yard";

/**
 * Collected as soon as the module is imported: one process may load more
 * than one game module (the room server hosts every template), and each
 * manifest takes its own game before the next module declares.
 */
const MANIFEST = collectManifest();
let compiled: CompiledGame | null = null;

/** The compiled game (weapons, loadout, arena, rounds as sim content). */
export function arenaGame(): CompiledGame {
  compiled ??= compileGame(MANIFEST);
  return compiled;
}

/** The SimAdapter for this game. `runner` options are server-side measurement modes. */
export function arenaAdapter(runner?: RunnerOptions): SimAdapter<EngineRoomWorld, InputCommand> {
  return engineSimAdapter({ name: GAME_NAME, version: GAME_VERSION, game: arenaGame(), ...(runner ? { runner } : {}) });
}

/** Cosmetic ids for store SKUs (0 is the default finish). */
export const COSMETICS: Readonly<Record<string, number>> = { skin_neon: 1, skin_chrome: 2 };
