/**
 * Library models the CRYPTWICK scene draws on its own (template machinery,
 * not game content). The crypt draws its walls, floors and candles itself.
 * The build copies these with the models game.ts uses.
 */

/** Enemy models are drawn about this many hit radii tall. */
export const ENEMY_HEIGHT_PER_RADIUS = 3.2;
/** Keepers are drawn this tall, m. */
export const KEEPER_HEIGHT = 1.8;

/** The crypt draws its own walls, floors and candles: no library dressing of its own. */
export const SCENE_MODELS: readonly string[] = [];
