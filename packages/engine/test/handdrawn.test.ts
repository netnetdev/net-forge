import { describe, expect, it } from "vitest";
import { MeshBasicMaterial, MeshStandardMaterial } from "three/webgpu";
import { pickStyle, styleKit } from "../src/runtime/styles/index.js";
import { handdrawnKit } from "../src/runtime/styles/handdrawn/index.js";
import { HANDDRAWN_LOOKS, handdrawnLook } from "../src/runtime/styles/handdrawn/looks.js";
import { HANDDRAWN_PALETTE, HANDDRAWN_PALETTE_HEX, linearRgb, nearestPigment, PIGMENTS } from "../src/runtime/styles/handdrawn/palette.js";
import { paintable } from "../src/runtime/styles/handdrawn/paint.js";
import { noiseData, paperData, seeded, tileNoise } from "../src/runtime/styles/handdrawn/textures.js";

describe("hand-drawn style", () => {
  it("is registered by name; lowpoly and unknown names keep the engine's own picture", () => {
    expect(styleKit("handdrawn")).toBe(handdrawnKit);
    expect(styleKit("lowpoly")).toBeNull();
    expect(styleKit("nope")).toBeNull();
    expect(styleKit(undefined)).toBeNull();
    expect(handdrawnKit.needsPost).toBe(true);
  });

  it("?style= wins only with a known style name", () => {
    expect(pickStyle("lowpoly", "handdrawn")).toBe("handdrawn");
    expect(pickStyle("lowpoly", "crayon")).toBe("lowpoly");
    expect(pickStyle("toon", null)).toBe("toon");
  });

  it("the palette is a fixed pigment box and snaps colours to its nearest pigment", () => {
    expect(HANDDRAWN_PALETTE.length).toBe(Object.keys(PIGMENTS).length);
    expect(HANDDRAWN_PALETTE_HEX.every((h) => /^#[0-9a-f]{6}$/.test(h))).toBe(true);
    for (const p of HANDDRAWN_PALETTE) expect(nearestPigment(p)).toBe(p);
    expect(nearestPigment(0xd85c40)).toBe(PIGMENTS.vermilion);
    expect(nearestPigment(0x3c66aa)).toBe(PIGMENTS.ultramarine);
    const [r, g, b] = linearRgb(0xffffff);
    expect([r, g, b]).toEqual([1, 1, 1]);
  });

  it("every look preset has rising wash values and a glow above them", () => {
    for (const look of Object.values(HANDDRAWN_LOOKS)) {
      const [a, b, c, d] = look.values;
      expect(a).toBeLessThan(b);
      expect(b).toBeLessThan(c);
      expect(c).toBeLessThan(d);
      expect(look.glow).toBeGreaterThan(d);
      expect(look.paint).toBeGreaterThan(0);
    }
    expect(handdrawnLook("night")).toBe(HANDDRAWN_LOOKS.night);
  });

  it("paints lit materials only, and never one that already has its own output", () => {
    expect(paintable(new MeshStandardMaterial())).toBe(true);
    expect(paintable(new MeshBasicMaterial())).toBe(false);
  });

  it("textures are deterministic, tileable and full range", () => {
    expect(seeded(4)()).toBe(seeded(4)());
    const n = tileNoise(64, 4, 2, seeded(1));
    expect(Math.min(...n)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...n)).toBeLessThanOrEqual(1.0001);
    // Tileable: the left column continues from the right one about as smoothly as any neighbouring columns.
    let wrap = 0;
    let inner = 0;
    for (let y = 0; y < 64; y++) {
      wrap += Math.abs((n[y * 64] ?? 0) - (n[y * 64 + 63] ?? 0));
      inner += Math.abs((n[y * 64 + 31] ?? 0) - (n[y * 64 + 32] ?? 0));
    }
    expect(wrap).toBeLessThan(inner * 3 + 1);
    expect(noiseData(11, 32)).toEqual(noiseData(11, 32));
    const paper = paperData(5, 64);
    expect(paper.length).toBe(64 * 64 * 4);
    expect(paper[3]).toBe(255);
  });
});
