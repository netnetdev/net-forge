/**
 * Surface textures for the PS1 style: what a template's tagged meshes
 * (`mesh.userData.surface = "ground"`) are textured with. Each role reads a
 * 128 px CC0 texture from the asset library (`style.ps1.surface_<role>`,
 * Screaming Brain Studios' texture packs) and repeats every few metres, so
 * a texel is about a screen block at the templates' camera distance.
 *
 * Until the file arrives (or when the library is not built) the role draws
 * a small procedural texture in its own colours, so the game always draws.
 */
import { CanvasTexture, NearestFilter, RepeatWrapping, SRGBColorSpace, TextureLoader } from "three/webgpu";
import type { Texture } from "three/webgpu";

export interface SurfaceRole {
  /** Library name after "style.ps1.". */
  readonly id: string;
  /** Metres one repeat of the texture covers. */
  readonly metres: number;
  /** Fallback: base colour and speckle colours of the procedural texture. */
  readonly base: string;
  readonly speckle: readonly string[];
}

/**
 * The roles templates tag. Aliases map the words a template is likely to
 * use onto the same texture (a "floor" in a yard is concrete).
 */
export const SURFACES: Readonly<Record<string, SurfaceRole>> = {
  grass: { id: "surface_grass", metres: 5, base: "#2e4021", speckle: ["#3b5428", "#24331a", "#4a3a26"] },
  dirt: { id: "surface_dirt", metres: 5, base: "#5a3e24", speckle: ["#6e4c2c", "#4a321d", "#7a6448"] },
  stone: { id: "surface_stone", metres: 2.5, base: "#5e5a55", speckle: ["#6d6862", "#4d4944", "#7a746c"] },
  wall: { id: "surface_wall", metres: 2.5, base: "#56524d", speckle: ["#64605a", "#403c38", "#2e2b28"] },
  wood: { id: "surface_wood", metres: 2, base: "#6b4a2b", speckle: ["#7c5733", "#563a21", "#8a6a44"] },
  metal: { id: "surface_metal", metres: 2.5, base: "#4c5560", speckle: ["#5a636e", "#3c444d", "#6c747e"] },
  concrete: { id: "surface_concrete", metres: 4, base: "#5d5f60", speckle: ["#6a6c6d", "#4f5152", "#77797a"] },
  gravel: { id: "surface_gravel", metres: 4, base: "#55534f", speckle: ["#6a6863", "#43413e", "#7c7a74"] },
  plate: { id: "surface_plate", metres: 3, base: "#3c4450", speckle: ["#48515e", "#2f3640", "#56606c"] },
  hazard: { id: "surface_hazard", metres: 1.5, base: "#6b5a1e", speckle: ["#7d6a24", "#2a2a2a", "#8a7630"] },
};

const ALIASES: Readonly<Record<string, string>> = {
  ground: "grass",
  field: "grass",
  floor: "concrete",
  road: "concrete",
  rock: "stone",
  pillar: "stone",
  fence: "metal",
  panel: "plate",
  steel: "metal",
  soil: "dirt",
  sand: "dirt",
  brick: "wall",
};

/** The role a tag names, or null. */
export function surfaceRole(tag: string): SurfaceRole | null {
  return SURFACES[tag] ?? SURFACES[ALIASES[tag] ?? ""] ?? null;
}

function speckled(role: SurfaceRole, seed: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (!g) return null;
  g.fillStyle = role.base;
  g.fillRect(0, 0, 64, 64);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 700; i++) {
    g.fillStyle = role.speckle[Math.floor(rnd() * role.speckle.length)] ?? role.base;
    g.fillRect(Math.floor(rnd() * 64), Math.floor(rnd() * 64), 1 + Math.floor(rnd() * 2), 1 + Math.floor(rnd() * 2));
  }
  return c;
}

/** Library textures are muted to this saturation and contrast: the console's palette was dusty, and the actors must stay the loudest thing on screen. */
const MUTE_SATURATION = 0.55;
const MUTE_CONTRAST = 0.8;

/** A muted copy of an image (saturation and contrast pulled in), or null when it cannot be read. */
export function muted(img: unknown): HTMLCanvasElement | null {
  if (typeof document === "undefined" || !img) return null;
  const src = img as { width?: number; height?: number };
  const w = src.width ?? 0;
  const h = src.height ?? 0;
  if (w <= 0 || h <= 0) return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  try {
    g.drawImage(img as CanvasImageSource, 0, 0);
    const im = g.getImageData(0, 0, w, h);
    const d = im.data;
    let mean = 0;
    for (let i = 0; i < d.length; i += 4) mean += 0.299 * (d[i] ?? 0) + 0.587 * (d[i + 1] ?? 0) + 0.114 * (d[i + 2] ?? 0);
    mean /= d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] ?? 0;
      const gg = d[i + 1] ?? 0;
      const b = d[i + 2] ?? 0;
      const y = 0.299 * r + 0.587 * gg + 0.114 * b;
      const yc = mean + (y - mean) * MUTE_CONTRAST;
      d[i] = yc + (r - y) * MUTE_SATURATION;
      d[i + 1] = yc + (gg - y) * MUTE_SATURATION;
      d[i + 2] = yc + (b - y) * MUTE_SATURATION;
    }
    g.putImageData(im, 0, 0);
    return c;
  } catch {
    return null;
  }
}

