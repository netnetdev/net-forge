/**
 * The voxel style's light and grade. Cubes read by their faces: a strong,
 * lower key light makes tops bright and sides a step darker, a weaker sky
 * fill keeps the shadow side from going flat, and a gentler exposure and
 * saturation keep the saturated voxel palettes from blowing out to white
 * under the night grade's bloom.
 */
import type { LookPreset } from "../../render/presets.js";
import type { StyleStack } from "../kit.js";

export function voxelStack(preset: LookPreset): StyleStack {
  // The key comes from the camera's left and a little behind, so the faces a top-down camera sees are lit unevenly.
  const sunDir: [number, number, number] = [-0.6, 0.72, 0.42];
  switch (preset) {
    case "night":
      return {
        shadows: true,
        lighting: { hemi: 1.45, sky: 0x8ea0e6, ground: 0x2a2416, sun: 0xd2dcff, sunIntensity: 3.9, sunDir, ambient: 0.22, shadowStrength: 0.62 },
        grade: { exposure: 1.1, saturation: 1.02, contrast: 1.1, bloomThreshold: 0.92 },
      };
    case "dusk":
      return { shadows: true, lighting: { sunDir, shadowStrength: 0.6 }, grade: { saturation: 1.0, bloomThreshold: 0.92 } };
    default:
      return { shadows: true, lighting: { sunDir, shadowStrength: 0.55 } };
  }
}
