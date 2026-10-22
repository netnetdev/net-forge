/**
 * The voxel style's core (voxel): a voxel grid, a
 * triangle voxelizer, interior fill, and a greedy mesher that bakes ambient
 * occlusion per voxel face. Pure TypeScript with no three.js and no DOM, so
 * the same code runs in the asset library build (Node: library models are
 * rebuilt as voxels there) and in the browser (voxel terrain, pillars,
 * trees and pickups made at load).
 *
 * Colours are packed 0xRRGGBB in sRGB, 8 bits a channel, so near-identical
 * colours merge into one face. The mesher writes linear colours with the
 * occlusion multiplied in, which is what glTF COLOR_0 and three.js vertex
 * colours expect.
 */

/** No voxel in a cell. */
export const EMPTY = -1;

/** A dense box of voxels: `nx * ny * nz` cells of `size` metres, the first cell's corner at `origin`. */
export class VoxelGrid {
  /** 0xRRGGBB (sRGB) per cell, or EMPTY. */
  readonly color: Int32Array;
  /** Which rigid part (bone or node) a cell moves with. Faces between different parts are kept, so parts can move apart. */
  readonly part: Uint16Array;

  constructor(
    readonly nx: number,
    readonly ny: number,
    readonly nz: number,
    readonly size: number,
    readonly origin: readonly [number, number, number] = [0, 0, 0],
  ) {
    if (![nx, ny, nz].every((n) => Number.isInteger(n) && n > 0)) throw new RangeError("VoxelGrid: dimensions are positive integers");
    if (!(size > 0)) throw new RangeError("VoxelGrid: size must be positive");
    if (nx * ny * nz > 16_000_000) throw new RangeError("VoxelGrid: more than 16M cells");
    this.color = new Int32Array(nx * ny * nz).fill(EMPTY);
    this.part = new Uint16Array(nx * ny * nz);
  }

  index(x: number, y: number, z: number): number {
    return x + this.nx * (y + this.ny * z);
  }

  inside(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz;
  }

  /** The cell's colour, or EMPTY (also outside the grid). */
  get(x: number, y: number, z: number): number {
    return this.inside(x, y, z) ? (this.color[this.index(x, y, z)] ?? EMPTY) : EMPTY;
  }

  solid(x: number, y: number, z: number): boolean {
    return this.get(x, y, z) !== EMPTY;
  }

  set(x: number, y: number, z: number, rgb: number, part = 0): void {
    if (!this.inside(x, y, z)) return;
    const i = this.index(x, y, z);
    this.color[i] = rgb & 0xffffff;
    this.part[i] = part;
  }

  clear(x: number, y: number, z: number): void {
    if (this.inside(x, y, z)) this.color[this.index(x, y, z)] = EMPTY;
  }

  /** Solid cells. */
  count(): number {
    let n = 0;
    for (let i = 0; i < this.color.length; i++) if ((this.color[i] ?? EMPTY) !== EMPTY) n++;
    return n;
  }
}

// ---------------------------------------------------------------------------
// Colour helpers

/** sRGB 0..255 channel to linear 0..1. */
export function srgbToLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear 0..1 to an sRGB 0..255 channel. */
export function linearToSrgb8(c: number): number {
  const v = c <= 0 ? 0 : c >= 1 ? 1 : c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(v * 255);
}

/** Pack linear r, g, b (0..1) into 0xRRGGBB sRGB. */
export function packLinear(r: number, g: number, b: number): number {
  return (linearToSrgb8(r) << 16) | (linearToSrgb8(g) << 8) | linearToSrgb8(b);
}

