/**
 * The toon material: banded cel lighting in place of the physical model.
 *
 *  - The key light (the sun or moon) lights in three flat bands: shadow,
 *    mid and full, with crisp anti-aliased edges. The shadow side keeps
 *    only the fill, so its colour comes from the cool ambient light: warm
 *    light, cool shadows.
 *  - Point lights (lanterns, lamps) light in two hard-edged pools.
 *  - A crisp specular blob on glossy things, a rim of light on the lit edge.
 *  - Albedo is pushed toward a saturated cartoon palette; textures are
 *    posterized into flat patches.
 *
 * The style never replaces a scene's materials: it draws each lit material
 * through a toon twin made here (see index.ts), sharing its colours and
 * copying its node graphs, so crowd motion, VAT animation and hit flashes
 * keep working and the template's own material edits still show.
 */
import { DoubleSide, LightingModel, MeshStandardNodeMaterial } from "three/webgpu";
import type { Light, LightingModelDirectInput, Material, Node, NodeBuilder, PhysicalLightingModel, Texture, UniformNode } from "three/webgpu";
import {
  abs,
  BRDF_Lambert,
  diffuseColor,
  dot,
  float,
  fwidth,
  luminance,
  max,
  mix,
  normalize,
  normalView,
  positionViewDirection,
  roughness,
  smoothstep,
  sqrt,
  floor,
  uniform,
  vec3,
} from "three/tsl";
import { NO_NORMAL } from "./ink.js";

/** One set of uniforms every toon material reads (tuning moves them all). */
export interface ToonUniforms {
  /** N.L where the lit side begins (the terminator), and where the full band begins. */
  readonly terminator: UniformNode<"float", number>;
  readonly fullAt: UniformNode<"float", number>;
  /** Key-light level in the shadow band and in the mid band (full = 1). */
  readonly shadowLevel: UniformNode<"float", number>;
  readonly midLevel: UniformNode<"float", number>;
  /** Point-light pool thresholds (light luminance at the surface) and the pools' brightness. */
  readonly poolLow: UniformNode<"float", number>;
  readonly poolHigh: UniformNode<"float", number>;
  readonly poolLevel: UniformNode<"float", number>;
  /** Rim: where it starts (1 - |N.V|) and how bright it is (times albedo). */
  readonly rimStart: UniformNode<"float", number>;
  readonly rimStrength: UniformNode<"float", number>;
  /** Specular blob: N.H threshold and brightness for a fully glossy surface. */
  readonly specAt: UniformNode<"float", number>;
  readonly specStrength: UniformNode<"float", number>;
  /** Albedo saturation multiplier, and how many value steps textures are posterized to. */
  readonly saturation: UniformNode<"float", number>;
  readonly posterize: UniformNode<"float", number>;
}

export function toonUniforms(): ToonUniforms {
  return {
    terminator: uniform(0.0),
    fullAt: uniform(0.42),
    shadowLevel: uniform(0.0),
    midLevel: uniform(0.55),
    poolLow: uniform(0.35),
    poolHigh: uniform(1.6),
    poolLevel: uniform(2.4),
    rimStart: uniform(0.68),
    rimStrength: uniform(0.55),
    specAt: uniform(0.965),
    specStrength: uniform(0.9),
    saturation: uniform(1.25),
    posterize: uniform(5),
  };
}

/** A smooth 0..1 step at `edge` whose width is one pixel of `x`'s change (crisp, never aliased). */
function crisp(edge: Node<"float">, x: Node<"float">): Node<"float"> {
  const w = max(fwidth(x), float(1e-4));
  return smoothstep(edge.sub(w), edge.add(w), x);
}

class ToonLighting extends LightingModel {
  /** The first directional light seen (gates the rim to the lit side). */
  private sunDir: Node<"vec3"> | null = null;

  constructor(private readonly u: ToonUniforms) {
    super();
  }

