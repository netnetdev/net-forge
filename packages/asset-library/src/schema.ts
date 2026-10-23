/**
 * The library manifest's shape. The manifest is the
 * only list of what a game can draw: every entry has a library id, the pack
 * it came from, and that pack's verified licence. Files are never in git;
 * `scripts/fetch.ts` downloads each pack from its official source and the
 * Net Forge asset pipeline optimizes and publishes them.
 */
import { appearanceSchema } from "@netforge/engine";
import { z } from "zod";

/** Styles the library is designed for. Only lowpoly and pixel are stocked today. */
export const LIBRARY_STYLES = ["lowpoly", "pixel", "toon", "voxel", "ps1", "handdrawn"] as const;
export type LibraryStyle = (typeof LIBRARY_STYLES)[number];

/** What an asset is, for search, the gallery and the fallback shape. */
export const ASSET_KINDS = ["character", "creature", "vehicle", "weapon", "prop", "pickup", "building", "nature", "food", "tile"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** How a body moves: picks the clip fallbacks and the crowd motion (bob, waddle, hover). */
export const BODY_PLANS = ["biped", "quadruped", "flyer", "blob", "wheeled", "static"] as const;
export type BodyPlan = (typeof BODY_PLANS)[number];

/** Licences we accept. Anything else is refused at load (permissive only). */
export const LICENSES = ["CC0-1.0"] as const;

const NAME = /^[a-z][a-z0-9_]{0,47}$/;
const LIBRARY_ID = /^style\.[a-z0-9]+\.[a-z][a-z0-9_]{0,47}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export const packSchema = z
  .object({
    id: z.string().regex(NAME),
    title: z.string().min(1),
    author: z.string().min(1),
    /** The pack's official page, where the licence is stated. */
    page: z.string().url(),
    license: z.enum(LICENSES),
    licenseUrl: z.string().url(),
    /** How the licence was verified, and when. */
    verified: z.object({ on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), how: z.string().min(10) }).strict(),
    /** Where the files come from: one official archive, or per-file mirrors that state the same licence. */
    download: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("zip"), url: z.string().url(), sha256: z.string().regex(SHA256).optional() }).strict(),
      z.object({ kind: z.literal("files"), host: z.string().url(), note: z.string().min(10) }).strict(),
    ]),
  })
  .strict();

/** Where one asset's file is: a path inside the pack archive, or a direct URL (files packs) with its source page. */
const sourceSchema = z.union([
  z
    .object({
      pack: z.string().regex(NAME),
      path: z.string().min(1).refine((p) => !p.includes(".."), "paths stay inside the archive"),
      sha256: z.string().regex(SHA256).optional(),
    })
    .strict(),
  z
    .object({
      pack: z.string().regex(NAME),
      url: z.string().url(),
      /** The per-model page that states the licence. */
      page: z.string().url(),
      sha256: z.string().regex(SHA256).optional(),
    })
    .strict(),
  /** Built from primitives at load (gems, cells): no file, no licence question. */
  z.object({ procedural: z.string().regex(NAME) }).strict(),
  /** Another library entry dressed with an appearance (e.g. a monster truck is the truck on big wheels). */
  z.object({ base: z.string().regex(LIBRARY_ID), appearance: appearanceSchema }).strict(),
  /**
   * The voxel style: another entry's file rebuilt as voxels at library build time, `res` voxels
   * tall (greedy-meshed, occlusion baked per face, each voxel riding its bone so the clips still play).
   */
  z.object({ voxelize: z.string().regex(LIBRARY_ID), res: z.number().int().min(4).max(96) }).strict(),
]);

