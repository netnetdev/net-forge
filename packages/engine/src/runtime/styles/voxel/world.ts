/**
 * Voxel worlds: the play field's floor, terraced ground past the wall, a
 * stone (or steel) wall, pillars with a voxel flame, and ground clutter.
 *
 * Static voxel scenery is greedy-meshed with occlusion baked into vertex
 * colours, and the material adds a per-voxel shade from the voxel's world
 * cell (a hash), so large merged faces still read as stacked cubes without
 * costing a quad per voxel. The floor is one plane painted per cell the same
 * way, and every placement is seeded, so every client sees the same world.
 */
import { Color, InstancedMesh, Matrix4, Mesh, MeshStandardNodeMaterial, PlaneGeometry, Quaternion, Vector3 } from "three/webgpu";
import type { BufferGeometry, Material, Object3D } from "three/webgpu";
import { abs, dot, float, floor, fract, max, mix, normalWorld, positionWorld, sin, smoothstep, step, vec3, vertexColor } from "three/tsl";
import type { Node } from "three/webgpu";
import type { FieldSpec, PillarSpec, StyledPillar, WorldTheme } from "../kit.js";
import { fillWhere, greedyMesh, hash3, jitter, shadeRgb, VoxelGrid } from "./core.js";
import { voxelGeometry, voxelMaterial } from "./geometry.js";
import { flameGrid } from "./shapes.js";

/** Floor cell (and terrain voxel), m. */
export const WORLD_CELL = 0.5;

/** Palettes per theme (sRGB). */
export interface WorldPalette {
  readonly grass: readonly number[];
  readonly dirt: readonly number[];
  readonly stone: readonly number[];
  readonly moss: number;
  readonly path: readonly number[];
  readonly flowers: readonly number[];
}

// A moonlit meadow: deep greens, cool stone and earth that stay brown under the blue night light.
const MEADOW: WorldPalette = {
  grass: [0x36603a, 0x3b6740, 0x325736, 0x447a45],
  dirt: [0x5a4631, 0x634d35, 0x4d3c2b],
  stone: [0x8c8679, 0x7c776b, 0x9a9486, 0x6c675d],
  moss: 0x46703a,
  path: [0x5f4f39, 0x67563e, 0x574833],
  flowers: [0xf2d64b, 0xe8584a, 0xf4f1e6, 0xa77be0, 0xff9a3c],
};

const YARD: WorldPalette = {
  grass: [0x3d4552, 0x434c5a, 0x394150, 0x48515f],
  dirt: [0x2e333c, 0x353a44, 0x2a2e36],
  stone: [0x4a5260, 0x535c6b, 0x3f4653, 0x5c6573],
  moss: 0xd9a12a,
  path: [0x5a6272, 0x626b7b, 0x535a68],
  flowers: [0xffb020, 0x16e0ff, 0xff4fd8],
};

export function paletteFor(theme: WorldTheme): WorldPalette {
  return theme === "yard" ? YARD : MEADOW;
}

const pick = (list: readonly number[], h: number): number => list[Math.min(list.length - 1, Math.floor(h * list.length))] ?? 0x808080;

/** A per-cell 0..1 hash in TSL (sin-hash; stable to a few hundred metres from the origin). */
function cellHash(c: Node<"vec3">): Node<"float"> {
  return fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
}

/**
 * The material for greedy-meshed static voxels: vertex colours (occlusion
 * baked) times a per-voxel shade from the voxel's world cell, and a faint
 * darkening along each voxel's edges so merged faces still show their cubes.
 */
