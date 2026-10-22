/**
 * The library: every asset a game can draw, by id. Loaded from the JSON
 * manifests in ../manifest and validated once. Pure data, no three.js, so
 * the generator, the gate, the assets service and the templates all read
 * the same list.
 */
import audio from "../manifest/audio.json" with { type: "json" };
import { GALLERY as gallery } from "../manifest/gallery.js";
import lowpoly from "../manifest/lowpoly.json" with { type: "json" };
import packs from "../manifest/packs.json" with { type: "json" };
import pixel from "../manifest/pixel.json" with { type: "json" };
import ps1 from "../manifest/ps1.json" with { type: "json" };
import voxel from "../manifest/voxel.json" with { type: "json" };
import { RIGS } from "./rigs.js";
import {
  audioManifestSchema,
  gallerySchema,
  packSchema,
  styleManifestSchema,
  type AssetDef,
  type GalleryEntry,
  type LibraryStyle,
  type PackDef,
  type SoundDef,
  type StyleManifest,
} from "./schema.js";

export interface Library {
  readonly packs: ReadonlyMap<string, PackDef>;
  readonly styles: ReadonlyMap<LibraryStyle, StyleManifest>;
  /** Every asset by id, aliases included (an alias maps to its asset). */
  readonly byId: ReadonlyMap<string, AssetDef>;
  readonly gallery: Readonly<Partial<Record<LibraryStyle, readonly GalleryEntry[]>>>;
  /** The audio section: sound effects and music loops by id (audio.sfx.hit). */
  readonly sounds: ReadonlyMap<string, SoundDef>;
}

/** Validate manifests and cross-references. Throws with every problem listed. */
export function buildLibrary(input: { packs: unknown; styles: readonly unknown[]; gallery: unknown; audio?: unknown }): Library {
  const issues: string[] = [];
  const packList = packSchema.array().parse(input.packs);
  const packMap = new Map(packList.map((p) => [p.id, p]));
  const styles = new Map<LibraryStyle, StyleManifest>();
  const byId = new Map<string, AssetDef>();
  for (const raw of input.styles) {
    const m = styleManifestSchema.parse(raw);
    styles.set(m.style, m);
    for (const a of m.assets) {
      if (!a.id.startsWith(`style.${m.style}.`)) issues.push(`${a.id} is listed under style ${m.style}`);
      if (byId.has(a.id)) issues.push(`${a.id} is listed twice`);
      byId.set(a.id, a);
      if ("pack" in a.source && !packMap.has(a.source.pack)) issues.push(`${a.id} names unknown pack ${a.source.pack}`);
      if (a.rig && !RIGS[a.rig]) issues.push(`${a.id} names unknown rig ${a.rig}`);
    }
  }
  for (const m of styles.values()) {
    for (const a of m.assets) {
      if ("base" in a.source) {
        const base = byId.get(a.source.base);
        if (!base) issues.push(`${a.id} is based on unknown ${a.source.base}`);
        else if ("base" in base.source) issues.push(`${a.id}: a variant's base must be a real asset, not another variant`);
      }
      if ("voxelize" in a.source) {
        const from = byId.get(a.source.voxelize);
        if (!from) issues.push(`${a.id} voxelizes unknown ${a.source.voxelize}`);
        else if (!("pack" in from.source)) issues.push(`${a.id}: only a model with a file can be voxelized (${a.source.voxelize} has none)`);
      }
      for (const al of a.aliases) {
        if (byId.has(al)) issues.push(`alias ${al} collides with an id`);
        byId.set(al, a);
      }
    }
  }
  const g = gallerySchema.parse(input.gallery);
  for (const [style, entries] of Object.entries(g)) {
    for (const e of entries) if (!byId.has(e.model)) issues.push(`gallery ${style}.${e.id} uses unknown model ${e.model}`);
  }
  const sounds = new Map<string, SoundDef>();
  const cues = new Set<string>();
  for (const s of input.audio === undefined ? [] : audioManifestSchema.parse(input.audio).sounds) {
    if (sounds.has(s.id)) issues.push(`${s.id} is listed twice`);
    sounds.set(s.id, s);
    if (!packMap.has(s.source.pack)) issues.push(`${s.id} names unknown pack ${s.source.pack}`);
    if (s.cue && cues.has(s.cue)) issues.push(`${s.id}: cue ${s.cue} already has a sound`);
    if (s.cue) cues.add(s.cue);
    if (s.kind === "music" && s.cue) issues.push(`${s.id}: music has no cue`);
  }
  if (issues.length) throw new Error(`asset library manifest:\n  - ${issues.join("\n  - ")}`);
  return { packs: packMap, styles, byId, gallery: g, sounds };
}

