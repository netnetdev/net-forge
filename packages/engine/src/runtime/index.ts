/**
 * @netnetcapital/engine/runtime: the client runtime. Used by templates and
 * the Launcher shell, never imported by generated game code (which sees
 * only the declarative API at the package root).
 */
export { createRenderer } from "./renderer.js";
export type { Backend, RendererHandle, RendererOptions } from "./renderer.js";
export { InstancedCrowd } from "./crowd.js";
export { boundsShift, CameraRig, fieldBounds, groundFootprint } from "./camera.js";
export type { CameraRigOptions, GroundBounds } from "./camera.js";
export { InputController } from "./input.js";
export type { InputOptions, LookTarget } from "./input.js";
export { AssetLoader } from "./assets.js";
export type { AssetLoaderOptions } from "./assets.js";
export { FrameStats } from "./stats.js";
export { lerp, lerpAngle, damp } from "./interpolate.js";
export { ArenaClient } from "./arena.js";
export type { ArenaOptions, ArenaStats } from "./arena.js";
export { collectManifest, resetRegistry } from "../api/registry.js";
export { SystemScheduler } from "../api/scheduler.js";
export type { SystemHost } from "../api/scheduler.js";
// Game feel kit (§13): trauma shake, hit-stop clock, hit flash, knockback offsets,
// damage numbers, tweens, audio hooks, rumble and the FeelKit facade.
export * from "./feel/index.js";
// Render pipeline (§5): lighting and shadows, post, atmosphere, quality tiers,
// GPU particles, decals, animated characters and crowds, createRenderStack.
export * from "./render/index.js";
// Art styles (§10): each style's kit (look, world, crowds, particles), by style id.
export * from "./styles/index.js";
// A template that draws without the render stack applies a style with createStyledView.
export { createStyledView } from "./styles/view.js";
export type { StyledView, StyledViewOptions } from "./styles/view.js";
export { createPixelStyle, PIXEL_PALETTE, pixelBlock } from "./styles/pixel/index.js";
export type { PixelStyleOptions } from "./styles/pixel/index.js";
