/**
 * Public, server-side run control and read helpers for content mode. Game
 * runners (waves, bosses, run resets) call these between steps; clients use
 * the pure decoders to draw HUDs from snapshot fields.
 */
import { EntityFlag, EntityKind } from "./api.js";
import type { InputCommand, NetId, PlayerId, PlayerSummary, ResolvedSimConfig, SimWorld, SpawnScale } from "./api.js";
import { applyBeamHitTo, arenaHitboxesOf, arenaSpawnPoint, beamShotFor, grantStatLevel } from "./arena.js";
import type { ArenaHitbox, BeamShot } from "./arena.js";
import {
  addXp,
  buffTicksOf,
  selfRevivesLeft,
  contentPaused,
  decodeChoices,
  derivedStats,
  keeperOf,
  slotLevel,
  slotWeapon,
  statLevel,
  xpToNext,
  edgePoint,
  isUp,
  onAnyScreen,
  raise,
  recycleStragglers,
  resetRunState,
  respawnDeadPlayers,
  ringPoint,
  ringSpot,
  sortedPlayers,
  spawnEnemyAt,
  upPlayers,
  viewRadius,
  xpCurve,
} from "./content.js";
import { nextRandom } from "./rng.js";
import { removeAll, scatterProps, setXpBoost as setBoost, spawnSpecial } from "./pickups.js";
import { internal, liveOrder } from "./world.js";
import type { MetaBonus } from "./world.js";
import { tallyFor } from "./tally.js";

export { decodeChoices, orbitAngle, slotLevel, slotWeapon, statLevel, ORBIT_BLADE_RADIUS, ORBIT_HIT_EVERY } from "./content.js";

/** Spawn an enemy of `type` (index into `content.enemyTypes`) at (x, z). Returns its NetId. */
export function spawnEnemy(world: SimWorld, type: number, x: number, z: number): NetId {
  const w = internal(world);
  const eid = spawnEnemyAt(w, type, x, z);
  return w.c.Networked.netId[eid] ?? 0;
}

/** Living (non-corpse) enemies, of one type or all. */
export function enemyCount(world: SimWorld, type?: number): number {
  const w = internal(world);
  if (type !== undefined) return w.typeCount[type] ?? 0;
  // Props (urns, lanterns) are not enemies: they never count toward the crowd or the director's cap.
  let props = 0;
  w.config.content.enemyTypes.forEach((t, i) => {
    if (t.prop) props += w.typeCount[i] ?? 0;
  });
  return w.enemyCount - w.corpseCount - props;
}

/** Room left under `maxEntities` (spawners should stop before 0). */
export function entityHeadroom(world: SimWorld): number {
  const w = internal(world);
  return w.config.maxEntities - w.byNetId.size;
}

/** Every player, in playerId order. */
export function listPlayers(world: SimWorld): PlayerSummary[] {
  const w = internal(world);
  const { Transform: T, Networked: N, Health: H, SimState: S, Game: G } = w.c;
  return sortedPlayers(w).map(([playerId, eid]) => {
    const flags = S.flags[eid] ?? 0;
    return {
      playerId,
      netId: N.netId[eid] ?? 0,
      x: T.x[eid] ?? 0,
      y: T.y[eid] ?? 0,
      z: T.z[eid] ?? 0,
      health: H.hp[eid] ?? 0,
      maxHealth: w.config.content.enabled ? derivedStats(w, eid).maxHealth : w.config.player.maxHealth,
      level: G.level[eid] ?? 0,
      up: isUp(w, eid),
      downed: (flags & EntityFlag.Downed) !== 0,
      dead: (flags & EntityFlag.Dead) !== 0,
      slot: (G.choices[eid] ?? 0) & 3,
      keeper: keeperOf(w, eid),
      buffed: w.config.content.enabled && buffTicksOf(w, eid) > 0,
      selfRevives: w.config.content.enabled ? selfRevivesLeft(w, eid) : 0,
    };
  });
}

