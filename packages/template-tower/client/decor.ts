/**
 * Library models the scene draws on its own (not named in game.ts): the
 * spire, the gate, the moor's trees and rocks. The build copies these into
 * ./library next to the page, in every art style (?style= may draw any).
 */
export const SPIRE_MODEL = "style.lowpoly.obelisk";
export const GATE_MODEL = "style.lowpoly.column_broken";
export const ROCK_MODEL = "style.lowpoly.rock_large";
export const TREE_MODELS = ["style.lowpoly.tree_pine", "style.lowpoly.tree_autumn", "style.lowpoly.tree_fat", "style.lowpoly.bush"] as const;
export const SMALL_DECOR = ["style.lowpoly.rock_small", "style.lowpoly.mushroom_red", "style.lowpoly.stump", "style.lowpoly.flower_red"] as const;
export const SCENE_MODELS: readonly string[] = [SPIRE_MODEL, GATE_MODEL, ROCK_MODEL, ...TREE_MODELS, ...SMALL_DECOR];
