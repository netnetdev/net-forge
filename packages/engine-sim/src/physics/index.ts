/** Rigid-body physics for games (see README "Physics"). */
export { createPhysics, restorePhysics, PhysicsWorld } from "./world.js";
export type { PhysicsOptions } from "./world.js";
export { Layer, ALL_LAYERS, layerMask, collisionGroups, layersCollide } from "./layers.js";
export type { LayerName, LayerBit } from "./layers.js";
export { resolveCharacter } from "./character.js";
export type * from "./types.js";
