/**
 * Weapon shapes beyond nova, bolt and orbit (content mode): cone sweeps,
 * chains, auras, meteors and boomerangs, and the per-level numbers every
 * weapon resolves to. Deterministic: grid queries in netId order, the
 * world PRNG only for the meteor's target.
 *
 * Player-owned meteors are projectiles with EntityFlag.Elite (a ground
 * hazard) and no Hostile flag; their telegraph word fills like an enemy
 * hazard so clients draw the circle before it lands.
 */
import { EntityFlag, EntityKind, Telegraph } from "./api.js";
import type { PlayerId, WeaponDef, WeaponLevelStats } from "./api.js";
import { nextRandom } from "./rng.js";
import { spawnEntity } from "./world.js";
import type { InternalWorld } from "./world.js";
import { enemyType, hitEnemy, isFlag } from "./content.js";
import { teleWord } from "./roles.js";
import { tallyWeapon } from "./tally.js";

type Near = (x: number, z: number, r: number, fn: (eid: number) => boolean | void) => void;

/** Seconds a meteor's circle shows before it lands. */
export const METEOR_FALL_SECONDS = 0.6;

/** A weapon's numbers at a player's level, after passives. */
export interface Scaled {
  damage: number;
  cooldown: number;
  count: number;
  range: number;
  speed: number;
  pierce: number;
  knockback: number;
  spread: number;
}

/** Passive multipliers the weapons read (content.ts derivedStats). */
export interface WeaponMods {
  readonly might: number;
  readonly haste: number;
  /** Area: radius multiplier for novas, auras, cones, meteors and orbits. */
  readonly area: number;
  /** Amount: extra projectiles, blades, jumps or meteors. */
  readonly amount: number;
}

const AREA_KINDS = new Set(["nova", "aura", "cone", "meteor", "orbit"]);
const AMOUNT_KINDS = new Set(["bolt", "orbit", "chain", "meteor", "boomerang"]);

/** The generic level curve (weapons that declare no `levels`). */
function generic(def: WeaponDef, level: number): WeaponLevelStats {
  const l = Math.max(1, level) - 1;
  return {
    damage: def.damage * (1 + 0.25 * l),
    cooldownTicks: def.cooldownTicks * (1 - 0.06 * l),
    count: def.kind === "nova" || def.kind === "aura" || def.kind === "cone" ? 1 : def.count + Math.floor(l / 2),
    range: def.kind === "nova" || def.kind === "aura" ? def.range * (1 + 0.08 * l) : def.range,
    speed: def.speed,
    pierce: def.pierce,
    knockback: def.knockback,
    spread: def.spread ?? Math.PI / 2,
  };
}

/** A weapon at a level with a player's passives applied. */
export function scaledWeapon(def: WeaponDef, level: number, mods: WeaponMods): Scaled {
  const base = def.levels?.[Math.max(0, Math.min(def.levels.length - 1, level - 1))] ?? generic(def, level);
  const area = AREA_KINDS.has(def.kind) ? mods.area : 1;
  return {
    damage: Math.max(1, Math.round(base.damage * mods.might)),
    cooldown: Math.min(255, Math.max(1, Math.round(base.cooldownTicks * mods.haste))),
    count: Math.min(16, Math.max(1, Math.round(base.count) + (AMOUNT_KINDS.has(def.kind) ? mods.amount : 0))),
    range: base.range * area,
    speed: base.speed,
    pierce: Math.round(base.pierce),
    knockback: base.knockback,
    spread: Math.min(Math.PI * 2, base.spread * (def.kind === "cone" ? Math.sqrt(area) : 1)),
  };
}

/** Facing of a player as a unit vector (yaw 0 faces -z). */
function facing(w: InternalWorld, pe: number): [number, number] {
  const yaw = w.c.Transform.yaw[pe] ?? 0;
  return [-Math.sin(yaw), -Math.cos(yaw)];
}

/**
 * Fire a cone, chain, aura or meteor if it has something to hit. Returns
 * true when it fired (the caller starts its cooldown). Bolts, boomerangs,
 * novas and orbits stay in content.ts.
 */