/** A 0xRRGGBB colour scaled in brightness (sRGB space), clamped. */
export function shadeRgb(rgb: number, k: number): number {
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((rgb >> s) & 0xff) * k)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Mix two 0xRRGGBB colours (sRGB space). */
export function mixRgb(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 0xff) * (1 - t) + ((b >> s) & 0xff) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** A deterministic 0..1 hash of integer coordinates (per-voxel colour variation that is the same on every client). */
export function hash3(x: number, y: number, z: number, seed = 0): number {
  let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f) ^ Math.imul(seed | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Triangle voxelizer

/** Akenine-Möller triangle / box overlap (separating axis test). `c` box centre, `h` half size. */
function triBoxOverlap(cx: number, cy: number, cz: number, h: number, t: Float32Array | number[], o: number): boolean {
  const v0x = (t[o] ?? 0) - cx, v0y = (t[o + 1] ?? 0) - cy, v0z = (t[o + 2] ?? 0) - cz;
  const v1x = (t[o + 3] ?? 0) - cx, v1y = (t[o + 4] ?? 0) - cy, v1z = (t[o + 5] ?? 0) - cz;
  const v2x = (t[o + 6] ?? 0) - cx, v2y = (t[o + 7] ?? 0) - cy, v2z = (t[o + 8] ?? 0) - cz;
  const e0x = v1x - v0x, e0y = v1y - v0y, e0z = v1z - v0z;
  const e1x = v2x - v1x, e1y = v2y - v1y, e1z = v2z - v1z;
  const e2x = v0x - v2x, e2y = v0y - v2y, e2z = v0z - v2z;
  // Nine edge cross axes.
  const axis = (ax: number, ay: number, az: number): boolean => {
    const p0 = v0x * ax + v0y * ay + v0z * az;
    const p1 = v1x * ax + v1y * ay + v1z * az;
    const p2 = v2x * ax + v2y * ay + v2z * az;
    const r = h * (Math.abs(ax) + Math.abs(ay) + Math.abs(az));
    return !(Math.min(p0, p1, p2) > r || Math.max(p0, p1, p2) < -r);
  };
  if (!axis(0, -e0z, e0y) || !axis(0, -e1z, e1y) || !axis(0, -e2z, e2y)) return false;
  if (!axis(e0z, 0, -e0x) || !axis(e1z, 0, -e1x) || !axis(e2z, 0, -e2x)) return false;
  if (!axis(-e0y, e0x, 0) || !axis(-e1y, e1x, 0) || !axis(-e2y, e2x, 0)) return false;
  // The box's own axes.
  if (Math.min(v0x, v1x, v2x) > h || Math.max(v0x, v1x, v2x) < -h) return false;
  if (Math.min(v0y, v1y, v2y) > h || Math.max(v0y, v1y, v2y) < -h) return false;
  if (Math.min(v0z, v1z, v2z) > h || Math.max(v0z, v1z, v2z) < -h) return false;
  // The triangle's plane.
  const nx = e0y * e1z - e0z * e1y;
  const ny = e0z * e1x - e0x * e1z;
  const nz = e0x * e1y - e0y * e1x;
  const d = -(nx * v0x + ny * v0y + nz * v0z);
  const r = h * (Math.abs(nx) + Math.abs(ny) + Math.abs(nz));
  return Math.abs(d) <= r;
}

/**
 * Closest point on a triangle to p (Ericson, Real-Time Collision
 * Detection 5.1.5). Writes barycentrics (u, v, w for corners 0, 1, 2) into
 * `out` and returns the squared distance.
 */
function closestOnTriangle(px: number, py: number, pz: number, t: Float32Array | number[], o: number, out: Float64Array): number {
  const ax = t[o] ?? 0, ay = t[o + 1] ?? 0, az = t[o + 2] ?? 0;
  const bx = t[o + 3] ?? 0, by = t[o + 4] ?? 0, bz = t[o + 5] ?? 0;
  const cx = t[o + 6] ?? 0, cy = t[o + 7] ?? 0, cz = t[o + 8] ?? 0;
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let u = 1, v = 0, w = 0;
  const finish = (): number => {
    out[0] = u;
    out[1] = v;
    out[2] = w;
    const qx = ax * u + bx * v + cx * w - px;
    const qy = ay * u + by * v + cy * w - py;
    const qz = az * u + bz * v + cz * w - pz;
    return qx * qx + qy * qy + qz * qz;
  };
  if (d1 <= 0 && d2 <= 0) return finish();
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) {
    u = 0;
    v = 1;
    return finish();
  }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t1 = d1 / (d1 - d3);
    u = 1 - t1;
    v = t1;
    return finish();
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) {
    u = 0;
    w = 1;
    return finish();
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t2 = d2 / (d2 - d6);
    u = 1 - t2;
    w = t2;
    return finish();
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t3 = (d4 - d3) / (d4 - d3 + (d5 - d6));
    u = 0;
    v = 1 - t3;
    w = t3;
    return finish();
  }
  const denom = 1 / (va + vb + vc);
  v = vb * denom;
  w = vc * denom;
  u = 1 - v - w;
  return finish();
}

