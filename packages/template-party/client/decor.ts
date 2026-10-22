/**
 * Library models the ROMPHOUSE scene draws on its own (template machinery,
 * not game content). The playroom draws its walls, floor and lights itself.
 * The build copies these with the models game.ts uses.
 */

/** Enemy models are drawn about this many hit radii tall. */
export const ENEMY_HEIGHT_PER_RADIUS = 3.2;
/** Keepers are drawn this tall, m. */
export const KEEPER_HEIGHT = 1.8;

/** The playroom draws its own walls, floor and lights: no library dressing of its own. */
export const SCENE_MODELS: readonly string[] = [];
