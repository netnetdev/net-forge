/**
 * Arena mode: the genre machinery of the arena shooter template
 * ("loadouts, respawn, scoreboard for arena").
 * Enabled by `content.arena.enabled`.
 *
 *  - Twin-stick control: `moveX`/`moveZ` move in the world frame (yaw 0:
 *    moveX is +x, moveZ is -z) and `yaw` is the aim.
 *  - A loadout of up to four weapons; Choice1..3 pick a slot, Alt cycles,
 *    Fire fires the selected slot when its cooldown is ready.
 *  - Players hurt each other. A killed player drops a heal cell, waits
 *    `respawnTicks`, then respawns at the spawn point farthest from every
 *    opponent with a short invulnerability (firing ends it).
 *  - Beams are hitscans. On a room server human beams are resolved by the
 *    room's lag-compensated rewind (`beamShot` + `applyBeamHit`); bots and
 *    the headless harness resolve them here, against the present.
 *
 * Deterministic like the rest of the sim: integer state, netId-ordered
 * loops, no world PRNG in the per-player paths, so a predicting client and
 * the server agree on movement, aim, weapon choice and cooldowns.
 */
import RAPIER from "@dimforge/rapier3d-deterministic-compat";
import { BOT_PLAYER_BASE, Button, EntityFlag, EntityKind } from "./api.js";
import type { InputCommand, NetId, PlayerId, ResolvedSimConfig, WeaponDef } from "./api.js";
import { derivedStats, enemyType, hitEnemy, isFlag, isUp, setByte, slotByte, slotWeapon, sortedPlayers } from "./content.js";
import { quantizeInput } from "./input.js";
import { liveOrder, QUERY_LEVEL_ONLY, spawnEntity } from "./world.js";
import type { InternalWorld } from "./world.js";

/** Projectile hit radius, m, and the height projectiles fly at. */
export const ARENA_BOLT_RADIUS = 0.2;
const BOLT_HEIGHT = 1.0;
/** Extra reach of a player's hitbox over their capsule radius, m (beams and the rewind buffer). */
export const ARENA_HITBOX_PAD = 0.2;
/** Pickup collect radius, m. */
const PICKUP_COLLECT = 0.9;

/** The selected weapon slot (0..3) in a player's packed `choices` field (arena mode). */
export const selectedSlot = (choices: number): number => choices & 3;

/** The slot a press selects: Choice1..3 pick slots 1..3 (if armed), Alt cycles to the next armed slot. */
function selectSlot(weapons: number, current: number, pressed: number): number {
  let slot = current;
  if ((pressed & Button.Choice1) !== 0) slot = 0;
  else if ((pressed & Button.Choice2) !== 0) slot = 1;
  else if ((pressed & Button.Choice3) !== 0) slot = 2;
  else if ((pressed & Button.Alt) !== 0) {
    for (let k = 1; k <= 4; k++) {
      const s = (current + k) % 4;
      if (slotWeapon(weapons, s) >= 0) {
        slot = s;
        break;
      }
    }
  }
  return slotWeapon(weapons, slot) >= 0 ? slot : current;
}

/**
 * The slot this command fires this tick, or -1. Pure: the room's
 * lag-compensation hook asks it BEFORE the step, the step asks it again,
 * and both see the same answer.
 */
function fireDecision(w: InternalWorld, eid: number, cmd: InputCommand, prevButtons: number): number {
  const G = w.c.Game;
  const weapons = G.weapons[eid] ?? 0;
  const slot = selectSlot(weapons, selectedSlot(G.choices[eid] ?? 0), cmd.buttons & ~prevButtons);
  if (!isUp(w, eid) || (cmd.buttons & Button.Fire) === 0 || slotWeapon(weapons, slot) < 0) return -1;
  // Cooldowns tick down before the fire check.
  return slotByte(G.wcd[eid] ?? 0, slot) <= 1 ? slot : -1;
}

/** Damage and cooldown of a weapon for a player's passives (might, haste). */
function scaled(w: InternalWorld, eid: number, def: WeaponDef): { damage: number; cooldown: number } {
  const ds = derivedStats(w, eid);
  return {
    damage: Math.max(1, Math.round(def.damage * ds.might)),
    cooldown: Math.min(255, Math.max(1, Math.round(def.cooldownTicks * ds.haste))),
  };
}