/** What a voxel looks like at a point on a triangle: its colour and the part it moves with. */
export interface VoxelSample {
  readonly rgb: number;
  readonly part: number;
}

/** Shades a triangle at barycentrics (u, v, w); null leaves the voxel to another triangle (a transparent texel). */
export type TriangleShader = (triangle: number, u: number, v: number, w: number) => VoxelSample | null;

/**
 * Rasterize a triangle soup (9 floats a triangle, in the grid's metres)
 * into the grid. Every voxel a triangle touches (separating-axis test, so
 * surfaces are watertight) takes the colour of the triangle closest to its
 * centre. Returns the number of solid voxels written.
 */
export function voxelizeTriangles(grid: VoxelGrid, positions: Float32Array | number[], shade: TriangleShader): number {
  const n = Math.floor(positions.length / 9);
  const s = grid.size;
  const [ox, oy, oz] = grid.origin;
  const h = s * 0.5 * (1 + 1e-5);
  const cells = grid.nx * grid.ny * grid.nz;
  const best = new Float32Array(cells).fill(Infinity);
  const bestTri = new Int32Array(cells).fill(-1);
  const bary = new Float32Array(cells * 3);
  const tmp = new Float64Array(3);
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    for (let k = 0; k < 3; k++) {
      const x = positions[o + k * 3] ?? 0, y = positions[o + k * 3 + 1] ?? 0, z = positions[o + k * 3 + 2] ?? 0;
      if (x < minx) minx = x;
      if (y < miny) miny = y;
      if (z < minz) minz = z;
      if (x > maxx) maxx = x;
      if (y > maxy) maxy = y;
      if (z > maxz) maxz = z;
    }
    if (!Number.isFinite(minx + miny + minz + maxx + maxy + maxz)) continue;
    const x0 = Math.max(0, Math.floor((minx - ox) / s - 1e-4)), x1 = Math.min(grid.nx - 1, Math.floor((maxx - ox) / s + 1e-4));
    const y0 = Math.max(0, Math.floor((miny - oy) / s - 1e-4)), y1 = Math.min(grid.ny - 1, Math.floor((maxy - oy) / s + 1e-4));
    const z0 = Math.max(0, Math.floor((minz - oz) / s - 1e-4)), z1 = Math.min(grid.nz - 1, Math.floor((maxz - oz) / s + 1e-4));
    for (let z = z0; z <= z1; z++) {
      const cz = oz + (z + 0.5) * s;
      for (let y = y0; y <= y1; y++) {
        const cy = oy + (y + 0.5) * s;
        for (let x = x0; x <= x1; x++) {
          const cx = ox + (x + 0.5) * s;
          if (!triBoxOverlap(cx, cy, cz, h, positions, o)) continue;
          const d = closestOnTriangle(cx, cy, cz, positions, o, tmp);
          const i = grid.index(x, y, z);
          if (d < (best[i] ?? Infinity)) {
            best[i] = d;
            bestTri[i] = t;
            bary[i * 3] = tmp[0] ?? 1;
            bary[i * 3 + 1] = tmp[1] ?? 0;
            bary[i * 3 + 2] = tmp[2] ?? 0;
          }
        }
      }
    }
  }
  let written = 0;
  for (let i = 0; i < cells; i++) {
    const t = bestTri[i] ?? -1;
    if (t < 0) continue;
    const sample = shade(t, bary[i * 3] ?? 1, bary[i * 3 + 1] ?? 0, bary[i * 3 + 2] ?? 0);
    if (!sample) continue;
    grid.color[i] = sample.rgb & 0xffffff;
    grid.part[i] = sample.part;
    written++;
  }
  return written;
}