/** One player's build this run: weapons (with levels), passives, keeper, and damage per weapon index. */
export interface PlayerBuild {
  readonly keeper: number;
  readonly weapons: readonly { readonly index: number; readonly level: number }[];
  readonly stats: readonly { readonly index: number; readonly level: number }[];
  /** Damage dealt per weapon index this run (authority worlds only; missing entries are 0). */
  readonly damage: readonly number[];
}

export function playerBuild(world: SimWorld, playerId: PlayerId): PlayerBuild | null {
  const w = internal(world);
  const eid = w.players.get(playerId);
  if (eid === undefined) return null;
  const G = w.c.Game;
  const packed = G.weapons[eid] ?? 0;
  const weapons: { index: number; level: number }[] = [];
  for (let s = 0; s < 4; s++) {
    const index = slotWeapon(packed, s);
    if (index >= 0) weapons.push({ index, level: slotLevel(packed, s) });
  }
  const stats: { index: number; level: number }[] = [];
  w.config.content.stats.forEach((_, i) => {
    const level = statLevel(G.stats[eid] ?? 0, i);
    if (level > 0) stats.push({ index: i, level });
  });
  return { keeper: keeperOf(w, eid), weapons, stats, damage: [...tallyFor(w, playerId)] };
}

/**
 * Raise a player by `levels` levels now (a late joiner catching up): each
 * level arrives as if from gems, with its card pending. Returns the levels granted.
 */
export function grantLevels(world: SimWorld, playerId: PlayerId, levels: number): number {
  const w = internal(world);
  const eid = w.players.get(playerId);
  if (eid === undefined || !w.config.content.enabled) return 0;
  const G = w.c.Game;
  const n = Math.max(0, Math.min(200, Math.floor(levels)));
  for (let i = 0; i < n; i++) addXp(w, eid, Math.max(1, xpToNext(w, G.level[eid] ?? 1) - (G.xp[eid] ?? 0)));
  return n;
}

/** Cards a player has waiting (level-ups not yet picked). */
export function pendingCards(world: SimWorld, playerId: PlayerId): number {
  const w = internal(world);
  const eid = w.players.get(playerId);
  return eid === undefined ? 0 : decodeChoices(w.c.Game.choices[eid] ?? 0).pending;
}

/** A fresh run in place: enemies, gems and projectiles cleared; players reset at the spawn. NetIds of players are kept. */
export function resetRun(world: SimWorld): void {
  resetRunState(internal(world));
}

/** Bring dead (out) players back beside a living teammate. Returns who came back. */
export function respawnDead(world: SimWorld): PlayerId[] {
  return respawnDeadPlayers(internal(world));
}

/** Revive one downed or dead player now (a paid revive). Returns false if they were up or absent. */
export function revivePlayer(world: SimWorld, playerId: PlayerId): boolean {
  const w = internal(world);
  const eid = w.players.get(playerId);
  if (eid === undefined || isUp(w, eid)) return false;
  raise(w, eid, w.config.content.coop.reviveHealth);
  w.events.push({ type: "player.revived", playerId, netId: w.c.Networked.netId[eid] ?? 0, by: playerId });
  return true;
}

/** Hard ceilings on a meta bonus, whatever a caller passes: +15% per stat, +30% across stats. */
export const META_MAX_PER_STAT = 0.15;
export const META_MAX_TOTAL = 0.3;

/**
 * Set a player's permanent (meta) stat bonus for this world: fractions,
 * 0.05 = +5%. Each stat is clamped to META_MAX_PER_STAT and the sum to
 * META_MAX_TOTAL (scaled down evenly past it). A player at full health
 * stays at full health. Pass an empty object to clear it.
 */
