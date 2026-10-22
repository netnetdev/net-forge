/**
 * Turns whatever a template put in the scene into PS1 geometry and
 * materials, without the template knowing: every mesh is found once, and
 *  - its vertices snap to the low-res pixel grid (the wobble),
 *  - its textures map affinely (no perspective correction: textures swim
 *    on big polygons), sample nearest, and stay at console sizes,
 *  - lit materials light per vertex from the shared VertexLights (Gouraud:
 *    smooth below a crease angle, no specular, no shadow maps),
 *  - big planes and boxes are tessellated (as console games did, to keep
 *    the warping and the vertex lighting in check),
 *  - meshes tagged `userData.surface = "<role>"` get the style's texture for
 *    that role in world-space box UVs (ground, walls, pillars).
 *
 * Patching overrides three methods on the material instance itself
 * (vertex output, lighting, cache key), so materials the template keeps
 * and mutates (opacity fades, hit flashes, crowd motion) keep working.
 */
import { BufferAttribute, BoxGeometry, NearestFilter, PlaneGeometry, Quaternion, Vector3 } from "three/webgpu";
import type { BufferGeometry, Material, Mesh, Node, NodeBuilder, Object3D, Texture, UniformNode, Vector2 } from "three/webgpu";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import { cameraProjectionMatrix, context, diffuseColor, emissive, float, floor, materialEmissive, materialMetalness, mix, positionView, uniform, varying, vec3, vec4 } from "three/tsl";
import type { VertexLights } from "./lights.js";
import { imageAverage, matchTint } from "./surfaces.js";
import type { Rgb, SurfaceTexture } from "./surfaces.js";

/** Lit material types (lit per vertex); basic ones only snap and map affinely. */
const LIT = /^Mesh(Standard|Physical|Lambert|Phong|Toon)(Node)?Material$/;
const UNLIT = /^MeshBasic(Node)?Material$/;
/** Longest texture edge kept as is; larger ones are shrunk to SHRINK_TO. */
const MAX_TEXTURE = 256;
const SHRINK_TO = 128;
/** Big flat cells are cut to about this size, m. */
const MAX_CELL = 3;
/** Share of the diffuse light a fully metallic surface loses (the physical renderer's metal draws darker). */
const METAL_DIM = 0.75;
/** Faces meeting at less than this angle share a smooth (Gouraud) normal. */
const CREASE = (55 * Math.PI) / 180;

type Patchable = Material & {
  setupModelViewProjection?: (builder: NodeBuilder) => Node;
  setupLighting?: (builder: NodeBuilder) => Node;
  contextNode?: unknown;
  emissiveNode?: Node | null;
  metalnessNode?: Node | null;
  metalness?: number;
  emissive?: { isColor?: boolean };
  flatShading?: boolean;
  map?: Texture | null;
  color?: { r: number; g: number; b: number; setRGB(r: number, g: number, b: number): void };
  __ps1?: true;
};

type Proto = {
  setupModelViewProjection(this: Patchable, builder: NodeBuilder): Node;
  customProgramCacheKey(this: Patchable): string;
};

/** A texture the patcher can resolve for a surface role (ground, wall...). */
export type SurfaceSource = (role: string) => SurfaceTexture | null;

export class Ps1Patcher {
  /** 0 = perspective-correct textures, 1 = full affine (the console). */
  readonly affine = uniform(1);
  /** Vertex snap grid as a fraction of the low-res pixel grid (1 = one pixel). */
  readonly snap = uniform(1);
  private readonly seenMaterials = new WeakSet<Material>();
  private readonly seenGeometry = new WeakSet<BufferGeometry>();
  private readonly seenTextures = new WeakSet<Texture>();
  private readonly seenMeshes = new WeakSet<Object3D>();
  private irradianceVarying: Node<"vec3"> | null = null;
  /** Meshes and materials patched so far (tests and stats). */
  readonly counts = { meshes: 0, materials: 0, geometries: 0, surfaces: 0, textures: 0 };

  constructor(
    private readonly lights: VertexLights,
    private readonly resolution: UniformNode<"vec2", Vector2>,
    private readonly surfaces: SurfaceSource,
  ) {}

  /** Snap a clip-space position to the low-res pixel grid. */
  private snapClip(clip: Node<"vec4">): Node<"vec4"> {
    const half = this.resolution.mul(0.5).mul(this.snap);
    const w = clip.w;
    const ndc = clip.xy.div(w);
    const snapped = floor(ndc.mul(half).add(0.5)).div(half).mul(w);
    return vec4(w.greaterThan(1e-4).select(snapped, clip.xy), clip.z, w);
  }

