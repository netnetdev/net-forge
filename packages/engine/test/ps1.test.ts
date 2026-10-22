import { describe, expect, it } from "vitest";
import { BoxGeometry, PlaneGeometry, SphereGeometry, Vector3 } from "three/webgpu";
import { styleKit, STYLE_KITS } from "../src/runtime/styles/index.js";
import { blockGrid } from "../src/runtime/styles/ps1/pipeline.js";
import { tessellate } from "../src/runtime/styles/ps1/materials.js";
import { matchTint, surfaceRole, SURFACES } from "../src/runtime/styles/ps1/surfaces.js";

describe("art styles", () => {
  it("ps1 has a renderer; low-poly and unknown names draw the stack's own frame", () => {
    expect(styleKit("ps1")?.id).toBe("ps1");
    expect(STYLE_KITS.ps1).toBeDefined();
    expect(styleKit("lowpoly")).toBeNull();
    expect(styleKit(undefined)).toBeNull();
    expect(styleKit("nope")).toBeNull();
  });
});

describe("ps1 block grid", () => {
  it("about 240 lines on the short side, whole device pixels per block", () => {
    expect(blockGrid(1280, 800, 240)).toEqual({ k: 3, w: 426, h: 266 });
    expect(blockGrid(1920, 1080, 240)).toEqual({ k: 5, w: 384, h: 216 });
    // A phone in portrait: the short side is the width.
    expect(blockGrid(390, 844, 240)).toEqual({ k: 2, w: 195, h: 422 });
    // Never below one pixel per block, never a zero-sized target.
    expect(blockGrid(100, 50, 240)).toEqual({ k: 1, w: 100, h: 50 });
    expect(blockGrid(0, 0, 240).w).toBeGreaterThan(0);
  });
});

describe("ps1 tessellation", () => {
  it("cuts big planes and boxes into cells of about 3 m", () => {
    const plane = tessellate(new PlaneGeometry(90, 90), new Vector3(1, 1, 1)) as PlaneGeometry;
    expect(plane.parameters.widthSegments).toBe(30);
    expect(plane.parameters.heightSegments).toBe(30);
    // World scale counts: a unit box scaled to a 12 m wall.
    const wall = tessellate(new BoxGeometry(1, 1, 1), new Vector3(12, 3, 1)) as BoxGeometry;
    expect(wall.parameters.widthSegments).toBe(4);
    expect(wall.parameters.heightSegments).toBe(1);
  });

  it("leaves small or already fine geometry, and other shapes, alone", () => {
    const small = new PlaneGeometry(2, 2);
    expect(tessellate(small, new Vector3(1, 1, 1))).toBe(small);
    const fine = new PlaneGeometry(9, 9, 10, 10);
    expect(tessellate(fine, new Vector3(1, 1, 1))).toBe(fine);
    const ball = new SphereGeometry(50);
    expect(tessellate(ball, new Vector3(1, 1, 1))).toBe(ball);
  });
});

describe("ps1 surfaces", () => {
  it("maps template tags and their aliases to library textures", () => {
    expect(surfaceRole("grass")?.id).toBe("surface_grass");
    expect(surfaceRole("ground")).toBe(SURFACES.grass);
    expect(surfaceRole("pillar")).toBe(SURFACES.stone);
    expect(surfaceRole("floor")).toBe(SURFACES.concrete);
    expect(surfaceRole("lava")).toBeNull();
  });

  it("tints a texture to the template's brightness and half its hue", () => {
    const lum = (c: readonly number[]) => 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
    // Same colour: no change.
    expect(matchTint([0.2, 0.3, 0.1], [0.2, 0.3, 0.1]).map((x) => +x.toFixed(6))).toEqual([1, 1, 1]);
    // A bright green texture where the template drew a dark blue-grey field comes out darker and bluer.
    const avg = [0.08, 0.2, 0.03] as const;
    const want = [0.02, 0.03, 0.04] as const;
    const t = matchTint(want, avg);
    const tinted = [avg[0] * t[0], avg[1] * t[1], avg[2] * t[2]];
    expect(lum(tinted)).toBeLessThan(lum(avg));
    expect(lum(tinted)).toBeGreaterThan(lum(want) * 0.5);
    expect(t[2]).toBeGreaterThan(t[1]);
    // Clamped: a black texture never asks for an unbounded gain.
    expect(Math.max(...matchTint([0.5, 0.5, 0.5], [0, 0, 0]))).toBeLessThanOrEqual(3);
  });
});