  override direct({ lightDirection, lightColor, lightNode, reflectedLight }: LightingModelDirectInput): void {
    const u = this.u;
    const dir = lightDirection as Node<"vec3">;
    const color = lightColor as Node<"vec3">;
    const ndl = dot(normalView, dir);
    const albedo = BRDF_Lambert({ diffuseColor: diffuseColor.rgb }) as unknown as Node<"vec3">;
    const light = (lightNode as unknown as { light?: Light }).light;
    if (light && (light as { isDirectionalLight?: boolean }).isDirectionalLight === true) {
      this.sunDir ??= dir;
      const lit = crisp(u.terminator, ndl);
      const full = crisp(u.fullAt, ndl);
      const band = u.shadowLevel.add(u.midLevel.sub(u.shadowLevel).mul(lit)).add(float(1).sub(u.midLevel).mul(full));
      (reflectedLight.directDiffuse as Node<"vec3">).addAssign(color.mul(band).mul(albedo));
    } else {
      // Pools: the light's strength at the surface (half-Lambert wrap), cut into two flat steps.
      const strength = luminance(color).mul(ndl.mul(0.5).add(0.5));
      const pool = crisp(u.poolLow, strength).mul(0.3).add(crisp(u.poolHigh, strength).mul(0.7));
      const hue = color.div(max(luminance(color), float(1e-4)));
      (reflectedLight.directDiffuse as Node<"vec3">).addAssign(hue.mul(pool).mul(u.poolLevel).mul(albedo));
    }
    // A crisp highlight on glossy surfaces, only on the lit side.
    const h = normalize(dir.add(positionViewDirection));
    const gloss = float(1).sub(roughness).max(0);
    const spec = crisp(u.specAt, dot(normalView, h)).mul(crisp(float(0.05), ndl)).mul(gloss.mul(gloss)).mul(u.specStrength);
    (reflectedLight.directSpecular as Node<"vec3">).addAssign(color.mul(spec).mul(0.32));
  }

  override indirect(builder: NodeBuilder): void {
    const ctx = builder.context as unknown as { ambientOcclusion: Node<"float">; irradiance: Node<"vec3">; reflectedLight: { indirectDiffuse: Node<"vec3"> } };
    const albedo = BRDF_Lambert({ diffuseColor: diffuseColor.rgb }) as unknown as Node<"vec3">;
    ctx.reflectedLight.indirectDiffuse.addAssign(ctx.irradiance.mul(albedo));
    ctx.reflectedLight.indirectDiffuse.mulAssign(ctx.ambientOcclusion);
  }

  override finish(builder: NodeBuilder): void {
    const u = this.u;
    const ctx = builder.context as unknown as { outgoingLight: Node<"vec3"> };
    // A thin band of light along the silhouette, on the side the key light reaches.
    const edge = float(1).sub(abs(dot(normalView, positionViewDirection)));
    let rim = crisp(u.rimStart, edge);
    if (this.sunDir) rim = rim.mul(smoothstep(-0.15, 0.3, dot(normalView, this.sunDir)));
    ctx.outgoingLight.addAssign(diffuseColor.rgb.mul(rim).mul(u.rimStrength));
  }
}

type NodeProps = {
  positionNode: Node | null;
  normalNode: Node | null;
  colorNode: Node | null;
  opacityNode: Node | null;
  emissiveNode: Node | null;
  castShadowPositionNode?: Node | null;
  mrtNode?: Node | null;
};

type Classic = Material & {
  color?: import("three/webgpu").Color;
  emissive?: import("three/webgpu").Color;
  emissiveIntensity?: number;
  map?: Texture | null;
  emissiveMap?: Texture | null;
  alphaMap?: Texture | null;
  roughness?: number;
  metalness?: number;
  flatShading?: boolean;
  fog?: boolean;
  wireframe?: boolean;
};

/**
 * A lit material drawn in the toon style. Physical lighting is swapped
 * for ToonLighting; metals keep their colour (no environment to reflect),
 * their gloss feeds the specular blob.
 */
export class ToonMaterial extends MeshStandardNodeMaterial {
  readonly isToonMaterial = true;

  constructor(private readonly u: ToonUniforms) {
    super();
  }

  override setupLightingModel(): PhysicalLightingModel {
    return new ToonLighting(this.u) as unknown as PhysicalLightingModel;
  }

  override setupDiffuseColor(builder: NodeBuilder): void {
    super.setupDiffuseColor(builder);
    const c = diffuseColor.rgb;
    const l = luminance(c);
    let out: Node<"vec3"> = mix(vec3(l), c, this.u.saturation);
    if (this.map) {
      // Textures turn into flat patches: value posterized in a perceptual space.
      const v = sqrt(max(l, float(1e-5)));
      const q = floor(v.mul(this.u.posterize).add(0.5)).div(this.u.posterize).max(0.04);
      out = out.mul(q.mul(q).div(max(l, float(1e-5))));
    }
    diffuseColor.rgb.assign(out);
  }