  /** Screen-linear (affine) UVs: interpolate uv*w and w, divide per pixel. */
  private affineUV(base: Node): Node<"vec2"> {
    const uv0 = base as Node<"vec2">;
    const w = cameraProjectionMatrix.mul(vec4(positionView, 1)).w;
    const a = varying(vec3(uv0.mul(w), w));
    return mix(uv0, a.xy.div(a.z), this.affine);
  }

  private light(): Node<"vec3"> {
    this.irradianceVarying ??= varying(this.lights.irradiance(), "v_ps1Light");
    return this.irradianceVarying;
  }

  /** Walk the scene and patch what is new. Cheap after the first pass (weak sets). */
  scan(root: Object3D): void {
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || this.seenMeshes.has(mesh)) return;
      this.seenMeshes.add(mesh);
      this.patchMesh(mesh);
    });
  }

  private patchMesh(mesh: Mesh): void {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const lit = mats.some((m) => LIT.test(m.type));
    const role = typeof mesh.userData.surface === "string" ? (mesh.userData.surface as string) : null;
    const surface = role && lit ? this.surfaces(role) : null;
    if (surface) {
      this.surface(mesh, surface);
      this.counts.surfaces++;
    } else if (lit) this.smooth(mesh.geometry);
    for (const m of mats) this.patchMaterial(m);
    this.counts.meshes++;
  }

  /** Smooth normals below the crease angle, in place (Gouraud on organic shapes, hard edges on boxes). */
  private smooth(g: BufferGeometry): void {
    if (this.seenGeometry.has(g)) return;
    this.seenGeometry.add(g);
    const pos = g.getAttribute("position");
    if (!pos || pos.count < 3 || pos.count > 200_000) return;
    // Skinned and morphed meshes keep their own normals (the bind pose would need re-skinning to crease safely).
    if (g.morphAttributes.position) return;
    const out = toCreasedNormals(g, CREASE);
    if (out !== g) {
      // An indexed source came back as a new, non-indexed geometry: move its attributes onto the original.
      g.setIndex(null);
      for (const name of Object.keys(out.attributes)) {
        const a = out.getAttribute(name);
        if (a) g.setAttribute(name, a);
      }
    }
    this.counts.geometries++;
  }

  /** A surface: tessellate big flat cells, world-space box UVs every `metres`, the style's texture. */
  private surface(mesh: Mesh, src: SurfaceTexture): void {
    const { texture, metres } = src;
    mesh.updateWorldMatrix(true, false);
    const s = new Vector3();
    mesh.matrixWorld.decompose(new Vector3(), new Quaternion(), s);
    let g = tessellate(mesh.geometry, s);
    g = g.index ? g.toNonIndexed() : g.clone();
    const pos = g.getAttribute("position");
    const n = pos.count;
    const uv = new Float32Array(n * 2);
    const m = mesh.matrixWorld;
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const fn = new Vector3();
    const wp = new Vector3();
    for (let t = 0; t + 2 < n; t += 3) {
      a.fromBufferAttribute(pos, t).applyMatrix4(m);
      b.fromBufferAttribute(pos, t + 1).applyMatrix4(m);
      c.fromBufferAttribute(pos, t + 2).applyMatrix4(m);
      fn.subVectors(c, b).cross(a.clone().sub(b)).normalize();
      const ax = Math.abs(fn.x);
      const ay = Math.abs(fn.y);
      const az = Math.abs(fn.z);
      for (let k = 0; k < 3; k++) {
        wp.fromBufferAttribute(pos, t + k).applyMatrix4(m);
        let u: number;
        let v: number;
        if (ay >= ax && ay >= az) [u, v] = [wp.x, wp.z];
        else if (ax >= az) [u, v] = [wp.z, wp.y];
        else [u, v] = [wp.x, wp.y];
        uv[(t + k) * 2] = u / metres;
        uv[(t + k) * 2 + 1] = v / metres;
      }
    }
    g.setAttribute("uv", new BufferAttribute(uv, 2));
    const smooth = toCreasedNormals(g, CREASE);
    mesh.geometry = smooth;
    this.seenGeometry.add(smooth);
    // The texture in place of the template's colour, on the template's own material (it may fade it later),
    // tinted to the brightness and roughly the hue the template drew there, so the scene keeps its mood
    // and the actors keep standing out against it.
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const m = mat as Patchable;
      if (m.map === texture) continue;
      const c = m.color;
      const base: Rgb = c ? [c.r, c.g, c.b] : [1, 1, 1];
      const mapAvg = m.map ? imageAverage(m.map.image) : null;
      const want: Rgb = mapAvg ? [base[0] * mapAvg[0], base[1] * mapAvg[1], base[2] * mapAvg[2]] : base;
      m.map = texture;
      src.onAverage((avg) => {
        const t = matchTint(want, avg);
        m.color?.setRGB(t[0], t[1], t[2]);
      });
    }
  }

  private patchTexture(t: Texture | null | undefined): void {
    if (!t || this.seenTextures.has(t)) return;
    this.seenTextures.add(t);
    t.magFilter = NearestFilter;
    t.minFilter = NearestFilter;
    t.generateMipmaps = false;
    t.anisotropy = 1;
    const img = t.image as { width?: number; height?: number } | null;
    const w = img?.width ?? 0;
    const h = img?.height ?? 0;
    if (w > MAX_TEXTURE || h > MAX_TEXTURE) {
      const shrunk = shrink(t.image as CanvasImageSource, w, h);
      if (shrunk) t.image = shrunk;
    }
    t.needsUpdate = true;
    this.counts.textures++;
  }

  private patchMaterial(mat: Material): void {
    if (this.seenMaterials.has(mat)) return;
    this.seenMaterials.add(mat);
    const lit = LIT.test(mat.type);
    if (!lit && !UNLIT.test(mat.type)) return;
    const m = mat as Patchable;
    if (m.__ps1) return;
    m.__ps1 = true;
    this.patchTexture(m.map);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    m.setupModelViewProjection = function (this: Patchable, builder: NodeBuilder): Node {
      const base = (Object.getPrototypeOf(this) as Proto).setupModelViewProjection.call(this, builder);
      return self.snapClip(base as Node<"vec4">);
    };
    m.customProgramCacheKey = function (this: Patchable): string {
      return `${(Object.getPrototypeOf(this) as Proto).customProgramCacheKey.call(this)}|ps1`;
    };
    if (m.contextNode === undefined || m.contextNode === null) {
      m.contextNode = context({ getUV: (tex: { getDefaultUV(): Node }) => self.affineUV(tex.getDefaultUV()) });
    }
    if (lit) {
      // Gouraud needs vertex normals; flat shading would derive face normals per pixel.
      m.flatShading = false;
      m.setupLighting = function (this: Patchable): Node {
        // Metal has little diffuse light: glTF models default to fully metallic, and without the dimming
        // they would glow white where the physical renderer draws them dark (no environment map to reflect).
        const metal = typeof this.metalness === "number" ? ((this.metalnessNode ?? materialMetalness) as Node<"float">) : float(0);
        let out: Node<"vec3"> = diffuseColor.rgb.mul(self.light()).mul(float(1).sub(metal.mul(METAL_DIM)));
        const e = this.emissiveNode ?? (this.emissive?.isColor === true ? materialEmissive : null);
        if (e) {
          emissive.assign(vec3(e as Node<"vec3">));
          out = out.add(emissive);
        }
        return out;
      };
    }
    m.needsUpdate = true;
    this.counts.materials++;
  }
}

