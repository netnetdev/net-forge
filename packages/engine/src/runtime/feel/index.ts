/**
 * The game-feel kit: one-line components every
 * template uses. See kit.ts for the FeelKit facade.
 */
export { FeelKit, FEEL_PRESETS } from "./kit.js";
export type { FeelKitOptions, FeelPreset, FeelPresetName, HitEvent, KillEvent } from "./kit.js";
export { Trauma } from "./trauma.js";
export type { TraumaOptions } from "./trauma.js";
export { FeelClock, RenderClock } from "./clock.js";
export type { ClockTick, FeelClockOptions } from "./clock.js";
export { HitFlash, flashColor, flashMultiplier } from "./flash.js";
export { KnockbackOffsets } from "./knockback.js";
export type { KnockbackOptions, KnockbackSample } from "./knockback.js";
export { Spring, Spring3, stepSpring } from "./spring.js";
export type { SpringOptions } from "./spring.js";
export { DamageNumbers, NumberStack } from "./numbers.js";
export type { DamageNumbersOptions, NumberDraw, NumberInput, NumberSlot, NumberStackOptions } from "./numbers.js";
export { Ease, Tweens, uiTweens, pop, shakeEl, countUp } from "./tween.js";
export type { EaseFn, EaseName, FeelElement, TweenOptions, TweenProps } from "./tween.js";
export { FeelAudio, Footsteps, CueGate, DEFAULT_CUES, SURFACES, distanceGain } from "./audio.js";
export type { CueOptions, FeelAudioOptions, FootstepOptions, PlayOptions, Surface, SynthRecipe } from "./audio.js";
export { SoundPlayer } from "./sound.js";
export type { MusicElement, SoundBank, SoundBankEntry, SoundPlayerOptions } from "./sound.js";
export { Rumble } from "./rumble.js";
export type { GamepadLike, NavigatorLike, RumbleActuator, RumbleOptions } from "./rumble.js";
export { hashSigned, valueNoise1, seededRandom } from "./noise.js";
export type { ParticleBurstOptions, ParticleSink, Projector, TraumaTarget } from "./types.js";
