import { Color } from "three/webgpu";
import type { Node, Scene } from "three/webgpu";
import {
  densityFogFactor,
  exponentialHeightFogFactor,
  fog,
  max,
  mix,
  rangeFogFactor,
  screenUV,
  smoothstep,
  uniform,
} from "three/tsl";
import { resolveLook } from "./presets.js";
import type { AtmospherePreset, LookPreset } from "./presets.js";

export interface AtmosphereOptions {
  readonly preset?: LookPreset;
  readonly overrides?: Partial<AtmospherePreset>;
  /** Draw the sky gradient as the background (default true). */
  readonly sky?: boolean;
}

/**
 * Fog matched to a sky gradient, so the far ground melts into the
 * background instead of meeting a hard color. Linear or exp2 distance fog,
 * plus an optional low height fog (ground mist). Values live in uniforms:
 * changing them never recompiles a shader.
 */
export class Atmosphere {
  readonly fogColor = uniform(new Color());
  readonly skyTop = uniform(new Color());
  readonly near = uniform(30);
  readonly far = uniform(90);
  readonly density = uniform(0.015);
  readonly heightDensity = uniform(0);
  readonly heightTop = uniform(1);
  private mode: "linear" | "exp2" = "linear";
  private height = false;

  constructor(
    private readonly scene: Scene,
    private readonly opts: AtmosphereOptions = {},
  ) {
    this.setPreset(opts.preset ?? "studio", opts.overrides);
  }

  setPreset(preset: LookPreset, overrides: Partial<AtmospherePreset> = {}): void {
    const a = { ...resolveLook(preset).atmosphere, ...overrides };
    this.fogColor.value.setHex(a.fog);
    this.skyTop.value.setHex(a.skyTop);
    this.near.value = a.near;
    this.far.value = a.far;
    this.density.value = a.density;
    this.heightDensity.value = a.heightFog;
    this.heightTop.value = a.heightFogTop;
    const height = a.heightFog > 0;
    const rebuild = a.mode !== this.mode || height !== this.height || this.scene.fogNode === undefined || this.scene.fogNode === null;
    this.mode = a.mode;
    this.height = height;
    if (rebuild) this.build(a.heightFog > 0);
  }

  private build(height: boolean): void {
    const distance = this.mode === "exp2" ? densityFogFactor(this.density) : rangeFogFactor(this.near, this.far);
    const factor = height ? max(distance, exponentialHeightFogFactor(this.heightDensity, this.heightTop) as Node<"float">) : distance;
    this.scene.fog = null;
    this.scene.fogNode = fog(this.fogColor, factor);
    if (this.opts.sky ?? true) {
      // Screen-space gradient: horizon (fog) color low on screen, sky color at the top.
      this.scene.backgroundNode = mix(this.skyTop, this.fogColor, smoothstep(0, 0.85, screenUV.y));
    }
    // A plain background color as well, for readers of scene.background.
    this.scene.background = new Color(this.fogColor.value);
  }

  dispose(): void {
    this.scene.fogNode = null;
    this.scene.backgroundNode = null;
  }
}
