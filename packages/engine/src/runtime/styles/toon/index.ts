/**
 * TOON: cel-shaded cartoon rendering for any scene the runtime draws.
 *
 * game({ style: "toon" }) (or a template's ?style=toon) and the render
 * stack draws every frame through this session:
 *
 *  - materials: each lit material is drawn through a toon twin (material.ts)
 *    at draw time, through the renderer's render-object hook. The scene and
 *    its materials are never changed, so templates keep fading, flashing and
 *    tinting them, and crowd motion, VAT and skinning carry over;
 *  - normals: faceted models are smoothed once, with a crease angle
 *    (normals.ts), so the bands cut clean curves;
 *  - ink: silhouette and crease lines in one screen pass (ink.ts);
 *  - shadows: flat cartoon shadows under every caster (shadows.ts);
 *  - effects: stars, streaks and puffs instead of glows (vfx.ts);
 *  - look: brighter, saturated presets with cool fill light (look.ts).
 */
import { DirectionalLight, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from "three/webgpu";
import type { BufferGeometry, Camera, Material, MeshBasicNodeMaterial, Object3D, Renderer, Scene } from "three/webgpu";
import type { QualityTier } from "../../render/quality.js";
import type { StyleContext, StyleKit, StyleSession } from "../kit.js";
import { inkPost, inkUniforms, NO_NORMAL } from "./ink.js";
import { toonLook } from "./look.js";
import { isLit, toonTwin, toonUniforms } from "./material.js";
import type { ToonMaterial } from "./material.js";
import { smoothNormalsInPlace } from "./normals.js";
import { shadowTwin, shadowUniforms } from "./shadows.js";
import { toonParticles } from "./vfx.js";
import { Color } from "three/webgpu";

/** Shared tuning: every toon material, ink pass and particle reads these. */
export const TOON = toonUniforms();
export const INK = inkUniforms();
/** Stars, streaks and puffs for the GPU particles, inked in INK's colour. */
const PARTICLES = toonParticles(INK.color);

type RenderObjectFn = Parameters<Renderer["setRenderObjectFunction"]>[0];

const smoothed = new WeakSet<object>();

/** Smooth a geometry's normals once (the normal attribute is shared by every draw of it). */
function smooth(geometry: BufferGeometry): void {
  const n = geometry.getAttribute("normal");
  const p = geometry.getAttribute("position");
  if (!n || !p || smoothed.has(n)) return;
  smoothed.add(n);
  if (n.itemSize !== 3 || p.itemSize !== 3 || !(n.array instanceof Float32Array) || n.count !== p.count) return;
  if ((p as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute || (n as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) return;
  const index = geometry.getIndex();
  smoothNormalsInPlace(p.array, n.array, index ? index.array : null);
  n.needsUpdate = true;
}

function attach(ctx: StyleContext): StyleSession {
  const { renderer, scene, camera } = ctx;
  const twins = new WeakMap<Material, ToonMaterial>();
  const shadowTwins = new WeakMap<Material, MeshBasicNodeMaterial>();
  const marked = new WeakSet<Material>();
  const shadowU = shadowUniforms(new Color(0x2a1c4a));
  let shadowsOn = ctx.tier !== "low";
  // Shadows are drawn after the opaque scene: the first transparent draw (this sentinel goes first) flushes them.
  const sentinel = new Mesh(new PlaneGeometry(0.001, 0.001), new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  sentinel.name = "ToonShadowFlush";
  sentinel.frustumCulled = false;
  sentinel.renderOrder = -1e9;
  sentinel.position.set(0, -500, 0);
  scene.add(sentinel);
  type Pending = [Object3D, Scene, Camera, BufferGeometry, Material, unknown, unknown, unknown];
  const pending: Pending[] = [];
  let sun: DirectionalLight | null = null;
  let frames = 0;
  const dir = new Vector3();

  const findSun = () => {
    sun = null;
    scene.traverse((o) => {
      if (!sun && (o as DirectionalLight).isDirectionalLight && o.visible) sun = o as DirectionalLight;
    });
  };

  const flush = () => {
    for (const p of pending) renderer.renderObject(p[0], p[1], p[2], p[3], p[4], p[5] as never, p[6] as never, p[7] as never);
    pending.length = 0;
  };

  const fn: RenderObjectFn = (object, s, cam, geometry, material, group, lightsNode, clippingContext, passId) => {
    if (object === sentinel) {
      flush();
      return;
    }
    if (isLit(material)) {
      smooth(geometry);
      let twin = twins.get(material);
      if (!twin) {
        twin = toonTwin(material, TOON);
        twins.set(material, twin);
      }
      twin.sync(material as never);
      renderer.renderObject(object, s, cam, geometry, twin, group, lightsNode, clippingContext, passId);
      if (shadowsOn && object.castShadow && !material.transparent && material.visible) {
        let st = shadowTwins.get(material);
        if (!st) {
          st = shadowTwin(material, shadowU);
          shadowTwins.set(material, st);
        }
        pending.push([object, s, cam, geometry, st, group, lightsNode, clippingContext]);
      }
      return;
    }
    if (material.transparent && !marked.has(material)) {
      // Effects leave the ink pass's normal target alone.
      marked.add(material);
      const m = material as Material & { mrtNode?: unknown };
      if (m.mrtNode === null || m.mrtNode === undefined) m.mrtNode = NO_NORMAL();
    }
    renderer.renderObject(object, s, cam, geometry, material, group, lightsNode, clippingContext, passId);
  };

  const ink = inkPost(INK, () => true);
  return {
    particles: PARTICLES,
    post: {
      ...ink,
      scenePass(pass) {
        ink.scenePass?.(pass);
        // The scene pass renders from inside the post graph, often under another node's
        // reset renderer state (bloom's), so the toon draw hook goes on the pass itself.
        const own = pass.updateBefore.bind(pass);
        pass.updateBefore = (frame) => {
          const prev = renderer.getRenderObjectFunction();
          renderer.setRenderObjectFunction(fn);
          try {
            return own(frame);
          } finally {
            renderer.setRenderObjectFunction(prev);
          }
        };
      },
    },
    render(draw) {
      if (frames++ % 120 === 0 || !sun) findSun();
      const s = sun as DirectionalLight | null;
      if (s) {
        dir.copy(s.position).sub(s.target.position);
        if (dir.lengthSq() > 1e-8 && dir.y > 0.05) shadowU.dir.value.copy(dir.normalize());
      }
      const c = camera as Camera & { near?: number; far?: number };
      if (c.near !== undefined) INK.near.value = c.near;
      if (c.far !== undefined) INK.far.value = c.far;
      pending.length = 0;
      const prev = renderer.getRenderObjectFunction();
      renderer.setRenderObjectFunction(fn);
      try {
        draw();
      } finally {
        renderer.setRenderObjectFunction(prev);
        pending.length = 0;
      }
    },
    setSize(width, height) {
      INK.texel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
      INK.width.value = Math.min(2.5, Math.max(1, height / 900));
    },
    setQuality(tier: QualityTier) {
      shadowsOn = tier !== "low";
    },
    dispose() {
      sentinel.removeFromParent();
      sentinel.geometry.dispose();
      (sentinel.material as Material).dispose();
    },
  };
}

export const toonKit: StyleKit = {
  id: "toon",
  look: toonLook,
  needsPost: true,
  // The ink pass draws the lines; the stack's own outline stays off.
  outline: false,
  attach,
};
