/**
 * An art style for a template that draws without the render stack (its
 * own lights and `renderer.render`): the style's session, post stages and
 * grade on that scene, in one call. Templates on `createRenderStack` pass
 * `style` to it instead.
 *
 *   const view = createStyledView(handle, scene, camera, "handdrawn");
 *   view?.setSize(w, h);
 *   view ? view.render() : renderer.render(scene, camera);
 */
import type { Camera, Scene } from "three/webgpu";
import type { RendererHandle } from "../renderer.js";
import { PostFX } from "../render/post.js";
import type { LookPreset } from "../render/presets.js";
import type { QualityTier } from "../render/quality.js";
import { styleKit } from "./index.js";
import type { StyleKit, StyleSession } from "./kit.js";

export interface StyledView {
  readonly session: StyleSession;
  readonly post: PostFX;
  /** Draw a frame (also advances the style's clock). */
  render(nowMs?: number): void;
  /** Canvas size in CSS pixels (after renderer.setSize). */
  setSize(width: number, height: number): void;
  dispose(): void;
}

export interface StyledViewOptions {
  /** Which of the style's grades to use (the scene keeps its own lights). Default "night". */
  readonly preset?: LookPreset;
  /** Bloom on (default: the style's choice). */
  readonly bloom?: boolean;
  /** Quality tier the session tunes for. Default "high". */
  readonly tier?: QualityTier;
}

/** The style's view of a scene, or null when the style has no session (lowpoly, unknown, or a kit with world builders only). */
export function createStyledView(handle: RendererHandle, scene: Scene, camera: Camera, style: string | StyleKit | null | undefined, opts: StyledViewOptions = {}): StyledView | null {
  const kit = typeof style === "string" || style === null || style === undefined ? styleKit(style) : style;
  if (!kit?.attach) return null;
  const preset = opts.preset ?? "night";
  const grade = kit.look?.(preset).grade;
  const post = new PostFX(handle.renderer, scene, camera, { preset, bloom: opts.bloom ?? kit.bloom ?? true, ...(grade ? { overrides: grade } : {}) });
  const session = kit.attach({ handle, renderer: handle.renderer, scene, camera, tier: opts.tier ?? "high", preset, post });
  if (session.post) post.setStyle(session.post);
  return {
    session,
    post,
    render(nowMs) {
      session.frame?.((nowMs ?? performance.now()) / 1000);
      if (session.render) session.render(() => post.render());
      else post.render();
    },
    setSize(width, height) {
      post.setSize(width, height);
      const pr = handle.renderer.getPixelRatio();
      session.setSize?.(width * pr, height * pr);
    },
    dispose() {
      session.dispose();
      post.dispose();
    },
  };
}
