import { describe, expect, it } from "vitest";
import { MeshBasicMaterial, MeshStandardMaterial } from "three/webgpu";
import { styleKit, STYLE_KITS } from "../src/runtime/styles/index.js";
import { smoothNormalsInPlace } from "../src/runtime/styles/toon/normals.js";
import { isLit, toonTwin, toonUniforms } from "../src/runtime/styles/toon/material.js";
import { toonLook } from "../src/runtime/styles/toon/look.js";

describe("toon art style", () => {
  it("is registered, and unknown or low-poly styles draw with the runtime's own look", () => {
    expect(STYLE_KITS.toon?.id).toBe("toon");
    expect(styleKit("toon")?.id).toBe("toon");
    expect(styleKit("lowpoly")).toBeNull();
    expect(styleKit(undefined)).toBeNull();
  });

  it("has a look for every preset, with a neutral tone curve", () => {
    for (const p of ["night", "dusk", "day", "studio"] as const) expect(toonLook(p).grade.toneMapping).toBe("neutral");
  });

  it("smooths shallow folds and keeps hard corners", () => {
    // Two triangles meeting at 20 degrees along the x axis (faceted: each has its own normal).
    const a = (20 * Math.PI) / 180;
    const positions = [0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, Math.sin(a), -Math.cos(a)];
    const n1 = [0, 1, 0];
    const n2 = [0, Math.cos(a), Math.sin(a)];
    const normals = new Float32Array([...n1, ...n1, ...n1, ...n2, ...n2, ...n2]);
    smoothNormalsInPlace(positions, normals, null);
    // The shared edge (vertices 0, 1 and 3, 4) now has one normal between the two faces.
    expect(normals[1]).toBeCloseTo(normals[10] ?? 0, 5);
    expect(normals[2]).toBeCloseTo(normals[11] ?? 0, 5);
    expect(normals[2]).toBeGreaterThan(0.01);
    // A 90 degree corner stays sharp.
    const sharp = new Float32Array([...n1, ...n1, ...n1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const box = [0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0];
    smoothNormalsInPlace(box, sharp, null);
    expect(sharp[1]).toBeCloseTo(1, 5);
    expect(sharp[11]).toBeCloseTo(1, 5);
  });

  it("twins lit materials only, sharing their colours so template tints show through", () => {
    const src = new MeshStandardMaterial({ color: 0xff0000, roughness: 0.3, metalness: 1, flatShading: true });
    expect(isLit(src)).toBe(true);
    expect(isLit(new MeshBasicMaterial())).toBe(false);
    const twin = toonTwin(src, toonUniforms());
    expect(isLit(twin)).toBe(false);
    expect(twin.color).toBe(src.color);
    expect(twin.flatShading).toBe(false);
    expect(twin.metalness).toBe(0);
    src.opacity = 0.5;
    src.transparent = true;
    twin.sync(src);
    expect(twin.opacity).toBe(0.5);
    expect(twin.transparent).toBe(true);
  });
});