const PX = z.number().int().min(0).max(4096);
const HEX = z.string().regex(/^#[0-9a-f]{6}$/);

/**
 * How the library build cuts a pixel-style sprite out of its source file.
 * The build applies these, then snaps every pixel to the style's palette
 * with all-or-nothing alpha, so sprites from different packs read as one
 * game and stay crisp when the runtime scales them (in the Net Forge asset pipeline).
 */
export const spriteSchema = z
  .object({
    /** Cut from the source first, px [x, y, w, h] (a prop or a tree out of a tilemap). */
    crop: z.tuple([PX, PX, PX, PX]).optional(),
    /** A background colour the build turns transparent. */
    key: HEX.optional(),
    /** Rectangles cleared before the crop, px [x, y, w, h] (a neighbour poking into it). */
    clear: z.array(z.tuple([PX, PX, PX, PX])).max(8).optional(),
    /**
     * The pack's thick outline colour: the build strips it where it touches
     * the outside and redraws a 1 px outline, so the sprite is its silhouette
     * and not a dark tile (Tiny Dungeon and Pixel Platformer pad to the edge).
     */
    outline: HEX.optional(),
    /** Lights itself (fire, gems, magic): the night does not darken it. */
    glow: z.boolean().optional(),
  })
  .strict();
export type SpriteDef = z.output<typeof spriteSchema>;

export const assetSchema = z
  .object({
    id: z.string().regex(LIBRARY_ID, 'library ids look like "style.lowpoly.truck"'),
    kind: z.enum(ASSET_KINDS),
    plan: z.enum(BODY_PLANS),
    /** Shared rig and clip set (rigs.ts), for animated models. */
    rig: z.string().regex(NAME).optional(),
    source: sourceSchema,
    /** Height in metres the model is scaled to (sprites: tiles tall). */
    height: z.number().positive().max(60),
    /** One line the model reads when it picks assets. Plain, no franchise names. */
    line: z.string().min(3).max(90),
    /** Search words: what a creator might call it. */
    tags: z.array(z.string().regex(/^[a-z0-9 -]+$/)).min(1).max(16),
    /** Old ids that still resolve here (drafts written before the library). */
    aliases: z.array(z.string().regex(LIBRARY_ID)).default([]),
    /** Yaw that turns the model to face -z (the runtime's forward), radians. */
    yaw: z.number().min(-Math.PI * 2).max(Math.PI * 2).default(0),
    /** 2D styles: how the build cuts the sprite (absent: the whole file). */
    sprite: spriteSchema.optional(),
  })
  .strict();

export const styleManifestSchema = z
  .object({
    style: z.enum(LIBRARY_STYLES),
    /** "3d" models (glTF) or "2d" sprites (PNG). */
    dimension: z.enum(["3d", "2d"]),
    /** Palette the style's generated art is locked to (AssetGenerator). */
    palette: z.array(z.string().regex(/^#[0-9a-f]{6}$/)).min(4).max(32),
    assets: z.array(assetSchema).min(1),
  })
  .strict();

export const galleryEntrySchema = z
  .object({
    /** Stable id of the example, lower_snake_case. */
    id: z.string().regex(NAME),
    name: z.string().min(2).max(32),
    /** One short line. */
    line: z.string().min(3).max(60),
    model: z.string().regex(LIBRARY_ID),
    appearance: appearanceSchema.optional(),
    /** Thumbnail path under the library's thumbs/ folder. */
    thumb: z.string().regex(/^[a-z0-9_/.-]+\.(png|webp)$/),
  })
  .strict();

export const gallerySchema = z.partialRecord(z.enum(LIBRARY_STYLES), z.array(galleryEntrySchema));

/** Sound ids: "audio.sfx.hit", "audio.music.battle_theme_a". */
export const SOUND_ID = /^audio\.(sfx|music)\.[a-z][a-z0-9_]{0,47}$/;
/** Formats every browser decodes (Ogg Vorbis: Chrome, Firefox, Safari 17+; MP3: all). */
export const SOUND_FORMATS = ["ogg", "mp3"] as const;

/**
 * One sound in the audio section (manifest/audio.json): a sound effect a
 * FeelKit cue plays, or a music loop. Same rules as models: a pack with a
 * verified CC0 licence, bytes pinned by sha256, files never in git.
 */
export const soundSchema = z
  .object({
    id: z.string().regex(SOUND_ID, 'sound ids look like "audio.sfx.hit" or "audio.music.<name>"'),
    kind: z.enum(["sfx", "music"]),
    /** The FeelKit cue this effect plays by default (hit, kill, levelUp, ...). */
    cue: z.string().regex(/^[a-z][a-zA-Z0-9]{0,31}$/).optional(),
    /** Mix level: the sample's gain so a default mix sits well (1 = as recorded). */
    gain: z.number().positive().max(8).default(1),
    line: z.string().min(3).max(90),
    tags: z.array(z.string().regex(/^[a-z0-9 -]+$/)).min(1).max(16),
    source: z.union([
      z
        .object({
          pack: z.string().regex(NAME),
          path: z.string().min(1).refine((p) => !p.includes(".."), "paths stay inside the archive"),
          sha256: z.string().regex(SHA256),
        })
        .strict(),
      z.object({ pack: z.string().regex(NAME), url: z.string().url(), page: z.string().url(), sha256: z.string().regex(SHA256) }).strict(),
    ]),
  })
  .strict()
  .refine((s) => SOUND_FORMATS.some((f) => ("path" in s.source ? s.source.path : s.source.url).toLowerCase().endsWith(`.${f}`)), "sounds are .ogg or .mp3")
  .refine((s) => s.kind === (s.id.split(".")[1] ?? ""), "a sound's kind matches its id (audio.sfx.* or audio.music.*)");

export const audioManifestSchema = z.object({ sounds: z.array(soundSchema).min(1) }).strict();

export type SoundDef = z.output<typeof soundSchema>;
export type AudioManifest = z.output<typeof audioManifestSchema>;
export type PackDef = z.output<typeof packSchema>;
export type AssetDef = z.output<typeof assetSchema>;
export type AssetSource = AssetDef["source"];
export type StyleManifest = z.output<typeof styleManifestSchema>;
export type GalleryEntry = z.output<typeof galleryEntrySchema>;
