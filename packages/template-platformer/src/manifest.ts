/**
 * Loads the game module once per process and compiles it. The room server,
 * the client, the bots and the tests all start here.
 */
import { collectManifest, compileGame, platformAdapter } from "@netforge/engine/game";
import type { CompiledGame, CompiledPlatformer, PlatformRoomWorld, RaceRunnerOptions } from "@netforge/engine/game";
import type { SimAdapter } from "@netforge/engine/net";
import type { InputCommand } from "@netforge/engine-sim";
import "./game.js";

/** Content version: bump with any change to game.ts (hot swap compares it). */
export const GAME_VERSION = "skyledge-0.1.0";
export const GAME_NAME = "skyledge";
/** Room template (as the Net Forge room server names it) and place used by the client and the bots. */
export const TEMPLATE = "platformer";
export const PLACE = "cliffs";

/**
 * Collected as soon as the module is imported: one process may load more
 * than one game module (the room server hosts every template), and each
 * manifest takes its own game before the next module declares.
 */
const MANIFEST = collectManifest();
let compiled: CompiledGame | null = null;

/** The compiled game (levels, motor, upgrades). */
export function platformerGame(): CompiledGame & { readonly platformer: CompiledPlatformer } {
  compiled ??= compileGame(MANIFEST);
  if (!compiled.platformer) throw new Error("SKYLEDGE: game.ts must declare template \"platformer\"");
  return compiled as CompiledGame & { readonly platformer: CompiledPlatformer };
}

/** The SimAdapter for this game. `runner` options are server-side timing overrides (tests). */
export function platformerAdapter(runner?: RaceRunnerOptions): SimAdapter<PlatformRoomWorld, InputCommand> {
  const g = platformerGame();
  return platformAdapter({
    name: GAME_NAME,
    version: GAME_VERSION,
    manifest: g.manifest,
    compiled: g.platformer,
    tickRate: g.tickRate,
    bots: g.bots,
    roundSeconds: g.round?.seconds ?? null,
    ...(runner ? { runner } : {}),
  });
}

/** Cosmetic ids for store SKUs (0 is the default outfit). */
export const COSMETICS: Readonly<Record<string, number>> = { skin_sunset: 1, skin_frost: 2 };
