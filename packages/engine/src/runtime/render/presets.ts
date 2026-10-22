/**
 * Look presets: one name picks the lighting, the atmosphere and the color
 * grade together, so a template (or a generated game) says `preset: "dusk"`
 * and gets a coherent picture. Plain data, node-testable.
 */

export type LookPreset = "night" | "dusk" | "day" | "studio";
export const LOOK_PRESETS: readonly LookPreset[] = ["night", "dusk", "day", "studio"];

export interface LightingPreset {
  /** Hemisphere sky and ground colors, intensity. */
  readonly sky: number;
  readonly ground: number;
  readonly hemi: number;
  /** Directional sun (or moon) color and intensity. */
  readonly sun: number;
  readonly sunIntensity: number;
  /** Direction the light travels FROM, normalized at use (x, y, z). */
  readonly sunDir: readonly [number, number, number];
  /** Flat ambient fill (0 = none). */
  readonly ambient: number;
  readonly ambientColor: number;
  /** Shadow darkness 0..1 (1 = full black shadows). */
  readonly shadowStrength: number;
}

export interface AtmospherePreset {
  /** Fog and horizon color. */
  readonly fog: number;
  /** Sky gradient: color at the top of the screen. */
  readonly skyTop: number;
  readonly mode: "linear" | "exp2";
  /** Linear fog near and far (m), or exp2 density. */
  readonly near: number;
  readonly far: number;
  readonly density: number;
  /** Height fog density (0 = off) below `heightFogTop` m. */
  readonly heightFog: number;
  readonly heightFogTop: number;
}

export interface GradePreset {
  readonly exposure: number;
  readonly contrast: number;
  readonly saturation: number;
  /** Multiplier tints for shadows and highlights (split toning). */
  readonly shadowTint: readonly [number, number, number];
  readonly highlightTint: readonly [number, number, number];
  readonly vignette: number;
  readonly bloomStrength: number;
  readonly bloomRadius: number;
  readonly bloomThreshold: number;
  readonly toneMapping: "aces" | "agx" | "neutral";
}

export interface Look {
  readonly lighting: LightingPreset;
  readonly atmosphere: AtmospherePreset;
  readonly grade: GradePreset;
}

const LOOKS: Record<LookPreset, Look> = {
  night: {
    lighting: {
      sky: 0x9fb0ff,
      ground: 0x3a2c18,
      hemi: 2.6,
      sun: 0xc8d6ff,
      sunIntensity: 3.4,
      sunDir: [-0.45, 0.85, 0.3],
      ambient: 0.35,
      ambientColor: 0x8090c0,
      shadowStrength: 0.75,
    },
    atmosphere: { fog: 0x121a2a, skyTop: 0x060912, mode: "linear", near: 32, far: 85, density: 0.018, heightFog: 0.06, heightFogTop: 1.2 },
    grade: {
      exposure: 1.5,
      contrast: 1.08,
      saturation: 1.12,
      shadowTint: [0.86, 0.94, 1.15],
      highlightTint: [1.08, 1.0, 0.9],
      vignette: 0.42,
      bloomStrength: 0.8,
      bloomRadius: 0.45,
      bloomThreshold: 0.82,
      toneMapping: "aces",
    },
  },
  dusk: {
    lighting: {
      sky: 0xffb38a,
      ground: 0x3a2a3a,
      hemi: 1.2,
      sun: 0xffa060,
      sunIntensity: 2.6,
      sunDir: [0.7, 0.45, 0.35],
      ambient: 0.1,
      ambientColor: 0xffd0b0,
      shadowStrength: 0.7,
    },
    atmosphere: { fog: 0x6a4a5c, skyTop: 0x2a2140, mode: "linear", near: 30, far: 110, density: 0.012, heightFog: 0.04, heightFogTop: 1.5 },
    grade: {
      exposure: 1.0,
      contrast: 1.08,
      saturation: 1.15,
      shadowTint: [0.9, 0.88, 1.12],
      highlightTint: [1.1, 1.0, 0.86],
      vignette: 0.35,
      bloomStrength: 0.65,
      bloomRadius: 0.5,
      bloomThreshold: 0.85,
      toneMapping: "agx",
    },
  },
  day: {
    lighting: {
      sky: 0xcfe6ff,
      ground: 0x6b5a40,
      hemi: 1.3,
      sun: 0xfff2dc,
      sunIntensity: 3.2,
      sunDir: [0.4, 0.9, 0.25],
      ambient: 0.15,
      ambientColor: 0xffffff,
      shadowStrength: 0.6,
    },
    atmosphere: { fog: 0xb8d4ee, skyTop: 0x6aa6e8, mode: "linear", near: 45, far: 160, density: 0.008, heightFog: 0, heightFogTop: 0 },
    grade: {
      exposure: 1.0,
      contrast: 1.04,
      saturation: 1.08,
      shadowTint: [0.95, 0.98, 1.06],
      highlightTint: [1.04, 1.01, 0.96],
      vignette: 0.22,
      bloomStrength: 0.35,
      bloomRadius: 0.4,
      bloomThreshold: 0.95,
      toneMapping: "agx",
    },
  },
  studio: {
    lighting: {
      sky: 0xffffff,
      ground: 0x404040,
      hemi: 1.4,
      sun: 0xffffff,
      sunIntensity: 2.4,
      sunDir: [0.5, 1, 0.6],
      ambient: 0.3,
      ambientColor: 0xffffff,
      shadowStrength: 0.5,
    },
    atmosphere: { fog: 0x22252c, skyTop: 0x101216, mode: "linear", near: 60, far: 200, density: 0.005, heightFog: 0, heightFogTop: 0 },
    grade: {
      exposure: 1.0,
      contrast: 1.0,
      saturation: 1.0,
      shadowTint: [1, 1, 1],
      highlightTint: [1, 1, 1],
      vignette: 0.15,
      bloomStrength: 0.3,
      bloomRadius: 0.35,
      bloomThreshold: 0.95,
      toneMapping: "neutral",
    },
  },
};

/** A preset by name; unknown names fall back to "studio" (never throws at runtime). */
export function resolveLook(name: string | undefined): Look {
  return (name !== undefined && (LOOKS as Record<string, Look>)[name]) || LOOKS.studio;
}
