/**
 * Player colours and the store's cosmetic finishes. The cosmetic id rides
 * in the player's `type` field (0 default, then COSMETICS in manifest.ts).
 */
import { BOT_PLAYER_BASE } from "@netforge/engine-sim";
import { KEEPER_COLORS } from "./names.js";

/**
 * Seat bots' colours: hot and saturated, so every opponent pops off the dark
 * yard (the scenery is greys and dim blues; people keep their slot colours).
 */
export const BOT_COLORS = [0xff4433, 0xff9a1a, 0xffe14d, 0xff3d9a, 0xb36bff, 0x4dff8a, 0xff6f4d];

/** A player's colour: humans by slot, bots from BOT_COLORS. */
export function playerColor(owner: number): number {
  if (owner >= BOT_PLAYER_BASE) return BOT_COLORS[(owner - BOT_PLAYER_BASE) % BOT_COLORS.length] ?? 0xff4433;
  return KEEPER_COLORS[(owner - 1) % KEEPER_COLORS.length] ?? 0xffffff;
}

export interface Finish {
  readonly body: number;
  readonly glow: number;
  readonly roughness: number;
  readonly metalness: number;
}

/** 0 default, 1 Neon (a hot two-tone glow), 2 Chrome (mirror metal with a coloured trim). */
export function finishOf(id: number, base: number): Finish {
  if (id === 1) return { body: 0x1a0f2e, glow: 0xff4fd8, roughness: 0.3, metalness: 0.2 };
  if (id === 2) return { body: 0xdfe6f0, glow: base, roughness: 0.12, metalness: 1 };
  return { body: base, glow: base, roughness: 0.45, metalness: 0.35 };
}

/** CSS colour from a hex number. */
export const css = (c: number): string => `#${c.toString(16).padStart(6, "0")}`;
