/**
 * Library models the scene draws on its own (not named in game.ts): the
 * camp, the reeds, the rocks and trees of the marsh, the warden's mound.
 * The build copies these into ./library, in every art style.
 */
export const TENT_MODEL = "style.lowpoly.tent";
export const FIRE_MODEL = "style.lowpoly.campfire";
export const REED_MODEL = "style.lowpoly.bush";
export const ROCK_MODEL = "style.lowpoly.rock_tall";
export const TREE_MODELS = ["style.lowpoly.tree_pine", "style.lowpoly.tree_dark", "style.lowpoly.tree_fat"] as const;
export const MOUND_MODEL = "style.lowpoly.column_broken";
export const SMALL_DECOR = ["style.lowpoly.mushroom_red", "style.lowpoly.flower_red", "style.lowpoly.stump", "style.lowpoly.log"] as const;
export const SCENE_MODELS: readonly string[] = [TENT_MODEL, FIRE_MODEL, REED_MODEL, ROCK_MODEL, ...TREE_MODELS, MOUND_MODEL, ...SMALL_DECOR];
