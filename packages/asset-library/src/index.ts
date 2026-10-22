/**
 * @netnetcapital/asset-library: the per-style asset library of the NetNet
 * game runtime. Pure data and lookups here (no
 * three.js); the renderer side is "@netnetcapital/asset-library/three".
 */
export { assetById, baseAsset, buildLibrary, cueSounds, galleryFor, idsForStyle, library, musicTracks, referenceableIds, search, soundById, stockedStyles } from "./library.js";
export type { Library, SearchHit } from "./library.js";
export { PART_ANCHOR, resolveLook } from "./look.js";
export type { AnchorName, ResolvedLook, ResolvedPart } from "./look.js";
export { bareClipName, CLIP_FALLBACK, CLIPS, clipFor, PLAN_MOTION, RIGS } from "./rigs.js";
export type { Clip, PlanMotion, RigDef } from "./rigs.js";
export { ASSET_KINDS, BODY_PLANS, LIBRARY_STYLES, LICENSES, SOUND_FORMATS, SOUND_ID } from "./schema.js";
export type { AssetDef, AssetKind, AssetSource, AudioManifest, BodyPlan, GalleryEntry, LibraryStyle, PackDef, SoundDef, StyleManifest } from "./schema.js";
export { assetPath, libraryIdsIn, libraryUrl, soundPath } from "./paths.js";
export { soundBank } from "./audio.js";
export type { BankSound, LibrarySoundBank, SoundBankOptions } from "./audio.js";
export { modelGuide } from "./guide.js";
export { inEveryStyle, restyleId } from "./restyle.js";
// The voxel style: the voxel core the library build and the runtime share.
export * as voxel from "./voxel.js";
