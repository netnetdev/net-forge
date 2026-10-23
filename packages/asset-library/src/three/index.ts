/**
 * @netforge/asset-library/three: draw library models with three.js
 * (WebGPU with the WebGL2 fallback, through the engine runtime).
 */
export { LibraryClient, spriteMultiple } from "./client.js";
export type { CharacterInstance, LibraryClientOptions, ModelSource } from "./client.js";
export { RigAnimator, StaticAnimator } from "./animator.js";
export type { CharacterAnimator } from "./animator.js";
export { bakeCrowd, placeStatic, poseModel } from "./crowd.js";
export type { CrowdModel, CrowdPart, Placement } from "./crowd.js";
export { prepareModel, shiftColor } from "./prepare.js";
export type { LoadedModel, PreparedModel } from "./prepare.js";
export { buildPart, proceduralAsset } from "./parts.js";
