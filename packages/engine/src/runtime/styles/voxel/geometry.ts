/**
 * Voxel meshes on the GPU: a greedy-meshed VoxelMesh as a three.js
 * BufferGeometry (positions, flat normals, linear vertex colours with the
 * occlusion baked in, and each vertex's rigid part), and the material every
 * voxel thing in the style draws with.
 */
import { BufferAttribute, BufferGeometry, Color, MeshStandardNodeMaterial } from "three/webgpu";
import type { VoxelMesh } from "./core.js";

/** A BufferGeometry from a greedy-meshed grid. `voxelPart` holds each vertex's part when there is more than one. */
export function voxelGeometry(mesh: VoxelMesh, opts: { parts?: boolean } = {}): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  g.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  g.setAttribute("color", new BufferAttribute(mesh.colors, 3));
  if (opts.parts) g.setAttribute("voxelPart", new BufferAttribute(new Float32Array(mesh.parts), 1));
  const vertices = mesh.positions.length / 3;
  g.setIndex(new BufferAttribute(vertices < 65536 ? new Uint16Array(mesh.indices) : mesh.indices, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export interface VoxelMaterialOptions {
  /** Glow colour (0 = none) and strength. */
  readonly emissive?: number;
  readonly emissiveIntensity?: number;
  /** Default 0.85: voxel art reads matte. */
  readonly roughness?: number;
  readonly transparent?: boolean;
  readonly opacity?: number;
}

/**
 * The style's material: vertex colours (occlusion baked in), matte, no
 * texture. A node material, so crowds and particles can drive its position
 * and emissive nodes.
 */
export function voxelMaterial(opts: VoxelMaterialOptions = {}): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial();
  m.vertexColors = true;
  m.roughness = opts.roughness ?? 0.85;
  m.metalness = 0;
  m.color = new Color(1, 1, 1);
  m.emissive = new Color(opts.emissive ?? 0);
  m.emissiveIntensity = opts.emissiveIntensity ?? 1;
  if (opts.transparent) {
    m.transparent = true;
    m.opacity = opts.opacity ?? 1;
  }
  return m;
}
