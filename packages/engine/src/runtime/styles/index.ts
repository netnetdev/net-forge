/**
 * Art styles (game-runtime.md §10): what a game declared with
 * `style: "<name>"` draws with, beyond its library models. Each style lives
 * in its own folder and registers one entry in STYLE_KITS (the one
 * registry). createRenderStack({ style }) applies a kit's render hooks
 * (look, post, session); templates read `stack.kit` (or `styleKit(style)`)
 * for its world builders, falling back to their own drawing for anything a
 * kit leaves out. Low-poly is the templates' own drawing and has no kit.
 */
import { STYLES } from "../../api/schemas.js";
import { handdrawnKit } from "./handdrawn/index.js";
import type { StyleKit } from "./kit.js";
import { pixelKit } from "./pixel/index.js";
import { ps1Kit } from "./ps1/index.js";
import { toonKit } from "./toon/index.js";
import { voxelKit } from "./voxel/kit.js";

export type {
  FieldSpec,
  PillarSpec,
  DecalLook,
  DecalLookInput,
  LookOutput,
  RingLook,
  RingLookInput,
  StyleContext,
  StyledPillar,
  StyleKit,
  StylePost,
  StylePostInput,
  StyleSession,
  StyleShape,
  StyleShapeName,
  StyleStack,
  SurfaceKind,
  SurfaceOptions,
  WorldTheme,
} from "./kit.js";

/** One entry per art style. Keep it a plain map. */
export const STYLE_KITS: Readonly<Record<string, StyleKit>> = {
  handdrawn: handdrawnKit,
  pixel: pixelKit,
  ps1: ps1Kit,
  toon: toonKit,
  voxel: voxelKit,
};

/** The art style a template draws in: a known `?style=` on the URL wins over the game's declared style. */
export function pickStyle(declared: string, requested: string | null | undefined): string {
  return requested && (STYLES as readonly string[]).includes(requested) ? requested : declared;
}

/** The kit for a style, or null (low-poly, or a style with no kit yet). */
export function styleKit(style: string | null | undefined): StyleKit | null {
  return (style && STYLE_KITS[style]) || null;
}

export * as voxel from "./voxel/index.js";
