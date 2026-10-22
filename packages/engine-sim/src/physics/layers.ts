/**
 * Collision layers. Every body is on exactly one layer and carries a mask of
 * the layers it collides with. Rapier's rule is pairwise: two bodies touch
 * only when EACH one's mask contains the other's layer, so both sides of a
 * pair must agree (a projectile that wants to hit enemies needs Enemy in its
 * mask, and enemies need Projectile in theirs). Queries (raycasts, shape
 * casts, overlaps) only look at the layers in the query's mask.
 */
export const Layer = {
  Level: 1 << 0,
  Player: 1 << 1,
  Enemy: 1 << 2,
  Projectile: 1 << 3,
  Pickup: 1 << 4,
  Prop: 1 << 5,
  Trigger: 1 << 6,
  Debris: 1 << 7,
  User1: 1 << 8,
  User2: 1 << 9,
  User3: 1 << 10,
  User4: 1 << 11,
  User5: 1 << 12,
  User6: 1 << 13,
  User7: 1 << 14,
  User8: 1 << 15,
} as const;
export type LayerName = keyof typeof Layer;
/** One bit of `Layer`. */
export type LayerBit = (typeof Layer)[LayerName];

/** Every layer (the default mask). */
export const ALL_LAYERS = 0xffff;

/** A mask from layer names or bits: `layerMask("Level", "Enemy")`. */
export function layerMask(...layers: readonly (LayerName | number)[]): number {
  let m = 0;
  for (const l of layers) m |= typeof l === "number" ? l : Layer[l];
  return m & ALL_LAYERS;
}

/** Rapier interaction groups: membership in the high 16 bits, filter in the low 16. */
export function collisionGroups(layer: number, mask: number): number {
  return (((layer & ALL_LAYERS) << 16) | (mask & ALL_LAYERS)) >>> 0;
}

/** Query groups: the query belongs to every layer and looks only at `mask`. */
export function queryGroups(mask: number): number {
  return collisionGroups(ALL_LAYERS, mask);
}

/** True when two bodies with these layers and masks collide (Rapier's pairwise rule). */
export function layersCollide(layerA: number, maskA: number, layerB: number, maskB: number): boolean {
  return (layerA & maskB) !== 0 && (layerB & maskA) !== 0;
}