/** Linear RGB. */
export type Rgb = readonly [number, number, number];

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Mean linear colour of an sRGB image (drawn down to 8x8), or null when it cannot be read. */
export function imageAverage(img: unknown): Rgb | null {
  if (typeof document === "undefined" || !img) return null;
  const c = document.createElement("canvas");
  c.width = c.height = 8;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  try {
    g.imageSmoothingEnabled = true;
    g.drawImage(img as CanvasImageSource, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data;
    let r = 0;
    let gg = 0;
    let b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += toLinear((d[i] ?? 0) / 255);
      gg += toLinear((d[i + 1] ?? 0) / 255);
      b += toLinear((d[i + 2] ?? 0) / 255);
    }
    const n = d.length / 4;
    return [r / n, gg / n, b / n];
  } catch {
    return null;
  }
}

/**
 * The material colour that makes a texture of mean `avg` read like the
 * template's own surface of mean `want`: its brightness, and half its hue
 * (a night field stays a dark blue-green field, not a lit lawn).
 */
/** How much of the template's hue the tint carries (0: brightness only, 1: all of it). */
const HUE = 0.5;

export function matchTint(want: Rgb, avg: Rgb): Rgb {
  const lum = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const l = lum(want) / Math.max(lum(avg), 1e-4);
  const ch = (i: 0 | 1 | 2) => Math.min(3, Math.max(0, l * (1 - HUE) + (want[i] / Math.max(avg[i], 1e-4)) * HUE));
  return [ch(0), ch(1), ch(2)];
}

/** A role's texture, its repeat, and its mean colour (now, and again when the library file arrives). */
export interface SurfaceTexture {
  readonly texture: Texture;
  readonly metres: number;
  onAverage(cb: (avg: Rgb) => void): void;
}

/**
 * Loads and caches one texture per role. `resolve` maps a library id to a
 * URL (or null when there is no library), from the template's LibraryClient.
 */
export class Ps1Surfaces {
  private readonly cache = new Map<string, Texture>();
  private readonly averages = new Map<string, Rgb>();
  private readonly listeners = new Map<string, ((avg: Rgb) => void)[]>();
  private readonly loader = new TextureLoader();

  constructor(private readonly resolve: ((id: string) => string | null) | undefined) {}

  get(tag: string): SurfaceTexture | null {
    const role = surfaceRole(tag);
    if (!role) return null;
    let t = this.cache.get(role.id);
    if (!t) {
      const canvas = speckled(role, role.id.length * 31 + role.id.charCodeAt(8));
      if (!canvas) return null;
      const made: Texture = new CanvasTexture(canvas);
      made.wrapS = made.wrapT = RepeatWrapping;
      made.magFilter = made.minFilter = NearestFilter;
      made.generateMipmaps = false;
      made.colorSpace = SRGBColorSpace;
      t = made;
      this.cache.set(role.id, made);
      const first = imageAverage(canvas);
      if (first) this.averages.set(role.id, first);
      let url: string | null = null;
      try {
        url = this.resolve?.(`style.ps1.${role.id}`) ?? null;
      } catch {
        url = null;
      }
      if (url) {
        this.loader.loadAsync(url).then(
          (loaded) => {
            // Same texture object: no material or pipeline changes, just new pixels.
            const image = muted(loaded.image) ?? loaded.image;
            const was = made.image as { width?: number; height?: number } | null;
            const now = image as { width?: number; height?: number } | null;
            // A new size needs new GPU storage (WebGL cannot write a 128 px image into the 64 px fallback's).
            if (was?.width !== now?.width || was?.height !== now?.height) made.dispose();
            made.image = image;
            made.needsUpdate = true;
            const avg = imageAverage(image);
            if (avg) {
              this.averages.set(role.id, avg);
              for (const cb of this.listeners.get(role.id) ?? []) cb(avg);
            }
          },
          () => undefined,
        );
      }
    }
    const id = role.id;
    return {
      texture: t,
      metres: role.metres,
      onAverage: (cb) => {
        const list = this.listeners.get(id) ?? [];
        list.push(cb);
        this.listeners.set(id, list);
        const now = this.averages.get(id);
        if (now) cb(now);
      },
    };
  }

  dispose(): void {
    for (const t of this.cache.values()) t.dispose();
    this.cache.clear();
    this.listeners.clear();
  }
}
