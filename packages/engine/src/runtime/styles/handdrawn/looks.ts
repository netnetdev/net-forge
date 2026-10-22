/**
 * The look presets as an illustrator would paint them. Light is soft and
 * coloured (the washes keep its hue), fog is the paper showing through,
 * tone mapping is neutral so pigments print as mixed, and bloom is a
 * whisper (watercolour does not glow; only lanterns and fire get a halo).
 * `paint` is the light level the washes are cut at for that preset.
 */
import type { Look, LookPreset } from "../../render/presets.js";

export interface HanddrawnLook extends Look {
  /** Multiplier on the light level before the washes are cut. */
  readonly paint: number;
  /** Paint value of each wash: deep shadow, shadow, mid, light. */
  readonly values: readonly [number, number, number, number];
  /** Paint value where the light is hot (lanterns, fire). */
  readonly glow: number;
}

const neutralGrade = {
  exposure: 1,
  contrast: 1,
  saturation: 1,
  shadowTint: [1, 1, 1] as const,
  highlightTint: [1, 1, 1] as const,
  toneMapping: "neutral" as const,
};

export const HANDDRAWN_LOOKS: Record<LookPreset, HanddrawnLook> = {
  // A nocturne: an indigo wash over the sheet, the moon cool on the tops of things, lanterns left as warm paper.
  night: {
    paint: 0.9,
    values: [0.34, 0.52, 0.74, 0.94], glow: 1.3,
    lighting: { sky: 0x8ea4e6, ground: 0x3e3c5c, hemi: 1.7, sun: 0xc4d2ff, sunIntensity: 1.6, sunDir: [-0.45, 0.85, 0.3], ambient: 0.35, ambientColor: 0x8090c8, shadowStrength: 0.55 },
    atmosphere: { fog: 0x2e3450, skyTop: 0x1c2036, mode: "linear", near: 40, far: 120, density: 0.01, heightFog: 0, heightFogTop: 0 },
    grade: { ...neutralGrade, saturation: 0.96, vignette: 0.34, bloomStrength: 0.28, bloomRadius: 0.35, bloomThreshold: 0.92 },
  },
  dusk: {
    paint: 1,
    values: [0.32, 0.5, 0.74, 0.95], glow: 1.2,
    lighting: { sky: 0xffcfae, ground: 0x5a4658, hemi: 1.5, sun: 0xffb27a, sunIntensity: 2.2, sunDir: [0.7, 0.45, 0.35], ambient: 0.25, ambientColor: 0xffe0c8, shadowStrength: 0.6 },
    atmosphere: { fog: 0x8a6a74, skyTop: 0x3a3050, mode: "linear", near: 40, far: 130, density: 0.008, heightFog: 0, heightFogTop: 0 },
    grade: { ...neutralGrade, vignette: 0.3, bloomStrength: 0.22, bloomRadius: 0.35, bloomThreshold: 0.92 },
  },
  day: {
    paint: 1,
    values: [0.4, 0.6, 0.84, 1], glow: 1.12,
    lighting: { sky: 0xe4ecf6, ground: 0x8a7a5a, hemi: 1.6, sun: 0xfff2dc, sunIntensity: 2.5, sunDir: [0.4, 0.9, 0.25], ambient: 0.25, ambientColor: 0xffffff, shadowStrength: 0.5 },
    atmosphere: { fog: 0xece3cc, skyTop: 0xd8dde0, mode: "linear", near: 50, far: 170, density: 0.006, heightFog: 0, heightFogTop: 0 },
    grade: { ...neutralGrade, vignette: 0.22, bloomStrength: 0.12, bloomRadius: 0.3, bloomThreshold: 0.96 },
  },
  studio: {
    paint: 1,
    values: [0.42, 0.62, 0.86, 1], glow: 1.1,
    lighting: { sky: 0xffffff, ground: 0x6a6258, hemi: 1.6, sun: 0xffffff, sunIntensity: 2.2, sunDir: [0.5, 1, 0.6], ambient: 0.3, ambientColor: 0xffffff, shadowStrength: 0.45 },
    atmosphere: { fog: 0xece3cc, skyTop: 0xe6dcc4, mode: "linear", near: 60, far: 200, density: 0.005, heightFog: 0, heightFogTop: 0 },
    grade: { ...neutralGrade, vignette: 0.18, bloomStrength: 0.1, bloomRadius: 0.3, bloomThreshold: 0.96 },
  },
};

export function handdrawnLook(preset: LookPreset): HanddrawnLook {
  return HANDDRAWN_LOOKS[preset] ?? HANDDRAWN_LOOKS.studio;
}
