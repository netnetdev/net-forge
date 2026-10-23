/**
 * Write manifest/voxel.json: the voxel style's models, each one a low-poly
 * library entry rebuilt as voxels at library build time (source
 * `{ voxelize, res }`). The names, aliases, tags and body plans follow the
 * low-poly entry, so a prompt maps to the same names in either style; `res`
 * (voxels tall) is chosen per model so every family reads as chunky voxel
 * art at the in-game camera distance.
 *
 *   pnpm --filter @netforge/asset-library exec tsx scripts/voxel-manifest.ts
 *
 * Then rebuild the voxel style with the Net Forge asset pipeline.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manifestDir = join(here, "..", "manifest");

interface LowpolyAsset {
  id: string;
  kind: string;
  plan: string;
  rig?: string;
  source: Record<string, unknown>;
  height: number;
  line: string;
  tags: string[];
  aliases?: string[];
  yaw?: number;
}

/** Voxels tall per model family; a name listed in RES overrides it. */
function defaultRes(a: LowpolyAsset): number {
  if (a.kind === "character") return 22;
  if (a.kind === "creature") return a.height >= 2.2 ? 30 : a.height >= 1.6 ? 24 : 18;
  if (a.kind === "vehicle") return 16;
  if (a.kind === "weapon") return 18;
  if (a.kind === "building") return 40;
  if (a.kind === "food" || a.kind === "pickup") return 12;
  if (a.kind === "nature") return a.height >= 3 ? 30 : a.height >= 1.2 ? 18 : 12;
  return 16;
}

/** Hand-tuned: thin or detailed models need more voxels to keep their silhouette, blobs read better chunkier. */
const RES: Readonly<Record<string, number>> = {
  bee: 16,
  ghost: 18,
  slime_green: 13,
  slime_pink: 13,
  slime_spiky: 14,
  slime_drop: 13,
  slime_horned: 14,
  mushroom_imp: 16,
  frog: 14,
  dragon: 32,
  trex: 34,
  mushroom_king: 34,
  demon_blue: 30,
  campfire: 12,
  stump: 10,
  chest: 14,
  crystal: 16,
  tree_pine: 26,
  tree_pine_tall: 34,
  tree_dark: 24,
  tree_oak: 24,
  rock_large: 12,
  generator: 22,
  satellite_dish: 26,
  barrels: 14,
  truck_flat: 18,
  van: 18,
  blaster_h: 20,
};

/** Low-poly names the voxel style does not carry (too fine to read as voxels, or near-duplicates). */
const SKIP = new Set<string>([]);

const lowpoly = JSON.parse(readFileSync(join(manifestDir, "lowpoly.json"), "utf8")) as { assets: LowpolyAsset[] };
const assets = lowpoly.assets
  .filter((a) => "pack" in a.source && !SKIP.has(a.id.split(".")[2] ?? ""))
  .map((a) => {
    const name = a.id.split(".")[2] ?? "";
    const out: Record<string, unknown> = {
      id: `style.voxel.${name}`,
      kind: a.kind,
      plan: a.plan,
      ...(a.rig ? { rig: a.rig } : {}),
      source: { voxelize: a.id, res: RES[name] ?? defaultRes(a) },
      height: a.height,
      line: a.line.length <= 82 ? `voxel ${a.line}` : a.line,
      tags: [...new Set([...a.tags, "voxel"])].slice(0, 16),
      aliases: (a.aliases ?? []).map((al) => `style.voxel.${al.split(".")[2] ?? ""}`),
    };
    if (a.yaw) out.yaw = a.yaw;
    return out;
  });

// Pickups the engine builds from voxels at load (no file): gems and cells.
const procedural = [
  ["gem_small", "small amber voxel gem (xp)", ["gem", "xp", "ember", "crystal", "small"], ["style.voxel.ember_small"]],
  ["gem_mid", "blue voxel gem (more xp)", ["gem", "xp", "crystal", "blue"], ["style.voxel.ember_mid"]],
  ["gem_large", "big magenta voxel gem (lots of xp)", ["gem", "xp", "crystal", "large", "pink"], ["style.voxel.ember_large"]],
  ["cell_heal", "green voxel health cell", ["heal", "health", "cell", "potion", "green"], ["style.voxel.volt_cell"]],
  ["cell_spark", "blue voxel energy cell", ["energy", "cell", "spark", "power", "blue"], ["style.voxel.spark_cell"]],
] as const;
for (const [name, line, tags, aliases] of procedural) {
  assets.push({ id: `style.voxel.${name}`, kind: "pickup", plan: "static", source: { procedural: `voxel_${name}` }, height: 0.5, line, tags: [...tags, "voxel"], aliases: [...aliases] });
}

const manifest = {
  style: "voxel",
  dimension: "3d",
  // Generated art for the voxel style is locked to this palette: warm daylight greens, earths and stone, with bright accents.
  palette: ["#2b2b3a", "#3f4b3b", "#4f7a3a", "#79a948", "#b6d36b", "#6b4a32", "#9a6b43", "#c99a62", "#7f8a96", "#b9c2c9", "#f1efe4", "#e8b04a", "#e0603a", "#b43a4a", "#5aa8d8", "#8a5cc8"],
  assets,
};
writeFileSync(join(manifestDir, "voxel.json"), JSON.stringify(manifest, null, 1) + "\n");
console.log(`wrote ${assets.length} voxel assets`);