export function fireShape(w: InternalWorld, near: Near, pid: PlayerId, pe: number, wi: number, def: WeaponDef, sc: Scaled): boolean {
  const T = w.c.Transform;
  const px = T.x[pe] ?? 0;
  const pz = T.z[pe] ?? 0;
  const reachPad = w.maxEnemyRadius;
  if (def.kind === "aura") {
    // A field around you: everything inside takes a tick of damage.
    const r = sc.range;
    let any = false;
    near(px, pz, r + reachPad, (o) => {
      if (isFlag(w, o, EntityFlag.Dead)) return;
      const ox = (T.x[o] ?? 0) - px;
      const oz = (T.z[o] ?? 0) - pz;
      const rr = r + enemyType(w, o).radius;
      if (ox * ox + oz * oz > rr * rr) return;
      any = true;
      hitEnemy(w, o, sc.damage, pid, ox, oz, sc.knockback);
    });
    return any;
  }
  if (def.kind === "cone") {
    // A sweep where you face: enemies within range and within half the spread of the facing.
    const [fx, fz] = facing(w, pe);
    const half = sc.spread / 2;
    const cosHalf = Math.cos(half);
    const full = sc.spread >= Math.PI * 2 - 1e-6;
    const hits: number[] = [];
    near(px, pz, sc.range + reachPad, (o) => {
      if (isFlag(w, o, EntityFlag.Dead)) return;
      const ox = (T.x[o] ?? 0) - px;
      const oz = (T.z[o] ?? 0) - pz;
      const d2 = ox * ox + oz * oz;
      const rr = sc.range + enemyType(w, o).radius;
      if (d2 > rr * rr) return;
      const d = Math.sqrt(d2) || 1;
      if (!full && (ox * fx + oz * fz) / d < cosHalf) return;
      hits.push(o);
    });
    if (hits.length === 0) return false;
    for (const o of hits) hitEnemy(w, o, sc.damage, pid, (T.x[o] ?? 0) - px, (T.z[o] ?? 0) - pz, sc.knockback);
    return true;
  }
  if (def.kind === "chain") {
    // Strike the nearest enemy in range, then jump to the nearest one not yet hit, `count` jumps.
    let from = -1;
    let bestD2 = sc.range * sc.range;
    near(px, pz, sc.range, (o) => {
      if (isFlag(w, o, EntityFlag.Dead)) return;
      const ox = (T.x[o] ?? 0) - px;
      const oz = (T.z[o] ?? 0) - pz;
      const d2 = ox * ox + oz * oz;
      if (d2 < bestD2) {
        bestD2 = d2;
        from = o;
      }
    });
    if (from < 0) return false;
    const hit = new Set<number>();
    let cur = from;
    let lx = px;
    let lz = pz;
    const jump = Math.max(2.5, sc.speed || 4);
    for (let j = 0; j <= sc.count && cur >= 0; j++) {
      hit.add(cur);
      const cx = T.x[cur] ?? 0;
      const cz = T.z[cur] ?? 0;
      hitEnemy(w, cur, sc.damage, pid, cx - lx, cz - lz, sc.knockback);
      lx = cx;
      lz = cz;
      let next = -1;
      let nd2 = jump * jump;
      near(cx, cz, jump, (o) => {
        if (hit.has(o) || isFlag(w, o, EntityFlag.Dead)) return;
        const ox = (T.x[o] ?? 0) - cx;
        const oz = (T.z[o] ?? 0) - cz;
        const d2 = ox * ox + oz * oz;
        if (d2 < nd2) {
          nd2 = d2;
          next = o;
        }
      });
      cur = next;
    }
    return true;
  }
  if (def.kind === "meteor") {
    // A circle lands on random enemies in range after a short, visible fall.
    const targets: number[] = [];
    near(px, pz, sc.range, (o) => {
      if (isFlag(w, o, EntityFlag.Dead)) return;
      const ox = (T.x[o] ?? 0) - px;
      const oz = (T.z[o] ?? 0) - pz;
      if (ox * ox + oz * oz <= sc.range * sc.range) targets.push(o);
    });
    if (targets.length === 0) return false;
    // The blast grows with the area passive the same way the targeting range does.
    const radius = Math.max(0.5, (def.blast ?? 1.6) * (sc.range / Math.max(0.1, def.range)));
    const delay = Math.round(METEOR_FALL_SECONDS * w.tickRate);
    for (let i = 0; i < sc.count; i++) {
      const o = targets[Math.floor(nextRandom(w) * targets.length)] as number;
      friendlyHazard(w, pid, wi, T.x[o] ?? 0, T.z[o] ?? 0, radius, delay, sc.damage, sc.knockback);
    }
    return true;
  }
  return false;
}

