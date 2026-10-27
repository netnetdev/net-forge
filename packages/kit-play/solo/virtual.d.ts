declare module "virtual:kit-play-solo" {
  import type { SoloEntry } from "./protocol.js";
  /** The template's src/manifest.ts, as a namespace. */
  export const template: Readonly<Record<string, unknown>>;
  export const entry: SoloEntry;
}
