import { describe, expect, it } from "vitest";
import { EMPTY, fillInterior, greedyMesh, packLinear, srgbToLinear, surfaceVoxels, VoxelGrid, voxelizeTriangles } from "../src/runtime/styles/voxel/core.js";

/** The 12 triangles of an axis-aligned box. */
function boxTriangles(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
  const c = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const faces = [
    [0, 2, 1, 0, 3, 2], [4, 5, 6, 4, 6, 7], [0, 1, 5, 0, 5, 4],
    [3, 6, 2, 3, 7, 6], [0, 4, 7, 0, 7, 3], [1, 2, 6, 1, 6, 5],
  ];
  return faces.flatMap((f) => f.flatMap((i) => c[i] as number[]));
}

describe("voxel core", () => {
  it("voxelizes a box shell and fills its inside", () => {
    const g = new VoxelGrid(10, 10, 10, 0.1, [-0.001, -0.001, -0.001]);
    const shell = voxelizeTriangles(g, boxTriangles(0.2, 0.2, 0.2, 0.8, 0.8, 0.8), () => ({ rgb: 0xff0000, part: 0 }));
    expect(shell).toBeGreaterThan(0);
    const filled = fillInterior(g);
    expect(filled).toBeGreaterThan(0);
    // A solid 6x6x6 or 7x7x7 block, nothing outside it.
    expect(g.get(5, 5, 5)).toBe(0xff0000);
    expect(g.get(0, 0, 0)).toBe(EMPTY);
    expect(surfaceVoxels(g).length).toBeLessThan(g.count());
  });

  it("greedy-meshes a solid block into six quads", () => {
    const g = new VoxelGrid(4, 4, 4, 1);
    for (let z = 0; z < 4; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) g.set(x, y, z, 0x336699);
    const m = greedyMesh(g, { ao: false });
    expect(m.quads).toBe(6);
    expect(m.positions.length).toBe(6 * 4 * 3);
    // Every normal is a unit axis.
    for (let i = 0; i < m.normals.length; i += 3) expect(Math.abs(m.normals[i]!) + Math.abs(m.normals[i + 1]!) + Math.abs(m.normals[i + 2]!)).toBe(1);
    // Linear colour out.
    expect(m.colors[0]).toBeCloseTo(srgbToLinear(0x33), 5);
  });

  it("winds every face outward", () => {
    const g = new VoxelGrid(3, 3, 3, 1);
    g.set(1, 1, 1, 0xffffff);
    const m = greedyMesh(g, { ao: false });
    expect(m.quads).toBe(6);
    for (let t = 0; t < m.indices.length; t += 3) {
      const p = (k: number) => [0, 1, 2].map((a) => m.positions[m.indices[t + k]! * 3 + a]!);
      const [a, b, c] = [p(0), p(1), p(2)] as [number[], number[], number[]];
      const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
      const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
      const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      const centre = [(a[0]! + b[0]! + c[0]!) / 3 - 1.5, (a[1]! + b[1]! + c[1]!) / 3 - 1.5, (a[2]! + b[2]! + c[2]!) / 3 - 1.5];
      expect(n[0]! * centre[0]! + n[1]! * centre[1]! + n[2]! * centre[2]!).toBeGreaterThan(0);
    }
  });

  it("bakes occlusion into the inner corner of an L", () => {
    const g = new VoxelGrid(3, 3, 3, 1);
    g.set(0, 0, 0, 0xffffff);
    g.set(1, 0, 0, 0xffffff);
    g.set(1, 1, 0, 0xffffff);
    const m = greedyMesh(g);
    let darkest = 1;
    for (let i = 0; i < m.colors.length; i += 3) darkest = Math.min(darkest, m.colors[i]!);
    expect(darkest).toBeLessThan(0.9);
  });

  it("keeps faces between rigid parts so they can move apart", () => {
    const g = new VoxelGrid(2, 1, 1, 1);
    g.set(0, 0, 0, 0xffffff, 0);
    g.set(1, 0, 0, 0xffffff, 1);
    expect(greedyMesh(g, { ao: false, splitParts: true }).quads).toBe(12);
    // Joined: no faces between them, but a quad never spans two parts (each moves with its own bone).
    expect(greedyMesh(g, { ao: false, splitParts: false }).quads).toBe(10);
  });

  it("packs linear colours back to sRGB", () => {
    expect(packLinear(1, 0, 0)).toBe(0xff0000);
    expect(packLinear(srgbToLinear(0x80), srgbToLinear(0x40), 0)).toBe(0x804000);
  });
});

describe("voxel kit", async () => {
  const { styleKit, STYLE_KITS } = await import("../src/runtime/styles/index.js");
  const { voxelShape, voxelStack, terrainHeight } = await import("../src/runtime/styles/voxel/index.js");

  it("is registered under its style id, and low-poly has no kit", () => {
    expect(styleKit("voxel")).toBe(STYLE_KITS.voxel);
    expect(styleKit("lowpoly")).toBeNull();
    expect(styleKit(undefined)).toBeNull();
  });

  it("draws a debris chunk as one cube and caches shapes", () => {
    const chunk = voxelShape("chunk");
    expect(chunk).not.toBeNull();
    // Six faces, four vertices each.
    expect(chunk?.geometry.getAttribute("position").count).toBe(24);
    expect(voxelShape("chunk")).toBe(chunk);
    expect(voxelShape("bolt")).toBeNull();
  });

  it("wants sun shadows under every preset and its own night light", () => {
    for (const p of ["night", "dusk", "day", "studio"] as const) expect(voxelStack(p).shadows).toBe(true);
    expect(voxelStack("night").lighting?.sunIntensity).toBeGreaterThan(0);
  });

  it("keeps the field and the strip past the wall flat, then climbs in whole voxels", () => {
    const spec = { half: 20, theme: "meadow" };
    expect(terrainHeight(spec, 0, 0)).toBe(0);
    expect(terrainHeight(spec, 22, 0)).toBe(0);
    for (let x = 24; x < 60; x += 3.7) expect((terrainHeight(spec, x, 5) / 0.5) % 1).toBe(0);
  });
});