/** Tessellate a PlaneGeometry or BoxGeometry whose cells are larger than MAX_CELL world metres. */
export function tessellate(g: BufferGeometry, worldScale: Vector3): BufferGeometry {
  const cells = (len: number, scale: number) => Math.max(1, Math.min(160, Math.ceil((len * Math.abs(scale)) / MAX_CELL)));
  if (g.type === "PlaneGeometry") {
    const p = (g as PlaneGeometry).parameters;
    const sx = cells(p.width, worldScale.x);
    const sy = cells(p.height, worldScale.y);
    if (sx > p.widthSegments || sy > p.heightSegments) return new PlaneGeometry(p.width, p.height, sx, sy);
  } else if (g.type === "BoxGeometry") {
    const p = (g as BoxGeometry).parameters;
    const sx = cells(p.width, worldScale.x);
    const sy = cells(p.height, worldScale.y);
    const sz = cells(p.depth, worldScale.z);
    if (sx > p.widthSegments || sy > p.heightSegments || sz > p.depthSegments) return new BoxGeometry(p.width, p.height, p.depth, sx, sy, sz);
  }
  return g;
}

/** Shrink an image to SHRINK_TO on its long edge (a console-sized texture). */
function shrink(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const k = SHRINK_TO / Math.max(w, h);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext("2d");
  if (!g) return null;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  try {
    g.drawImage(src, 0, 0, c.width, c.height);
  } catch {
    return null;
  }
  return c;
}
