/**
 * Draw a game in another art style: the same library name in that style.
 * A game written against "style.lowpoly.ghost" draws "style.voxel.ghost"
 * when it plays in the voxel style (a template's ?style= flag, or the game's
 * declared style). Names a style does not carry stay as they are.
 */
import { assetById, library } from "./library.js";

export function restyleId(id: string, style: string | null | undefined): string {
  if (!style) return id;
  const parts = id.split(".");
  if (parts.length !== 3 || parts[0] !== "style" || parts[1] === style) return id;
  const target = `style.${style}.${parts[2]}`;
  const a = assetById(target);
  return a ? a.id : id;
}

/** Ids plus the same name in every other style the library carries (a draft build copies what any ?style= may draw). */
export function inEveryStyle(ids: readonly string[]): string[] {
  const out = new Set(ids);
  for (const id of ids) for (const style of library().styles.keys()) out.add(restyleId(id, style));
  return [...out];
}
