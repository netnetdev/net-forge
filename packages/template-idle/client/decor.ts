/** Library models the scene draws on its own: the barge, crystals, the flat's edge. Copied into ./library in every art style. */
export const BARGE_MODEL = "style.lowpoly.cargo_ship";
export const CRYSTAL_MODEL = "style.lowpoly.crystal";
export const EDGE_MODELS = ["style.lowpoly.rock_small", "style.lowpoly.cactus", "style.lowpoly.rock_tall", "style.lowpoly.tent"] as const;
export const SCENE_MODELS: readonly string[] = [BARGE_MODEL, CRYSTAL_MODEL, ...EDGE_MODELS];
