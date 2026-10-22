/**
 * The library on the client: resolve a library id (and a look) to something
 * drawable. Models load through the engine runtime's AssetLoader (meshopt
 * and KTX2 decoding, one fetch per id) unless a ModelSource is given.
 * Every method rejects when the file is missing (offline with no library
 * built, or a bad base URL); templates catch that and keep their primitive
 * shapes, so a game always draws.
 *
 * Network: one GET per distinct library id, cached for the session. No
 * chain reads.
 */
import type { AppearanceDef } from "@netnetcapital/engine";
import { AssetLoader, markSprite, markSpriteMaterial, SPRITE_TEXEL, spriteBillboardNode } from "@netnetcapital/engine/runtime";
import type { RendererHandle } from "@netnetcapital/engine/runtime";
import { Color, DoubleSide, Group, Mesh, MeshStandardNodeMaterial, NearestFilter, Object3D, PlaneGeometry, SRGBColorSpace, TextureLoader } from "three/webgpu";
import { float, texture, uv, vec2, vec3, vec4 } from "three/tsl";
import { resolveLook, type ResolvedLook } from "../look.js";
import { assetPath, libraryUrl } from "../paths.js";
import { restyleId } from "../restyle.js";
import { RIGS } from "../rigs.js";
import { RigAnimator, StaticAnimator, type CharacterAnimator } from "./animator.js";
import { bakeCrowd, poseModel, type CrowdModel } from "./crowd.js";
import { proceduralAsset } from "./parts.js";
import { prepareModel, type LoadedModel, type PreparedModel } from "./prepare.js";

/** Anything that can load a glTF by library id (the engine's AssetLoader fits). */
export interface ModelSource {
  load(id: string): Promise<LoadedModel>;
}

export interface LibraryClientOptions {
  /** Base URL of the built library: "./library" next to the page in dev, `<CDN>/ipfs/<cid>` in production. */
  readonly baseUrl: string;
  /** Where basis_transcoder.js/.wasm are served, for KTX2 textures. */
  readonly transcoderPath?: string;
  readonly source?: ModelSource;
  /**
   * The game's art style (game({ style })): a model id from another style
   * draws this style's model of the same name when the style stocks one
   * (`style.lowpoly.ghost` -> `style.ps1.ghost`).
   */
  readonly style?: string;
}

/**
 * Pixel scale of a sprite asked to stand `wanted` m tall: 1 (its own
 * pixels) for anything near its natural size, 2 for the big ones (bosses,
 * trees), so the picture keeps one or two pixel sizes and never a smear.
 */
export function spriteMultiple(wanted: number, natural: number): number {
  return natural > 0 && wanted / natural >= 2.2 ? 2 : 1;
}

export interface CharacterInstance extends PreparedModel {
  readonly animator: CharacterAnimator;
  readonly look: ResolvedLook;
}

export class LibraryClient {
  private readonly source: ModelSource;
  private readonly crowds = new Map<string, Promise<CrowdModel>>();

  constructor(handle: RendererHandle | null, private readonly opts: LibraryClientOptions) {
    if (opts.source) this.source = opts.source;
    else {
      if (!handle) throw new Error("LibraryClient needs a renderer or a ModelSource");
      const loader = new AssetLoader(handle.renderer, { resolve: (id) => this.url(id), transcoderPath: opts.transcoderPath ?? `${opts.baseUrl.replace(/\/+$/, "")}/basis/` });
      this.source = { load: (id) => loader.load(id) };
    }
  }

  /** The URL a library id is fetched from. Throws for ids with no file. */
  url(id: string): string {
    const look = resolveLook(id);
    const path = assetPath(look.asset);
    if (!path) throw new Error(`${id} has no file (procedural or variant)`);
    return libraryUrl(this.opts.baseUrl, path);
  }

  private async loaded(look: ResolvedLook): Promise<LoadedModel> {
    return this.source.load(look.asset.id);
  }

  private isSprite(look: ResolvedLook): boolean {
    return assetPath(look.asset)?.endsWith(".png") ?? false;
  }