const aimX = (yaw: number) => -Math.sin(yaw);
const aimZ = (yaw: number) => -Math.cos(yaw);

// ------------------------------------------------------------ input

export function arenaInput(w: InternalWorld, eid: number, cmd: InputCommand, prevButtons: number): void {
  const { Transform: T, Velocity: V, SimState: S } = w.c;
  const G = w.c.Game;
  const coop = w.config.content.coop;
  const fireSlot = fireDecision(w, eid, cmd, prevButtons);
  const pressed = cmd.buttons & ~prevButtons;

  let wcd = G.wcd[eid] ?? 0;
  for (let s = 0; s < 4; s++) {
    const cd = slotByte(wcd, s);
    if (cd > 0) wcd = setByte(wcd, s, cd - 1);
  }
  G.wcd[eid] = wcd;
  // Weapon choice works while dead, so you respawn holding what you picked.
  G.choices[eid] = selectSlot(G.weapons[eid] ?? 0, selectedSlot(G.choices[eid] ?? 0), pressed);

  if (!isUp(w, eid)) {
    V.x[eid] = 0;
    V.z[eid] = 0;
    G.dash[eid] = 0;
    S.flags[eid] = (S.flags[eid] ?? 0) & ~EntityFlag.Dashing;
    return;
  }
  T.yaw[eid] = cmd.yaw;

  let dash = G.dash[eid] ?? 0;
  let dashTicks = dash & 0xff;
  let dashCd = (dash >>> 8) & 0xff;
  let dashBuf = (dash >>> 16) & 0xff;
  if ((pressed & Button.Sprint) !== 0) dashBuf = coop.dashBufferTicks + 1;
  if (dashBuf > 0 && dashCd === 0 && dashTicks === 0 && coop.dashTicks > 0) {
    dashTicks = coop.dashTicks;
    dashCd = coop.dashCooldownTicks;
    dashBuf = 0;
    G.iframes[eid] = Math.max(G.iframes[eid] ?? 0, coop.dashTicks);
  }
  let vx = cmd.moveX;
  let vz = -cmd.moveZ;
  const len = Math.hypot(vx, vz);
  if (len > 1) {
    vx /= len;
    vz /= len;
  }
  if (dashTicks > 0 && vx === 0 && vz === 0) {
    vx = aimX(cmd.yaw);
    vz = aimZ(cmd.yaw);
  }
  const speed = w.config.player.speed * derivedStats(w, eid).speedMul * (dashTicks > 0 ? coop.dashSpeed : 1);
  V.x[eid] = vx * speed;
  V.z[eid] = vz * speed;
  S.flags[eid] = dashTicks > 0 ? (S.flags[eid] ?? 0) | EntityFlag.Dashing : (S.flags[eid] ?? 0) & ~EntityFlag.Dashing;
  if (dashTicks > 0) dashTicks--;
  if (dashCd > 0) dashCd--;
  if (dashBuf > 0) dashBuf--;
  dash = dashTicks | (dashCd << 8) | (dashBuf << 16);
  G.dash[eid] = dash;

  if (fireSlot >= 0) fire(w, eid, fireSlot);
}

// ------------------------------------------------------------ firing

