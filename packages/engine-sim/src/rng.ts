/**
 * mulberry32: a 32-bit seeded PRNG whose whole state is one u32, so it
 * rides in the snapshot. Public domain (Tommy Ettinger).
 */
export function nextRandom(state: { rng: number }): number {
  const s = (state.rng + 0x6d2b79f5) >>> 0;
  state.rng = s;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
