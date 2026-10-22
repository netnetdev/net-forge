/**
 * Library models the scene draws on its own (not named in game.ts): the
 * study around the table. The build copies these into ./library in every
 * art style (?style= may draw any).
 */
export const LAMP_MODEL = "style.lowpoly.campfire";
export const SHELF_MODELS = ["style.lowpoly.barrels", "style.lowpoly.crate", "style.lowpoly.chest", "style.lowpoly.column"] as const;
export const SCENE_MODELS: readonly string[] = [LAMP_MODEL, ...SHELF_MODELS];