  /** Mirror the source's per-frame state (the template fades, flashes and recolours it). */
  sync(src: Classic): void {
    if (this.opacity !== src.opacity) this.opacity = src.opacity;
    if (src.emissiveIntensity !== undefined && this.emissiveIntensity !== src.emissiveIntensity) this.emissiveIntensity = src.emissiveIntensity;
    if (this.visible !== src.visible) this.visible = src.visible;
    if (this.transparent !== src.transparent || this.depthWrite !== src.depthWrite || this.side !== src.side || this.alphaTest !== src.alphaTest) {
      this.transparent = src.transparent;
      this.depthWrite = src.depthWrite;
      this.side = src.side;
      this.alphaTest = src.alphaTest;
      // A faded (see-through) surface leaves the ink pass's normals alone, so it is not inked over what it shows.
      const self = this as unknown as NodeProps;
      const own = (src as unknown as Partial<NodeProps>).mrtNode ?? null;
      self.mrtNode = src.transparent && !own ? NO_NORMAL() : own;
      this.needsUpdate = true;
    }
  }
}

/** Does this material react to lights (and so gets a toon twin)? */
export function isLit(m: Material): boolean {
  const t = m as Material & { isMeshStandardMaterial?: boolean; isMeshPhongMaterial?: boolean; isMeshLambertMaterial?: boolean; isMeshToonMaterial?: boolean; lights?: boolean; isToonMaterial?: boolean };
  if (t.isToonMaterial) return false;
  if (t.isMeshStandardMaterial || t.isMeshPhongMaterial || t.isMeshLambertMaterial || t.isMeshToonMaterial) return true;
  return false;
}

/** The toon twin of a lit material: shared colours, copied state and node graphs. */
export function toonTwin(source: Material, u: ToonUniforms): ToonMaterial {
  const src = source as Classic;
  const m = new ToonMaterial(u);
  m.name = `toon:${source.name}`;
  // Shared colour objects: the template's own edits (tints, flashes) show through.
  if (src.color) m.color = src.color;
  if (src.emissive) m.emissive = src.emissive;
  m.emissiveIntensity = src.emissiveIntensity ?? 1;
  m.map = src.map ?? null;
  m.emissiveMap = src.emissiveMap ?? null;
  m.alphaMap = src.alphaMap ?? null;
  m.vertexColors = source.vertexColors;
  m.side = source.side === DoubleSide ? DoubleSide : source.side;
  m.transparent = source.transparent;
  m.opacity = source.opacity;
  m.alphaTest = source.alphaTest;
  m.depthWrite = source.depthWrite;
  m.depthTest = source.depthTest;
  m.blending = source.blending;
  m.polygonOffset = source.polygonOffset;
  m.polygonOffsetFactor = source.polygonOffsetFactor;
  m.polygonOffsetUnits = source.polygonOffsetUnits;
  m.visible = source.visible;
  m.colorWrite = source.colorWrite;
  m.fog = src.fog ?? true;
  m.wireframe = src.wireframe ?? false;
  // Smooth normals band cleanly (index.ts welds them with a crease angle).
  m.flatShading = false;
  // Metals keep their colour as albedo; gloss drives the highlight.
  const metal = src.metalness ?? 0;
  m.metalness = 0;
  m.roughness = Math.min(1, Math.max(0, (src.roughness ?? 0.8) * (1 - metal * 0.6)));
  // Node graphs (crowd motion, VAT, hit flashes) carry over as they are.
  const s = source as unknown as Partial<NodeProps>;
  const d = m as unknown as NodeProps;
  if (s.positionNode) d.positionNode = s.positionNode;
  if (s.normalNode) d.normalNode = s.normalNode;
  if (s.colorNode) d.colorNode = s.colorNode;
  if (s.opacityNode) d.opacityNode = s.opacityNode;
  if (s.emissiveNode) d.emissiveNode = s.emissiveNode;
  if (s.castShadowPositionNode) d.castShadowPositionNode = s.castShadowPositionNode;
  if (s.mrtNode) d.mrtNode = s.mrtNode;
  else if (source.transparent) d.mrtNode = NO_NORMAL();
  return m;
}
