/**
 * Template machinery shapes in voxels (StyleKit.shape): the debris chunk a
 * kill throws (one cube, so a death reads as a model breaking into voxels),
 * loose field rocks and cut stumps. Each is centred on the origin, like the
 * primitives a template draws them with, and built once.
 */
import type { StyleShape, StyleShapeName } from "../kit.js";
import { fillWhere, greedyMesh, hash3, jitter, VoxelGrid } from "./core.js";
import { voxelGeometry, voxelMaterial } from "./geometry.js";

/** Grid centred on the origin in all three axes. */
function centred(nx: number, ny: number, nz: number, size: number): VoxelGrid {
  return new VoxelGrid(nx, ny, nz, size, [(-nx * size) / 2, (-ny * size) / 2, (-nz * size) / 2]);
}

/** One cube about as big as the unit dodecahedron it replaces; white, so the instance colour is the chunk's colour. */
function chunk(): VoxelGrid {
  const g = centred(1, 1, 1, 1.25);
  g.set(0, 0, 0, 0xffffff);
  return g;
}

/** A lumpy boulder (half size about 0.5 m) in warm field stone with a mossy cap. */
function rock(): VoxelGrid {
  const n = 8;
  const g = centred(n, 7, n, 0.125);
  const c = n / 2;
  fillWhere(
    g,
    (x, y, z) => {
      const dx = (x - c) / 4;
      const dy = (y - 3.5) / 3.5;
      const dz = (z - c) / 4;
      return dx * dx + dy * dy * 1.1 + dz * dz < 1 - (hash3(Math.floor(x), Math.floor(y), Math.floor(z), 61) - 0.5) * 0.35;
    },
    (x, y, z) => (y >= 5 && hash3(x, y, z, 63) < 0.55 ? jitter(0x4f6f3a, x, y, z, 0.08, 65) : jitter(0x7c7466, x, y, z, 0.1, 67)),
  );
  return g;
}

/** A cut stump (radius about 0.36 m, 0.9 m tall): bark rings and a pale cut top. */
function stump(): VoxelGrid {
  const n = 6;
  const g = centred(n, 7, n, 0.125);
  const c = n / 2;
  fillWhere(
    g,
    (x, _y, z) => Math.hypot(x - c, z - c) < 2.9,
    (x, y, z) => {
      const r = Math.hypot(x + 0.5 - c, z + 0.5 - c);
      if (y === 6) return r < 1.6 ? jitter(0xc9a46c, x, y, z, 0.06, 71) : 0x8a6440;
      return jitter((y & 1) === 0 ? 0x5c4430 : 0x4e3a28, x, y, z, 0.08, 73);
    },
  );
  return g;
}

const BUILDERS: Partial<Record<StyleShapeName, () => VoxelGrid>> = { chunk, rock, stump };
const cache = new Map<StyleShapeName, StyleShape>();

/** A machinery shape in voxels, or null to keep the template's own. */
export function voxelShape(name: StyleShapeName): StyleShape | null {
  const hit = cache.get(name);
  if (hit) return hit;
  const build = BUILDERS[name];
  if (!build) return null;
  const shape: StyleShape = { geometry: voxelGeometry(greedyMesh(build(), { splitParts: false })), material: voxelMaterial({ roughness: 0.8 }) };
  cache.set(name, shape);
  return shape;
}
