/**
 * @netnetcapital/engine/runtime render module: lighting
 * with a following shadow, post-processing (bloom, grade, tone mapping,
 * FXAA, outline), atmosphere, quality tiers and dynamic resolution, GPU
 * particles, ground decals and rings, skinned and VAT-animated characters,
 * and `createRenderStack`, which wires them in one call.
 * WebGPU first, WebGL2 fallback: everything here runs on both backends.
 */
export { createRenderStack } from "./stack.js";
export type { RenderStack, RenderStackOptions } from "./stack.js";
export { LightingRig, snapToTexel } from "./lighting.js";
export type { LightingOptions } from "./lighting.js";
export { PostFX } from "./post.js";
export type { PostFXOptions } from "./post.js";
export { Atmosphere } from "./atmosphere.js";
export type { AtmosphereOptions } from "./atmosphere.js";
export { QualityManager, DynamicResolution, detectTier, browserHints, qualitySettings, QUALITY_TIERS } from "./quality.js";
export type { QualityTier, QualitySettings, DeviceHints, DynamicResolutionOptions } from "./quality.js";
export { GpuParticles, ParticleRing, PARTICLE_PRESETS } from "./particles.js";
export type { ParticleBurstOptions as GpuBurstOptions, ParticlePreset, ParticlePresetName, GpuParticlesOptions, ParticleShade, ParticleShadeInput, ParticleShadeOutput } from "./particles.js";
export { GroundDecals, GroundRings } from "./decals.js";
export type { DecalKind, DecalOptions, RingOptions } from "./decals.js";
export { AnimatedCharacter, locomotionState, DEFAULT_LOCOMOTION } from "./animation.js";
export type { AnimatedCharacterOptions, LocomotionState, LocomotionThresholds, PlayOptions as AnimationPlayOptions } from "./animation.js";
export { bakeVertexAnimation, VatCrowd } from "./vat.js";
export type { VertexAnimation, VatClip, BakeOptions, VatCrowdOptions } from "./vat.js";
export { applyCrowdMotion, AnimatedCrowd, toNodeMaterial } from "./crowd-motion.js";
export type { CrowdMotionOptions, CrowdAttributes } from "./crowd-motion.js";
export { billboardWorld, isSprite, markSprite, markSpriteMaterial, SPRITE_TEXEL, spriteBillboardNode, spriteScale } from "./sprite.js";
export { HeroHighlight } from "./highlight.js";
export type { HeroHighlightOptions } from "./highlight.js";
export { buildSegmentRig } from "./rig.js";
export type { SegmentRig, SegmentRigOptions } from "./rig.js";
export { resolveLook, LOOK_PRESETS } from "./presets.js";
export type { Look, LookPreset, LightingPreset, AtmospherePreset, GradePreset } from "./presets.js";