const N6: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * Make a voxelized shell solid: every empty cell the outside cannot reach
 * (6-connected flood from the grid's border) becomes solid, with the colour
 * and part of the nearest shell voxel. Returns the cells filled.
 */
export function fillInterior(grid: VoxelGrid): number {
  const { nx, ny, nz } = grid;
  const cells = nx * ny * nz;
  const outside = new Uint8Array(cells);
  const queue = new Int32Array(cells);
  let head = 0;
  let tail = 0;
  const push = (x: number, y: number, z: number) => {
    const i = grid.index(x, y, z);
    if (outside[i] || (grid.color[i] ?? EMPTY) !== EMPTY) return;
    outside[i] = 1;
    queue[tail++] = i;
  };
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) if (x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1) push(x, y, z);
  while (head < tail) {
    const i = queue[head++] ?? 0;
    const x = i % nx;
    const y = Math.floor(i / nx) % ny;
    const z = Math.floor(i / (nx * ny));
    for (const [dx, dy, dz] of N6) {
      const X = x + dx, Y = y + dy, Z = z + dz;
      if (X >= 0 && Y >= 0 && Z >= 0 && X < nx && Y < ny && Z < nz) push(X, Y, Z);
    }
  }
  // Multi-source flood from the shell into the enclosed cells.
  head = 0;
  tail = 0;
  for (let i = 0; i < cells; i++) if ((grid.color[i] ?? EMPTY) !== EMPTY) queue[tail++] = i;
  let filled = 0;
  while (head < tail) {
    const i = queue[head++] ?? 0;
    const x = i % nx;
    const y = Math.floor(i / nx) % ny;
    const z = Math.floor(i / (nx * ny));
    for (const [dx, dy, dz] of N6) {
      const X = x + dx, Y = y + dy, Z = z + dz;
      if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
      const j = grid.index(X, Y, Z);
      if (outside[j] || (grid.color[j] ?? EMPTY) !== EMPTY) continue;
      grid.color[j] = grid.color[i] ?? 0;
      grid.part[j] = grid.part[i] ?? 0;
      queue[tail++] = j;
      filled++;
    }
  }
  return filled;
}

/**
 * Remove voxels that touch no empty cell (hidden inside), keeping a model's
 * shell. Saves nothing in the mesh (hidden faces are never emitted) but
 * shortens a list of voxels to throw when a model shatters.
 */
export function surfaceVoxels(grid: VoxelGrid): { x: number; y: number; z: number; rgb: number; part: number }[] {
  const out: { x: number; y: number; z: number; rgb: number; part: number }[] = [];
  for (let z = 0; z < grid.nz; z++)
    for (let y = 0; y < grid.ny; y++)
      for (let x = 0; x < grid.nx; x++) {
        const c = grid.get(x, y, z);
        if (c === EMPTY) continue;
        if (N6.some(([dx, dy, dz]) => !grid.solid(x + dx, y + dy, z + dz))) out.push({ x, y, z, rgb: c, part: grid.part[grid.index(x, y, z)] ?? 0 });
      }
  return out;
}

// ---------------------------------------------------------------------------
// Greedy mesher with baked ambient occlusion

export interface MeshOptions {
  /** Bake ambient occlusion into vertex colours (default true). */
  readonly ao?: boolean;
  /** Brightness at each occlusion level, fully occluded (0) to open (3). Default [0.42, 0.62, 0.82, 1]. */
  readonly aoLevels?: readonly [number, number, number, number];
  /** Keep faces between voxels of different parts (rigid parts that move apart). Default true. */
  readonly splitParts?: boolean;
  /** Skip faces pointing this way (e.g. the bottoms of terrain): "-y" etc. */
  readonly skip?: readonly ("+x" | "-x" | "+y" | "-y" | "+z" | "-z")[];
  /** Treat cells outside the grid as solid on these faces (a chunk's neighbours): default none. */
  readonly solidOutside?: (x: number, y: number, z: number) => boolean;
}