function fire(w: InternalWorld, eid: number, slot: number): void {
  const { Transform: T, Velocity: V, SimState: S, Networked: N } = w.c;
  const G = w.c.Game;
  const content = w.config.content;
  const wi = slotWeapon(G.weapons[eid] ?? 0, slot);
  const def = content.weapons[wi];
  if (!def) return;
  const pid = w.c.Owner.player[eid] ?? 0;
  const sc = scaled(w, eid, def);
  G.wcd[eid] = setByte(G.wcd[eid] ?? 0, slot, sc.cooldown);
  // Firing ends spawn protection (and a dash's dodge).
  G.iframes[eid] = 0;
  w.events.push({ type: "player.shot", playerId: pid, netId: N.netId[eid] ?? 0, slot });
  if (!content.arena.authority) return;
  const px = T.x[eid] ?? 0;
  const pz = T.z[eid] ?? 0;
  const yaw = T.yaw[eid] ?? 0;
  if (def.kind === "blaster") {
    const muzzle = w.config.player.radius + 0.25;
    const life = Math.min(255, Math.max(1, Math.ceil((def.range / Math.max(1, def.speed)) * w.tickRate)));
    const spread = def.spread ?? 0;
    for (let b = 0; b < def.count; b++) {
      if (w.byNetId.size >= w.config.maxEntities - 8) break;
      const a = yaw + (def.count > 1 ? (b / (def.count - 1) - 0.5) * spread : 0);
      const dx = aimX(a);
      const dz = aimZ(a);
      const p = spawnEntity(w, EntityKind.Projectile, [px + dx * muzzle, BOLT_HEIGHT, pz + dz * muzzle], { owner: pid, type: wi });
      V.x[p] = dx * def.speed;
      V.z[p] = dz * def.speed;
      T.yaw[p] = a;
      G.value[p] = sc.damage;
      G.level[p] = def.pierce;
      G.xp[p] = 0;
      S.cooldown[p] = life;
      w.events.push({ type: "entity.spawned", netId: N.netId[p] ?? 0, kind: EntityKind.Projectile });
    }
  } else if (def.kind === "beam") {
    if (content.arena.externalHitscan && pid < BOT_PLAYER_BASE) return; // the room's rewind resolves it
    const dx = aimX(yaw);
    const dz = aimZ(yaw);
    const range = beamRange(w.config, px, pz, dx, dz, def.range);
    const hit = rayTarget(w, pid, px, pz, dx, dz, range);
    if (hit >= 0) damageEntity(w, hit, sc.damage, pid, dx, dz, def.knockback);
  } else if (def.kind === "nova") {
    const r2 = def.range * def.range;
    for (const [opid, o] of sortedPlayers(w)) {
      if (opid === pid || !isUp(w, o)) continue;
      const ox = (T.x[o] ?? 0) - px;
      const oz = (T.z[o] ?? 0) - pz;
      if (ox * ox + oz * oz <= r2) damagePlayer(w, o, sc.damage, pid);
    }
    for (const o of [...liveOrder(w)]) {
      if (N.kind[o] !== EntityKind.Enemy || isFlag(w, o, EntityFlag.Dead)) continue;
      const ox = (T.x[o] ?? 0) - px;
      const oz = (T.z[o] ?? 0) - pz;
      if (ox * ox + oz * oz <= r2) hitEnemy(w, o, sc.damage, pid, ox, oz, def.knockback);
    }
  }
}

/** Distance along a unit ray to a circle, or null. */
function rayCircle(ox: number, oz: number, ux: number, uz: number, cx: number, cz: number, r: number): number | null {
  const mx = ox - cx;
  const mz = oz - cz;
  const b = mx * ux + mz * uz;
  const c = mx * mx + mz * mz - r * r;
  if (c > 0 && b > 0) return null;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}

/**
 * How far a beam from (x, z) along the unit (dx, dz) reaches before a
 * pillar or the arena wall stops it, capped at `range`. Clients draw beams
 * with it; the server clamps hitscans with it.
 */
export function beamRange(config: ResolvedSimConfig, x: number, z: number, dx: number, dz: number, range: number): number {
  let best = range;
  const h = config.arena.halfExtent;
  if (dx > 1e-9) best = Math.min(best, (h - x) / dx);
  else if (dx < -1e-9) best = Math.min(best, (-h - x) / dx);
  if (dz > 1e-9) best = Math.min(best, (h - z) / dz);
  else if (dz < -1e-9) best = Math.min(best, (-h - z) / dz);
  for (const p of config.arena.pillars) {
    const t = rayCircle(x, z, dx, dz, p.x, p.z, p.radius);
    if (t !== null && t < best) best = t;
  }
  return Math.max(0, best);
}

