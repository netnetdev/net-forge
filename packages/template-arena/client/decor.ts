/**
 * Library models the VOLTYARD scene draws on its own (template machinery,
 * not game content). The build copies these with the models game.ts uses.
 */
/** Seat bots: a different townsperson from the players' model. */
export const BOT_MODEL = "style.lowpoly.mini_male_e";
/** The blaster every wirejack holds. */
export const HELD_MODEL = "style.lowpoly.blaster_h";
/** Each transformer pillar: a generator machine. */
export const PILLAR_MODEL = "style.lowpoly.generator";
/** Wirejacks are drawn this tall, m. */
export const PLAYER_HEIGHT = 1.9;

/** [library id, height m, how many] parked outside the fence. */
export const YARD_DECOR: readonly (readonly [string, number, number])[] = [
  ["style.lowpoly.truck_flat", 2, 3],
  ["style.lowpoly.van", 2, 3],
  ["style.lowpoly.barrels", 1.3, 6],
  ["style.lowpoly.satellite_dish", 3.2, 2],
];

export const SCENE_MODELS: readonly string[] = [BOT_MODEL, HELD_MODEL, PILLAR_MODEL, ...YARD_DECOR.map(([id]) => id)];
