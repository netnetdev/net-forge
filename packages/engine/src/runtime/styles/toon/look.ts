/**
 * The toon style's look presets. Cartoon lighting is simpler and brighter
 * than the runtime's: one strong key light (it makes the bands), a cool,
 * saturated fill (it colours the shadow side), little fog, a neutral tone
 * curve that keeps colours true, and light bloom only on things that glow.
 * Same preset names as the runtime, so a game's look.preset still means
 * night, dusk, day or studio.
 */
import type { Look, LookPreset } from "../../render/presets.js";

const LOOKS: Record<LookPreset, Look> = {
  // A storybook night: moonlit blues and violets, warm lantern pools, nothing near black.
  night: {
    lighting: {
      sky: 0xa8b8ff,
      ground: 0x3c2c58,
      hemi: 0.7,
      sun: 0xd6e2ff,
      sunIntensity: 4.4,
      sunDir: [-0.42, 0.86, 0.32],
      ambient: 1.9,
      ambientColor: 0x6f62d8,
      shadowStrength: 0.6,
    },
    atmosphere: { fog: 0x2a2a5c, skyTop: 0x141238, mode: "linear", near: 50, far: 150, density: 0.01, heightFog: 0, heightFogTop: 0 },
    grade: {
      exposure: 1.4,
      contrast: 1.04,
      saturation: 1.18,
      shadowTint: [0.92, 0.9, 1.14],
      highlightTint: [1.06, 1.01, 0.92],
      vignette: 0.22,
      bloomStrength: 0.42,
      bloomRadius: 0.35,
      bloomThreshold: 0.95,
      toneMapping: "neutral",
    },
  },
  // Golden hour: orange key light, violet shadows.
  dusk: {
    lighting: {
      sky: 0xffc39a,
      ground: 0x4a3058,
      hemi: 0.6,
      sun: 0xffb478,
      sunIntensity: 3.8,
      sunDir: [0.62, 0.62, 0.42],
      ambient: 1.5,
      ambientColor: 0x8a5ad0,
      shadowStrength: 0.6,
    },
    atmosphere: { fog: 0x8a5a78, skyTop: 0x3a2a60, mode: "linear", near: 55, far: 170, density: 0.008, heightFog: 0, heightFogTop: 0 },
    grade: {
      exposure: 1.1,
      contrast: 1.04,
      saturation: 1.2,
      shadowTint: [0.95, 0.9, 1.1],
      highlightTint: [1.08, 1.0, 0.9],
      vignette: 0.2,
      bloomStrength: 0.38,
      bloomRadius: 0.35,
      bloomThreshold: 0.95,
      toneMapping: "neutral",
    },
  },
  // Saturday-morning daylight: white sun, sky-blue shadows.
  day: {
    lighting: {
      sky: 0xd8ecff,
      ground: 0x6a6040,
      hemi: 0.6,
      sun: 0xfff6e6,
      sunIntensity: 3.6,
      sunDir: [0.38, 0.88, 0.28],
      ambient: 1.7,
      ambientColor: 0x7ca0e8,
      shadowStrength: 0.55,
    },
    atmosphere: { fog: 0xbfe0ff, skyTop: 0x6ab4ff, mode: "linear", near: 60, far: 190, density: 0.006, heightFog: 0, heightFogTop: 0 },
    grade: {
      exposure: 1.0,
      contrast: 1.03,
      saturation: 1.15,
      shadowTint: [0.97, 0.99, 1.06],
      highlightTint: [1.03, 1.01, 0.97],
      vignette: 0.14,
      bloomStrength: 0.25,
      bloomRadius: 0.3,
      bloomThreshold: 1.0,
      toneMapping: "neutral",
    },
  },
  studio: {
    lighting: {
      sky: 0xffffff,
      ground: 0x505060,
      hemi: 0.6,
      sun: 0xffffff,
      sunIntensity: 3.2,
      sunDir: [0.5, 1, 0.6],
      ambient: 1.6,
      ambientColor: 0x9a9ad8,
      shadowStrength: 0.5,
    },
    atmosphere: { fog: 0x2a2838, skyTop: 0x16141f, mode: "linear", near: 70, far: 220, density: 0.005, heightFog: 0, heightFogTop: 0 },
    grade: {
      exposure: 1.0,
      contrast: 1.0,
      saturation: 1.1,
      shadowTint: [1, 1, 1],
      highlightTint: [1, 1, 1],
      vignette: 0.12,
      bloomStrength: 0.25,
      bloomRadius: 0.3,
      bloomThreshold: 1.0,
      toneMapping: "neutral",
    },
  },
};

export function toonLook(preset: LookPreset): Look {
  return LOOKS[preset] ?? LOOKS.studio;
}
