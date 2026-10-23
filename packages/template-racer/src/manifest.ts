/**
 * Loads the game module once per process and compiles it. The room server,
 * the client, the bots and the tests all start here.
 */
import { collectManifest, compileGame, kartAdapter } from "@netforge/engine/game";
import type { CompiledGame, CompiledRacer, KartRoomWorld, RaceRunnerOptions } from "@netforge/engine/game";
import type { SimAdapter } from "@netforge/engine/net";
import type { InputCommand } from "@netforge/engine-sim";
import "./game.js";

/** Content version: bump with any change to game.ts (hot swap compares it). */
export const GAME_VERSION = "torquebay-0.1.0";
export const GAME_NAME = "torquebay";
/** Room template (as the Net Forge room server names it) and place used by the client and the bots. */
export const TEMPLATE = "racer";
export const PLACE = "harbour";

const MANIFEST = collectManifest();
let compiled: CompiledGame | null = null;

/** The compiled game (tracks, handling, upgrades). */
export function racerGame(): CompiledGame & { readonly racer: CompiledRacer } {
  compiled ??= compileGame(MANIFEST);
  if (!compiled.racer) throw new Error('TORQUEBAY: game.ts must declare template "racer"');
  return compiled as CompiledGame & { readonly racer: CompiledRacer };
}

/** The SimAdapter for this game. `runner` options are server-side timing overrides (tests). */
export function racerAdapter(runner?: RaceRunnerOptions): SimAdapter<KartRoomWorld, InputCommand> {
  const g = racerGame();
  return kartAdapter({
    name: GAME_NAME,
    version: GAME_VERSION,
    manifest: g.manifest,
    compiled: g.racer,
    tickRate: g.tickRate,
    bots: g.bots,
    roundSeconds: g.round?.seconds ?? null,
    ...(runner ? { runner } : {}),
  });
}

/** Cosmetic ids for store SKUs (0 is the kart's own paint). */
export const COSMETICS: Readonly<Record<string, number>> = { skin_flame: 1, skin_chrome: 2 };
