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
export const GAME_VERSION = "romphouse-0.1.0";
export const GAME_NAME = "romphouse";
/** Room template and place used by the client and the bots. */
export const TEMPLATE = "party";
export const PLACE = "playroom";

/**
 * Collected as soon as the module is imported: one process may load more
 * than one game module (the room server hosts every template), and each
 * manifest takes its own game before the next module declares.
 */
const MANIFEST = collectManifest();
let compiled: CompiledGame | null = null;

/** The compiled game (prefabs, weapons, upgrades and the playroom's walls and floor as sim content). */
export function partyGame(): CompiledGame {
  compiled ??= compileGame(MANIFEST);
  return compiled;
}

/** The SimAdapter for this game. `runner` options are server-side measurement modes. */
export function partyAdapter(runner?: RunnerOptions): SimAdapter<EngineRoomWorld, InputCommand> {
  return engineSimAdapter({ name: GAME_NAME, version: GAME_VERSION, game: partyGame(), ...(runner ? { runner } : {}) });
}

/** Cosmetic ids for store SKUs (0 is the default palette). */
export const COSMETICS: Readonly<Record<string, number>> = { skin_disco: 1 };
