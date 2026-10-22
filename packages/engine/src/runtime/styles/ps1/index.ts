/**
 * PS1-retro: the 1996-1999 console look, through the normal runtime.
 *
 *  - The scene draws at about 240 lines (crisp blocks, whole device pixels
 *    each), no anti-aliasing, and leaves the screen as 15-bit colour
 *    through the console's 4x4 ordered dither (pipeline.ts).
 *  - Vertices snap to that pixel grid, textures map affinely and sample
 *    nearest at console sizes, lit materials light per vertex with smooth
 *    Gouraud normals and no specular (materials.ts, lights.ts).
 *  - Tagged template surfaces get CC0 128 px textures from the library
 *    (surfaces.ts); fog comes in closer (a short draw distance).
 *
 * A template opts in by naming the style in createRenderStack (or calling
 * `styleKit("ps1").attach(...)` when it draws with renderer.render).
 */
import type { StyleContext, StyleKit, StyleSession } from "../kit.js";
import { VertexLights } from "./lights.js";
import { Ps1Patcher } from "./materials.js";
import { Ps1Pipeline } from "./pipeline.js";
import { Ps1Surfaces } from "./surfaces.js";

export { VertexLights, MAX_POINT_LIGHTS } from "./lights.js";
export { Ps1Patcher, tessellate } from "./materials.js";
export { Ps1Pipeline, blockGrid } from "./pipeline.js";
export { Ps1Surfaces, SURFACES, surfaceRole } from "./surfaces.js";

export interface Ps1Session extends StyleSession {
  readonly pipeline: Ps1Pipeline;
  readonly patcher: Ps1Patcher;
  readonly lights: VertexLights;
}

/** Fog pulls in to this share of the template's distances (a short draw distance). */
const FOG_PULL = 0.6;

export const ps1Kit: StyleKit = {
  id: "ps1",
  attach(ctx: StyleContext): Ps1Session {
    const { handle, scene, camera } = ctx;
    const lights = new VertexLights();
    const pipeline = new Ps1Pipeline(handle.renderer, scene, camera, ctx.post);
    const surfaces = new Ps1Surfaces(ctx.resolve);
    const patcher = new Ps1Patcher(lights, pipeline.resolution, (role) => surfaces.get(role));
    if (ctx.atmosphere) {
      ctx.atmosphere.near.value *= FOG_PULL;
      ctx.atmosphere.far.value *= FOG_PULL;
    }
    const r: Ps1Session = {
      pipeline,
      patcher,
      lights,
      // The pipeline draws the whole frame (the stack's own post only lends its grade).
      render() {
        patcher.scan(scene);
        lights.update(scene, camera, performance.now());
        pipeline.render();
      },
      // No setSize: the pipeline fits itself to the drawing buffer each frame.
      dispose() {
        pipeline.dispose();
        surfaces.dispose();
      },
    };
    return r;
  },
};