export function voxelWorldMaterial(opts: { cell: number; jitter?: number; edge?: number; roughness?: number } = { cell: WORLD_CELL }): MeshStandardNodeMaterial {
  const m = voxelMaterial({ roughness: opts.roughness ?? 0.9 });
  const cell = float(opts.cell);
  // The voxel a face belongs to: half a cell in from the face, along its normal.
  const inside = positionWorld.sub(normalWorld.mul(cell.mul(0.5))).div(cell);
  const id = floor(inside);
  const shade = float(1).add(cellHash(id).sub(0.5).mul(2 * (opts.jitter ?? 0.07)));
  // Distance to the nearest voxel edge across the face (in cells): 0 at an edge, 0.5 in the middle.
  const f = fract(positionWorld.div(cell));
  const g = abs(f.sub(0.5));
  const n = abs(normalWorld);
  // Use the two axes in the face's plane.
  const a = mix(g.x, g.z, step(0.5, n.x));
  const b = mix(g.y, g.z, step(0.5, n.y));
  const edge = smoothstep(0.5, 0.44, max(a, b));
  const lines = float(1).sub(float(1).sub(edge).mul(opts.edge ?? 0.12));
  m.colorNode = vertexColor().mul(shade).mul(lines);
  // colorNode already carries the vertex colours; with the flag on as well, NodeMaterial multiplies them in twice (dark, muddy stone).
  m.vertexColors = false;
  return m;
}

/** The floor plane's material: grass cells with dirt and path patches, one colour per cell. */
function floorMaterial(p: WorldPalette, half: number): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial();
  m.roughness = 0.95;
  m.metalness = 0;
  const cell = float(WORLD_CELL);
  const q = positionWorld.xz.div(cell);
  const c = floor(q);
  const h = cellHash(vec3(c.x, 0, c.y));
  const h2 = cellHash(vec3(c.y, 3, c.x));
  // Blocky patches: a coarse hash per 4x4 cells, blended by the cell's own hash so patch edges stay ragged.
  const big = floor(c.div(4));
  const patch = cellHash(vec3(big.x, 7, big.y));
  const col = (hex: number) => {
    const r = ((hex >> 16) & 255) / 255;
    const g = ((hex >> 8) & 255) / 255;
    const b = (hex & 255) / 255;
    // sRGB to linear (square approximation is enough for a palette).
    return vec3(r * r, g * g, b * b);
  };
  const grassA = col(p.grass[0] ?? 0x4c7a3b);
  const grassB = col(p.grass[1] ?? 0x568a41);
  const grassC = col(p.grass[2] ?? 0x44703a);
  const dirt = col(p.dirt[1] ?? 0x7c5c40);
  const path = col(p.path[0] ?? 0x8a6d4a);
  // Soft patches of two greens (one per 4 x 4 cells) and a sprinkle of a third, so the floor reads as blocks
  // without a checkerboard competing with the crowd.
  let base = mix(grassA, grassB, smoothstep(0.3, 0.7, patch.add(h.sub(0.5).mul(0.35))));
  base = mix(base, grassC, step(0.9, h2));
  // Dirt patches (about 1 in 9 blocks of 4x4), ragged at the edges.
  const isDirt = step(0.89, patch.add(h.sub(0.5).mul(0.12)));
  base = mix(base, dirt, isDirt);
  // A worn ring path around the centre reads as a place people walk.
  const r = q.mul(WORLD_CELL).length();
  const ring = step(abs(r.sub(half * 0.42)), float(1.6).add(h.mul(0.8)));
  base = mix(base, path, ring.mul(step(0.25, h2)));
  const shade = float(1).add(h.sub(0.5).mul(0.08));
  const f = fract(q);
  const edge = smoothstep(0.0, 0.06, f.x).mul(smoothstep(1.0, 0.94, f.x)).mul(smoothstep(0.0, 0.06, f.y)).mul(smoothstep(1.0, 0.94, f.y));
  m.colorNode = base.mul(shade).mul(float(0.86).add(edge.mul(0.14)));
  return m;
}