/** The nearest opponent (player or enemy) a ray hits within `range`, or -1. Present positions. */
function rayTarget(w: InternalWorld, shooter: PlayerId, x: number, z: number, dx: number, dz: number, range: number): number {
  const { Transform: T, Networked: N } = w.c;
  let best = -1;
  let bestT = range;
  const pr = w.config.player.radius + ARENA_HITBOX_PAD;
  for (const [pid, eid] of sortedPlayers(w)) {
    if (pid === shooter || !isUp(w, eid)) continue;
    const t = rayCircle(x, z, dx, dz, T.x[eid] ?? 0, T.z[eid] ?? 0, pr);
    if (t !== null && t <= bestT) {
      bestT = t;
      best = eid;
    }
  }
  if (w.enemyCount - w.corpseCount > 0) {
    for (const eid of liveOrder(w)) {
      if (N.kind[eid] !== EntityKind.Enemy || isFlag(w, eid, EntityFlag.Dead)) continue;
      const t = rayCircle(x, z, dx, dz, T.x[eid] ?? 0, T.z[eid] ?? 0, enemyType(w, eid).radius);
      if (t !== null && t < bestT) {
        bestT = t;
        best = eid;
      }
    }
  }
  return best;
}

/** Damage a player or an enemy (by ECS id), credited to `by`. */
function damageEntity(w: InternalWorld, eid: number, damage: number, by: PlayerId, dx: number, dz: number, knock: number): void {
  const kind = w.c.Networked.kind[eid];
  if (kind === EntityKind.Player) damagePlayer(w, eid, damage, by);
  else if (kind === EntityKind.Enemy) hitEnemy(w, eid, damage, by, dx, dz, knock);
}

// ------------------------------------------------------------ damage, death

/** Hurt a player (no self damage; invulnerable players and the dead take none). Returns true when it killed. */
export function damagePlayer(w: InternalWorld, eid: number, damage: number, by: PlayerId): boolean {
  const { Health: H, Networked: N } = w.c;
  const G = w.c.Game;
  const pid = w.c.Owner.player[eid] ?? 0;
  if (!isUp(w, eid) || (G.iframes[eid] ?? 0) > 0 || (by !== 0 && by === pid)) return false;
  const hit = Math.max(1, Math.round(damage) - derivedStats(w, eid).armor);
  const hp = Math.max(0, (H.hp[eid] ?? 0) - hit);
  H.hp[eid] = hp;
  const attacker = by > 0 ? w.players.get(by) : undefined;
  w.events.push({ type: "player.hit", playerId: pid, netId: N.netId[eid] ?? 0, by: attacker !== undefined ? (N.netId[attacker] ?? 0) : 0, damage: hit, health: hp });
  if (hp > 0) return false;
  killPlayer(w, eid, pid, by);
  return true;
}

function killPlayer(w: InternalWorld, eid: number, pid: PlayerId, by: PlayerId): void {
  const { Transform: T, Velocity: V, SimState: S, Networked: N } = w.c;
  const G = w.c.Game;
  const arena = w.config.content.arena;
  S.flags[eid] = ((S.flags[eid] ?? 0) | EntityFlag.Dead) & ~(EntityFlag.Dashing | EntityFlag.Downed);
  S.cooldown[eid] = arena.respawnTicks;
  V.x[eid] = V.y[eid] = V.z[eid] = 0;
  G.dash[eid] = 0;
  G.iframes[eid] = 0;
  const netId = N.netId[eid] ?? 0;
  w.events.push({ type: "player.killed", playerId: pid, netId, by: by === pid ? 0 : by });
  w.events.push({ type: "player.died", playerId: pid, netId });
  if (!arena.authority || arena.dropHeal <= 0) return;
  if (w.pickupCount >= w.config.content.progression.maxPickups || w.byNetId.size >= w.config.maxEntities - 8) return;
  const tier = arena.dropHeal >= 25 ? 2 : arena.dropHeal >= 5 ? 1 : 0;
  const g = spawnEntity(w, EntityKind.Pickup, [T.x[eid] ?? 0, 0.3, T.z[eid] ?? 0], { type: tier });
  G.value[g] = arena.dropHeal;
  S.cooldown[g] = arena.pickupTicks;
  w.events.push({ type: "entity.spawned", netId: N.netId[g] ?? 0, kind: EntityKind.Pickup });
}

// ------------------------------------------------------------ combat (authority)