/** A player's meteor: a circle that lands on enemies after `delay` ticks. */
function friendlyHazard(w: InternalWorld, pid: PlayerId, wi: number, x: number, z: number, r: number, delay: number, damage: number, knock: number): void {
  if (w.byNetId.size >= w.config.maxEntities - 32) return;
  const { SimState: S, Networked: N } = w.c;
  const G = w.c.Game;
  const p = spawnEntity(w, EntityKind.Projectile, [x, 0.05, z], { owner: pid, type: wi });
  S.flags[p] = EntityFlag.Elite;
  S.cooldown[p] = delay + 1;
  G.xp[p] = delay;
  G.stats[p] = Math.round(r * 100);
  G.value[p] = damage;
  G.revive[p] = Math.round(knock * 10);
  G.level[p] = teleWord(Telegraph.Circle, 0, r, true);
  w.events.push({ type: "entity.spawned", netId: N.netId[p] ?? 0, kind: EntityKind.Projectile });
}

/** Land players' meteors (projectiles with Elite and no Hostile). Call in combat, before lifetime. */
export function friendlyHazards(w: InternalWorld, near: Near, order: readonly number[]): void {
  const { Transform: T, Networked: N, SimState: S, Owner: O } = w.c;
  const G = w.c.Game;
  for (let k = 0; k < order.length; k++) {
    const p = order[k] as number;
    if (N.kind[p] !== EntityKind.Projectile || w.doomed.has(p)) continue;
    const flags = S.flags[p] ?? 0;
    if ((flags & EntityFlag.Elite) === 0 || (flags & EntityFlag.Hostile) !== 0) continue;
    const left = S.cooldown[p] ?? 0;
    const total = Math.max(1, G.xp[p] ?? 1);
    const r = (G.stats[p] ?? 100) / 100;
    G.level[p] = teleWord(Telegraph.Circle, 1 - (left - 1) / total, r, true);
    if (left > 1) continue;
    const x = T.x[p] ?? 0;
    const z = T.z[p] ?? 0;
    const pid = O.player[p] ?? 0;
    const dmg = G.value[p] ?? 1;
    const knock = (G.revive[p] ?? 0) / 10;
    tallyWeapon(w, G.type[p] ?? 0);
    near(x, z, r + w.maxEnemyRadius, (o) => {
      if (isFlag(w, o, EntityFlag.Dead)) return;
      const ox = (T.x[o] ?? 0) - x;
      const oz = (T.z[o] ?? 0) - z;
      const rr = r + enemyType(w, o).radius;
      if (ox * ox + oz * oz > rr * rr) return;
      hitEnemy(w, o, dmg, pid, ox, oz, knock);
    });
    w.doomed.add(p);
  }
}

/** Boomerangs fly out, then turn back at half their life (call before projectiles move). */
export function turnBoomerangs(w: InternalWorld, order: readonly number[]): void {
  const { Networked: N, SimState: S, Velocity: V } = w.c;
  const G = w.c.Game;
  const weapons = w.config.content.weapons;
  for (let k = 0; k < order.length; k++) {
    const p = order[k] as number;
    if (N.kind[p] !== EntityKind.Projectile || (S.flags[p] ?? 0) !== 0) continue;
    if (weapons[G.type[p] ?? 0]?.kind !== "boomerang") continue;
    const half = (G.stats[p] ?? 0) >> 1;
    if (half > 0 && (S.cooldown[p] ?? 0) === half) {
      V.x[p] = -(V.x[p] ?? 0);
      V.z[p] = -(V.z[p] ?? 0);
      // It may hit the same enemies again on the way back.
      G.xp[p] = 0;
    }
  }
}
