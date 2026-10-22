/**
 * Ink lines: one screen-space pass over the scene's depth and normals.
 *
 * Silhouettes come from depth (a second difference of view depth, so flat
 * floors seen at a slant stay clean), creases from normals (an MRT output
 * of the scene pass). The cost is a handful of texture reads per pixel,
 * the same for one hero or two thousand instanced enemies, and it needs no
 * per-mesh work: crowds, VAT bakes, skinned characters and props are all
 * inked the same way. Transparent things (particles, rings, decals) write
 * nothing to the normal target and never write depth, so effects are not
 * outlined.
 *
 * The line colour is a deep ink mixed with a darkened copy of the colour
 * under it, so lines read as painted, not as a black filter.
 */
import { BlendMode, Color, MaterialBlending, UnsignedByteType, Vector2 } from "three/webgpu";
import type { Node, PassNode, UniformNode } from "three/webgpu";
import { abs, select, unpackRGBToNormal, packNormalToRGB, dot, float, max, min, mix, mrt, normalView, output, perspectiveDepthToViewZ, screenUV, smoothstep, uniform, vec2, vec3, vec4 } from "three/tsl";
import type { StylePost } from "../kit.js";

export interface InkUniforms {
  readonly color: UniformNode<"color", Color>;
  /** How much of the colour under a line tints it (0 = flat ink). */
  readonly tint: UniformNode<"float", number>;
  /** Line half-width in device pixels. */
  readonly width: UniformNode<"float", number>;
  /** Relative depth curvature that starts a silhouette line. */
  readonly depthAt: UniformNode<"float", number>;
  /** 1 - N.N' that starts a crease line. */
  readonly creaseAt: UniformNode<"float", number>;
  readonly strength: UniformNode<"float", number>;
  readonly texel: UniformNode<"vec2", Vector2>;
  readonly near: UniformNode<"float", number>;
  readonly far: UniformNode<"float", number>;
  /** 1 shows the normal target, 2 its alpha (tuning). */
  readonly debug: UniformNode<"float", number>;
}

export function inkUniforms(): InkUniforms {
  return {
    color: uniform(new Color(0x170f26)),
    tint: uniform(0.3),
    width: uniform(1),
    depthAt: uniform(0.01),
    creaseAt: uniform(0.32),
    strength: uniform(1),
    texel: uniform(new Vector2(1 / 1280, 1 / 720)),
    near: uniform(0.1),
    far: uniform(500),
    debug: uniform(0),
  };
}

/** Normal output for transparent materials: alpha 0 leaves the normal target as it was. */
export const NO_NORMAL = (): Node => mrt({ normal: vec4(0, 0, 0, 0) });

export function inkPost(u: InkUniforms, enabled: () => boolean): StylePost {
  return {
    scenePass(pass: PassNode) {
      if (!enabled()) return;
      const m = mrt({ output, normal: vec4(packNormalToRGB(normalView), 1) });
      // Opaque surfaces overwrite normals; transparent ones blend with alpha 0 (see NO_NORMAL).
      m.setBlendMode("normal", new BlendMode(MaterialBlending));
      pass.setMRT(m);
      pass.getTexture("normal").type = UnsignedByteType;
    },
    color(rgb: Node<"vec3">, pass: PassNode): Node<"vec3"> {
      if (!enabled()) return rgb;
      const depth = pass.getTextureNode("depth");
      const normal = pass.getTextureNode("normal");
      const step = u.texel.mul(u.width);
      const uvAt = (dx: number, dy: number) => screenUV.add(step.mul(vec2(dx, dy)));
      const z = (dx: number, dy: number) => perspectiveDepthToViewZ(depth.sample(uvAt(dx, dy)).x, u.near, u.far);
      const z0 = z(0, 0);
      // Second differences: zero on any plane, large across a silhouette.
      const lapX = abs(z(1, 0).add(z(-1, 0)).sub(z0.mul(2)));
      const lapY = abs(z(0, 1).add(z(0, -1)).sub(z0.mul(2)));
      const lapD = abs(z(1, 1).add(z(-1, -1)).sub(z0.mul(2))).add(abs(z(1, -1).add(z(-1, 1)).sub(z0.mul(2)))).mul(0.5);
      const rel = max(max(lapX, lapY), lapD).div(max(abs(z0), float(0.01)));
      const sil = smoothstep(u.depthAt, u.depthAt.mul(2.2), rel);
      // Creases: neighbours whose normals turn sharply away (skip pixels with no surface).
      const n = (dx: number, dy: number) => normal.sample(uvAt(dx, dy));
      const c = n(0, 0);
      const n0 = unpackRGBToNormal(c.rgb);
      const turn = (s: Node<"vec4">) => float(1).sub(dot(n0, unpackRGBToNormal(s.rgb))).mul(s.a);
      const crease = max(max(turn(n(1, 0)), turn(n(-1, 0))), max(turn(n(0, 1)), turn(n(0, -1)))).mul(c.a);
      const fold = smoothstep(u.creaseAt, u.creaseAt.mul(1.6), crease);
      const edge = min(max(sil, fold), float(1)).mul(u.strength);
      const ink = mix(vec3(u.color as unknown as Node<"vec3">), rgb.mul(0.18), u.tint);
      const out = mix(rgb, ink, edge);
      return select(u.debug.greaterThan(1.5), vec3(c.a), select(u.debug.greaterThan(0.5), c.rgb, out));
    },
  };
}