export function arenaCombat(
  w: InternalWorld,
  forEnemiesNear: (x: number, z: number, r: number, fn: (eid: number) => boolean | void) => void,
): void {
  if (!w.config.content.arena.authority) return;
  const { Transform: T, Velocity: V, Networked: N, SimState: S } = w.c;
  const G = w.c.Game;
  const P = w.config.player;
  const content = w.config.content;
  const dt = w.dt;
  const players = sortedPlayers(w);
  const reach = P.radius + ARENA_BOLT_RADIUS;

  for (const eid of liveOrder(w)) {
    if (N.kind[eid] === EntityKind.Enemy && (S.cooldown[eid] ?? 0) > 0 && !isFlag(w, eid, EntityFlag.Dead)) S.cooldown[eid] = (S.cooldown[eid] ?? 0) - 1;
  }

  // Projectiles: swept from last tick's position, so a fast bolt cannot tunnel through a player.
  const order = [...liveOrder(w)];
  for (const p of order) {
    if (N.kind[p] !== EntityKind.Projectile || w.doomed.has(p)) continue;
    const x1 = T.x[p] ?? 0;
    const z1 = T.z[p] ?? 0;
    const vx = V.x[p] ?? 0;
    const vz = V.z[p] ?? 0;
    const step = Math.hypot(vx, vz) * dt;
    if (step < 1e-9) continue;
    const ux = vx / Math.hypot(vx, vz);
    const uz = vz / Math.hypot(vx, vz);
    const x0 = x1 - ux * step;
    const z0 = z1 - uz * step;
    const owner = w.c.Owner.player[p] ?? 0;
    const last = G.xp[p] ?? 0;
    let hit = -1;
    let hitT = step;
    for (const [pid, eid] of players) {
      if (pid === owner || !isUp(w, eid) || (N.netId[eid] ?? 0) === last) continue;
      const t = rayCircle(x0, z0, ux, uz, T.x[eid] ?? 0, T.z[eid] ?? 0, reach);
      if (t !== null && t <= hitT) {
        hitT = t;
        hit = eid;
      }
    }
    if (w.enemyCount - w.corpseCount > 0) {
      forEnemiesNear(x1, z1, step + ARENA_BOLT_RADIUS + w.maxEnemyRadius, (o) => {
        if (isFlag(w, o, EntityFlag.Dead) || (N.netId[o] ?? 0) === last) return;
        const t = rayCircle(x0, z0, ux, uz, T.x[o] ?? 0, T.z[o] ?? 0, ARENA_BOLT_RADIUS + enemyType(w, o).radius);
        if (t !== null && t < hitT) {
          hitT = t;
          hit = o;
        }
      });
    }
    // A pillar in the way stops the bolt before anything behind it.
    let blocked = false;
    for (const pl of w.config.arena.pillars) {
      const t = rayCircle(x0, z0, ux, uz, pl.x, pl.z, pl.radius + ARENA_BOLT_RADIUS * 0.5);
      if (t !== null && t < hitT) {
        hitT = t;
        blocked = true;
      }
    }
    if (blocked) {
      T.x[p] = x0 + ux * hitT;
      T.z[p] = z0 + uz * hitT;
      w.doomed.add(p);
      continue;
    }
    if (hit < 0) continue;
    const def = content.weapons[G.type[p] ?? 0];
    G.xp[p] = N.netId[hit] ?? 0;
    damageEntity(w, hit, G.value[p] ?? 0, owner, vx, vz, def?.knockback ?? 0);
    const pierce = (G.level[p] ?? 0) - 1;
    if (pierce < 0) {
      T.x[p] = x0 + ux * hitT;
      T.z[p] = z0 + uz * hitT;
      w.doomed.add(p);
    } else G.level[p] = pierce;
  }

  // Enemies (if a game adds any) hurt players they touch.
  if (w.enemyCount - w.corpseCount > 0) {
    for (const [, pe] of players) {
      if (!isUp(w, pe) || (G.iframes[pe] ?? 0) > 0) continue;
      const px = T.x[pe] ?? 0;
      const pz = T.z[pe] ?? 0;
      forEnemiesNear(px, pz, P.radius + w.maxEnemyRadius + 0.05, (o) => {
        if (isFlag(w, o, EntityFlag.Dead) || (S.cooldown[o] ?? 0) > 0) return;
        const def = enemyType(w, o);
        if (def.damage <= 0) return;
        const ox = (T.x[o] ?? 0) - px;
        const oz = (T.z[o] ?? 0) - pz;
        const r = P.radius + def.radius + 0.05;
        if (ox * ox + oz * oz > r * r) return;
        S.cooldown[o] = w.config.enemies.contactCooldownTicks;
        if (damagePlayer(w, pe, def.damage, 0)) return false;
      });
    }
  }
}

