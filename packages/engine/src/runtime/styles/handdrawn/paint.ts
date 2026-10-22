/**
 * Watercolour painting for lit materials. Every lit surface keeps its own
 * geometry, maps, skinning and vertex animation; only its final colour is
 * repainted (the material's `outputNode`):
 *
 *  - its colour is pulled toward the nearest pigment in the palette, so a
 *    pack of toy-bright models reads as one painter's box;
 *  - the light it receives is split into a few washes (deep shadow,
 *    shadow, mid, light, glow) with ragged, slightly wet borders, keeping
 *    the light's hue (moonlight blue, lantern amber);
 *  - shadows go cool, and the deepest are hatched with pen strokes that
 *    are redrawn a few times a second.
 *
 * Light is read as the ratio of the lit colour to the albedo, so every
 * light the scene has (sun, sky, lanterns, emissive glow) is honoured
 * without touching the lighting code.
 */
import type { Material, Mesh, Node, Object3D, Texture, UniformNode, Vector2, Vector4 } from "three/webgpu";
import {
  abs,
  diffuseColor,
  dot,
  exp,
  float,
  Fn,
  fract,
  If,
  luminance,
  max,
  min,
  mix,
  output,
  screenCoordinate,
  smoothstep,
  sqrt,
  texture,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { HANDDRAWN_PALETTE, linearRgb, PIGMENTS } from "./palette.js";

export interface PaintUniforms {
  /** Random offset re-rolled a few times a second (the boil). */
  readonly boil: UniformNode<"vec2", Vector2>;
  /** Render pixels per CSS pixel. */
  readonly dpr: UniformNode<"float", number>;
  /** 0..1 pull toward the palette. */
  readonly snap: UniformNode<"float", number>;
  /** Strength of the shadow hatching, 0..1. */
  readonly hatch: UniformNode<"float", number>;
  /** Light level multiplier before the washes are cut (per look preset). */
  readonly exposure: UniformNode<"float", number>;
  /** Paint value of each wash: deep shadow, shadow, mid, light (the glow is `glow`). */
  readonly values: UniformNode<"vec4", Vector4>;
  readonly glow: UniformNode<"float", number>;
  readonly noise: Texture;
}

const PIGMENT_LINEAR = HANDDRAWN_PALETTE.map(linearRgb);

/**
 * The palette's pull on a linear colour: a soft blend of the pigments
 * nearest to it (compared gamma-encoded with eye weights). Soft, not a hard
 * nearest pick, so a gradient in a texture stays a gradient instead of
 * breaking into patches.
 */
const pigmentOf = Fn(([c]: readonly [Node<"vec3">]) => {
  const g = sqrt(max(c, vec3(0)));
  const sum = vec3(0).toVar();
  const wsum = float(1e-6).toVar();
  for (const p of PIGMENT_LINEAR) {
    const pg = vec3(Math.sqrt(p[0]), Math.sqrt(p[1]), Math.sqrt(p[2]));
    const d = g.sub(pg);
    const w = exp(dot(d.mul(d), vec3(0.3, 0.59, 0.11)).mul(-260));
    sum.addAssign(vec3(p[0], p[1], p[2]).mul(w));
    wsum.addAssign(w);
  }
  return sum.div(wsum);
});

/** A pen stroke field: 1 on lines `spacing` CSS px apart along `u`, about 1 px wide. */
function strokes(u: Node<"float">, spacing: number): Node<"float"> {
  const d = abs(fract(u).sub(0.5)).mul(spacing);
  return float(1).sub(smoothstep(0.35, 1.15, d));
}

/** The repainted output for a lit material (assign to `material.outputNode`). */
export function paintNode(u: PaintUniforms): Node<"vec4"> {
  const albedo = diffuseColor.rgb;
  const lit = output.rgb;
  const pig = pigmentOf(albedo) as unknown as Node<"vec3">;
  const snapped = mix(albedo, pig, u.snap);
  // A wash is never solid black: very dark albedos (night stone, dark walls) are lifted toward a grey wash, and the
  // hatching and the pen carry their darkness instead, as an illustrator would draw a dark rock.
  const darkness = float(1).sub(smoothstep(0.015, 0.12, luminance(snapped)));
  const paint = mix(snapped, snapped.mul(0.4).add(vec3(...linearRgb(PIGMENTS.slate)).mul(0.6)), darkness.mul(0.65));
  // Light received, per channel; its luminance picks the wash and its hue tints it.
  const ratio = lit.div(max(albedo, vec3(0.045)));
  const level = luminance(ratio).mul(u.exposure);
  const hue = min(ratio.div(max(luminance(ratio), float(1e-3))), vec3(2.2));
  // Screen position in CSS pixels, and the noise that makes wash borders ragged.
  const sc = screenCoordinate.xy.div(u.dpr);
  const n = texture(u.noise, sc.div(150).add(u.boil)).r;
  const nf = texture(u.noise, sc.div(37).add(u.boil.yx)).b;
  const lv = level.mul(n.mul(0.22).add(0.89));
  // Washes: deep shadow, shadow, mid, light, glow (each preset sets their values).
  const v = u.values;
  const s1 = smoothstep(0.1, 0.16, lv);
  const s2 = smoothstep(0.3, 0.38, lv);
  const s3 = smoothstep(0.62, 0.74, lv);
  const s4 = smoothstep(1.45, 1.8, lv);
  const value = v.x.add(v.y.sub(v.x).mul(s1)).add(v.z.sub(v.y).mul(s2)).add(v.w.sub(v.z).mul(s3)).add(u.glow.sub(v.w).mul(s4));
  // Shadows go cool, light keeps its hue.
  const cool = mix(vec3(0.8, 0.86, 1.1), vec3(1, 1, 1), s2);
  let col: Node<"vec3"> = paint.mul(value).mul(mix(vec3(1, 1, 1), hue, 0.6)).mul(cool);
  // Hatching: the shadow wash gets one direction, the deep shadow a cross.
  const jitter = nf.mul(0.5);
  const h1 = strokes(sc.x.mul(0.62).add(sc.y).div(7).add(jitter).add(u.boil.x.mul(3)), 7);
  const h2 = strokes(sc.x.sub(sc.y.mul(0.62)).div(7.5).add(jitter).add(u.boil.y.mul(3)), 7.5);
  const dash = smoothstep(0.26, 0.4, texture(u.noise, sc.div(19).add(u.boil)).g);
  const shade = float(1).sub(s2);
  const deep = max(float(1).sub(s1), darkness.mul(0.8));
  // Light single hatching in the shadow wash, a firmer cross only in the deep shadow (a lit field never turns to cloth).
  const hatch = max(h1.mul(shade).mul(0.45), max(h1, h2).mul(deep).mul(0.9)).mul(dash).mul(u.hatch);
  const ink = vec3(...linearRgb(PIGMENTS.sepia));
  col = mix(col, col.mul(0.3).add(ink.mul(0.3)), hatch);
  return vec4(col, output.a);
}

const LIT_TYPES = new Set([
  "MeshStandardMaterial",
  "MeshStandardNodeMaterial",
  "MeshPhysicalMaterial",
  "MeshPhysicalNodeMaterial",
  "MeshLambertMaterial",
  "MeshLambertNodeMaterial",
  "MeshPhongMaterial",
  "MeshPhongNodeMaterial",
  "MeshToonMaterial",
  "MeshToonNodeMaterial",
]);

type PaintableMaterial = Material & { outputNode?: Node | null; metalness?: number; roughness?: number; flatShading?: boolean };

/** Lit materials get painted; unlit ones (flames, glows, outlines, effects) keep their colour. */
export function paintable(m: Material): m is PaintableMaterial {
  const pm = m as PaintableMaterial;
  return LIT_TYPES.has(m.type) && (pm.outputNode === undefined || pm.outputNode === null);
}

/**
 * Finds lit materials as they arrive in the scene (models load late) and
 * paints each once. A scan walks the scene graph (a few hundred nodes; the
 * crowds are one node per type), so it runs every few frames, not every one.
 */
export class PaintWatcher {
  private readonly done = new WeakSet<Material>();
  painted = 0;

  constructor(
    private readonly root: Object3D,
    private readonly make: () => Node<"vec4">,
  ) {}

  private paint(m: Material): void {
    if (this.done.has(m)) return;
    this.done.add(m);
    if (!paintable(m)) return;
    // Paint is matte: no metal, no gloss (watercolour has no specular).
    if (m.metalness !== undefined) m.metalness = 0;
    if (m.roughness !== undefined) m.roughness = 1;
    m.outputNode = this.make();
    m.needsUpdate = true;
    this.painted++;
  }

  scan(): void {
    this.root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material;
      if (Array.isArray(mat)) for (const m of mat) this.paint(m);
      else if (mat) this.paint(mat);
    });
  }
}
