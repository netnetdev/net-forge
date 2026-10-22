/**
 * Library models the TORQUEBAY scene draws on its own (template machinery,
 * not game content). The build copies these with the models game.ts uses,
 * in every art style.
 */
/** Seat bots drive the other karts of the set. */
export const BOT_MODELS: readonly string[] = ["style.lowpoly.kart_b", "style.lowpoly.kart_c", "style.lowpoly.kart_d", "style.lowpoly.kart_e"];
export const COIN_MODEL = "style.lowpoly.coin";
/** Karts are drawn this tall, m. */
export const KART_HEIGHT = 1.1;
/** The kart models face -z; the scene drives along +x. */
export const MODEL_YAW = -Math.PI / 2;

/** Scenery past the barriers: [library id, height m, every n samples (~2 m each)]. */
export const SCENERY: readonly (readonly [string, number, number])[] = [
  ["style.lowpoly.tree_palm", 6, 7],
  ["style.lowpoly.tree_oak", 5, 9],
  ["style.lowpoly.building_c", 12, 22],
  ["style.lowpoly.barrels", 1.3, 11],
  ["style.lowpoly.truck_flat", 2.6, 19],
];

/** The pixel style's own karts (the low-poly karts have no pixel twins). */
export const PIXEL_PLAYER = "style.pixel.kart";
export const PIXEL_BOTS: readonly string[] = ["style.pixel.buggy", "style.pixel.sports_car", "style.pixel.car", "style.pixel.taxi"];

export const SCENE_MODELS: readonly string[] = [...BOT_MODELS, COIN_MODEL, ...SCENERY.map(([id]) => id), PIXEL_PLAYER, ...PIXEL_BOTS];
