import { AmbientLight, Color, DirectionalLight, HemisphereLight, Object3D, PCFShadowMap } from "three/webgpu";
import type { Scene, WebGPURenderer } from "three/webgpu";
import { resolveLook } from "./presets.js";
import type { LightingPreset, LookPreset } from "./presets.js";

export type Vec3Tuple = [number, number, number];

/**
 * Snap a world point to the shadow map's texel grid in light space, so a
 * shadow camera that follows the player moves in whole texels and the
 * shadow edges never shimmer. `dir` is the light's travel-from direction
 * (unit), `texel` the world size of one shadow texel.
 */
export function snapToTexel(p: readonly [number, number, number], dir: readonly [number, number, number], texel: number): Vec3Tuple {
  const [dx, dy, dz] = normalize(dir);
  // A right/up basis perpendicular to the light direction.
  let rx = dz;
  let ry = 0;
  let rz = -dx;
  const rl = Math.hypot(rx, ry, rz);
  if (rl < 1e-6) {
    rx = 1;
    ry = 0;
    rz = 0;
  } else {
    rx /= rl;
    rz /= rl;
  }
  // up = dir x right
  const ux = dy * rz - dz * ry;
  const uy = dz * rx - dx * rz;
  const uz = dx * ry - dy * rx;
  const a = p[0] * rx + p[1] * ry + p[2] * rz;
  const b = p[0] * ux + p[1] * uy + p[2] * uz;
  const c = p[0] * dx + p[1] * dy + p[2] * dz;
  const sa = texel > 0 ? Math.round(a / texel) * texel : a;
  const sb = texel > 0 ? Math.round(b / texel) * texel : b;
  return [rx * sa + ux * sb + dx * c, ry * sa + uy * sb + dy * c, rz * sa + uz * sb + dz * c];
}

function normalize(v: readonly [number, number, number]): Vec3Tuple {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export interface LightingOptions {
  readonly preset?: LookPreset;
  /** Override pieces of the preset. */
  readonly overrides?: Partial<LightingPreset>;
  /** Shadow map size in texels; 0 turns shadows off. Default 2048. */
  readonly shadowMapSize?: number;
  /** Half-size of the square area around the focus that receives shadows, m. Default 26. */
  readonly shadowExtent?: number;
}

/**
 * Hemisphere + one directional light whose single shadow map follows a
 * focus point (the player), snapped to texels. Sized for a top-down or
 * third-person view: one tuned map beats cascades at this camera distance.
 */
export class LightingRig {
  readonly root = new Object3D();
  readonly hemi: HemisphereLight;
  readonly sun: DirectionalLight;
  readonly ambient: AmbientLight;
  private dir: Vec3Tuple;
  private extent: number;
  private mapSize: number;
  private readonly distance = 60;

  constructor(
    private readonly renderer: WebGPURenderer,
    scene: Scene,
    opts: LightingOptions = {},
  ) {
    const p = { ...resolveLook(opts.preset).lighting, ...opts.overrides };
    this.hemi = new HemisphereLight(p.sky, p.ground, p.hemi);
    this.sun = new DirectionalLight(p.sun, p.sunIntensity);
    this.ambient = new AmbientLight(p.ambientColor, p.ambient);
    this.dir = normalize(p.sunDir);
    this.extent = opts.shadowExtent ?? 26;
    this.mapSize = 0;
    this.root.name = "LightingRig";
    this.root.add(this.hemi, this.sun, this.sun.target, this.ambient);
    scene.add(this.root);
    renderer.shadowMap.type = PCFShadowMap;
    this.setShadowMapSize(opts.shadowMapSize ?? 2048);
    this.sun.shadow.intensity = p.shadowStrength;
    this.follow(0, 0, 0);
  }

  /** World size of one shadow texel at the current settings. */
  get texel(): number {
    return this.mapSize > 0 ? (this.extent * 2) / this.mapSize : 0;
  }

  get shadowsOn(): boolean {
    return this.mapSize > 0;
  }

  /** Change the shadow resolution (quality tier); 0 turns shadows off. */
  setShadowMapSize(size: number): void {
    const s = Math.max(0, Math.floor(size));
    if (s === this.mapSize) return;
    this.mapSize = s;
    const on = s > 0;
    this.renderer.shadowMap.enabled = on || this.renderer.shadowMap.enabled;
    this.sun.castShadow = on;
    if (!on) return;
    const sh = this.sun.shadow;
    sh.mapSize.set(s, s);
    // Bias tuned for a 1-2 texel slope at these extents; normalBias kills acne on curved crowds.
    sh.bias = -0.0005;
    sh.normalBias = 0.03;
    sh.radius = 2.5;
    this.applyExtent();
    // A resized map needs a new render target.
    sh.map?.dispose();
    sh.map = null;
  }

  /** Half-size of the shadowed square around the focus, m (fit it to what the camera shows). */
  setShadowExtent(extent: number): void {
    this.extent = Math.max(2, extent);
    this.applyExtent();
  }

  private applyExtent(): void {
    const cam = this.sun.shadow.camera;
    cam.left = -this.extent;
    cam.right = this.extent;
    cam.top = this.extent;
    cam.bottom = -this.extent;
    cam.near = 1;
    cam.far = this.distance * 2 + 20;
    cam.updateProjectionMatrix();
  }

  /** Move the shadowed area to follow a focus point (texel-snapped). */
  follow(x: number, y: number, z: number): void {
    const [sx, sy, sz] = snapToTexel([x, y, z], this.dir, this.texel);
    const d = this.distance;
    this.sun.position.set(sx + this.dir[0] * d, sy + this.dir[1] * d, sz + this.dir[2] * d);
    this.sun.target.position.set(sx, sy, sz);
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();
  }

  /** Switch the preset colors and intensities in place. */
  setPreset(preset: LookPreset, overrides: Partial<LightingPreset> = {}): void {
    const p = { ...resolveLook(preset).lighting, ...overrides };
    this.hemi.color = new Color(p.sky);
    this.hemi.groundColor = new Color(p.ground);
    this.hemi.intensity = p.hemi;
    this.sun.color = new Color(p.sun);
    this.sun.intensity = p.sunIntensity;
    this.ambient.color = new Color(p.ambientColor);
    this.ambient.intensity = p.ambient;
    this.sun.shadow.intensity = p.shadowStrength;
    this.dir = normalize(p.sunDir);
  }

  dispose(): void {
    this.sun.shadow.map?.dispose();
    this.root.removeFromParent();
  }
}