let cached: Library | null = null;

/** The library as shipped in this repository. */
export function library(): Library {
  cached ??= buildLibrary({ packs, styles: [lowpoly, pixel, ps1, voxel], gallery, audio });
  return cached;
}

/** An asset by id or alias, or undefined. */
export function assetById(id: string): AssetDef | undefined {
  return library().byId.get(id);
}

/** The asset a variant ultimately draws (itself for a real asset). */
export function baseAsset(a: AssetDef): AssetDef {
  if ("base" in a.source) return library().byId.get(a.source.base) ?? a;
  return a;
}

/** Canonical ids (no aliases) of one style. */
export function idsForStyle(style: string): string[] {
  const m = library().styles.get(style as LibraryStyle);
  return m ? m.assets.map((a) => a.id) : [];
}

/** Ids a game may reference in a style: canonical ids and the aliases older drafts used. */
export function referenceableIds(style: string): Set<string> {
  const m = library().styles.get(style as LibraryStyle);
  const out = new Set<string>();
  for (const a of m?.assets ?? []) {
    out.add(a.id);
    for (const al of a.aliases) out.add(al);
  }
  return out;
}

/** Styles that have assets today. */
export function stockedStyles(): LibraryStyle[] {
  return [...library().styles.keys()];
}

const STOP = new Set(["a", "an", "the", "of", "like", "with", "and", "or", "to", "make", "add", "look", "looks", "some", "my", "for", "in", "on"]);

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

export interface SearchHit {
  readonly asset: AssetDef;
  readonly score: number;
}

/**
 * Library assets that match a description ("a monster truck", "slimes",
 * "a knight"), best first. Matches tags, the id's name and the line.
 */
export function search(style: string, query: string, limit = 8): SearchHit[] {
  const q = words(query);
  if (q.length === 0) return [];
  const m = library().styles.get(style as LibraryStyle);
  if (!m) return [];
  const hits: SearchHit[] = [];
  for (const a of m.assets) {
    const name = a.id.split(".")[2] ?? "";
    const tagWords = a.tags.flatMap((t) => words(t));
    const nameWords = words(name.replace(/_/g, " "));
    const lineWords = words(a.line);
    let score = 0;
    for (const w of q) {
      if (a.tags.includes(q.join(" "))) score += 6;
      if (tagWords.includes(w)) score += 3;
      if (nameWords.includes(w)) score += 3;
      if (lineWords.includes(w)) score += 1;
    }
    // Whole-phrase tag match ("monster truck") beats its words alone.
    const phrase = q.join(" ");
    if (a.tags.some((t) => t === phrase)) score += 8;
    if (score > 0) hits.push({ asset: a, score });
  }
  return hits.sort((x, y) => y.score - x.score || x.asset.id.localeCompare(y.asset.id)).slice(0, limit);
}

/** The gallery of ready-made looks for a style. */
export function galleryFor(style: string): readonly GalleryEntry[] {
  return library().gallery[style as LibraryStyle] ?? [];
}

/** A sound by id (audio.sfx.hit, audio.music.battle_theme_a), or undefined. */
export function soundById(id: string): SoundDef | undefined {
  return library().sounds.get(id);
}

/** Every sound effect that plays a FeelKit cue by default, by cue name. */
export function cueSounds(): ReadonlyMap<string, SoundDef> {
  const out = new Map<string, SoundDef>();
  for (const s of library().sounds.values()) if (s.kind === "sfx" && s.cue) out.set(s.cue, s);
  return out;
}

/** The music loops, in manifest order. */
export function musicTracks(): SoundDef[] {
  return [...library().sounds.values()].filter((s) => s.kind === "music");
}
