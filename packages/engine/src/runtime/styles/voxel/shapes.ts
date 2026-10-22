/**
 * Procedural voxel models the style builds at load (no file): pickups and
 * scenery. Pure: each returns a VoxelGrid, the caller meshes it. Every
 * colour varies a little per voxel (a seeded hash), so faces read as stacked
 * cubes rather than flat plastic.
 */
import { fillWhere, hash3, jitter, mixRgb, shadeRgb, VoxelGrid } from "./core.js";

/** Grid centred on x and z, standing on y = 0. */
function centred(nx: number, ny: number, nz: number, size: number): VoxelGrid {
  return new VoxelGrid(nx, ny, nz, size, [(-nx * size) / 2, 0, (-nz * size) / 2]);
}

const GEMS = {
  small: { r: 2, light: 0xffd36b, dark: 0xe0861c, size: 0.075 },
  mid: { r: 3, light: 0x9fe4ff, dark: 0x2f7fd8, size: 0.07 },
  large: { r: 4, light: 0xffa6e6, dark: 0xc7288f, size: 0.085 },
} as const;

/** A faceted voxel gem: a double pyramid, light on its upper faces, dark below, one bright glint. */
export function gemGrid(kind: keyof typeof GEMS): VoxelGrid {
  const g = GEMS[kind];
  const n = g.r * 2 + 1;
  const h = g.r * 2 + 3;
  const grid = centred(n, h, n, g.size);
  const cx = n / 2;
  const cy = h / 2;
  fillWhere(
    grid,
    (x, y, z) => Math.abs(x - cx) + Math.abs(z - cx) + Math.abs(y - cy) * (g.r / (h / 2)) <= g.r + 0.5,
    (x, y, z) => {
      const up = y + 0.5 > cy;
      const base = up ? g.light : g.dark;
      const glint = up && x === Math.floor(cx) - 1 && z === Math.floor(cx) && y === Math.floor(cy) + 1;
      return glint ? 0xffffff : jitter(base, x, y, z, 0.07, 3);
    },
  );
  return grid;
}

/** A chunky plus sign: the universal heal. */
export function crossGrid(color = 0x5dff7a): VoxelGrid {
  const grid = centred(7, 7, 3, 0.085);
  fillWhere(
    grid,
    (x, y) => (x > 2 && x < 5) || (y > 2 && y < 5),
    (x, y, z) => {
      if (x === 3 && y === 3) return 0xeaffe8;
      const end = x === 0 || x === 6 || y === 0 || y === 6;
      return jitter(end ? shadeRgb(color, 0.82) : color, x, y, z, 0.06, 5);
    },
  );
  return grid;
}

/** An energy cell: a squat battery with a bright core band. */
export function cellGrid(color = 0x6fd3ff): VoxelGrid {
  const grid = centred(5, 7, 5, 0.075);
  fillWhere(
    grid,
    (x, y, z) => (y < 6 ? Math.abs(x - 2.5) < 2.2 && Math.abs(z - 2.5) < 2.2 : Math.abs(x - 2.5) < 1 && Math.abs(z - 2.5) < 1),
    (x, y, z) => (y === 6 ? 0xd8dde4 : y === 2 || y === 3 ? mixRgb(color, 0xffffff, 0.45) : jitter(shadeRgb(color, 0.75), x, y, z, 0.06, 7)),
  );
  return grid;
}

/** A little cluster of flames for braziers and campfires: hot core, orange tongues, red tips. */
export function flameGrid(seed = 1): VoxelGrid {
  const grid = centred(5, 7, 5, 0.12);
  fillWhere(
    grid,
    (x, y, z) => {
      const r = Math.hypot(x - 2.5, z - 2.5);
      const reach = 2.4 - y * 0.34 + (hash3(Math.floor(x), 0, Math.floor(z), seed) - 0.5) * 1.2;
      return r < reach;
    },
    (x, y, z) => {
      const r = Math.hypot(x + 0.5 - 2.5, z + 0.5 - 2.5);
      if (y < 2 && r < 1.2) return 0xfff2b0;
      if (y < 4) return jitter(0xffa031, x, y, z, 0.08, seed);
      return jitter(0xff5a1f, x, y, z, 0.08, seed);
    },
  );
  return grid;
}

/** Pickups by procedural library name (style.voxel.gem_small is `voxel_gem_small`). */
export function pickupGrid(name: string): { grid: VoxelGrid; glow: number } | null {
  switch (name) {
    case "gem_small":
      return { grid: gemGrid("small"), glow: 0xff9a1f };
    case "gem_mid":
      return { grid: gemGrid("mid"), glow: 0x2f8fff };
    case "gem_large":
      return { grid: gemGrid("large"), glow: 0xff3fb8 };
    case "cell_heal":
      return { grid: crossGrid(), glow: 0x2bff6a };
    case "cell_spark":
      return { grid: cellGrid(), glow: 0x1e9bff };
    default:
      return null;
  }
}