export function setMetaBonus(world: SimWorld, playerId: PlayerId, bonus: Partial<MetaBonus>): void {
  const w = internal(world);
  const keys = ["speed", "maxHealth", "magnet", "might", "haste", "area"] as const;
  const out: MetaBonus = { speed: 0, maxHealth: 0, magnet: 0, might: 0, haste: 0, area: 0 };
  let total = 0;
  for (const k of keys) {
    const v = bonus[k];
    out[k] = typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(META_MAX_PER_STAT, v)) : 0;
    total += out[k];
  }
  if (total > META_MAX_TOTAL) for (const k of keys) out[k] *= META_MAX_TOTAL / total;
  const eid = w.players.get(playerId);
  const before = eid === undefined ? 0 : derivedStats(w, eid).maxHealth;
  if (total === 0) w.meta.delete(playerId);
  else w.meta.set(playerId, out);
  if (eid === undefined) return;
  const after = derivedStats(w, eid).maxHealth;
  const hp = w.c.Health.hp[eid] ?? 0;
  if (hp >= before && after !== before) w.c.Health.hp[eid] = after;
}

/** A player's meta bonus as the sim applies it (zeros when none). */
export function metaBonusOf(world: SimWorld, playerId: PlayerId): MetaBonus {
  return { ...(internal(world).meta.get(playerId) ?? { speed: 0, maxHealth: 0, magnet: 0, might: 0, haste: 0, area: 0 }) };
}

/** Set a player's cosmetic id (drawn by clients; no gameplay effect). */
export function setCosmetic(world: SimWorld, playerId: PlayerId, cosmetic: number): void {
  const w = internal(world);
  const eid = w.players.get(playerId);
  if (eid !== undefined) w.c.Game.type[eid] = Math.max(0, Math.min(255, Math.floor(cosmetic)));
}

/** A point on a ring of `radius` m around a random living player (the arena spawn if none). Consumes the world PRNG. */
export function spawnRingPoint(world: SimWorld, radius: number): [number, number] {
  return ringPoint(internal(world), radius);
}

/** The world's seeded PRNG, 0..1 (server-side game logic). */
export function simRandom(world: SimWorld): number {
  return nextRandom(internal(world));
}

/** XP needed to go from `level` to `level + 1`. */
export function xpForLevel(config: ResolvedSimConfig, level: number): number {
  const p = config.content.progression;
  return xpCurve(p.xpBase, p.xpGrowth, p.xpExponent, level);
}

/** Max health for a packed `stats` field (clients draw health bars with it). */
export function maxHealthFor(config: ResolvedSimConfig, stats: number): number {
  let add = 0;
  config.content.stats.forEach((s, i) => {
    if (s.stat === "maxHealth") add += s.step * ((stats >>> (i * 4)) & 0x0f);
  });
  return Math.round(config.player.maxHealth + add);
}


/** An entity's health by NetId, or undefined when it is gone. */
export function entityHealth(world: SimWorld, netId: NetId): number | undefined {
  const w = internal(world);
  const eid = w.byNetId.get(netId);
  return eid === undefined ? undefined : (w.c.Health.hp[eid] ?? 0);
}

// ------------------------------------------------------------ arena (shooter) mode

export { beamRange, selectedSlot, ARENA_BOLT_RADIUS, ARENA_HITBOX_PAD, ARENA_SPAWN_CLEAR } from "./arena.js";
export type { BeamShot, ArenaHitbox } from "./arena.js";

/** A human player's beam this tick, for a room's lag compensation. Call before `step` with the command it will consume. */
export function beamShot(world: SimWorld, playerId: PlayerId, cmd: InputCommand): BeamShot | null {
  return beamShotFor(internal(world), playerId, cmd);
}

/** Apply a lag-compensated beam hit (the rewind found `target`, a NetId). Its events come out of the next `step`. */
export function applyBeamHit(world: SimWorld, shot: BeamShot, target: NetId): void {
  applyBeamHitTo(internal(world), shot, target);
}

/** Living players' and enemies' hitboxes this tick (the room's rewind buffer records them). */
export function arenaHitboxes(world: SimWorld): ArenaHitbox[] {
  return arenaHitboxesOf(internal(world));
}

/** Where a player joining or respawning now would stand: the spawn point farthest from opponents. */
export function arenaSpawn(world: SimWorld, playerId: PlayerId): [number, number] {
  return arenaSpawnPoint(internal(world), playerId);
}

