/**
 * The voxel style's kit: what a template asks for when a game plays in
 * `style: "voxel"`.
 */
import type { StyleKit } from "../kit.js";
import { voxelStack } from "./look.js";
import { voxelShape } from "./props.js";
import { voxelField, voxelPillar, terrainHeight } from "./world.js";

export const voxelKit: StyleKit = {
  id: "voxel",
  stack: (preset) => voxelStack(preset),
  field: (spec) => voxelField(spec, spec.pillars ?? []),
  groundHeight: (spec, x, z) => terrainHeight(spec, x, z),
  pillar: (spec, theme, index) => voxelPillar(spec, theme, index),
  shape: (name) => voxelShape(name),
};
