/**
 * Special pickups and loot (content mode): heals, vacuums, bombs and chests;
 * drop chances rolled on the sim's PRNG; elites and bosses dropping loot;
 * gems merging when the floor is crowded; an XP boost for timed events.
 * Deterministic: netId order, the world PRNG, integer state.
 */
import { EntityFlag, EntityKind, PICKUP_SPECIAL } from "./api.js";
import type { EnemyTypeDef, PickupTypeDef, PlayerId } from "./api.js";
import { nextRandom } from "./rng.js";
import { despawnEntity, liveOrder, spawnEntity } from "./world.js";
import type { InternalWorld } from "./world.js";
import { addXp, clearSpot, derivedStats, drawChoices, enemyType, isFlag, killEnemyBy, onAnyScreen, ripenEvolution, viewRadius } from "./content.js";

/** XP multiplier for gems dropped now (timed events such as an "ember hour"); server-side state, replays rerun it. */
const xpBoosts = new WeakMap<InternalWorld, number>();

export function xpBoostOf(w: InternalWorld): number {
  return xpBoosts.get(w) ?? 1;
}

export function setXpBoost(w: InternalWorld, mul: number): void {
  if (mul === 1) xpBoosts.delete(w);
  else xpBoosts.set(w, Math.max(0, mul));
}

/** Spawn special pickup `index` at (x, z). Returns its ECS id, or -1 when the floor or the world is full. */
export function spawnSpecial(w: InternalWorld, index: number, x: number, z: number): number {
  if (index < 0 || index >= w.config.content.pickups.length) return -1;
  if (w.byNetId.size >= w.config.maxEntities - 8) return -1;
  const g = spawnEntity(w, EntityKind.Pickup, [x, 0.3, z], { type: PICKUP_SPECIAL + index });
  w.events.push({ type: "entity.spawned", netId: w.c.Networked.netId[g] ?? 0, kind: EntityKind.Pickup });
  return g;
}

/**
 * A crowded floor merges gems: the XP goes into the nearest gem within 6 m
 * instead of a new entity. Returns true when it merged.
 */
/** The gems on the floor, listed once per tick (a crowded floor merges many kills in one tick). */
const gemLists = new WeakMap<InternalWorld, { tick: number; gems: number[] }>();
function gemsNow(w: InternalWorld): number[] {
  const cached = gemLists.get(w);
  if (cached && cached.tick === w.tick) return cached.gems;
  const { Networked: N, Game: G } = w.c;
  const gems: number[] = [];
  for (const g of liveOrder(w)) if (N.kind[g] === EntityKind.Pickup && (G.type[g] ?? 0) < PICKUP_SPECIAL) gems.push(g);
  gemLists.set(w, { tick: w.tick, gems });
  return gems;
}

export function mergeGem(w: InternalWorld, x: number, z: number, value: number): boolean {
  if (w.pickupCount < w.config.content.mergeGemsAbove) return false;
  const { Transform: T, Networked: N, Game: G } = w.c;
  let best = -1;
  let bd = 36;
  for (const g of gemsNow(w)) {
    if (N.kind[g] !== EntityKind.Pickup || w.doomed.has(g)) continue;
    const d2 = ((T.x[g] ?? 0) - x) ** 2 + ((T.z[g] ?? 0) - z) ** 2;
    if (d2 < bd) {
      bd = d2;
      best = g;
    }
  }
  if (best < 0) return false;
  G.value[best] = (G.value[best] ?? 0) + value;
  // A merged gem shows its new tier.
  const v = G.value[best] ?? 0;
  G.type[best] = Math.max(G.type[best] ?? 0, v >= 25 ? 2 : v >= 5 ? 1 : 0);
  return true;
}

/** Roll an enemy's special drops, and an elite's chest. */
export function dropsOnDeath(w: InternalWorld, eid: number, def: EnemyTypeDef): void {
  const T = w.c.Transform;
  const x = T.x[eid] ?? 0;
  const z = T.z[eid] ?? 0;
  let k = 0;
  const near = () => {
    const a = k++ * 2.4;
    return [x + Math.cos(a) * 0.8, z + Math.sin(a) * 0.8] as const;
  };
  for (const d of def.drops ?? []) {
    if (nextRandom(w) < d.chance) {
      const [px, pz] = near();
      spawnSpecial(w, d.pickup, px, pz);
    }
  }
  const loot = w.config.content.loot;
  if (isFlag(w, eid, EntityFlag.Elite) && loot.chest >= 0) {
    const [px, pz] = near();
    spawnSpecial(w, loot.chest, px, pz);
  }
  if (def.boss) {
    for (const i of [loot.heal, loot.vacuum, loot.bossChest ?? loot.chest]) {
      if (i < 0) continue;
      const [px, pz] = near();
      spawnSpecial(w, i, px, pz);
    }
  }
}