// ------------------------------------------------------------ pickups (authority)

/** Heal cells: walking over one restores its value, if you are hurt. */
export function arenaPickups(w: InternalWorld): void {
  if (!w.config.content.arena.authority || w.pickupCount === 0) return;
  const { Transform: T, Networked: N, Health: H } = w.c;
  const up: number[] = [];
  for (const [, eid] of sortedPlayers(w)) if (isUp(w, eid)) up.push(eid);
  for (const g of liveOrder(w)) {
    if (N.kind[g] !== EntityKind.Pickup || w.doomed.has(g)) continue;
    const x = T.x[g] ?? 0;
    const z = T.z[g] ?? 0;
    for (const pe of up) {
      const ox = (T.x[pe] ?? 0) - x;
      const oz = (T.z[pe] ?? 0) - z;
      if (ox * ox + oz * oz > PICKUP_COLLECT * PICKUP_COLLECT) continue;
      const max = derivedStats(w, pe).maxHealth;
      const hp = H.hp[pe] ?? 0;
      if (hp >= max) continue;
      H.hp[pe] = Math.min(max, hp + (w.c.Game.value[g] ?? 0));
      w.doomed.add(g);
      break;
    }
  }
}

// ------------------------------------------------------------ rules

/** Spawn protection and regen tick; the dead count down and (authority) respawn. */
export function arenaRules(w: InternalWorld): void {
  const { SimState: S, Health: H } = w.c;
  const G = w.c.Game;
  const arena = w.config.content.arena;
  for (const [pid, eid] of sortedPlayers(w)) {
    if ((G.iframes[eid] ?? 0) > 0) G.iframes[eid] = (G.iframes[eid] ?? 0) - 1;
    const flags = S.flags[eid] ?? 0;
    if ((flags & EntityFlag.Dead) !== 0) {
      const cd = Math.max(0, (S.cooldown[eid] ?? 0) - 1);
      S.cooldown[eid] = cd;
      if (cd === 0 && arena.authority) respawn(w, eid, pid);
      continue;
    }
    const ds = derivedStats(w, eid);
    if (ds.regen > 0 && w.tick % w.tickRate === 0) H.hp[eid] = Math.min(ds.maxHealth, (H.hp[eid] ?? 0) + ds.regen);
    if ((H.hp[eid] ?? 0) > ds.maxHealth) H.hp[eid] = ds.maxHealth;
  }
}

/** Pickups expire (arena heal cells only). */
export function arenaLifetime(w: InternalWorld): void {
  if (w.pickupCount === 0) return;
  const { Networked: N, SimState: S } = w.c;
  for (const eid of liveOrder(w)) {
    if (N.kind[eid] !== EntityKind.Pickup) continue;
    const cd = (S.cooldown[eid] ?? 0) - 1;
    S.cooldown[eid] = Math.max(0, cd);
    if (cd <= 0) w.doomed.add(eid);
  }
}

/** A spawn never lands within this many metres of a living opponent when anywhere else is free, m. */
export const ARENA_SPAWN_CLEAR = 12;
/** Opponents farther than this cannot threaten a spawn even with a clear line, m. */
const SPAWN_SIGHT = 36;
/** Eye height of the sight lines a spawn is checked with, m (pillars are taller). */
const SIGHT_HEIGHT = 1.2;

/**
 * Is the straight line between two points on the floor clear of the level
 * (pillars and walls)? A physics raycast against the level colliders only.
 */
export function levelLineClear(w: InternalWorld, x0: number, z0: number, x1: number, z1: number): boolean {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return true;
  const ray = new RAPIER.Ray({ x: x0, y: SIGHT_HEIGHT, z: z0 }, { x: dx / len, y: 0, z: dz / len });
  return w.physics.castRay(ray, len, true, undefined, QUERY_LEVEL_ONLY) === null;
}

