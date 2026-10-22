/**
 * The hand-drawn palette: a watercolour box of pigments. Every surface the
 * style paints is pulled toward its nearest pigment, which is what makes
 * models from different packs read as one illustrator's work. The asset
 * library's handdrawn manifest carries the same list (its `palette`), so
 * generated art is locked to it too.
 */

/** Pigments as sRGB hex, light to dark within each family. */
export const PIGMENTS = {
  paper: 0xf3ead6,
  naples: 0xecd59a,
  ochre: 0xd9a548,
  sienna: 0xb8743a,
  umber: 0x6e4a33,
  sepia: 0x3a2a20,
  peach: 0xebbf9f,
  vermilion: 0xd65a3c,
  crimson: 0xa8354a,
  rose: 0xd88f9a,
  violet: 0x7c4f7e,
  indigo: 0x3b3f6b,
  ultramarine: 0x4b66a8,
  cerulean: 0x73a6cb,
  teal: 0x3e8783,
  viridian: 0x3f7656,
  sap: 0x76953f,
  leaf: 0xa9c27c,
  olive: 0x8a8648,
  slate: 0x8c95a0,
  paynes: 0x3f4a58,
  stone: 0xb6aa95,
  ink: 0x241a14,
  white: 0xfbf7ee,
} as const;

export type Pigment = keyof typeof PIGMENTS;

/** The palette in a fixed order (the manifest's `palette`). */
export const HANDDRAWN_PALETTE: readonly number[] = Object.values(PIGMENTS);

/** "#rrggbb" strings, for manifests and docs. */
export const HANDDRAWN_PALETTE_HEX: readonly string[] = HANDDRAWN_PALETTE.map((c) => `#${c.toString(16).padStart(6, "0")}`);

/** sRGB 0..255 channel to linear 0..1. */
export function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** A hex colour as linear rgb. */
export function linearRgb(hex: number): [number, number, number] {
  return [srgbToLinear((hex >> 16) & 255), srgbToLinear((hex >> 8) & 255), srgbToLinear(hex & 255)];
}

/**
 * The pigment nearest to a colour (sRGB hex), measured in a perceptual-ish
 * space (gamma-encoded, weighted toward green like the eye). Pure, so the
 * shader's choice can be checked in node.
 */
export function nearestPigment(hex: number): number {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  let best = HANDDRAWN_PALETTE[0] ?? 0;
  let bd = Infinity;
  for (const p of HANDDRAWN_PALETTE) {
    const dr = r - ((p >> 16) & 255);
    const dg = g - ((p >> 8) & 255);
    const db = b - (p & 255);
    const d = 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}
