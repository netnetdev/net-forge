/**
 * The voxel art style: chunky cube-built worlds and
 * characters. Library models are rebuilt as voxels at library build time
 * (rigid parts on their bones, occlusion baked per face); this module is the
 * runtime half: the voxel core, voxel geometry and material, procedural
 * pickups and scenery, the voxel world builders, cube particles with
 * voxel-shatter deaths, rigid-part crowds, and the style's look.
 */
import type { BufferGeometry, MeshStandardNodeMaterial } from "three/webgpu";
import { greedyMesh } from "./core.js";
import { voxelGeometry, voxelMaterial } from "./geometry.js";
import { pickupGrid } from "./shapes.js";

export * from "./core.js";
export * from "./geometry.js";
export * from "./shapes.js";
export * from "./world.js";
export * from "./props.js";
export * from "./look.js";
export { voxelKit } from "./kit.js";

/** A procedural voxel pickup (library source `{ procedural: "voxel_<name>" }`): geometry centred on the origin and a glowing material. */
export function voxelPickup(name: string): { geometry: BufferGeometry; material: MeshStandardNodeMaterial } | null {
  const p = pickupGrid(name);
  if (!p) return null;
  const geometry = voxelGeometry(greedyMesh(p.grid, { splitParts: false }));
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  // Centre on the origin like the low-poly pickups (they bob around their middle).
  if (box) geometry.translate(0, -(box.min.y + box.max.y) / 2, 0);
  return { geometry, material: voxelMaterial({ emissive: p.glow, emissiveIntensity: 0.9, roughness: 0.4 }) };
}
