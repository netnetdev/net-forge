/**
 * The hand-drawn post stages.
 *
 *  scene (HDR): the painted frame is read through a slow wobble, so wash
 *    borders are never ruler-straight, and pigment pools a little darker
 *    where one wash meets another (the wet edge of real watercolour).
 *  display (sRGB): pen lines from the depth buffer (silhouettes heavy,
 *    creases light) with varying pressure, small breaks and their own
 *    wobble, redrawn a few times a second; then the frame is printed on
 *    paper: tooth, fibres, granulation in the darker washes.
 */
import type { Node, Texture, UniformNode, Vector2 } from "three/webgpu";
import { abs, float, luminance, max, mix, perspectiveDepthToViewZ, pow, screenUV, smoothstep, texture, vec2, vec3, vec4 } from "three/tsl";
import type { StylePostInput } from "../kit.js";
import { PIGMENTS } from "./palette.js";

export interface InkUniforms {
  readonly boil: UniformNode<"vec2", Vector2>;
  readonly dpr: UniformNode<"float", number>;
  /** Pen width in CSS px. */
  readonly lineWidth: UniformNode<"float", number>;
  /** 0..1 line opacity. */
  readonly lineStrength: UniformNode<"float", number>;
  /** Wobble of the washes, CSS px. */
  readonly wobble: UniformNode<"float", number>;
  /** 0..1 how much the paper shows. */
  readonly paper: UniformNode<"float", number>;
  readonly noise: Texture;
  readonly paperTex: Texture;
}

const hexVec = (hex: number): Node<"vec3"> => vec3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);

/** HDR stage: wobbled read of the painted frame, darker wet edges. */
export function inkScene(input: StylePostInput, u: InkUniforms): Node<"vec4"> {
  const px = input.texel;
  // CSS pixel coordinates of this fragment.
  const css = screenUV.div(px).div(u.dpr);
  const n = texture(u.noise, css.div(170).add(u.boil.mul(0.37))).rg.sub(0.5).mul(2);
  const uv = screenUV.add(n.mul(u.wobble).mul(u.dpr).mul(px));
  const c = input.color.sample(uv);
  // Wet edge: how much the colour changes across a few pixels.
  const r = px.mul(u.dpr).mul(1.6);
  const l = luminance(c.rgb);
  const lx = luminance(input.color.sample(uv.add(vec2(r.x, 0))).rgb);
  const ly = luminance(input.color.sample(uv.add(vec2(0, r.y))).rgb);
  const lx2 = luminance(input.color.sample(uv.sub(vec2(r.x, 0))).rgb);
  const ly2 = luminance(input.color.sample(uv.sub(vec2(0, r.y))).rgb);
  const grad = abs(lx.sub(l)).add(abs(ly.sub(l))).add(abs(lx2.sub(l))).add(abs(ly2.sub(l))).div(max(l, float(0.06)));
  // The darker side of a border collects pigment.
  const darker = smoothstep(0, 0.02, l.mul(4).sub(lx).sub(ly).sub(lx2).sub(ly2).negate());
  const pool = smoothstep(0.12, 0.6, grad).mul(darker).mul(0.18);
  return vec4(c.rgb.mul(float(1).sub(pool)), c.a);
}

/** Display stage: pen lines and paper over the graded, tone-mapped frame. */
export function inkDisplay(color: Node<"vec4">, input: StylePostInput, u: InkUniforms): Node<"vec4"> {
  const px = input.texel;
  const css = screenUV.div(px).div(u.dpr);
  // The pen wanders on its own (lines sit a little off the washes, as when inked by hand).
  const nw = texture(u.noise, css.div(90).add(u.boil)).rg.sub(0.5).mul(2);
  const uv = screenUV.add(nw.mul(1.1).mul(u.dpr).mul(px));
  // Pressure: thicker and thinner along a stroke, with an occasional lift.
  const press = texture(u.noise, css.div(55).add(u.boil.yx)).g;
  const width = u.lineWidth.mul(press.mul(0.8).add(0.6));
  const lift = smoothstep(0.1, 0.24, press);
  const o = px.mul(u.dpr).mul(width);
  const dist = (p: Node<"vec2">): Node<"float"> => perspectiveDepthToViewZ(input.depth.sample(p).x, input.near, input.far).negate();
  const dc = dist(uv);
  const d1 = dist(uv.add(vec2(o.x, 0)));
  const d2 = dist(uv.sub(vec2(o.x, 0)));
  const d3 = dist(uv.add(vec2(0, o.y)));
  const d4 = dist(uv.sub(vec2(0, o.y)));
  // Silhouettes: a neighbour much further away (the line sits on the near side).
  const far = max(max(d1.sub(dc), d2.sub(dc)), max(d3.sub(dc), d4.sub(dc)));
  const sil = smoothstep(0.006, 0.02, far.div(dc));
  // Creases: the surface bends (1/z is flat across a plane, so its Laplacian finds folds).
  const wc = float(1).div(dc);
  const lap = abs(float(1).div(d1).add(float(1).div(d2)).add(float(1).div(d3)).add(float(1).div(d4)).sub(wc.mul(4))).div(wc);
  const crease = smoothstep(0.0035, 0.012, lap).mul(0.55);
  // Colour edges: where one painted thing meets another at the same depth (a crowd shoulder to shoulder).
  const lumAt = (p: Node<"vec2">): Node<"float"> => luminance(input.color.sample(p).rgb);
  const l0 = lumAt(uv);
  const lx = abs(lumAt(uv.add(vec2(o.x, 0))).sub(lumAt(uv.sub(vec2(o.x, 0)))));
  const ly = abs(lumAt(uv.add(vec2(0, o.y))).sub(lumAt(uv.sub(vec2(0, o.y)))));
  const edge = smoothstep(0.55, 1.1, max(lx, ly).div(max(l0, float(0.04)))).mul(0.6);
  const line = max(max(sil, crease), edge).mul(lift).mul(u.lineStrength);
  const ink = hexVec(PIGMENTS.ink);
  let col: Node<"vec3"> = mix(color.rgb, ink, line);
  // Paper: tooth and fibres everywhere, granulation where the wash is dark, a slow tone across the sheet.
  const pp = texture(u.paperTex, css.div(512));
  const sheet = texture(u.paperTex, css.div(2048)).g;
  const lum = luminance(col);
  const tooth = pow(pp.r, float(1.4));
  const gran = mix(float(1), pp.b.mul(0.22).add(0.78), float(1).sub(lum).mul(0.9));
  const paper = mix(float(1), tooth.mul(gran).mul(sheet.mul(0.06).add(0.97)), u.paper);
  col = col.mul(paper);
  return vec4(col, color.a);
}
