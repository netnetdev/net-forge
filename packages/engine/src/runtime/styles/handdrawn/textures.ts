/**
 * Procedural textures for the hand-drawn style, generated in JS (no DOM,
 * no files, deterministic from a seed): a tileable noise field the line
 * wobble, wet edges and hatching read, and a sheet of paper with grain and
 * fibres the whole frame is printed on. Original work, so no licence
 * question.
 */
import { DataTexture, LinearFilter, RepeatWrapping, RGBAFormat, UnsignedByteType } from "three/webgpu";

/** A small seeded generator (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value noise on a `size` grid with `cells` lattice cells per side, fractal over `octaves`. Values 0..1. */
export function tileNoise(size: number, cells: number, octaves: number, rnd: () => number): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  let c = cells;
  for (let o = 0; o < octaves; o++) {
    const lattice = new Float32Array(c * c);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();
    const step = size / c;
    for (let y = 0; y < size; y++) {
      const gy = y / step;
      const y0 = Math.floor(gy) % c;
      const y1 = (y0 + 1) % c;
      const fy = gy - Math.floor(gy);
      const sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < size; x++) {
        const gx = x / step;
        const x0 = Math.floor(gx) % c;
        const x1 = (x0 + 1) % c;
        const fx = gx - Math.floor(gx);
        const sx = fx * fx * (3 - 2 * fx);
        const a = lattice[y0 * c + x0] ?? 0;
        const b = lattice[y0 * c + x1] ?? 0;
        const d = lattice[y1 * c + x0] ?? 0;
        const e = lattice[y1 * c + x1] ?? 0;
        const v = (a + (b - a) * sx) * (1 - sy) + (d + (e - d) * sx) * sy;
        out[y * size + x] = (out[y * size + x] ?? 0) + v * amp;
      }
    }
    total += amp;
    amp *= 0.5;
    c *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) / total;
  return out;
}

function dataTexture(data: Uint8Array, size: number): DataTexture {
  const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** Stretch a noise field so it spans 0..1 (value noise bunches around the middle). */
function contrast(f: Float32Array): Float32Array {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of f) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const k = hi - lo > 1e-6 ? 1 / (hi - lo) : 1;
  for (let i = 0; i < f.length; i++) f[i] = ((f[i] ?? 0) - lo) * k;
  return f;
}

/**
 * Noise for the style's shaders, 256 px and tileable: R low (wobble, wet
 * edges), G mid (line pressure and breaks), B fine (stroke jitter), A white.
 */
export function noiseData(seed = 11, size = 256): Uint8Array {
  const rnd = seeded(seed);
  const r = contrast(tileNoise(size, 4, 3, rnd));
  const g = contrast(tileNoise(size, 8, 3, rnd));
  const b = contrast(tileNoise(size, 32, 2, rnd));
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round((r[i] ?? 0) * 255);
    data[i * 4 + 1] = Math.round((g[i] ?? 0) * 255);
    data[i * 4 + 2] = Math.round((b[i] ?? 0) * 255);
    data[i * 4 + 3] = Math.floor(rnd() * 256);
  }
  return data;
}

/**
 * Cold-pressed paper, 512 px and tileable: R is the surface (1 = the top of
 * the tooth, lower = valleys and fibres), G a slower mottle for the sheet's
 * tone, B the tooth alone (where pigment granulates).
 */
export function paperData(seed = 5, size = 512): Uint8Array {
  const rnd = seeded(seed);
  const tooth = contrast(tileNoise(size, 64, 2, rnd));
  const mottle = contrast(tileNoise(size, 4, 4, rnd));
  const surface = new Float32Array(size * size);
  for (let i = 0; i < surface.length; i++) surface[i] = 0.9 + 0.1 * (tooth[i] ?? 0);
  // Fibres: short soft curves, a little darker or lighter than the sheet.
  const wrap = (v: number) => ((Math.round(v) % size) + size) % size;
  for (let f = 0; f < 1400; f++) {
    let x = rnd() * size;
    let y = rnd() * size;
    let a = rnd() * Math.PI * 2;
    const len = 6 + rnd() * 26;
    const dv = rnd() < 0.7 ? -(0.03 + rnd() * 0.05) : 0.03 + rnd() * 0.03;
    for (let s = 0; s < len; s++) {
      const i = wrap(y) * size + wrap(x);
      surface[i] = Math.min(1, Math.max(0, (surface[i] ?? 0) + dv * (1 - Math.abs(s / len - 0.5))));
      a += (rnd() - 0.5) * 0.35;
      x += Math.cos(a);
      y += Math.sin(a);
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round((surface[i] ?? 0) * 255);
    data[i * 4 + 1] = Math.round((mottle[i] ?? 0) * 255);
    data[i * 4 + 2] = Math.round((tooth[i] ?? 0) * 255);
    data[i * 4 + 3] = 255;
  }
  return data;
}

let noiseTex: DataTexture | null = null;
let paperTex: DataTexture | null = null;

/** The shared noise texture (built once per page). */
export function noiseTexture(): DataTexture {
  noiseTex ??= dataTexture(noiseData(), 256);
  return noiseTex;
}

/** The shared paper texture (built once per page). */
export function paperTexture(): DataTexture {
  paperTex ??= dataTexture(paperData(), 512);
  return paperTex;
}