/** A player collected special pickup `def`. */
export function applyPickup(w: InternalWorld, pe: number, def: PickupTypeDef): void {
  const G = w.c.Game;
  const pid: PlayerId = w.c.Owner.player[pe] ?? 0;
  if (def.effect === "heal") {
    const max = derivedStats(w, pe).maxHealth;
    const add = def.amount <= 1 ? Math.round(max * def.amount) : Math.round(def.amount);
    w.c.Health.hp[pe] = Math.min(max, (w.c.Health.hp[pe] ?? 0) + Math.max(1, add));
  } else if (def.effect === "vacuum") {
    // Every gem on the floor comes to you.
    let total = 0;
    for (const g of liveOrder(w)) {
      if (w.c.Networked.kind[g] !== EntityKind.Pickup || w.doomed.has(g) || (G.type[g] ?? 0) >= PICKUP_SPECIAL) continue;
      total += G.value[g] ?? 0;
      w.doomed.add(g);
    }
    if (total > 0) addXp(w, pe, total);
  } else if (def.effect === "bomb") {
    // Every non-boss enemy on the collector's screen dies, credited to them.
    const T = w.c.Transform;
    const px = T.x[pe] ?? 0;
    const pz = T.z[pe] ?? 0;
    for (const o of [...liveOrder(w)]) {
      if (w.c.Networked.kind[o] !== EntityKind.Enemy || isFlag(w, o, EntityFlag.Dead)) continue;
      const t = enemyType(w, o);
      if (t.boss) continue;
      const ox = (T.x[o] ?? 0) - px;
      const oz = (T.z[o] ?? 0) - pz;
      const r = viewRadius(w, Math.atan2(oz, ox));
      if (ox * ox + oz * oz < r * r) killEnemyBy(w, o, pid);
    }
  } else if (def.effect === "chest") {
    // A boss chest ripens an evolution the player has the passive for, so it is on the cards.
    if (def.evolve) ripenEvolution(w, pe);
    // Card picks: pending levels without XP (a ready evolution shows first).
    const c = G.choices[pe] ?? 0;
    const pending = Math.min(255, (c >>> 24) + Math.max(1, Math.round(def.amount)));
    G.choices[pe] = ((c & 0xffffff) | (pending << 24)) >>> 0;
    if ((c & 0xffffff) === 0) drawChoices(w, pe);
  }
  w.events.push({ type: "player.collected", playerId: pid, netId: w.c.Networked.netId[pe] ?? 0, effect: def.effect });
}

/** Remove every living enemy of a type at once (an event ending), with no kills or drops. Returns how many. */
export function removeAll(w: InternalWorld, type: number): number {
  let n = 0;
  for (const eid of [...liveOrder(w)]) {
    if (w.c.Networked.kind[eid] !== EntityKind.Enemy || (w.c.Game.type[eid] ?? 0) !== type || isFlag(w, eid, EntityFlag.Dead)) continue;
    const netId = w.c.Networked.netId[eid] ?? 0;
    despawnEntity(w, eid);
    w.events.push({ type: "entity.removed", netId, kind: EntityKind.Enemy });
    n++;
  }
  return n;
}

/** Scatter `count` of an enemy type (props) over the field, clear of pillars and off every screen, on the sim's PRNG. */
export function scatterProps(w: InternalWorld, type: number, count: number, spawn: (x: number, z: number) => void): number {
  const def = w.config.content.enemyTypes[type];
  if (!def) return 0;
  const half = w.config.arena.halfExtent - def.radius - 2;
  let n = 0;
  for (let i = 0; i < count * 6 && n < count; i++) {
    const x = (nextRandom(w) * 2 - 1) * half;
    const z = (nextRandom(w) * 2 - 1) * half;
    let ok = true;
    for (const p of w.config.arena.pillars) if ((x - p.x) ** 2 + (z - p.z) ** 2 < (p.radius + def.radius + 1.5) ** 2) ok = false;
    if (ok && !clearSpot(w, x, z, def.radius + 1)) ok = false;
    if (!ok || onAnyScreen(w, x, z, 2)) continue;
    spawn(x, z);
    n++;
  }
  return n;
}
