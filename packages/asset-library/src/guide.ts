/**
 * The asset library as the builder model reads it: every id it may use in a
 * style, grouped by kind with one plain line each, then how appearances dress a
 * model. Stable text (no dates, no per-request data) so it caches in the
 * model's system prefix.
 */
import { APPEARANCE_PARTS } from "@netforge/engine";
import { library } from "./library.js";
import { ASSET_KINDS, type LibraryStyle } from "./schema.js";

const KIND_TITLE: Readonly<Record<(typeof ASSET_KINDS)[number], string>> = {
  character: "Characters (heroes and players; animated)",
  creature: "Creatures and enemies (animated)",
  vehicle: "Vehicles",
  weapon: "Weapons",
  prop: "Props",
  pickup: "Pickups",
  building: "Buildings",
  nature: "Nature",
  food: "Food",
  tile: "Tiles",
};

export function modelGuide(style: string): string {
  const m = library().styles.get(style as LibraryStyle);
  if (!m) return `No assets are stocked for style "${style}".`;
  const lines: string[] = [
    `## Asset library: style "${style}" (${m.assets.length} models, all CC0, all originals you can rename freely)`,
    "",
    "Use these ids for every model: prefab model, players.prefab, weapon model. Pick by what the thing is; name it anything original in names.json.",
    "Body plans: biped, quadruped, flyer (hovers), blob (squashes), wheeled, static. Animated ones walk, run, attack, get hit and die by themselves.",
  ];
  for (const kind of ASSET_KINDS) {
    const of = m.assets.filter((a) => a.kind === kind);
    if (of.length === 0) continue;
    lines.push("", `### ${KIND_TITLE[kind]}`);
    for (const a of of) lines.push(`${a.id}: ${a.line} [${a.plan}]`);
  }
  lines.push(
    "",
    "## Appearances: dress a model so it becomes your own character",
    "A prefab (and players) can carry appearance: { tint, accent, scale, parts }. tint shifts the model's colours toward \"#rrggbb\"; accent colours the parts; scale is 0.4 to 3 (visual only, radius is the hit size); parts adds up to 4 of:",
    APPEARANCE_PARTS.join(", "),
    "Use an appearance whenever the creator describes a character the library does not have as-is, and to make several enemies from one base.",
    "",
    "Examples",
    '- "add a monster truck": prefab("big_wheel", { model: "style.lowpoly.monster_truck", ... }) (the truck on big_wheels).',
    '- "make the enemies look like slimes": change each enemy prefab\'s model to style.lowpoly.slime_green, slime_pink, slime_spiky (tint them apart if you want more).',
    '- "a storm fox that crackles": model "style.lowpoly.shiba", appearance: { tint: "#5ec8ff", accent: "#1a2a40", parts: ["antenna", "tail_bolt"] }, with a new name of your own.',
    '- "a hero in overalls with a mustache": players.prefab "style.lowpoly.worker", players.appearance: { tint: "#2e7d32", parts: ["mustache", "hat_cap"] }.',
    "- Unknown words resolve to the nearest library model plus an appearance; never invent an id.",
  );
  return lines.join("\n");
}
