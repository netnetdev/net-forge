/**
 * Cartoon effects for the GPU particles: flat shapes, not glows.
 *
 *  - Sparks, bursts, kills and magic: five-point stars and pointed streaks
 *    (a diamond stretched along the velocity reads as a speed line), flat
 *    colour with a white-hot core, popping in and snapping out.
 *  - Smoke and dust: round puffs with a lumpy edge, a light top and a shaded
 *    bottom, an ink rim, that swell and then shrink away.
 *
 * Shapes are drawn in the fragment stage with one-pixel anti-aliasing;
 * there are no textures.
 */
import type { Color, Node, UniformNode } from "three/webgpu";
import { abs, atan, cos, dot, float, fwidth, length, max, mix, pow, select, sin, smoothstep, vec2, vec3 } from "three/tsl";
import type { ParticleShade } from "../../render/particles.js";

/** 1 inside (d > 0), 0 outside, with a one-pixel soft edge. */
function inside(d: Node<"float">): Node<"float"> {
  const w = max(fwidth(d), float(1e-4));
  return smoothstep(w.negate(), w, d);
}

export function toonParticles(ink: UniformNode<"color", Color>): ParticleShade {
  const inkRgb = ink as unknown as Node<"vec3">;
  return {
    size(t, seed, blend) {
      if (blend === "add") {
        // Pop in past full size, settle, then the preset's own shrink takes it away.
        const pop = smoothstep(0, 0.07, t).mul(0.75).add(0.35);
        const settle = float(1).add(smoothstep(0.05, 0.2, t).oneMinus().mul(smoothstep(0, 0.05, t)).mul(0.35));
        return pop.mul(settle).mul(seed.mul(0.5).add(0.85));
      }
      // Puffs swell out, then shrink away instead of fading.
      return mix(float(0.45), float(1.3), smoothstep(0, 0.3, t)).mul(float(1).sub(smoothstep(0.55, 1, t).mul(0.75)));
    },
    shade({ t, uv, color, seed, blend }) {
      const p = uv.sub(0.5).mul(2);
      const r = length(p);
      const ang = atan(p.y, p.x);
      if (blend === "add") {
        const base = color.div(2.2);
        // A five-point star, turned by the seed.
        const lobes = pow(cos(ang.mul(5).add(seed.mul(6.283))).mul(0.5).add(0.5), float(2.2));
        const star = inside(mix(float(0.42), float(0.98), lobes).sub(r));
        // A pointed streak: a diamond, long along the velocity.
        const streak = inside(float(0.95).sub(abs(p.x).mul(1.7).add(abs(p.y))));
        const shape = select(seed.lessThan(0.32), star, streak);
        const core = smoothstep(0.55, 0.05, r).mul(0.75);
        const c = mix(base.mul(1.35), vec3(1, 0.98, 0.92), core);
        return { color: c, opacity: shape.mul(float(1).sub(smoothstep(0.82, 1, t))), blend: "alpha" };
      }
      // A puff: lumpy round edge, light from the top left, ink rim.
      const edge = float(0.9).add(sin(ang.mul(5).add(seed.mul(6.283))).mul(0.07));
      const body = inside(edge.sub(r));
      const light = mix(color, vec3(0.93, 0.9, 0.96), 0.6);
      const lower = smoothstep(-0.1, 0.55, dot(p, vec2(0.55, -0.75)));
      const shaded = mix(light, light.mul(vec3(0.7, 0.68, 0.82)), lower);
      const rim = smoothstep(edge.sub(0.24), edge.sub(0.1), r);
      const c = mix(shaded, inkRgb, rim.mul(0.8));
      return { color: c, opacity: body.mul(float(1).sub(smoothstep(0.8, 1, t))).mul(0.95) };
    },
  };
}
