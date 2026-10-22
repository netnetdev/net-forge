import { PerspectiveCamera, Vector3 } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { pixelBlock, PIXEL_PALETTE, viewMetres } from "../src/runtime/styles/pixel/index.js";
import { styleKit, STYLE_KITS } from "../src/runtime/styles/index.js";

describe("pixel style", () => {
  it("is registered under the name games declare", () => {
    expect(styleKit("pixel")?.id).toBe("pixel");
    expect(STYLE_KITS.pixel).toBeDefined();
    expect(styleKit("lowpoly")).toBeNull();
    expect(styleKit(undefined)).toBeNull();
  });

  it("picks a whole block size near 16 picture pixels per metre", () => {
    // EMBERWATCH: about 16 m of view on a 720 px canvas -> 3 px blocks (240 rows).
    expect(pixelBlock(720, 15.85, 16)).toBe(3);
    expect(pixelBlock(1440, 15.85, 16)).toBe(6);
    expect(pixelBlock(1080, 15.85, 16)).toBe(4);
    // Never under one screen pixel, and a tiny window keeps a legible row count.
    expect(pixelBlock(100, 50, 16)).toBe(1);
    expect(pixelBlock(240, 2, 16, 120)).toBe(2);
  });

  it("measures the view height at the ground the camera looks at", () => {
    const cam = new PerspectiveCamera(50, 16 / 9, 0.1, 500);
    // Straight down from 17 m: 2 * 17 * tan(25 deg).
    const m = viewMetres(cam, new Vector3(0, -1, 0), new Vector3(0, 17, 0));
    expect(m).toBeCloseTo(2 * 17 * Math.tan((25 * Math.PI) / 180), 5);
  });

  it("has a 16-colour palette of lowercase hex colours", () => {
    expect(PIXEL_PALETTE).toHaveLength(16);
    for (const c of PIXEL_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});
