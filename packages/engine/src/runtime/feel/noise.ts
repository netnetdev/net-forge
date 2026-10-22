/** Seeded integer hash to -1..1 (deterministic, no Math.random). */
export function hashSigned(i: number, seed: number): number {
  let h = Math.imul((i | 0) ^ Math.imul(seed | 0, 0x9e3779b1), 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** Smooth 1D value noise in -1..1, continuous in `t`, fixed for a seed. */
export function valueNoise1(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const a = hashSigned(i, seed);
  const b = hashSigned(i + 1, seed);
  return a + (b - a) * u;
}

/** A small seeded PRNG (mulberry32), 0..1, for cosmetic variation that should not use Math.random. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
