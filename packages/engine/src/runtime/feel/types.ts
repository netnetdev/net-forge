/**
 * Shared shapes of the game-feel kit (game-runtime.md §13). Kept free of
 * three.js and the DOM so the kit imports anywhere, including node tests.
 */

/** Something that can play a pooled particle effect (the GPU particle system implements it). */
export interface ParticleSink {
  burst(preset: string, x: number, y: number, z: number, opts?: ParticleBurstOptions): void;
}

export interface ParticleBurstOptions {
  /** Particle count override. */
  readonly count?: number;
  /** Tint as 0xRRGGBB. */
  readonly color?: number;
  /** Size multiplier. */
  readonly scale?: number;
  /** Bias direction in the ground plane (e.g. the hit direction). */
  readonly dirX?: number;
  readonly dirZ?: number;
}

/** World position to CSS pixels on the canvas. */
export type Projector = (x: number, y: number, z: number) => { x: number; y: number; onScreen: boolean };

/** Anything that takes trauma and an optional FOV punch: a CameraRig, or a bare Trauma. */
export interface TraumaTarget {
  addTrauma(amount: number): void;
  punch?(fovKickDegrees: number): void;
}
