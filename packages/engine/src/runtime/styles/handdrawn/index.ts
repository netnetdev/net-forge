/**
 * HAND-DRAWN: the world as an ink-and-watercolour illustration.
 *
 * The library's 3D models are painted, not swapped for flat cards: every
 * lit surface is repainted in watercolour washes from one pigment box
 * (paint.ts), pen lines are drawn from the depth of the scene with a
 * wandering, pressure-varied line that is redrawn eight times a second
 * (ink.ts), the frame is printed on paper, effects are painted flecks,
 * blots and brush rings (vfx.ts), and template ground is a painted field
 * or a ruled yard (ground.ts). A game opts in with `game({ style:
 * "handdrawn" })`; nothing in the game changes.
 */
import { Vector2, Vector4 } from "three/webgpu";
import { uniform } from "three/tsl";
import type { LookPreset } from "../../render/presets.js";
import type { StyleKit, StyleSession } from "../kit.js";
import { paintField, paintGlow, paintPaving } from "./ground.js";
import { inkDisplay, inkScene, type InkUniforms } from "./ink.js";
import { handdrawnLook } from "./looks.js";
import { paintNode, PaintWatcher, type PaintUniforms } from "./paint.js";
import { noiseTexture, paperTexture, seeded } from "./textures.js";
import { decalLook, particleLook, ringLook } from "./vfx.js";

/** Lines, hatching and wash borders are redrawn this many times a second (the boil). */
export const BOIL_FPS = 8;
/** Seconds between scans for newly loaded materials. */
const SCAN_EVERY = 0.25;
/** Metres one painted ground tile covers, and one paved floor tile (four slabs). */
const GROUND_TILE = 14;
const FLOOR_TILE = 8;

export const handdrawnKit: StyleKit = {
  id: "handdrawn",
  needsPost: true,
  bloom: true,
  look: (preset: LookPreset) => handdrawnLook(preset),
  attach({ renderer, scene, preset }): StyleSession {
    const noise = noiseTexture();
    const boil = uniform(new Vector2(0, 0));
    const dpr = uniform(1);
    const first = handdrawnLook(preset);
    const paint: PaintUniforms = { boil, dpr, noise, snap: uniform(0.62), hatch: uniform(1), exposure: uniform(first.paint), values: uniform(new Vector4(...first.values)), glow: uniform(first.glow) };
    const ink: InkUniforms = { boil, dpr, noise, paperTex: paperTexture(), lineWidth: uniform(1.9), lineStrength: uniform(0.92), wobble: uniform(1.1), paper: uniform(1) };
    const watcher = new PaintWatcher(scene, () => paintNode(paint));
    const rnd = seeded(97);
    let tick = -1;
    let lastScan = -Infinity;
    const surfaces = new Map<string, ReturnType<typeof paintField>>();
    return {
      post: {
        scene: (input) => inkScene(input, ink),
        display: (color, input) => inkDisplay(color, input, ink),
      },
      frame(seconds) {
        const t = Math.floor(seconds * BOIL_FPS);
        if (t !== tick) {
          tick = t;
          boil.value.set(rnd(), rnd());
        }
        dpr.value = renderer.getPixelRatio();
        if (seconds - lastScan >= SCAN_EVERY || seconds < lastScan) {
          lastScan = seconds;
          watcher.scan();
        }
      },
      setPreset(p) {
        const l = handdrawnLook(p);
        paint.exposure.value = l.paint;
        paint.values.value.set(...l.values);
        paint.glow.value = l.glow;
      },
      particles: particleLook(noise),
      decals: decalLook(noise),
      rings: ringLook(noise),
      surface(kind) {
        if (kind !== "ground" && kind !== "floor" && kind !== "glow") return null;
        let t = surfaces.get(kind);
        if (t === undefined) {
          t = kind === "ground" ? paintField() : kind === "floor" ? paintPaving() : paintGlow();
          surfaces.set(kind, t);
        }
        if (!t) return null;
        if (kind === "glow") return t;
        const c = t.clone();
        // Metres one tile covers: the pen marks then print at about one screen pixel at the templates' camera distance.
        c.userData = { tile: kind === "ground" ? GROUND_TILE : FLOOR_TILE };
        return c;
      },
      dispose() {
        for (const t of surfaces.values()) t?.dispose();
      },
    };
  },
};