/** Floor points a spawn may use when no declared spawn is safe: a 4 m grid, 1 m inside the walls and clear of pillars. */
function fallbackSpawns(w: InternalWorld): readonly (readonly [number, number])[] {
  const cached = fallbackCache.get(w);
  if (cached) return cached;
  const h = w.config.arena.halfExtent;
  const r = w.config.player.radius;
  const out: [number, number][] = [];
  for (let x = -h + 2; x <= h - 2; x += 4) {
    for (let z = -h + 2; z <= h - 2; z += 4) {
      if (w.config.arena.pillars.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < (p.radius + r + 1) ** 2)) continue;
      out.push([x, z]);
    }
  }
  fallbackCache.set(w, out);
  return out;
}
const fallbackCache = new WeakMap<InternalWorld, readonly (readonly [number, number])[]>();

/**
 * Where `pid` spawns: a declared spawn point no living opponent can see
 * (physics raycasts against the level) and at least ARENA_SPAWN_CLEAR m
 * from all of them, the farthest such. When no declared point qualifies, a
 * floor grid point that does; failing that, the least exposed and farthest
 * point. Ties go to the first, counting from a point that depends on the
 * player id, so an empty arena spreads players out.
 */
export function arenaSpawnPoint(w: InternalWorld, pid: PlayerId): [number, number] {
  const { Transform: T } = w.c;
  const [sx, , sz] = w.config.arena.spawn;
  const spawns = w.config.content.arena.spawns;
  if (spawns.length === 0) return [sx, sz];
  const foes: [number, number][] = [];
  for (const [opid, eid] of sortedPlayers(w)) if (opid !== pid && isUp(w, eid)) foes.push([T.x[eid] ?? 0, T.z[eid] ?? 0]);
  const rate = (x: number, z: number): { near: number; seen: number } => {
    let near = 1e12;
    let seen = 0;
    for (const [fx, fz] of foes) {
      const d2 = (fx - x) ** 2 + (fz - z) ** 2;
      near = Math.min(near, d2);
      if (d2 < SPAWN_SIGHT * SPAWN_SIGHT && levelLineClear(w, fx, fz, x, z)) seen++;
    }
    return { near, seen };
  };
  const clear2 = ARENA_SPAWN_CLEAR * ARENA_SPAWN_CLEAR;
  // Declared spawns first: the farthest safe one.
  let best: readonly [number, number] = spawns[pid % spawns.length] ?? [sx, sz];
  let bestKey = -Infinity;
  for (let k = 0; k < spawns.length; k++) {
    const s = spawns[(pid + k) % spawns.length];
    if (!s) continue;
    const r = rate(s[0], s[1]);
    // Unseen and clear beats everything; then fewer eyes on it, then distance.
    const key = (r.seen === 0 && r.near >= clear2 ? 1e9 : 0) - r.seen * 1e6 + Math.min(r.near, 1e5);
    if (key > bestKey) {
      bestKey = key;
      best = s;
    }
  }
  if (bestKey >= 1e9) return [best[0], best[1]];
  // No declared spawn is safe: any floor point that is.
  const grid = fallbackSpawns(w);
  for (let k = 0; k < grid.length; k++) {
    const s = grid[(pid * 7 + k) % grid.length];
    if (!s) continue;
    const r = rate(s[0], s[1]);
    const key = (r.seen === 0 && r.near >= clear2 ? 1e9 : 0) - r.seen * 1e6 + Math.min(r.near, 1e5);
    if (key > bestKey) {
      bestKey = key;
      best = s;
    }
  }
  return [best[0], best[1]];
}

function respawn(w: InternalWorld, eid: number, pid: PlayerId): void {
  const { Transform: T, Velocity: V, SimState: S, Health: H, Networked: N } = w.c;
  const G = w.c.Game;
  const [x, z] = arenaSpawnPoint(w, pid);
  const y = w.config.arena.spawn[1];
  T.x[eid] = T.px[eid] = x;
  T.y[eid] = T.py[eid] = y;
  T.z[eid] = T.pz[eid] = z;
  V.x[eid] = V.y[eid] = V.z[eid] = 0;
  w.colliders.get(eid)?.setTranslation({ x, y, z });
  S.flags[eid] = 0;
  S.cooldown[eid] = 0;
  S.timers[eid] = 0;
  G.wcd[eid] = 0;
  G.dash[eid] = 0;
  G.iframes[eid] = w.config.content.arena.spawnIframeTicks;
  H.hp[eid] = derivedStats(w, eid).maxHealth;
  w.events.push({ type: "player.respawned", playerId: pid, netId: N.netId[eid] ?? 0 });
}