/** Give a player one level of passive `index` (content.stats) for the rest of the run: a store upgrade. */
export function grantUpgrade(world: SimWorld, playerId: PlayerId, index: number): boolean {
  const w = internal(world);
  const eid = w.players.get(playerId);
  return eid === undefined ? false : grantStatLevel(w, eid, index);
}

/** Pickups on the floor: position (m) and value (XP, or heal in the arena). */
export function listPickups(world: SimWorld): { x: number; z: number; value: number }[] {
  const w = internal(world);
  const out: { x: number; z: number; value: number }[] = [];
  if (w.pickupCount === 0) return out;
  for (const eid of liveOrder(w)) {
    if (w.c.Networked.kind[eid] !== EntityKind.Pickup || w.doomed.has(eid)) continue;
    out.push({ x: w.c.Transform.x[eid] ?? 0, z: w.c.Transform.z[eid] ?? 0, value: w.c.Game.value[eid] ?? 0 });
  }
  return out;
}

/** Spawn an enemy of `type` with stat multipliers (the spawn director's curve). Returns its NetId. */
/** Authority: multiply every non-boss enemy's steering speed by `k` (0.25..3) from now on. */
export function setEnemySpeed(world: SimWorld, k: number): void {
  internal(world).enemySpeed = Math.max(0.25, Math.min(3, k));
}

export function spawnEnemyScaled(world: SimWorld, type: number, x: number, z: number, scale: SpawnScale): NetId {
  const w = internal(world);
  const eid = spawnEnemyAt(w, type, x, z, scale);
  return w.c.Networked.netId[eid] ?? 0;
}

export interface EdgeSpawnOptions {
  /** Heading (radians from +x toward +z) to centre on; omit for any heading. */
  readonly heading?: number;
  /** Width of the arc around `heading`, radians. Default 2*pi. */
  readonly spread?: number;
  /** Metres beyond the view edge. Default 2. */
  readonly margin?: number;
  /** The spawned enemy's radius (kept clear of walls and pillars). Default 0.5. */
  readonly radius?: number;
  /** Centre on the player's movement instead of `heading` ("ahead" or "behind"); any heading when standing still. */
  readonly relative?: "ahead" | "behind";
}

/**
 * A point just off the screen of `playerId` (or of a random living player),
 * inside the arena, clear of pillars and off every other player's screen.
 * Null when there is none: skip the spawn, never clamp it on screen.
 */
export function edgeSpawnPoint(world: SimWorld, playerId: PlayerId | undefined, opts: EdgeSpawnOptions = {}): [number, number] | null {
  const w = internal(world);
  let eid = playerId !== undefined ? w.players.get(playerId) : undefined;
  if (eid !== undefined && !isUp(w, eid)) eid = undefined;
  if (eid === undefined) {
    const up = upPlayers(w);
    if (up.length === 0) return null;
    eid = up[Math.floor(nextRandom(w) * up.length)] as number;
  }
  const spread = opts.spread ?? Math.PI * 2;
  let heading = opts.heading;
  if (opts.relative) {
    const vx = w.c.Velocity.x[eid] ?? 0;
    const vz = w.c.Velocity.z[eid] ?? 0;
    heading = vx * vx + vz * vz > 1 ? Math.atan2(vz, vx) + (opts.relative === "behind" ? Math.PI : 0) : undefined;
  }
  return edgePoint(w, eid, heading === undefined || spread >= Math.PI * 2 ? null : heading, spread, opts.margin ?? 2, opts.radius ?? 0.5);
}

/** A ring point around (cx, cz) inside the arena and clear of pillars (headings retried, never clamped). Null if none. */
export function ringSpawnPoint(world: SimWorld, cx: number, cz: number, radius: number, enemyRadius = 0.5): [number, number] | null {
  return ringSpot(internal(world), cx, cz, radius, enemyRadius);
}

/** Move far-off-screen non-boss enemies back to the spawn edge (see content.ts). Call every `periodTicks`. */
export function recycleEnemies(world: SimWorld, periodTicks: number, afterTicks: number, margin: number): { moved: number; removed: number } {
  return recycleStragglers(internal(world), periodTicks, afterTicks, margin);
}

