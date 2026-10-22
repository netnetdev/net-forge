import { z } from "zod";

/**
 * APPEARANCE (game-runtime.md §10, asset library section). An appearance
 * dresses a library model so one base makes many distinct originals: a
 * body colour, an accent colour, a size, and up to four attachments from a
 * fixed list. The model writes appearances; it never writes geometry. The
 * same recipe draws the same character on every client.
 *
 * Not to be confused with game({ look }), the scene's render look.
 * Kept in its own file so schema changes elsewhere rebase mechanically.
 */

/** Attachments an appearance can add. Each sits on an anchor the body plan has (head, face, back, tail, body, wheels). */
export const APPEARANCE_PARTS = [
  "horns",
  "ears_long",
  "ears_round",
  "antenna",
  "crown",
  "hat_cap",
  "hat_top",
  "mustache",
  "tail",
  "tail_bolt",
  "wings",
  "armor",
  "backpack",
  "big_wheels",
] as const;

const HEX = /^#[0-9a-fA-F]{6}$/;

export const appearanceSchema = z
  .object({
    /** Main body colour, "#rrggbb". Shifts the model's palette toward it. */
    tint: z.string().regex(HEX, 'colours are "#rrggbb", e.g. "#ffd23f"').optional(),
    /** Colour of the attachments, "#rrggbb". Default: a darker tint. */
    accent: z.string().regex(HEX, 'colours are "#rrggbb", e.g. "#3a2a1a"').optional(),
    /** Size multiplier on the library model's height (0.4 to 3). Visual only; the prefab's radius is the hit size. */
    scale: z.number().min(0.4, "scale is at least 0.4").max(3, "scale is at most 3").optional(),
    /** Up to four attachments, e.g. ["ears_long", "tail_bolt"]. */
    parts: z.array(z.enum(APPEARANCE_PARTS)).max(4, "an appearance carries at most 4 parts").default([]),
  })
  .strict();

export type AppearanceInput = z.input<typeof appearanceSchema>;
export type AppearanceDef = z.output<typeof appearanceSchema>;
export type AppearancePart = (typeof APPEARANCE_PARTS)[number];