/** Deterministic value noise in 2D, 0..1. */
function noise2(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash3(x0, 0, z0, seed);
  const b = hash3(x0 + 1, 0, z0, seed);
  const c = hash3(x0, 0, z0 + 1, seed);
  const d = hash3(x0 + 1, 0, z0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/**
 * Height of the voxel ground at (x, z), m: flat inside the field and for a
 * strip past the wall, then terraces that climb away from it in whole
 * voxels. Scenery standing outside the wall uses it to stand on the ground.
 */
export function terrainHeight(spec: Pick<FieldSpec, "half" | "theme">, x: number, z: number): number {
  const d = Math.max(Math.abs(x), Math.abs(z)) - spec.half - 1;
  if (d < 3) return 0;
  const n = noise2(x * 0.07, z * 0.07, 11) * 0.65 + noise2(x * 0.19, z * 0.19, 12) * 0.35;
  const climb = spec.theme === "yard" ? 0.06 : 0.16;
  const raw = (d - 3) * climb + (n - 0.35) * (spec.theme === "yard" ? 1.2 : 3.2);
  const steps = Math.max(0, Math.round(raw / WORLD_CELL));
  return Math.min(12, steps) * WORLD_CELL;
}

/** Terraced ground in a rectangle of cells (one greedy-meshed chunk). */
function terrainChunk(spec: FieldSpec, p: WorldPalette, x0: number, z0: number, nx: number, nz: number): BufferGeometry | null {
  const heights: number[] = [];
  let top = 0;
  for (let k = 0; k < nz; k++)
    for (let i = 0; i < nx; i++) {
      const cx = x0 + (i + 0.5) * WORLD_CELL;
      const cz = z0 + (k + 0.5) * WORLD_CELL;
      const h = Math.round(terrainHeight(spec, cx, cz) / WORLD_CELL);
      heights.push(h);
      top = Math.max(top, h);
    }
  if (top === 0) return null;
  const grid = new VoxelGrid(nx, top, nz, WORLD_CELL, [x0, 0, z0]);
  for (let k = 0; k < nz; k++)
    for (let i = 0; i < nx; i++) {
      const h = heights[i + k * nx] ?? 0;
      for (let y = 0; y < h; y++) {
        const wx = Math.floor(x0 / WORLD_CELL) + i;
        const wz = Math.floor(z0 / WORLD_CELL) + k;
        const hh = hash3(wx, y, wz, 21);
        // Grass on top, dirt under it, stone deep down; the colour is per material, the shader adds per-voxel shade.
        const c = y === h - 1 ? (hh < 0.85 ? (p.grass[1] ?? 0) : p.moss) : y >= h - 3 ? (p.dirt[0] ?? 0) : hh < 0.5 ? (p.stone[1] ?? 0) : (p.dirt[2] ?? 0);
        grid.set(i, y, k, c);
      }
    }
  // Neighbours outside the chunk count as solid where the terrain is, so chunk seams have no faces or occlusion gaps.
  const solidOutside = (x: number, y: number, z: number): boolean => {
    if (y < 0) return true;
    const wx = x0 + (x + 0.5) * WORLD_CELL;
    const wz = z0 + (z + 0.5) * WORLD_CELL;
    return y < Math.round(terrainHeight(spec, wx, wz) / WORLD_CELL);
  };
  return voxelGeometry(greedyMesh(grid, { splitParts: false, skip: ["-y"], solidOutside }));
}

/** A seeded PRNG. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The wall around the field: dry stone blocks (meadow) or steel barrier blocks (yard), an uneven top. */
function wallGeometry(spec: FieldSpec, p: WorldPalette): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  const cell = WORLD_CELL;
  const rows = Math.max(2, Math.round(Math.min(spec.wallHeight, spec.theme === "yard" ? 1.5 : 2) / cell));
  const len = Math.ceil((spec.half * 2 + 2) / cell);
  const thick = 2;
  // Two long sides (north, south) and two short (east, west) fitted between them.
  const sides: [number, number, number, number][] = [
    [-spec.half - 1, spec.half, len, thick],
    [-spec.half - 1, -spec.half - 1, len, thick],
    [spec.half, -spec.half, thick, len - 4],
    [-spec.half - 1, -spec.half, thick, len - 4],
  ];
  sides.forEach(([x0, z0, nx, nz], s) => {
    const grid = new VoxelGrid(nx, rows + 1, nz, cell, [x0, 0, z0]);
    fillWhere(
      grid,
      (x, y, z) => {
        const i = Math.floor(x), k = Math.floor(z);
        if (y < rows) return true;
        // An uneven top: a few raised blocks.
        return hash3(i, 99, k, s) < 0.18;
      },
      (x, y, z) => {
        const wx = Math.floor(x0 / cell) + x;
        const wz = Math.floor(z0 / cell) + z;
        const h = hash3(wx, y, wz, 31);
        if (spec.theme === "yard") return y === rows - 1 && (Math.floor((wx + wz) / 2) & 1) === 0 ? p.moss : pick(p.stone, h);
        if (y >= rows - 1 && h < 0.45) return p.moss;
        return pick(p.stone, h);
      },
    );
    out.push(voxelGeometry(greedyMesh(grid, { splitParts: false, skip: ["-y"] })));
  });
  return out;
}

/** Ground clutter models: a grass tuft, a flower, a pebble (tiny voxel models at 0.1 m). */
function clutterModels(p: WorldPalette, theme: WorldTheme): { geometry: BufferGeometry; count: number; seed: number }[] {
  const s = 0.1;
  const tuft = new VoxelGrid(3, 4, 3, s, [-0.15, 0, -0.15]);
  const g0 = p.grass[3] ?? 0x5d9447;
  const g1 = p.grass[0] ?? 0x4c7a3b;
  tuft.set(1, 0, 1, g1);
  tuft.set(1, 1, 1, g0);
  tuft.set(1, 2, 1, g0);
  tuft.set(0, 0, 1, g1);
  tuft.set(0, 1, 1, g0);
  tuft.set(2, 0, 0, g1);
  tuft.set(2, 1, 0, g0);
  tuft.set(1, 0, 2, g1);
  tuft.set(1, 3, 1, shadeRgb(g0, 1.15));
  const flower = new VoxelGrid(3, 4, 3, s, [-0.15, 0, -0.15]);
  flower.set(1, 0, 1, g1);
  flower.set(1, 1, 1, g0);
  flower.set(1, 2, 1, g0);
  const petal = 0xffffff;
  for (const [x, z] of [[0, 1], [2, 1], [1, 0], [1, 2]] as const) flower.set(x, 3, z, petal);
  flower.set(1, 3, 1, 0xf2d64b);
  const pebble = new VoxelGrid(3, 2, 2, s, [-0.15, 0, -0.1]);
  for (let x = 0; x < 3; x++) for (let z = 0; z < 2; z++) pebble.set(x, 0, z, pick(p.stone, hash3(x, 0, z, 5)));
  pebble.set(1, 1, 0, pick(p.stone, 0.2));
  if (theme === "yard") {
    // The lot: bolts, cable stubs and hazard studs instead of grass.
    return [
      { geometry: voxelGeometry(greedyMesh(pebble, { splitParts: false, skip: ["-y"] })), count: 900, seed: 3 },
    ];
  }
  return [
    { geometry: voxelGeometry(greedyMesh(tuft, { splitParts: false, skip: ["-y"] })), count: 2600, seed: 1 },
    { geometry: voxelGeometry(greedyMesh(flower, { splitParts: false, skip: ["-y"] })), count: 420, seed: 2 },
    { geometry: voxelGeometry(greedyMesh(pebble, { splitParts: false, skip: ["-y"] })), count: 500, seed: 3 },
  ];
}

/** Every flower gets one of the palette's colours: the petals are white in the model and tinted per instance. */
function scatterClutter(spec: FieldSpec, p: WorldPalette, avoid: readonly PillarSpec[]): Object3D[] {
  const out: Object3D[] = [];
  const reach = spec.half + spec.outside * 0.6;
  const m = new Matrix4();
  const q = new Quaternion();
  const axis = new Vector3(0, 1, 0);
  const pos = new Vector3();
  const scl = new Vector3();
  for (const c of clutterModels(p, spec.theme)) {
    const mat = voxelMaterial({ roughness: 0.95 });
    const mesh = new InstancedMesh(c.geometry, mat, c.count);
    const r = rng(0x9e37 + c.seed * 7919);
    let n = 0;
    for (let i = 0; i < c.count * 3 && n < c.count; i++) {
      // Clumped: pick a clump centre, then scatter around it.
      const x = (r() * 2 - 1) * reach;
      const z = (r() * 2 - 1) * reach;
      const inField = Math.abs(x) < spec.half - 0.6 && Math.abs(z) < spec.half - 0.6;
      const outside = Math.max(Math.abs(x), Math.abs(z)) > spec.half + 1.5;
      if (!inField && !outside) continue;
      if (avoid.some((pl) => (pl.x - x) ** 2 + (pl.z - z) ** 2 < (pl.radius + 0.6) ** 2)) continue;
      // Thinner in the middle of the field, where the fights are.
      if (inField && r() < 0.35) continue;
      const y = outside ? terrainHeight(spec, x, z) : 0;
      // Snap to the floor's cells so clutter sits on blocks.
      const sx = Math.round(x / 0.1) * 0.1;
      const sz = Math.round(z / 0.1) * 0.1;
      q.setFromAxisAngle(axis, Math.floor(r() * 4) * (Math.PI / 2));
      const k = 0.8 + r() * 0.6;
      pos.set(sx, y, sz);
      scl.set(k, k * (0.8 + r() * 0.5), k);
      mesh.setMatrixAt(n, m.compose(pos, q, scl));
      if (c.seed === 2) mesh.setColorAt(n, new Color(pick(p.flowers, r())));
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.computeBoundingSphere();
    mesh.name = "VoxelClutter";
    out.push(mesh);
  }
  return out;
}

/**
 * The whole field: the painted floor, terraced ground past the wall, the
 * wall, and ground clutter. Returns meshes to add to the scene.
 */
export function voxelField(spec: FieldSpec, pillars: readonly PillarSpec[] = []): Object3D[] {
  const p = paletteFor(spec.theme);
  const out: Object3D[] = [];
  const size = (spec.half + spec.outside) * 2;
  const floor = new Mesh(new PlaneGeometry(size, size), floorMaterial(p, spec.half));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = "VoxelFloor";
  out.push(floor);
  const worldMat = voxelWorldMaterial({ cell: WORLD_CELL, jitter: 0.08, edge: 0.14 });
  // Terraces in chunks of 32 x 32 cells around the field.
  const edge = spec.half + Math.min(spec.outside, 28);
  const chunk = 32 * WORLD_CELL;
  const start = -Math.ceil(edge / chunk) * chunk;
  for (let z0 = start; z0 < edge; z0 += chunk)
    for (let x0 = start; x0 < edge; x0 += chunk) {
      // Skip chunks entirely inside the flat strip.
      const far = Math.max(Math.abs(x0), Math.abs(x0 + chunk), Math.abs(z0), Math.abs(z0 + chunk));
      if (far < spec.half + 4) continue;
      const g = terrainChunk(spec, p, x0, z0, 32, 32);
      if (!g) continue;
      const mesh = new Mesh(g, worldMat);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      mesh.name = "VoxelTerrain";
      out.push(mesh);
    }
  if (spec.wall !== false) {
    for (const g of wallGeometry(spec, p)) {
      const mesh = new Mesh(g, worldMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = "VoxelWall";
      out.push(mesh);
    }
  }
  out.push(...scatterClutter(spec, p, pillars));
  return out;
}

/** A stone column of rough courses with a capital, an iron brazier and a voxel flame (meadow); a steel post with a lamp (yard). */
export function voxelPillar(spec: PillarSpec, theme: WorldTheme, index: number): StyledPillar {
  const p = paletteFor(theme);
  const cell = 0.25;
  const r = spec.radius;
  const n = Math.ceil((r * 2.3) / cell) + 1;
  const rows = Math.max(4, Math.round(spec.height / cell));
  const grid = new VoxelGrid(n, rows + 2, n, cell, [spec.x - (n * cell) / 2, 0, spec.z - (n * cell) / 2]);
  const c = n / 2;
  const yard = theme === "yard";
  fillWhere(
    grid,
    (x, y, z) => {
      const d = Math.hypot(x - c, z - c) * cell;
      const course = Math.floor(y / 2);
      // Rough courses: each ring of stones juts a little in or out.
      const wobble = (hash3(Math.floor(Math.atan2(z - c, x - c) * 3), course, index, 41) - 0.5) * cell * 1.2;
      if (y < 2) return d < r * 1.08 + (yard ? 0 : wobble * 0.5);
      if (y >= rows - 1) return d < r * 1.02;
      return d < r * 0.86 + (yard ? 0 : wobble);
    },
    (x, y, z) => {
      const course = Math.floor(y / 2);
      const stone = pick(p.stone, hash3(Math.floor(Math.atan2(z - c, x - c) * 2.5), course, index, 43));
      if (yard) return y >= rows - 1 || y < 2 ? (p.stone[3] ?? 0) : (y & 3) === 0 ? p.moss : (p.stone[0] ?? 0);
      if (y < 2 && hash3(x, y, z, 45) < 0.4) return p.moss;
      // The capital a top-down camera mostly sees: darker, weathered stone with moss, so a pillar is not a bright disc.
      if (y >= rows - 1) return hash3(x, y, z, 49) < 0.3 ? shadeRgb(p.moss, 0.8) : shadeRgb(stone, 0.62);
      // Alternate courses a step apart read as stacked blocks.
      return shadeRgb(stone, (course & 1) === 0 ? 0.86 : 0.76);
    },
  );
  const body = new Mesh(voxelGeometry(greedyMesh(grid, { splitParts: false, skip: ["-y"] })), voxelWorldMaterial({ cell, jitter: 0.06, edge: 0.1 }));
  body.castShadow = true;
  body.receiveShadow = true;
  body.name = "VoxelPillar";
  const top: Object3D[] = [];
  const topY = (rows + 1) * cell;
  // The brazier: a dark iron bowl on the capital.
  const bowlN = Math.max(4, Math.round((r * 1.1) / 0.125));
  const bowl = new VoxelGrid(bowlN, 3, bowlN, 0.125, [spec.x - (bowlN * 0.125) / 2, topY, spec.z - (bowlN * 0.125) / 2]);
  const bc = bowlN / 2;
  fillWhere(
    bowl,
    (x, y, z) => {
      const d = Math.hypot(x - bc, z - bc);
      return y < 1 ? d < bc * 0.7 : d < bc && d > bc - 1.3;
    },
    (x, y, z) => jitter(yard ? 0x2a2f38 : 0x3a3330, x, y, z, 0.1, 47),
  );
  const bowlMesh = new Mesh(voxelGeometry(greedyMesh(bowl, { splitParts: false })), voxelMaterial({ roughness: 0.6 }));
  bowlMesh.castShadow = true;
  top.push(bowlMesh);
  let flame: [number, number, number] | null = null;
  if (!yard) {
    const fg = flameGrid(index + 1);
    const flameMesh = new Mesh(voxelGeometry(greedyMesh(fg, { splitParts: false, ao: false })), voxelMaterial({ emissive: 0xff7a1c, emissiveIntensity: 2.4, roughness: 1 }));
    flameMesh.position.set(spec.x, topY + 0.1, spec.z);
    flameMesh.scale.setScalar(Math.max(0.8, r * 0.45));
    flameMesh.name = "VoxelFlame";
    top.push(flameMesh);
    flame = [spec.x, topY + 0.5, spec.z];
  }
  return { body, fade: [body.material as Material], top, flame };
}
