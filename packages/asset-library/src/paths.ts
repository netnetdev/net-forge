/**
 * Where a library file lives, relative to the library's base URL. Games
 * never see these (they use library ids); only the runtime's resolver does.
 * The base URL is the local build in dev ("./library" next to the page),
 * and `<CDN>/ipfs/<library cid>` in production (VITE_LIBRARY_URL).
 */
import type { AssetDef, SoundDef } from "./schema.js";

/** "style.lowpoly.truck" -> "lowpoly/truck.glb"; pixel sprites are PNG. Null for procedural and variant entries. */
export function assetPath(a: AssetDef): string | null {
  const src = a.source;
  if ("procedural" in src || "base" in src) return null;
  const [, style = "", name = ""] = a.id.split(".");
  const ext = "path" in src && src.path.toLowerCase().endsWith(".png") ? "png" : "glb";
  return `${style}/${name}.${ext}`;
}

/** Every library id written in a source text (a game.ts), in first-seen order. */
export function libraryIdsIn(source: string): string[] {
  return [...new Set(source.match(/style\.[a-z0-9]+\.[a-z][a-z0-9_]*/g) ?? [])];
}

/** Join a base URL and a library path. */
export function libraryUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path}`;
}

/** "audio.sfx.hit" -> "audio/sfx/hit.ogg"; the extension is the source file's. */
export function soundPath(s: SoundDef): string {
  const [, group = "", name = ""] = s.id.split(".");
  const file = "path" in s.source ? s.source.path : s.source.url;
  const ext = file.toLowerCase().endsWith(".mp3") ? "mp3" : "ogg";
  return `audio/${group}/${name}.${ext}`;
}