/** Distance from a player to the edge of the screen at a heading (radians from +x toward +z), m. */
export function viewEdge(world: SimWorld, heading: number): number {
  return viewRadius(internal(world), heading);
}

/** True when (x, z) is on the screen of any player who is up. */
export function isOnScreen(world: SimWorld, x: number, z: number): boolean {
  return onAnyScreen(internal(world), x, z);
}

/** True while the sim is paused for a solo player's upgrade cards. */
export function simPaused(world: SimWorld): boolean {
  const w = internal(world);
  return w.config.content.enabled && contentPaused(w);
}

/** An enemy's max health as spawned (scaled), by NetId; undefined when gone or not an enemy. */
export function enemyMaxHealth(world: SimWorld, netId: NetId): number | undefined {
  const w = internal(world);
  const eid = w.byNetId.get(netId);
  if (eid === undefined || w.c.Networked.kind[eid] !== EntityKind.Enemy) return undefined;
  return w.c.Game.stats[eid] || (w.config.content.enemyTypes[w.c.Game.type[eid] ?? 0]?.health ?? 1);
}

/** An entity's ground position by NetId, or undefined when it is gone. */
export function entityPosition(world: SimWorld, netId: NetId): [number, number] | undefined {
  const w = internal(world);
  const eid = w.byNetId.get(netId);
  return eid === undefined ? undefined : [w.c.Transform.x[eid] ?? 0, w.c.Transform.z[eid] ?? 0];
}

/** A player's weapon multipliers from a packed `stats` field (clients draw weapons the size the sim uses). */
export function weaponModsFor(config: ResolvedSimConfig, stats: number): { might: number; haste: number; area: number; amount: number } {
  let might = 0;
  let haste = 0;
  let area = 0;
  let amount = 0;
  config.content.stats.forEach((s, i) => {
    const v = s.step * ((stats >>> (i * 4)) & 0x0f);
    if (s.stat === "might") might += v;
    else if (s.stat === "haste") haste += v;
    else if (s.stat === "area") area += v;
    else if (s.stat === "amount") amount += v;
  });
  return { might: 1 + might, haste: Math.max(0.3, 1 - haste), area: 1 + area, amount: Math.round(amount) };
}

/** Give a player XP now (levels and cards follow as from gems). Returns false when the player is absent. */
export function grantXp(world: SimWorld, playerId: PlayerId, amount: number): boolean {
  const w = internal(world);
  const eid = w.players.get(playerId);
  if (eid === undefined || !w.config.content.enabled) return false;
  addXp(w, eid, Math.max(0, Math.floor(amount)));
  return true;
}

/** Spawn special pickup `index` (content.pickups) at (x, z). Returns its NetId, or 0 when the world is full. */
export function spawnPickupAt(world: SimWorld, index: number, x: number, z: number): NetId {
  const w = internal(world);
  const g = spawnSpecial(w, index, x, z);
  return g < 0 ? 0 : (w.c.Networked.netId[g] ?? 0);
}

/** Multiply the XP of gems dropped from now on (1 turns it off). Server-side, for timed events. */
export function setXpBoost(world: SimWorld, multiplier: number): void {
  setBoost(internal(world), multiplier);
}

/** Remove every living enemy of a type at once, with no kills or drops. Returns how many. */
export function removeEnemies(world: SimWorld, type: number): number {
  return removeAll(internal(world), type);
}

/** Scatter `count` enemies of a type (props) over the field, off every screen. Returns how many. */
export function scatterEnemies(world: SimWorld, type: number, count: number): number {
  const w = internal(world);
  return scatterProps(w, type, count, (x, z) => {
    spawnEnemyAt(w, type, x, z);
  });
}

/** An enemy's type index by NetId, or -1 when it is gone or not an enemy. */
export function enemyTypeOf(world: SimWorld, netId: NetId): number {
  const w = internal(world);
  const eid = w.byNetId.get(netId);
  return eid === undefined || w.c.Networked.kind[eid] !== EntityKind.Enemy ? -1 : (w.c.Game.type[eid] ?? 0);
}
