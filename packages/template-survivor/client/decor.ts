/**
 * Library models the EMBERWATCH scene draws on its own (template machinery,
 * not game content): the forest past the wall.
 * The build copies these with the models game.ts uses.
 */

/** Enemy models are drawn about this many hit radii tall. */
export const ENEMY_HEIGHT_PER_RADIUS = 3.2;
/** Keepers are drawn this tall, m. */
export const KEEPER_HEIGHT = 1.8;

/** [library id, height m, how many] in a ring outside the wall. */
export const DECOR: readonly (readonly [string, number, number])[] = [
  ["style.lowpoly.tree_pine", 5.5, 26],
  ["style.lowpoly.tree_pine_tall", 7.5, 14],
  ["style.lowpoly.tree_dark", 5, 14],
  ["style.lowpoly.rock_large", 1.8, 12],
  ["style.lowpoly.stump", 0.7, 10],
];

export const SCENE_MODELS: readonly string[] = DECOR.map(([id]) => id);