  /**
   * A 2D sprite as an upright plane, feet at y = 0, in metres at
   * SPRITE_TEXEL per source pixel (times a whole multiple), pixels kept
   * crisp. Marked for billboarding (crowds and characters face the camera).
   * Lit like the scene but carrying its own colour as emissive, so a sprite
   * reads at night; `glow` sprites (fire, gems) light themselves fully.
   */
  private async sprite(look: ResolvedLook, height?: number, hero = false): Promise<{ geometry: PlaneGeometry; material: MeshStandardNodeMaterial; height: number }> {
    const tex = await new TextureLoader().loadAsync(this.url(look.asset.id));
    tex.magFilter = NearestFilter;
    tex.minFilter = NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = SRGBColorSpace;
    const img = tex.image as { width: number; height: number };
    const natural = img.height * SPRITE_TEXEL;
    // A character (a player) stands about twice as tall as the 16 px crowd, in whole pixel multiples, so a player finds themself at once.
    const k = Math.max(hero ? Math.max(1, Math.round(32 / img.height)) : 1, spriteMultiple((height ?? look.asset.height) * look.scale, natural));
    const h = natural * k;
    const geometry = new PlaneGeometry(img.width * SPRITE_TEXEL * k, h);
    geometry.translate(0, h / 2, 0);
    markSprite(geometry);
    const material = new MeshStandardNodeMaterial({ map: tex, emissiveMap: tex, side: DoubleSide, roughness: 1, metalness: 0 });
    // As a node, not `alphaTest`: NodeMaterial.clone() drops `alphaTest` (three r186), and templates clone crowd materials.
    material.alphaTestNode = float(0.5);
    material.emissive.setRGB(1, 1, 1);
    material.emissiveIntensity = look.asset.sprite?.glow ? 1 : hero ? 0.6 : 0.45;
    if (hero) {
      // The player: full colour (no tint) and a 1 px ember rim where the silhouette meets the clear, the brightest thing on screen.
      const t = texture(tex);
      const step = vec2(1 / Math.max(1, img.width), 1 / Math.max(1, img.height));
      const at = (dx: number, dy: number) => texture(tex, uv().add(step.mul(vec2(dx, dy)))).a;
      const edge = t.a.greaterThan(0.5).and(at(1, 0).min(at(-1, 0)).min(at(0, 1)).min(at(0, -1)).lessThan(0.5));
      const rim = vec3(1, 0.86, 0.35);
      // Unlit: its own colours whatever the lantern at its feet does (lit, it washed out to white).
      material.colorNode = vec4(vec3(0), t.a);
      material.emissiveNode = edge.select(rim.mul(0.85), t.rgb.mul(0.65));
    } else if (look.tint !== null) material.color.setHex(look.tint).lerp(new Color(1, 1, 1), 0.5);
    markSpriteMaterial(material);
    return { geometry, material, height: h };
  }

  /** An animated character for the scene (players, bosses, a few dozen at most). */
  async character(modelId: string, look?: AppearanceDef, opts: { height?: number } = {}): Promise<CharacterInstance> {
    const l = resolveLook(restyleId(modelId, this.opts.style), look);
    const src = l.asset.source;
    if ("procedural" in src) {
      const p = proceduralAsset(src.procedural);
      if (!p) throw new Error(`unknown procedural asset ${src.procedural}`);
      const root = new Group();
      const mesh = new Mesh(p.geometry, p.material);
      root.add(mesh);
      return { root, model: mesh, height: 0.5, width: 0.5, depth: 0.5, hand: null, animator: new StaticAnimator(), look: l };
    }
    if (this.isSprite(l)) {
      const s = await this.sprite(l, opts.height, true);
      const root = new Group();
      // One character, so it faces the camera from its own node (crowds billboard in AnimatedCrowd).
      s.material.positionNode = spriteBillboardNode();
      const mesh = new Mesh(s.geometry, s.material);
      root.add(mesh);
      return { root, model: mesh, height: s.height, width: s.height, depth: 0.05, hand: null, animator: new StaticAnimator(), look: l };
    }
    const loaded = await this.loaded(l);
    const prepared = prepareModel(loaded, l, opts);
    const rig = l.asset.rig ? RIGS[l.asset.rig] : undefined;
    const animator = rig && loaded.animations.length ? new RigAnimator(prepared.model, loaded.animations, rig) : new StaticAnimator();
    return { ...prepared, animator, look: l };
  }

  /** A static prop (trees, buildings, held weapons). */
  async prop(modelId: string, look?: AppearanceDef, opts: { height?: number } = {}): Promise<Object3D> {
    return (await this.character(modelId, look, opts)).root;
  }

  /** Static instanced parts for crowds. Cached per model, look and height. */
  crowd(modelId: string, look?: AppearanceDef, opts: { height?: number } = {}): Promise<CrowdModel> {
    const l = resolveLook(restyleId(modelId, this.opts.style), look);
    const key = `${l.key}|${opts.height ?? "-"}`;
    let p = this.crowds.get(key);
    if (!p) {
      p = this.buildCrowd(l, opts);
      p.catch(() => this.crowds.delete(key));
      this.crowds.set(key, p);
    }
    return p;
  }

  private async buildCrowd(l: ResolvedLook, opts: { height?: number }): Promise<CrowdModel> {
    const src = l.asset.source;
    if ("procedural" in src) {
      const p = proceduralAsset(src.procedural);
      if (!p) throw new Error(`unknown procedural asset ${src.procedural}`);
      return { parts: [{ geometry: p.geometry, material: p.material }], height: 0.5, triangles: 0 };
    }
    if (this.isSprite(l)) {
      const s = await this.sprite(l, opts.height);
      return { parts: [{ geometry: s.geometry, material: s.material }], height: s.height, triangles: 2 };
    }
    const loaded = await this.loaded(l);
    const prepared = prepareModel(loaded, l, opts);
    poseModel(prepared, loaded.animations, l.asset.rig ? RIGS[l.asset.rig] : undefined);
    return bakeCrowd(prepared);
  }
}