// ------------------------------------------------------------ lag compensation seam

/** A human's beam this tick, for the room's rewind. */
export interface BeamShot {
  readonly shooter: PlayerId;
  readonly x: number;
  readonly z: number;
  /** Unit aim direction. */
  readonly dx: number;
  readonly dz: number;
  /** Clamped by pillars and walls. */
  readonly range: number;
  readonly damage: number;
  readonly knockback: number;
}

/**
 * Does `cmd` fire a beam this tick? Call BEFORE `step` with the command the
 * step will consume. Only for rooms that resolve beams externally
 * (`arena.externalHitscan`) and human players; otherwise null.
 */
export function beamShotFor(w: InternalWorld, playerId: PlayerId, raw: InputCommand): BeamShot | null {
  const arena = w.config.content.arena;
  if (!arena.enabled || !arena.externalHitscan || playerId >= BOT_PLAYER_BASE) return null;
  const eid = w.players.get(playerId);
  if (eid === undefined) return null;
  const cmd = quantizeInput(raw);
  const slot = fireDecision(w, eid, cmd, w.c.SimState.buttons[eid] ?? 0);
  if (slot < 0) return null;
  const def = w.config.content.weapons[slotWeapon(w.c.Game.weapons[eid] ?? 0, slot)];
  if (!def || def.kind !== "beam") return null;
  const x = w.c.Transform.x[eid] ?? 0;
  const z = w.c.Transform.z[eid] ?? 0;
  const dx = aimX(cmd.yaw);
  const dz = aimZ(cmd.yaw);
  return { shooter: playerId, x, z, dx, dz, range: beamRange(w.config, x, z, dx, dz, def.range), damage: scaled(w, eid, def).damage, knockback: def.knockback };
}

/** Apply a resolved beam hit to the entity with `target` NetId. */
export function applyBeamHitTo(w: InternalWorld, shot: BeamShot, target: NetId): void {
  const eid = w.byNetId.get(target);
  if (eid === undefined) return;
  damageEntity(w, eid, shot.damage, shot.shooter, shot.dx, shot.dz, shot.knockback);
}

/** What the rewind buffer records each tick: living players and enemies. */
export interface ArenaHitbox {
  readonly netId: NetId;
  readonly owner: PlayerId;
  readonly x: number;
  readonly z: number;
  readonly r: number;
}

export function arenaHitboxesOf(w: InternalWorld): ArenaHitbox[] {
  const { Transform: T, Networked: N } = w.c;
  const out: ArenaHitbox[] = [];
  const pr = w.config.player.radius + ARENA_HITBOX_PAD;
  for (const [pid, eid] of sortedPlayers(w)) {
    if (isUp(w, eid)) out.push({ netId: N.netId[eid] ?? 0, owner: pid, x: T.x[eid] ?? 0, z: T.z[eid] ?? 0, r: pr });
  }
  if (w.enemyCount - w.corpseCount > 0) {
    for (const eid of liveOrder(w)) {
      if (N.kind[eid] !== EntityKind.Enemy || isFlag(w, eid, EntityFlag.Dead)) continue;
      out.push({ netId: N.netId[eid] ?? 0, owner: 0, x: T.x[eid] ?? 0, z: T.z[eid] ?? 0, r: enemyType(w, eid).radius });
    }
  }
  return out;
}

/** Grant one level of passive `stat` index for the rest of the run (a store upgrade). False when absent or maxed. */
export function grantStatLevel(w: InternalWorld, eid: number, index: number): boolean {
  const def = w.config.content.stats[index];
  if (!def) return false;
  const G = w.c.Game;
  const lvl = ((G.stats[eid] ?? 0) >>> (index * 4)) & 0x0f;
  if (lvl >= def.maxLevel) return false;
  const before = derivedStats(w, eid).maxHealth;
  G.stats[eid] = (((G.stats[eid] ?? 0) & ~(0x0f << (index * 4))) | ((lvl + 1) << (index * 4))) >>> 0;
  const after = derivedStats(w, eid).maxHealth;
  if (after > before && isUp(w, eid)) w.c.Health.hp[eid] = (w.c.Health.hp[eid] ?? 0) + (after - before);
  return true;
}
