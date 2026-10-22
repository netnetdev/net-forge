import type { WebGPURenderer } from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

export interface AssetLoaderOptions {
  /**
   * Maps a library id ("style.lowpoly.mech_01") to a URL on the asset CDN.
   * Games never see URLs (spec §10); only this resolver does.
   */
  readonly resolve: (id: string) => string;
  /** Where basis_transcoder.js/.wasm are served (copied from three/examples/jsm/libs/basis/). */
  readonly transcoderPath: string;
}

/**
 * glTF loading with the runtime's compression stack: meshopt geometry
 * (EXT_meshopt_compression) and KTX2/Basis textures (KHR_texture_basisu).
 * Loads are cached by id, so a prefab used 2,000 times is fetched once.
 */
export class AssetLoader {
  private readonly gltf: GLTFLoader;
  private readonly ktx2: KTX2Loader;
  private readonly cache = new Map<string, Promise<GLTF>>();
  private ready: Promise<void>;

  constructor(renderer: WebGPURenderer, private readonly opts: AssetLoaderOptions) {
    this.ktx2 = new KTX2Loader().setTranscoderPath(opts.transcoderPath);
    this.ready = this.ktx2.detectSupportAsync(renderer).then(() => undefined);
    this.gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(this.ktx2);
  }

  load(id: string): Promise<GLTF> {
    let p = this.cache.get(id);
    if (!p) {
      const url = this.opts.resolve(id);
      p = this.ready.then(() => this.gltf.loadAsync(url));
      p.catch(() => this.cache.delete(id));
      this.cache.set(id, p);
    }
    return p;
  }

  dispose(): void {
    this.ktx2.dispose();
    this.cache.clear();
  }
}
