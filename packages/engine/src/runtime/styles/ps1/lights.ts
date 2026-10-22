/**
 * Per-vertex (Gouraud) lighting for the PS1 style. The scene's own lights
 * (ambient, hemisphere, directional and point lights the templates and the
 * LightingRig add) are gathered once a frame into a few shared uniforms, and
 * every styled material lights its vertices from them in the vertex stage.
 * Big triangles therefore light like a 1997 console: blotchy lantern pools
 * on a coarse ground grid, smooth ramps across a character, no specular.
 *
 * The maths follows three.js's physical Lambert (irradiance x albedo / pi,
 * same point-light falloff), so a scene keeps its brightness when it
 * switches style.
 */
import { Vector3, Vector4 } from "three/webgpu";
import type { Camera, Color, Node, Object3D, Scene } from "three/webgpu";
import { dot, float, max, mix, normalize, normalWorld, positionWorld, pow, saturate, uniform, vec3 } from "three/tsl";

/** Point lights each vertex sums (the nearest to the camera). */
export const MAX_POINT_LIGHTS = 8;
/** Directional lights (sun, moon, rim). */
export const MAX_DIR_LIGHTS = 2;

type LightLike = Object3D & {
  isLight?: boolean;
  isAmbientLight?: boolean;
  isHemisphereLight?: boolean;
  isDirectionalLight?: boolean;
  isPointLight?: boolean;
  color: Color;
  groundColor?: Color;
  intensity: number;
  distance?: number;
  decay?: number;
  target?: Object3D;
};

const tmpA = new Vector3();
const tmpB = new Vector3();
const slots = (n: number, w = 0) => Array.from({ length: n }, () => uniform(new Vector4(0, 0, 0, w)));

export class VertexLights {
  /** Ambient irradiance (colour x intensity, summed). */
  readonly ambient = uniform(new Vector3());
  readonly hemiSky = uniform(new Vector3());
  readonly hemiGround = uniform(new Vector3());
  /** xyz: direction toward the light (world). */
  readonly dirDir = slots(MAX_DIR_LIGHTS);
  /** rgb: colour x intensity. */
  readonly dirColor = slots(MAX_DIR_LIGHTS);
  /** xyz: position (world), w: cutoff distance (0 = none). */
  readonly pointPos = slots(MAX_POINT_LIGHTS);
  /** rgb: colour x intensity, w: decay exponent. */
  readonly pointColor = slots(MAX_POINT_LIGHTS, 2);
  /** Overall gain on the vertex light (1 = three.js's physical Lambert). */
  readonly gain = uniform(1);
  /** Vertex light is clamped here (the console modulated textures up to 2x). */
  readonly ceiling = uniform(2.2);
  private readonly points: LightLike[] = [];
  private nextScan = 0;
  private lights: LightLike[] = [];
  private node: Node<"vec3"> | null = null;

  /**
   * The lit colour multiplier for the current vertex: built once, shared by
   * every styled material (wrapped in `varying()` so it runs per vertex).
   */
  irradiance(): Node<"vec3"> {
    if (this.node) return this.node;
    const n = normalize(normalWorld);
    const p = positionWorld;
    let irr: Node<"vec3"> = vec3(this.ambient).add(mix(vec3(this.hemiGround), vec3(this.hemiSky), n.y.mul(0.5).add(0.5)));
    for (let i = 0; i < MAX_DIR_LIGHTS; i++) {
      const d = this.dirDir[i];
      const c = this.dirColor[i];
      if (!d || !c) continue;
      irr = irr.add(c.xyz.mul(max(dot(n, d.xyz), 0)));
    }
    for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
      const lp = this.pointPos[i];
      const lc = this.pointColor[i];
      if (!lp || !lc) continue;
      const toL = lp.xyz.sub(p);
      const dist = max(toL.length(), float(1e-4));
      const ndl = max(dot(n, toL.div(dist)), 0);
      // three.js getDistanceAttenuation: 1 / d^decay, softened to zero at the cutoff.
      const fall = float(1).div(max(pow(dist, lc.w), float(0.01)));
      const edge = pow(saturate(float(1).sub(pow(dist.div(max(lp.w, float(1e-4))), 4))), 2);
      const window = lp.w.greaterThan(0).select(edge, float(1));
      irr = irr.add(lc.xyz.mul(ndl.mul(fall).mul(window)));
    }
    // Lambert: irradiance x albedo / pi (the material applies the albedo).
    this.node = irr.mul(1 / Math.PI).mul(this.gain).min(vec3(this.ceiling));
    return this.node;
  }

  /** Gather the scene's lights into the uniforms. Rescans the scene graph twice a second. */
  update(scene: Scene, camera: Camera, nowMs: number): void {
    if (nowMs >= this.nextScan) {
      this.nextScan = nowMs + 500;
      this.lights = [];
      scene.traverseVisible((o) => {
        if ((o as LightLike).isLight) this.lights.push(o as LightLike);
      });
    }
    const amb = this.ambient.value.set(0, 0, 0);
    const sky = this.hemiSky.value.set(0, 0, 0);
    const gnd = this.hemiGround.value.set(0, 0, 0);
    let dirs = 0;
    this.points.length = 0;
    for (const l of this.lights) {
      if (!l.visible || l.intensity <= 0) continue;
      const k = l.intensity;
      if (l.isAmbientLight) {
        amb.x += l.color.r * k;
        amb.y += l.color.g * k;
        amb.z += l.color.b * k;
      } else if (l.isHemisphereLight) {
        sky.x += l.color.r * k;
        sky.y += l.color.g * k;
        sky.z += l.color.b * k;
        const g = l.groundColor ?? l.color;
        gnd.x += g.r * k;
        gnd.y += g.g * k;
        gnd.z += g.b * k;
      } else if (l.isDirectionalLight && dirs < MAX_DIR_LIGHTS) {
        l.getWorldPosition(tmpA);
        if (l.target) l.target.getWorldPosition(tmpB);
        else tmpB.set(0, 0, 0);
        tmpA.sub(tmpB).normalize();
        this.dirDir[dirs]?.value.set(tmpA.x, tmpA.y, tmpA.z, 0);
        this.dirColor[dirs]?.value.set(l.color.r * k, l.color.g * k, l.color.b * k, 0);
        dirs++;
      } else if (l.isPointLight) this.points.push(l);
    }
    for (let i = dirs; i < MAX_DIR_LIGHTS; i++) this.dirColor[i]?.value.set(0, 0, 0, 0);
    // The nearest point lights to the camera (a top-down camera: the ones on screen).
    camera.getWorldPosition(tmpB);
    if (this.points.length > MAX_POINT_LIGHTS) {
      const d = new Map<LightLike, number>();
      for (const l of this.points) d.set(l, l.getWorldPosition(tmpA).distanceToSquared(tmpB));
      this.points.sort((a, b) => (d.get(a) ?? 0) - (d.get(b) ?? 0));
    }
    for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
      const l = this.points[i];
      if (!l) {
        this.pointColor[i]?.value.set(0, 0, 0, 2);
        continue;
      }
      l.getWorldPosition(tmpA);
      this.pointPos[i]?.value.set(tmpA.x, tmpA.y, tmpA.z, l.distance ?? 0);
      this.pointColor[i]?.value.set(l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity, l.decay ?? 2);
    }
  }
}
