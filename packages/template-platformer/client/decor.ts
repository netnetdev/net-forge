/**
 * Library models the SKYLEDGE scene draws on its own (template machinery,
 * not game content). The build copies these with the models game.ts uses,
 * in every art style.
 */
/** Seat bots: a different climber from the players' model. */
export const BOT_MODEL = "style.lowpoly.mini_female_c";
/** Every course's coins. */
export const COIN_MODEL = "style.lowpoly.coin";
/** Climbers are drawn this tall, m (the body box is 1.4 m). */
export const PLAYER_HEIGHT = 1.45;

/** Scenery on the cliff tops behind the course: [library id, height m, how far back it may stand m]. */
export const BACKDROP: readonly (readonly [string, number, number])[] = [
  ["style.lowpoly.tree_pine", 4.2, 2.5],
  ["style.lowpoly.tree_oak", 3.6, 2.5],
  ["style.lowpoly.rock_small", 0.7, 2],
  ["style.lowpoly.bush", 0.9, 1.5],
  ["style.lowpoly.mushroom_red", 0.5, 1],
];

export const SCENE_MODELS: readonly string[] = [BOT_MODEL, COIN_MODEL, ...BACKDROP.map(([id]) => id)];
