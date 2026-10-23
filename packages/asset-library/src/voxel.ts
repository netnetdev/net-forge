/**
 * The voxel style in the library. Voxel models are
 * other library entries rebuilt as voxels at library build time (source
 * `{ voxelize, res }`), so every voxel id has the same name as its low-poly
 * base and a prompt maps to the same names in either style. The voxel core
 * (grid, voxelizer, greedy mesher with baked occlusion) is the engine's, so
 * the build and the runtime mesh voxels the same way.
 */
export {
  EMPTY,
  fillInterior,
  fillWhere,
  greedyMesh,
  hash3,
  jitter,
  linearToSrgb8,
  mixRgb,
  packLinear,
  shadeRgb,
  srgbToLinear,
  surfaceVoxels,
  VoxelGrid,
  voxelizeTriangles,
} from "@netforge/engine/voxel";
export type { MeshOptions, TriangleShader, VoxelMesh, VoxelSample } from "@netforge/engine/voxel";
