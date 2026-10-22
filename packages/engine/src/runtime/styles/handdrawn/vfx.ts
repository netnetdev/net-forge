/**
 * Effects drawn by hand: every particle is a painted fleck with an inked
 * rim (no soft glow dots), smoke is a scribbled puff, scorches are ink
 * blots, splats are watercolour blooms with a dark tide line, and rings
 * are brush circles with dry-brush gaps. Same pools and draws as the
 * engine's effects; only their fragment shading changes.
 */
import type { Node, Texture } from "three/webgpu";
import { abs, atan, clamp, cos, float, length, max, min, mix, select, smoothstep, texture, vec2, vec3 } from "three/tsl";
import type { ParticleShade } from "../../render/particles.js";
import type { DecalLook, RingLook } from "../kit.js";
import { linearRgb, PIGMENTS } from "./palette.js";

const inkLinear = (): Node<"vec3"> => vec3(...linearRgb(PIGMENTS.sepia));

/** Colours arrive linear and sometimes boosted for bloom: bring them back to paint (0..1, a touch muted). */
function paintColor(c: Node<"vec3">): Node<"vec3"> {
  const k = max(max(c.x, c.y), max(c.z, float(1e-3)));
  const unboosted = c.div(max(k, float(1)));
  return mix(unboosted, vec3(0.5, 0.45, 0.4).mul(unboosted.x.add(unboosted.y).add(unboosted.z).div(3)), 0.12).mul(1.15);
}

/** Painted flecks and scribbled puffs, drawn with normal blending (the stack multiplies in each particle's alive flag). */
export function particleLook(noise: Texture): ParticleShade {
  const shade: ParticleShade["shade"] = ({ uv, t, color, blend }) => {
    const p = uv.sub(0.5).mul(2);
    // A slightly lumpy outline so no two flecks are perfect circles.
    const lump = texture(noise, uv.mul(0.35).add(t.mul(0.05))).b.sub(0.5).mul(0.22);
    const d = length(p).add(lump);
    if (blend === "add") {
      // A painted fleck: solid paint, an inked rim, shrinking as it dies.
      const edge = float(0.82).sub(t.mul(0.25));
      const fill = float(1).sub(smoothstep(edge.sub(0.08), edge, d));
      // The rim is a thin pen ring: on a big fleck it reads as ink, on a speck it stays a touch of shade (no dirt dots in a crowd).
      const rim = smoothstep(edge.sub(0.2), edge.sub(0.06), d).mul(fill);
      const paint = paintColor(color).mul(1.25);
      const col = mix(paint, inkLinear(), rim.mul(0.45));
      return { color: col, opacity: fill.mul(float(1).sub(smoothstep(0.75, 1, t))), blend: "alpha" };
    }
    // Smoke and dust: a pale scribbled puff with a broken pencil rim.
    const fill = float(1).sub(smoothstep(0.7, 0.84, d));
    const rim = smoothstep(0.52, 0.74, d).mul(fill).mul(smoothstep(0.35, 0.55, texture(noise, uv.mul(0.6)).g));
    const wash = mix(paintColor(color), vec3(0.86, 0.82, 0.74), 0.55);
    const col = mix(wash, inkLinear(), rim.mul(0.6));
    return { color: col, opacity: fill.mul(0.55).mul(float(1).sub(t)), blend: "alpha" };
  };
  return { shade };
}

export function decalLook(noise: Texture): DecalLook {
  return ({ uv, r, angle, kind, t, color, shape, opacity }) => {
    const n = texture(noise, uv.mul(0.5).add(vec2(cos(angle).mul(0.01), 0))).r;
    const fade = float(1).sub(smoothstep(0.55, 1, t));
    // Scorch: an ink blot with a crisp, ragged edge and a few spatters.
    const blot = smoothstep(0.32, 0.4, shape.add(n.sub(0.5).mul(0.25)));
    const spat = smoothstep(0.82, 0.86, texture(noise, uv.mul(1.7)).a).mul(smoothstep(1, 0.6, r)).mul(smoothstep(0.4, 0.7, r));
    const scorchA = max(blot, spat).mul(0.85);
    // Splat: a watercolour bloom, pale inside, dark tide line at its edge.
    const bloom = smoothstep(0.3, 0.42, shape.add(n.sub(0.5).mul(0.3)));
    const inner = smoothstep(0.45, 0.85, shape);
    const splatA = bloom.mul(0.42).add(bloom.sub(inner).mul(0.45));
    // Ring: a brush circle with dry-brush gaps.
    const band = float(1).sub(smoothstep(0.03, 0.07, abs(r.sub(0.8).add(n.sub(0.5).mul(0.06)))));
    const dry = smoothstep(0.25, 0.45, texture(noise, vec2(angle.mul(0.16), r.mul(0.2))).g);
    const ringA = band.mul(dry);
    const a = select(kind.lessThan(0.5), scorchA, select(kind.lessThan(1.5), splatA, ringA));
    const tone = paintColor(color);
    const col = select(kind.lessThan(0.5), mix(inkLinear(), tone, 0.25), select(kind.lessThan(1.5), mix(tone, tone.mul(0.6), bloom.sub(inner)), mix(tone, inkLinear(), 0.35)));
    return { color: col, opacity: clamp(a.mul(opacity).mul(fade).mul(1.25), 0, 1), blending: "normal" };
  };
}

export function ringLook(noise: Texture): RingLook {
  return ({ uv, r, t, alive, color }) => {
    const p = uv.sub(0.5);
    const ang = atan(p.y, p.x);
    const n = texture(noise, vec2(ang.mul(0.21), t.mul(0.1))).g;
    // A brush stroke around the circle: thick at the start, thinning as it spreads, with gaps.
    const width = mix(float(0.13), float(0.05), t);
    const centre = float(0.9).add(n.sub(0.5).mul(0.05));
    const band = float(1).sub(smoothstep(width.mul(0.5), width, abs(r.sub(centre))));
    const dry = smoothstep(0.22, 0.4, n);
    const inkRim = smoothstep(width.mul(0.15), width.mul(0.55), abs(r.sub(centre))).mul(band);
    const paint = paintColor(color).mul(1.2);
    const col = mix(paint, inkLinear(), min(inkRim.mul(0.8), float(0.8)));
    return { color: col, opacity: band.mul(dry).mul(float(1).sub(t)).mul(alive), blending: "normal" };
  };
}