/** A mesh in the grid's metres: indexed quads with flat normals, linear colours (occlusion baked in) and a part per vertex. */
export interface VoxelMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly parts: Uint16Array;
  readonly indices: Uint32Array;
  readonly quads: number;
}

const AO_DEFAULT: readonly [number, number, number, number] = [0.42, 0.62, 0.82, 1];

/**
 * Greedy-mesh a voxel grid (0fps "Meshing in a Minecraft game", with the
 * occlusion-aware merge from "Ambient occlusion for Minecraft-like
 * worlds"): coplanar faces with the same colour, part and corner occlusion
 * merge into one quad. Faces are emitted where a voxel meets an empty cell,
 * or a voxel of another part when `splitParts` is on.
 */
export function greedyMesh(grid: VoxelGrid, opts: MeshOptions = {}): VoxelMesh {
  const useAo = opts.ao ?? true;
  const levels = opts.aoLevels ?? AO_DEFAULT;
  const split = opts.splitParts ?? true;
  const skip = new Set(opts.skip ?? []);
  const outside = opts.solidOutside;
  const dims = [grid.nx, grid.ny, grid.nz] as const;
  const s = grid.size;
  const [ox, oy, oz] = grid.origin;
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const prt: number[] = [];
  const idx: number[] = [];
  const solidAt = (x: number, y: number, z: number): boolean => (grid.inside(x, y, z) ? grid.solid(x, y, z) : (outside?.(x, y, z) ?? false));
  // Linear colour cache.
  const lin = new Map<number, [number, number, number]>();
  const linear = (rgb: number): [number, number, number] => {
    let c = lin.get(rgb);
    if (!c) {
      c = [srgbToLinear((rgb >> 16) & 0xff), srgbToLinear((rgb >> 8) & 0xff), srgbToLinear(rgb & 0xff)];
      lin.set(rgb, c);
    }
    return c;
  };
  const xyz = [0, 0, 0];
  const q = [0, 0, 0];
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const nu = dims[u] as number;
    const nv = dims[v] as number;
    const nd = dims[d] as number;
    const maskColor = new Int32Array(nu * nv);
    const maskKey = new Int32Array(nu * nv);
    for (const side of [1, -1] as const) {
      const dirName = `${side > 0 ? "+" : "-"}${"xyz"[d]}` as "+x";
      if (skip.has(dirName)) continue;
      for (let slice = 0; slice < nd; slice++) {
        // Build the face mask for this slice.
        let any = false;
        for (let j = 0; j < nv; j++) {
          for (let i = 0; i < nu; i++) {
            xyz[d] = slice;
            xyz[u] = i;
            xyz[v] = j;
            const x = xyz[0] ?? 0, y = xyz[1] ?? 0, z = xyz[2] ?? 0;
            const m = i + j * nu;
            maskColor[m] = EMPTY;
            const c = grid.get(x, y, z);
            if (c === EMPTY) continue;
            q[0] = x;
            q[1] = y;
            q[2] = z;
            q[d] = (q[d] ?? 0) + side;
            const bx = q[0] ?? 0, by = q[1] ?? 0, bz = q[2] ?? 0;
            const pa = grid.part[grid.index(x, y, z)] ?? 0;
            let visible: boolean;
            if (grid.inside(bx, by, bz)) {
              const nb = grid.get(bx, by, bz);
              visible = nb === EMPTY || (split && (grid.part[grid.index(bx, by, bz)] ?? 0) !== pa);
            } else visible = !(outside?.(bx, by, bz) ?? false);
            if (!visible) continue;
            let ao = 0xff;
            if (useAo) {
              // Corners (-u,-v), (+u,-v), (+u,+v), (-u,+v) on the layer in front of the face.
              const occ = (du: number, dv: number): boolean => {
                q[0] = x;
                q[1] = y;
                q[2] = z;
                q[d] = (q[d] ?? 0) + side;
                q[u] = (q[u] ?? 0) + du;
                q[v] = (q[v] ?? 0) + dv;
                return solidAt(q[0] ?? 0, q[1] ?? 0, q[2] ?? 0);
              };
              const level = (du: number, dv: number): number => {
                const s1 = occ(du, 0);
                const s2 = occ(0, dv);
                if (s1 && s2) return 0;
                return 3 - ((s1 ? 1 : 0) + (s2 ? 1 : 0) + (occ(du, dv) ? 1 : 0));
              };
              ao = level(-1, -1) | (level(1, -1) << 2) | (level(1, 1) << 4) | (level(-1, 1) << 6);
            }
            maskColor[m] = c;
            maskKey[m] = (pa << 8) | ao;
            any = true;
          }
        }
        if (!any) continue;
        // Greedy merge.
        for (let j = 0; j < nv; j++) {
          for (let i = 0; i < nu; ) {
            const m = i + j * nu;
            const c = maskColor[m] ?? EMPTY;
            if (c === EMPTY) {
              i++;
              continue;
            }
            const key = maskKey[m] ?? 0;
            let w = 1;
            while (i + w < nu && maskColor[m + w] === c && maskKey[m + w] === key) w++;
            let h = 1;
            outer: while (j + h < nv) {
              for (let k = 0; k < w; k++) {
                const mm = i + k + (j + h) * nu;
                if (maskColor[mm] !== c || maskKey[mm] !== key) break outer;
              }
              h++;
            }
            for (let jj = 0; jj < h; jj++) for (let ii = 0; ii < w; ii++) maskColor[i + ii + (j + jj) * nu] = EMPTY;
            // Emit the quad.
            const plane = slice + (side > 0 ? 1 : 0);
            const corner = (cu: number, cv: number): void => {
              xyz[d] = plane;
              xyz[u] = cu;
              xyz[v] = cv;
              pos.push(ox + (xyz[0] ?? 0) * s, oy + (xyz[1] ?? 0) * s, oz + (xyz[2] ?? 0) * s);
            };
            const base = pos.length / 3;
            corner(i, j);
            corner(i + w, j);
            corner(i + w, j + h);
            corner(i, j + h);
            const ao = key & 0xff;
            const a = [(ao & 3), (ao >> 2) & 3, (ao >> 4) & 3, (ao >> 6) & 3] as const;
            const [lr, lg, lb] = linear(c);
            const part = key >>> 8;
            for (let k = 0; k < 4; k++) {
              const b = useAo ? (levels[a[k] ?? 3] ?? 1) : 1;
              col.push(lr * b, lg * b, lb * b);
              nor.push(d === 0 ? side : 0, d === 1 ? side : 0, d === 2 ? side : 0);
              prt.push(part);
            }
            // Pick the diagonal the way 0fps does, so occlusion interpolates without a crease across the quad.
            const flip = (a[0] ?? 0) + (a[2] ?? 0) > (a[1] ?? 0) + (a[3] ?? 0);
            if (side > 0) {
              if (flip) idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
              else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
            } else if (flip) idx.push(base + 1, base + 3, base + 2, base + 1, base, base + 3);
            else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
            i += w;
          }
        }
      }
    }
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nor),
    colors: new Float32Array(col),
    parts: new Uint16Array(prt),
    indices: new Uint32Array(idx),
    quads: idx.length / 6,
  };
}

// ---------------------------------------------------------------------------
// Shapes for procedural voxel models (pickups, scenery)

/** Fill every cell whose centre (in grid cells, from the grid's corner) passes `inside`, coloured by `paint`. */
export function fillWhere(grid: VoxelGrid, inside: (x: number, y: number, z: number) => boolean, paint: (x: number, y: number, z: number) => number, part = 0): number {
  let n = 0;
  for (let z = 0; z < grid.nz; z++)
    for (let y = 0; y < grid.ny; y++)
      for (let x = 0; x < grid.nx; x++) {
        if (!inside(x + 0.5, y + 0.5, z + 0.5)) continue;
        grid.set(x, y, z, paint(x, y, z), part);
        n++;
      }
  return n;
}

/** A small palette shade jitter: the colour scaled by 1 +- `amount`, chosen by the voxel's hash. */
export function jitter(rgb: number, x: number, y: number, z: number, amount = 0.06, seed = 0): number {
  return shadeRgb(rgb, 1 + (hash3(x, y, z, seed) * 2 - 1) * amount);
}
