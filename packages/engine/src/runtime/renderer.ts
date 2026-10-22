import { WebGPURenderer } from "three/webgpu";

export type Backend = "webgpu" | "webgl2";

export interface RendererOptions {
  /** Skip WebGPU even where the browser has it (testing, or a known-bad driver). */
  readonly forceWebGL?: boolean;
  readonly antialias?: boolean;
  /** Cap on devicePixelRatio; the quality tier lowers it. Default 2. */
  readonly maxPixelRatio?: number;
}

export interface RendererHandle {
  readonly renderer: WebGPURenderer;
  readonly backend: Backend;
}

/**
 * three.js WebGPURenderer. It targets WebGPU where `navigator.gpu` yields an
 * adapter and falls back to its WebGL2 backend otherwise, so one code path
 * (node materials, instancing) covers every browser (spec §5).
 */
export async function createRenderer(canvas: HTMLCanvasElement, opts: RendererOptions = {}): Promise<RendererHandle> {
  const renderer = new WebGPURenderer({
    canvas,
    antialias: opts.antialias ?? true,
    forceWebGL: opts.forceWebGL ?? false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, opts.maxPixelRatio ?? 2));
  await renderer.init();
  const backend: Backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "webgpu" : "webgl2";
  return { renderer, backend };
}
