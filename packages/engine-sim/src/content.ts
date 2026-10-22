/**
 * Content mode: the genre machinery templates build on (game-runtime.md §12,
 * "waves, weapons, upgrades, XP, bosses for survivor"). Enabled when the
 * world's config lists weapons. Everything here is deterministic: integer
 * state, netId-ordered loops, and level-up offers drawn from a hash of
 * (seed, netId, level) rather than the world PRNG, so a predicting client
 * and the server offer the same three upgrades.
 */
import { Button, EntityFlag, EntityKind, KEEPER_MASK, KEEPER_SHIFT, PICKUP_SPECIAL } from "./api.js";
import type { EnemyTypeDef, PlayerId, SpawnScale, StatKind, WeaponDef } from "./api.js";
import { flowDir, flowOut, hasNav, inWall, onFloor, pushOutOfWalls, segmentWalls, updateFlow, wallsOf } from "./walls.js";
import { nextRandom } from "./rng.js";
import {
  absorbShield,
  applyBlasts,
  bossLoot,
  contactSource,
  flushRoleSpawns,
  hasRole,
  hostileProjectiles,
  onEnemyDeath,
  HOLD,
  roleSteer,
  roleUpkeep,
  setDownHook,
  steerTo,
} from "./roles.js";
import { fireShape, friendlyHazards, scaledWeapon, turnBoomerangs } from "./weapons.js";
import { applyPickup, dropsOnDeath, mergeGem, xpBoostOf } from "./pickups.js";
import { resetTally, tallyDamage, tallyWeapon } from "./tally.js";
import { despawnEntity, initProgression, liveOrder, spawnEntity } from "./world.js";
import type { InternalWorld } from "./world.js";

/** Ticks between hits from one orbit blade on one enemy. */
export const ORBIT_HIT_EVERY = 8;
/** Orbit blade hit radius, m. */
export const ORBIT_BLADE_RADIUS = 0.45;
/** Projectile hit radius, m, and height above the floor. */
const BOLT_RADIUS = 0.25;
const BOLT_HEIGHT = 0.8;
/** Gem pull speed toward a player inside the magnet radius, m/s, and the collect radius. */
const GEM_PULL_SPEED = 14;
const GEM_COLLECT = 0.8;
/** Neighbours examined per enemy for separation. */
const MAX_NEIGHBOURS = 12;
/**
 * Knockback physics (authoritative, deterministic). A hit shoves an enemy
 * and staggers it: for the stagger ticks it stops steering, slides with
 * ground friction, bounces off pillars, and passes momentum to the enemies
 * it runs into (a mass-weighted impulse with a little restitution), so a
 * nova into a packed swarm pushes the whole front rank back.
 */
export const STAGGER_MAX_TICKS = 12;
/** Velocity kept per tick while staggered, at 30 Hz (scaled for other tick rates). */
const KNOCK_FRICTION_30HZ = 0.8;
/** Fastest a knocked enemy may move, m/s. */
const KNOCK_MAX_SPEED = 16;
/** Restitution of enemy/enemy and enemy/pillar knock collisions. */
const KNOCK_RESTITUTION = 0.35;
/** Below this speed a staggered enemy no longer shoves its neighbours, m/s. */
const SHOVE_MIN_SPEED = 1.5;

// ------------------------------------------------------------ packed fields

export const slotByte = (weapons: number, slot: number): number => (weapons >>> (slot * 8)) & 0xff;
/** Weapon index in a slot, or -1 when empty. */
export const slotWeapon = (weapons: number, slot: number): number => (slotByte(weapons, slot) & 0x0f) - 1;
export const slotLevel = (weapons: number, slot: number): number => slotByte(weapons, slot) >>> 4;
export const setByte = (packed: number, i: number, v: number): number => ((packed & ~(0xff << (i * 8))) | ((v & 0xff) << (i * 8))) >>> 0;
export const statLevel = (stats: number, i: number): number => (stats >>> (i * 4)) & 0x0f;
const setNibble = (packed: number, i: number, v: number): number => ((packed & ~(0x0f << (i * 4))) | ((v & 0x0f) << (i * 4))) >>> 0;
/** The three offered upgrade indices (-1 for none) and the pending level-ups. */
export function decodeChoices(choices: number): { offers: [number, number, number]; pending: number } {
  return {
    offers: [(choices & 0xff) - 1, ((choices >>> 8) & 0xff) - 1, ((choices >>> 16) & 0xff) - 1],
    pending: choices >>> 24,
  };
}

// ------------------------------------------------------------ derived stats

export interface DerivedStats {
  speedMul: number;
  maxHealth: number;
  magnet: number;
  might: number;
  haste: number;
  regen: number;
  armor: number;
  /** Radius multiplier for novas, auras, cones, meteors and orbits. */
  area: number;
  /** Extra projectiles, blades, jumps or meteors. */
  amount: number;
}

export function derivedStats(w: InternalWorld, eid: number): DerivedStats {
  const stats = w.c.Game.stats[eid] ?? 0;
  const d: Record<StatKind, number> = { speed: 0, maxHealth: 0, magnet: 0, might: 0, haste: 0, regen: 0, armor: 0, area: 0, amount: 0 };
  w.config.content.stats.forEach((s, i) => {
    d[s.stat] += s.step * statLevel(stats, i);
  });
  const player = w.c.Networked.kind[eid] === EntityKind.Player;
  const buffed = player && buffTicksOf(w, eid) > 0;
  const coop = w.config.content.coop;
  // Meta upgrades (opt-in, capped by the engine before they get here): fractions of the base.
  const m = player && w.meta.size > 0 ? w.meta.get(w.c.Owner.player[eid] ?? 0) : undefined;
  const base = w.config.player.maxHealth;
  const magnet = w.config.content.progression.magnet;
  return {
    speedMul: (1 + d.speed) * (1 + (m?.speed ?? 0)) * (buffed ? coop.reviveBuffSpeed : 1),
    maxHealth: Math.round(base * (1 + (m?.maxHealth ?? 0)) + d.maxHealth),
    magnet: magnet * (1 + (m?.magnet ?? 0)) + d.magnet,
    might: (1 + d.might) * (1 + (m?.might ?? 0)) * (buffed ? coop.reviveBuffMight : 1),
    haste: Math.max(0.3, (1 - d.haste) * (1 - (m?.haste ?? 0))),
    regen: Math.round(d.regen),
    armor: Math.round(d.armor),
    area: (1 + d.area) * (1 + (m?.area ?? 0)),
    amount: Math.round(d.amount),
  };
}

export function xpToNext(w: InternalWorld, level: number): number {
  const p = w.config.content.progression;
  return xpCurve(p.xpBase, p.xpGrowth, p.xpExponent, level);
}

/** XP to go from `level` to `level + 1`: base + growth x (level - 1)^exponent, rounded, at least 1. */
export function xpCurve(base: number, growth: number, exponent: number, level: number): number {
  const l = Math.max(1, level) - 1;
  return Math.max(1, Math.round(base + growth * (exponent === 1 ? l : Math.pow(l, exponent))));
}

// ------------------------------------------------------------ helpers

export const isFlag = (w: InternalWorld, eid: number, f: number): boolean => ((w.c.SimState.flags[eid] ?? 0) & f) !== 0;
export const isUp = (w: InternalWorld, eid: number): boolean =>
  ((w.c.SimState.flags[eid] ?? 0) & (EntityFlag.Dead | EntityFlag.Downed)) === 0;
/** Enemies: stagger ticks left (low byte of SimState.timers, which rides in snapshots). */
export const staggerOf = (w: InternalWorld, eid: number): number => (w.c.SimState.timers[eid] ?? 0) & 0xff;
const setStagger = (w: InternalWorld, eid: number, ticks: number): void => {
  const t = w.c.SimState.timers[eid] ?? 0;
  w.c.SimState.timers[eid] = (t & ~0xff) | (Math.max(0, Math.min(STAGGER_MAX_TICKS, ticks)) & 0xff);
};
/** Knockback mass of an enemy (the prefab's mass, default 1). */
const massOf = (def: EnemyTypeDef): number => def.mass ?? 1;
export const enemyType = (w: InternalWorld, eid: number): EnemyTypeDef =>
  w.config.content.enemyTypes[w.c.Game.type[eid] ?? 0] ?? (w.config.content.enemyTypes[0] as EnemyTypeDef);
/**
 * Enemies carry their own scaled stats (the spawn director's curve): contact
 * damage in Game.value, gem XP in Game.xp, max health in Game.stats, and
 * ticks spent far off screen in Game.bleed. A client that only received an
 * enemy's position (value 0) falls back to the type's numbers.
 */
const enemyDamage = (w: InternalWorld, eid: number): number => {
  const v = w.c.Game.value[eid] ?? 0;
  return v > 0 ? v : enemyType(w, eid).damage;
};
const enemyXp = (w: InternalWorld, eid: number): number => {
  const v = w.c.Game.xp[eid] ?? 0;
  return v > 0 ? v : enemyType(w, eid).xp;
};

/** Players in ascending playerId order with their ECS ids. */
export function sortedPlayers(w: InternalWorld): [PlayerId, number][] {
  const out: [PlayerId, number][] = [];
  for (const pid of [...w.players.keys()].sort((a, b) => a - b)) {
    const eid = w.players.get(pid);
    if (eid !== undefined) out.push([pid, eid]);
  }
  return out;
}

/**
 * Player Game.value: rerolls used (bits 0-3) | reroll counter (4-11) |
 * keeper index (12-15) | revive buff ticks left (16-27).
 */
export const keeperOf = (w: InternalWorld, eid: number): number => ((w.c.Game.value[eid] ?? 0) >>> 12) & 0xf;
export const buffTicksOf = (w: InternalWorld, eid: number): number => ((w.c.Game.value[eid] ?? 0) >>> 16) & 0xfff;
const setBuffTicks = (w: InternalWorld, eid: number, ticks: number): void => {
  const v = w.c.Game.value[eid] ?? 0;
  w.c.Game.value[eid] = ((v & ~(0xfff << 16)) | ((Math.max(0, Math.min(0xfff, ticks)) & 0xfff) << 16)) >>> 0;
};

/** The crit roll for hits on enemy `netId` at `tick`, in [0, 1): a fixed hash, so clients can mark crit numbers. */
export function critRoll(tick: number, netId: number): number {
  return mix(Math.imul(tick >>> 0, 0x9e3779b1) ^ Math.imul(netId >>> 0, 0x85ebca77) ^ 0x2c1b3c6d) / 4294967296;
}

/** Murmur3 finalizer: a fixed integer hash for level-up offers. */
function mix(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// ------------------------------------------------------------ input

export function contentInput(
  w: InternalWorld,
  eid: number,
  cmd: { moveX: number; moveZ: number; yaw: number; buttons: number },
  prevButtons: number,
): void {
  const { Transform: T, Velocity: V, SimState: S } = w.c;
  const G = w.c.Game;
  const coop = w.config.content.coop;
  const pressed = cmd.buttons & ~prevButtons;
  // Upgrade choice while up (the cards wait, hidden, while downed: a pick is never lost).
  if (isUp(w, eid)) choiceInput(w, eid, pressed);
  keeperInput(w, eid, cmd.buttons);

  let dash = G.dash[eid] ?? 0;
  let dashTicks = dash & 0xff;
  let dashCd = (dash >>> 8) & 0xff;
  let dashBuf = (dash >>> 16) & 0xff;
  if ((pressed & Button.Sprint) !== 0) dashBuf = coop.dashBufferTicks + 1;

  if (!isUp(w, eid)) {
    V.x[eid] = 0;
    V.z[eid] = 0;
    G.dash[eid] = 0;
    S.flags[eid] = (S.flags[eid] ?? 0) & ~EntityFlag.Dashing;
    if (!isFlag(w, eid, EntityFlag.Downed)) return;
    // Downed: Sprint spends a free self-revive (after a beat, so a held dash does not fire it).
    const downFor = coop.downedTicks - bleedTicks(w, eid);
    if ((pressed & Button.Sprint) !== 0 && selfRevivesLeft(w, eid) > 0 && downFor >= coop.selfReviveDelayTicks) {
      selfRevive(w, eid);
      return;
    }
    // Otherwise crawl toward help.
    if (coop.crawlSpeed > 0) {
      let cx = cmd.moveX;
      let cz = cmd.moveZ;
      const cl = Math.hypot(cx, cz);
      if (cl > 1) {
        cx /= cl;
        cz /= cl;
      }
      const sn = Math.sin(cmd.yaw);
      const cs = Math.cos(cmd.yaw);
      const vx = cx * cs - cz * sn;
      const vz = -cx * sn - cz * cs;
      const speed = w.config.player.speed * coop.crawlSpeed;
      V.x[eid] = vx * speed;
      V.z[eid] = vz * speed;
      if (vx !== 0 || vz !== 0) T.yaw[eid] = Math.atan2(-vx, -vz);
    }
    return;
  }
  if (dashBuf > 0 && dashCd === 0 && dashTicks === 0 && coop.dashTicks > 0) {
    dashTicks = coop.dashTicks;
    dashCd = coop.dashCooldownTicks;
    dashBuf = 0;
    G.iframes[eid] = Math.max(G.iframes[eid] ?? 0, coop.dashTicks);
  }
  let mx = cmd.moveX;
  let mz = cmd.moveZ;
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  const s = Math.sin(cmd.yaw);
  const co = Math.cos(cmd.yaw);
  let vx = mx * co - mz * s;
  let vz = -mx * s - mz * co;
  if (dashTicks > 0 && vx === 0 && vz === 0) {
    // Dash with no stick: forward along the facing.
    const f = T.yaw[eid] ?? 0;
    vx = -Math.sin(f);
    vz = -Math.cos(f);
  }
  const speed = w.config.player.speed * derivedStats(w, eid).speedMul * (dashTicks > 0 ? coop.dashSpeed : 1);
  V.x[eid] = vx * speed;
  V.z[eid] = vz * speed;
  if (vx !== 0 || vz !== 0) T.yaw[eid] = Math.atan2(-vx, -vz);
  S.flags[eid] = dashTicks > 0 ? (S.flags[eid] ?? 0) | EntityFlag.Dashing : (S.flags[eid] ?? 0) & ~EntityFlag.Dashing;
  if (dashTicks > 0) dashTicks--;
  if (dashCd > 0) dashCd--;
  if (dashBuf > 0) dashBuf--;
  dash = dashTicks | (dashCd << 8) | (dashBuf << 16);
  G.dash[eid] = dash;
}

/**
 * Keeper choice (held input bits 11..14): taken while the keeper is still
 * level 1 with no card pending, which is the start of every run. It swaps
 * the start weapon and the signature passive; nothing else changes.
 */
export function keeperInput(w: InternalWorld, eid: number, buttons: number): void {
  const chars = w.config.content.characters;
  const pick = ((buttons & KEEPER_MASK) >>> KEEPER_SHIFT) - 1;
  if (pick < 0 || pick >= chars.length || pick === keeperOf(w, eid)) return;
  const G = w.c.Game;
  if ((G.level[eid] ?? 1) !== 1 || decodeChoices(G.choices[eid] ?? 0).pending > 0) return;
  const v = G.value[eid] ?? 0;
  G.value[eid] = ((v & ~(0xf << 12)) | ((pick & 0xf) << 12)) >>> 0;
  equipKeeper(w, eid);
}

/** Give a level-1 keeper its character's start weapon and signature passive. */
export function equipKeeper(w: InternalWorld, eid: number): void {
  const ch = w.config.content.characters[keeperOf(w, eid)];
  if (!ch) return;
  const G = w.c.Game;
  G.weapons[eid] = ((ch.weapon + 1) | (1 << 4)) >>> 0;
  G.wcd[eid] = 0;
  G.stats[eid] = ch.stat >= 0 ? setNibble(0, ch.stat, 1) : 0;
}

/** Apply a fresh Choice1..3 press. */
export function choiceInput(w: InternalWorld, eid: number, pressed: number): void {
  if ((pressed & Button.Choice1) !== 0) applyChoice(w, eid, 0);
  else if ((pressed & Button.Choice2) !== 0) applyChoice(w, eid, 1);
  else if ((pressed & Button.Choice3) !== 0) applyChoice(w, eid, 2);
  else if ((pressed & Button.Reroll) !== 0) rerollChoices(w, eid);
  else if ((pressed & Button.Skip) !== 0) skipChoice(w, eid);
}

/**
 * Solo pause: the only player in the world is up with cards open, so the
 * whole sim waits for the pick (coop.pauseSolo). Co-op never pauses.
 */
export function contentPaused(w: InternalWorld): boolean {
  if (!w.config.content.coop.pauseSolo) return false;
  for (const eid of w.players.values()) {
    if (isFlag(w, eid, EntityFlag.Solo) && isUp(w, eid) && (w.c.Game.choices[eid] ?? 0) >>> 24 > 0) return true;
  }
  return false;
}

/** Authority only: mark the player Solo when they are alone in the world (prediction worlds read the flag instead). */
export function markSolo(w: InternalWorld): void {
  if (w.config.content.coop.soloFromFlag) return;
  const S = w.c.SimState;
  const solo = w.players.size === 1;
  for (const eid of w.players.values()) {
    S.flags[eid] = solo ? (S.flags[eid] ?? 0) | EntityFlag.Solo : (S.flags[eid] ?? 0) & ~EntityFlag.Solo;
  }
}

/** True when this player is known to have teammates (co-op rules apply). */
const inCoop = (w: InternalWorld, eid: number): boolean =>
  w.config.content.coop.soloFromFlag ? !isFlag(w, eid, EntityFlag.Solo) : w.players.size > 1;

// ------------------------------------------------------------ progression

export function addXp(w: InternalWorld, eid: number, amount: number): void {
  const G = w.c.Game;
  const pid = w.c.Owner.player[eid] ?? 0;
  const netId = w.c.Networked.netId[eid] ?? 0;
  let xp = (G.xp[eid] ?? 0) + amount;
  let level = G.level[eid] ?? 1;
  let { pending } = decodeChoices(G.choices[eid] ?? 0);
  let need = xpToNext(w, level);
  while (xp >= need && level < 0xffff) {
    xp -= need;
    level++;
    pending = Math.min(255, pending + 1);
    w.events.push({ type: "player.levelup", playerId: pid, netId, level });
    need = xpToNext(w, level);
  }
  G.xp[eid] = xp;
  G.level[eid] = level;
  const offers = (G.choices[eid] ?? 0) & 0xffffff;
  G.choices[eid] = (offers | (pending << 24)) >>> 0;
  if (offers === 0 && pending > 0) {
    drawChoices(w, eid);
    if (inCoop(w, eid) && isUp(w, eid)) choicePulse(w, eid);
  }
}

/**
 * Co-op cards do not pause the room. Opening them instead shoves every
 * enemy within coop.choicePulseRadius away and grants a moment of
 * i-frames, so reading the cards is never what kills you.
 */
function choicePulse(w: InternalWorld, eid: number): void {
  const coop = w.config.content.coop;
  const G = w.c.Game;
  G.iframes[eid] = Math.max(G.iframes[eid] ?? 0, coop.choicePulseIframeTicks);
  shove(w, eid, coop.choicePulseRadius);
}

/** Knock every enemy within `r` m of a player away from them. */
function shove(w: InternalWorld, eid: number, r: number): void {
  if (r <= 0) return;
  const { Transform: T, Velocity: V, Networked: N } = w.c;
  const px = T.x[eid] ?? 0;
  const pz = T.z[eid] ?? 0;
  for (const o of liveOrder(w)) {
    if (N.kind[o] !== EntityKind.Enemy || isFlag(w, o, EntityFlag.Dead)) continue;
    const def = enemyType(w, o);
    const ox = (T.x[o] ?? 0) - px;
    const oz = (T.z[o] ?? 0) - pz;
    const reach = r + def.radius;
    const d2 = ox * ox + oz * oz;
    if (d2 > reach * reach || d2 < 1e-8) continue;
    const d = Math.sqrt(d2);
    const k = 8 / (def.mass ?? 1);
    V.x[o] = (V.x[o] ?? 0) + (ox / d) * k;
    V.z[o] = (V.z[o] ?? 0) + (oz / d) * k;
  }
}

/** Card weights (GAME-DESIGN.md "builds have a goal"): evolutions always show; these weigh the rest. */
export const CARD_WEIGHTS = { upgrade: 8, newWeapon: 10, passive: 4, passiveSlotsFull: 7 } as const;

/** Rerolls used (bits 0-3) and the reroll counter that varies the draw (bits 4-11), in a player's Game.value. */
const rerollsUsed = (w: InternalWorld, eid: number): number => (w.c.Game.value[eid] ?? 0) & 0xf;
const rerollIndex = (w: InternalWorld, eid: number): number => ((w.c.Game.value[eid] ?? 0) >>> 4) & 0xff;

/** Rerolls a player has left this run. */
export function rerollsLeft(w: InternalWorld, eid: number): number {
  return Math.max(0, w.config.content.progression.rerolls - rerollsUsed(w, eid));
}

/** Weapon indices this player could evolve now: [from slot, into weapon]. */
function readyEvolutions(w: InternalWorld, eid: number): [number, number][] {
  const G = w.c.Game;
  const { weapons } = w.config.content;
  const packed = G.weapons[eid] ?? 0;
  const st = G.stats[eid] ?? 0;
  const owned = new Set<number>();
  for (let s = 0; s < 4; s++) if (slotWeapon(packed, s) >= 0) owned.add(slotWeapon(packed, s));
  const out: [number, number][] = [];
  for (let s = 0; s < 4; s++) {
    const wi = slotWeapon(packed, s);
    const def = wi >= 0 ? weapons[wi] : undefined;
    if (!def?.evolve || slotLevel(packed, s) < def.maxLevel) continue;
    if (statLevel(st, def.evolve.requires) < 1 || owned.has(def.evolve.into)) continue;
    out.push([s, def.evolve.into]);
  }
  return out;
}

/**
 * A boss chest's promise: when the player holds a weapon that evolves and
 * already has its paired passive, that weapon jumps to its max level, so the
 * evolution card shows on the chest's draw. Returns whether one ripened (or
 * one was ready already).
 */
export function ripenEvolution(w: InternalWorld, eid: number): boolean {
  if (readyEvolutions(w, eid).length > 0) return true;
  const G = w.c.Game;
  const { weapons } = w.config.content;
  let packed = G.weapons[eid] ?? 0;
  const owned = new Set<number>();
  for (let s = 0; s < 4; s++) if (slotWeapon(packed, s) >= 0) owned.add(slotWeapon(packed, s));
  for (let s = 0; s < 4; s++) {
    const wi = slotWeapon(packed, s);
    const def = wi >= 0 ? weapons[wi] : undefined;
    if (!def?.evolve || owned.has(def.evolve.into) || statLevel(G.stats[eid] ?? 0, def.evolve.requires) < 1) continue;
    packed = setByte(packed, s, (wi + 1) | (def.maxLevel << 4));
    G.weapons[eid] = packed;
    return true;
  }
  return false;
}

/** Candidate cards with their weights (evolutions are handled first, separately). */
function weightedUpgrades(w: InternalWorld, eid: number): [number, number][] {
  const G = w.c.Game;
  const { weapons, stats, progression } = w.config.content;
  const packed = G.weapons[eid] ?? 0;
  let used = 0;
  const owned = new Map<number, number>();
  for (let s = 0; s < 4; s++) {
    const wi = slotWeapon(packed, s);
    if (wi >= 0) {
      used++;
      owned.set(wi, slotLevel(packed, s));
    }
  }
  const full = used >= progression.maxWeapons;
  const out: [number, number][] = [];
  weapons.forEach((def, i) => {
    const lvl = owned.get(i);
    if (lvl !== undefined) {
      if (lvl < def.maxLevel) out.push([i, CARD_WEIGHTS.upgrade]);
    } else if (!full && !def.evolved) out.push([i, CARD_WEIGHTS.newWeapon]);
  });
  const st = G.stats[eid] ?? 0;
  stats.forEach((def, i) => {
    if (statLevel(st, i) < def.maxLevel) out.push([weapons.length + i, full ? CARD_WEIGHTS.passiveSlotsFull : CARD_WEIGHTS.passive]);
  });
  return out;
}

/**
 * Offer up to three cards: every evolution that is ready first, then a
 * weighted draw without repeats, from a hash of (seed, netId, level,
 * pending, reroll counter) so a predicting client draws the same cards.
 */
export function drawChoices(w: InternalWorld, eid: number): void {
  const G = w.c.Game;
  let { pending } = decodeChoices(G.choices[eid] ?? 0);
  if (pending === 0) {
    G.choices[eid] = 0;
    return;
  }
  const picks: number[] = readyEvolutions(w, eid).map(([, into]) => into).slice(0, 3);
  const pool = weightedUpgrades(w, eid).filter(([u]) => !picks.includes(u));
  if (picks.length === 0 && pool.length === 0) {
    maxedOut(w, eid, pending);
    return;
  }
  let h = mix(
    w.config.seed ^ Math.imul(w.c.Networked.netId[eid] ?? 0, 0x9e3779b1) ^ Math.imul(G.level[eid] ?? 0, 0x27d4eb2f) ^ pending ^ Math.imul(rerollIndex(w, eid), 0x165667b1),
  );
  while (picks.length < 3 && pool.length > 0) {
    let total = 0;
    for (const [, wt] of pool) total += wt;
    h = mix(h + 0x6d2b79f5);
    let r = (h / 4294967296) * total;
    let k = 0;
    for (; k < pool.length - 1; k++) {
      r -= (pool[k] as [number, number])[1];
      if (r < 0) break;
    }
    picks.push((pool[k] as [number, number])[0]);
    pool.splice(k, 1);
  }
  let packed = 0;
  for (let k = 0; k < picks.length; k++) packed |= ((picks[k] as number) + 1) << (k * 8);
  pending = Math.min(255, pending);
  G.choices[eid] = (packed | (pending << 24)) >>> 0;
}

/**
 * Everything is maxed: each pending level heals a fifth of max health, and
 * every teammate who is up gets a tenth of a level (never a dead card).
 */
let sharingOverflow = false;
function maxedOut(w: InternalWorld, eid: number, pending: number): void {
  const G = w.c.Game;
  const max = derivedStats(w, eid).maxHealth;
  w.c.Health.hp[eid] = Math.min(max, (w.c.Health.hp[eid] ?? 0) + Math.round((max * pending) / 5));
  G.choices[eid] = 0;
  // A level that came from a teammate's overflow heals but never passes XP back (no ping-pong).
  if (sharingOverflow) return;
  sharingOverflow = true;
  try {
    for (const [, o] of sortedPlayers(w)) {
      if (o === eid || !isUp(w, o)) continue;
      addXp(w, o, Math.max(1, Math.round((xpToNext(w, G.level[o] ?? 1) * pending) / 10)));
    }
  } finally {
    sharingOverflow = false;
  }
}

/** Reroll the open cards (one of the run's rerolls). */
export function rerollChoices(w: InternalWorld, eid: number): boolean {
  const G = w.c.Game;
  if (decodeChoices(G.choices[eid] ?? 0).pending === 0 || rerollsLeft(w, eid) <= 0) return false;
  const used = rerollsUsed(w, eid) + 1;
  const index = (rerollIndex(w, eid) + 1) & 0xff;
  G.value[eid] = (((G.value[eid] ?? 0) & ~0xfff) | (used & 0xf) | (index << 4)) >>> 0;
  drawChoices(w, eid);
  return true;
}

/** Skip the open cards: one pending level becomes a small heal. */
export function skipChoice(w: InternalWorld, eid: number): void {
  const G = w.c.Game;
  const { pending } = decodeChoices(G.choices[eid] ?? 0);
  if (pending === 0) return;
  const max = derivedStats(w, eid).maxHealth;
  w.c.Health.hp[eid] = Math.min(max, (w.c.Health.hp[eid] ?? 0) + Math.round(max / 10));
  G.choices[eid] = ((pending - 1) << 24) >>> 0;
  if (pending - 1 > 0) drawChoices(w, eid);
}

/** Take offer `k` (0..2): add or level a weapon, evolve one, or level a passive. */
export function applyChoice(w: InternalWorld, eid: number, k: number): void {
  const G = w.c.Game;
  const { offers, pending } = decodeChoices(G.choices[eid] ?? 0);
  const u = offers[k] ?? -1;
  if (u < 0 || pending === 0) return;
  const { weapons, stats } = w.config.content;
  let evolved = false;
  if (u < weapons.length) {
    let packed = G.weapons[eid] ?? 0;
    let done = false;
    // An evolution replaces the weapon it grew from, in its slot.
    const evo = readyEvolutions(w, eid).find(([, into]) => into === u);
    if (evo) {
      packed = setByte(packed, evo[0], (u + 1) | (1 << 4));
      done = true;
      evolved = true;
    }
    for (let s = 0; s < 4 && !done; s++) {
      if (slotWeapon(packed, s) === u) {
        const lvl = Math.min(weapons[u]?.maxLevel ?? 1, slotLevel(packed, s) + 1);
        packed = setByte(packed, s, (u + 1) | (lvl << 4));
        done = true;
      }
    }
    for (let s = 0; s < 4 && !done; s++) {
      if (slotWeapon(packed, s) < 0) {
        packed = setByte(packed, s, (u + 1) | (1 << 4));
        G.wcd[eid] = setByte(G.wcd[eid] ?? 0, s, 0);
        done = true;
      }
    }
    G.weapons[eid] = packed;
  } else {
    const i = u - weapons.length;
    const def = stats[i];
    if (def) {
      const before = derivedStats(w, eid).maxHealth;
      G.stats[eid] = setNibble(G.stats[eid] ?? 0, i, Math.min(def.maxLevel, statLevel(G.stats[eid] ?? 0, i) + 1));
      const after = derivedStats(w, eid).maxHealth;
      if (after > before) w.c.Health.hp[eid] = (w.c.Health.hp[eid] ?? 0) + (after - before);
    }
  }
  G.choices[eid] = ((pending - 1) << 24) >>> 0;
  w.events.push({
    type: "player.upgraded",
    playerId: w.c.Owner.player[eid] ?? 0,
    netId: w.c.Networked.netId[eid] ?? 0,
    upgrade: u,
    ...(evolved ? { evolved: true } : {}),
  });
  if (pending - 1 > 0) drawChoices(w, eid);
}

// ------------------------------------------------------------ AI

export function contentAI(
  w: InternalWorld,
  forEnemiesNear: (x: number, z: number, r: number, fn: (eid: number) => boolean | void) => void,
): void {
  const { Transform: T, Velocity: V, Networked: N, SimState: S } = w.c;
  if (w.enemyCount === 0) return;
  const targets: number[] = [];
  for (const [, eid] of sortedPlayers(w)) if (isUp(w, eid)) targets.push(eid);
  const steer = Math.min(1, 6 * w.dt);
  const friction = Math.pow(KNOCK_FRICTION_30HZ, 30 * w.dt);
  // A level with floors (a dungeon): chasers walk round walls on the flow field.
  const nav = hasNav(w);
  const walls = wallsOf(w);
  if (nav) updateFlow(w, targets.map((t) => [T.x[t] ?? 0, T.z[t] ?? 0] as const));
  for (const eid of liveOrder(w)) {
    if (N.kind[eid] !== EntityKind.Enemy || ((S.flags[eid] ?? 0) & EntityFlag.Dead) !== 0) continue;
    const def = enemyType(w, eid);
    const x = T.x[eid] ?? 0;
    const z = T.z[eid] ?? 0;
    const stagger = staggerOf(w, eid);
    if (stagger > 0) {
      knockSlide(w, eid, def, x, z, friction, forEnemiesNear);
      setStagger(w, eid, stagger - 1);
      continue;
    }
    let dx = 0;
    let dz = 0;
    let best = Infinity;
    let target = -1;
    for (const t of targets) {
      const ox = (T.x[t] ?? 0) - x;
      const oz = (T.z[t] ?? 0) - z;
      const d2 = ox * ox + oz * oz;
      if (d2 < best) {
        best = d2;
        dx = ox;
        dz = oz;
        target = t;
      }
    }
    let desX = 0;
    let desZ = 0;
    let detour = false;
    if (best !== Infinity && best > 1e-6 && def.ai !== "idle") {
      const d = Math.sqrt(best);
      desX = (dx / d) * def.speed;
      desZ = (dz / d) * def.speed;
      // A wall between it and the player: follow the flow field round it.
      if (nav && d > 1.5 && segmentWalls(walls, x, z, dx, dz, def.radius * 0.8) >= 0 && flowDir(w, x, z, def.radius)) {
        desX = flowOut.x * def.speed;
        desZ = flowOut.z * def.speed;
        detour = true;
      }
    }
    // Roles (roles.ts): plain chasers never come here. A role on a detour walks first and acts once it sees the player.
    roleUpkeep(w, eid);
    if (hasRole(def) && !detour) {
      if (roleSteer(w, eid, def, target, dx, dz, forEnemiesNear) === HOLD) continue;
      desX = steerTo.x;
      desZ = steerTo.z;
    }
    // Late in a run the swarm gets quicker (the director's speed curve); bosses keep their pace.
    if (w.enemySpeed !== 1 && !def.boss) {
      desX *= w.enemySpeed;
      desZ *= w.enemySpeed;
    }
    const sepDist = def.radius * 2.2;
    let sx = 0;
    let sz = 0;
    let seen = 0;
    // Separation runs on alternate ticks per enemy (netId parity) at double weight: the same push
    // through the steering filter, at half the neighbour queries in a dense crowd.
    const sepTick = ((w.tick + (N.netId[eid] ?? 0)) & 1) === 0;
    if (sepTick) forEnemiesNear(x, z, sepDist, (o) => {
      if (o === eid) return;
      // A boss shoulders past props (urns in a doorway never pin it).
      if (def.boss && w.config.content.enemyTypes[w.c.Game.type[o] ?? 0]?.prop) return;
      const ox = x - (T.x[o] ?? 0);
      const oz = z - (T.z[o] ?? 0);
      const d2 = ox * ox + oz * oz;
      if (d2 >= sepDist * sepDist) return;
      if (d2 < 1e-8) {
        sx += ((N.netId[eid] ?? 0) < (N.netId[o] ?? 0) ? 1 : -1) * def.speed * 2;
      } else {
        const d = Math.sqrt(d2);
        const push = ((sepDist - d) / sepDist) * def.speed * 4;
        sx += (ox / d) * push;
        sz += (oz / d) * push;
      }
      if (++seen >= MAX_NEIGHBOURS) return false;
    });
    const vx = V.x[eid] ?? 0;
    const vz = V.z[eid] ?? 0;
    V.x[eid] = vx + (desX + sx - vx) * steer;
    V.z[eid] = vz + (desZ + sz - vz) * steer;
    if (desX !== 0 || desZ !== 0) T.yaw[eid] = Math.atan2(-desX, -desZ);
  }
  // Bomber blasts caught enemies too.
  applyBlasts(w, (o, damage) => hitEnemy(w, o, damage, 0, 0, 0, 0));
}

/**
 * One staggered tick: ground friction on the knock velocity, then a
 * momentum exchange with every overlapping, approaching neighbour (a 1-D
 * impulse along the contact normal, masses from the prefabs). Neighbours
 * hit hard enough stagger too, so a shove travels through a crowd.
 */
function knockSlide(
  w: InternalWorld,
  eid: number,
  def: EnemyTypeDef,
  x: number,
  z: number,
  friction: number,
  forEnemiesNear: (x: number, z: number, r: number, fn: (eid: number) => boolean | void) => void,
): void {
  const { Transform: T, Velocity: V, SimState: S } = w.c;
  let vx = (V.x[eid] ?? 0) * friction;
  let vz = (V.z[eid] ?? 0) * friction;
  const speed = Math.hypot(vx, vz);
  if (speed > KNOCK_MAX_SPEED) {
    vx = (vx / speed) * KNOCK_MAX_SPEED;
    vz = (vz / speed) * KNOCK_MAX_SPEED;
  }
  if (speed >= SHOVE_MIN_SPEED) {
    const ma = massOf(def);
    let seen = 0;
    forEnemiesNear(x, z, def.radius + w.maxEnemyRadius, (o) => {
      if (o === eid || ((S.flags[o] ?? 0) & EntityFlag.Dead) !== 0) return;
      const odef = enemyType(w, o);
      const nx = (T.x[o] ?? 0) - x;
      const nz = (T.z[o] ?? 0) - z;
      const reach = def.radius + odef.radius;
      const d2 = nx * nx + nz * nz;
      if (d2 >= reach * reach || d2 < 1e-8) return;
      const d = Math.sqrt(d2);
      const ux = nx / d;
      const uz = nz / d;
      const ovx = V.x[o] ?? 0;
      const ovz = V.z[o] ?? 0;
      // Closing speed along the normal (positive: moving into the neighbour).
      const closing = (vx - ovx) * ux + (vz - ovz) * uz;
      if (closing <= 0) return;
      const mb = massOf(odef);
      const j = ((1 + KNOCK_RESTITUTION) * closing) / (1 / ma + 1 / mb);
      vx -= (j / ma) * ux;
      vz -= (j / ma) * uz;
      V.x[o] = ovx + (j / mb) * ux;
      V.z[o] = ovz + (j / mb) * uz;
      const passed = j / mb;
      if (passed >= SHOVE_MIN_SPEED) setStagger(w, o, Math.max(staggerOf(w, o), staggerTicks(passed)));
      if (++seen >= MAX_NEIGHBOURS) return false;
    });
  }
  V.x[eid] = vx;
  V.z[eid] = vz;
}

/** Stagger length for a knock of `dv` m/s: about 1.6 ticks per m/s, 2..STAGGER_MAX_TICKS. */
function staggerTicks(dv: number): number {
  return Math.max(2, Math.min(STAGGER_MAX_TICKS, Math.round(dv * 1.6)));
}

/** First crossing of a segment with a circle (2-D), as a 0..1 fraction, or -1. */
export function segmentCircle(x0: number, z0: number, dx: number, dz: number, cx: number, cz: number, r: number): number {
  const fx = x0 - cx;
  const fz = z0 - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-12) return -1;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - r * r;
  if (c <= 0) return -1; // starts inside: let it leave
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

// ------------------------------------------------------------ physics (non-player)

export function contentMovement(w: InternalWorld): void {
  const { Transform: T, Velocity: V, Networked: N, SimState: S } = w.c;
  const P = w.config.player;
  const dt = w.dt;
  const half = w.config.arena.halfExtent;
  const pillars = w.config.arena.pillars;
  const walls = wallsOf(w);
  const up: number[] = [];
  for (const [, eid] of sortedPlayers(w)) if (isUp(w, eid)) up.push(eid);
  const magnets = up.map((eid) => derivedStats(w, eid).magnet);
  const order = liveOrder(w);
  for (let k = 0; k < order.length; k++) {
    const eid = order[k] as number;
    const kind = N.kind[eid];
    if (kind === EntityKind.Enemy) {
      if (((S.flags[eid] ?? 0) & EntityFlag.Dead) !== 0) continue;
      const r = enemyType(w, eid).radius;
      let x = (T.x[eid] ?? 0) + (V.x[eid] ?? 0) * dt;
      let z = (T.z[eid] ?? 0) + (V.z[eid] ?? 0) * dt;
      const staggered = staggerOf(w, eid) > 0;
      for (const p of pillars) {
        const ox = x - p.x;
        const oz = z - p.z;
        const min = p.radius + r;
        const d2 = ox * ox + oz * oz;
        if (d2 < min * min) {
          const d = Math.sqrt(d2);
          if (d > 1e-6) {
            x = p.x + (ox / d) * min;
            z = p.z + (oz / d) * min;
            if (staggered) {
              // Knocked into a pillar: bounce off it.
              const ux = ox / d;
              const uz = oz / d;
              const vn = (V.x[eid] ?? 0) * ux + (V.z[eid] ?? 0) * uz;
              if (vn < 0) {
                V.x[eid] = (V.x[eid] ?? 0) - (1 + KNOCK_RESTITUTION) * vn * ux;
                V.z[eid] = (V.z[eid] ?? 0) - (1 + KNOCK_RESTITUTION) * vn * uz;
              }
            }
          } else x = p.x + min;
        }
      }
      if (walls.length > 0) {
        const [wx, wz, nx, nz] = pushOutOfWalls(walls, x, z, r);
        if ((nx !== 0 || nz !== 0) && staggered) {
          // Knocked into a wall: bounce off it.
          const vn = (V.x[eid] ?? 0) * nx + (V.z[eid] ?? 0) * nz;
          if (vn < 0) {
            V.x[eid] = (V.x[eid] ?? 0) - (1 + KNOCK_RESTITUTION) * vn * nx;
            V.z[eid] = (V.z[eid] ?? 0) - (1 + KNOCK_RESTITUTION) * vn * nz;
          }
        }
        x = wx;
        z = wz;
      }
      for (const pe of up) {
        const ox = x - (T.x[pe] ?? 0);
        const oz = z - (T.z[pe] ?? 0);
        const min = P.radius + r;
        const d2 = ox * ox + oz * oz;
        if (d2 < min * min && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          x = (T.x[pe] ?? 0) + (ox / d) * min;
          z = (T.z[pe] ?? 0) + (oz / d) * min;
        }
      }
      const lim = half - r;
      T.x[eid] = x < -lim ? -lim : x > lim ? lim : x;
      T.z[eid] = z < -lim ? -lim : z > lim ? lim : z;
      T.y[eid] = r;
    } else if (kind === EntityKind.Projectile) {
      // Swept against the pillars (continuous, so a fast bolt never tunnels): a bolt that meets one stops there.
      const x0 = T.x[eid] ?? 0;
      const z0 = T.z[eid] ?? 0;
      const dx = (V.x[eid] ?? 0) * dt;
      const dz = (V.z[eid] ?? 0) * dt;
      let hit = 1;
      for (const p of pillars) {
        const t = segmentCircle(x0, z0, dx, dz, p.x, p.z, p.radius + BOLT_RADIUS);
        if (t >= 0 && t < hit) hit = t;
      }
      if (walls.length > 0) {
        const t = segmentWalls(walls, x0, z0, dx, dz, BOLT_RADIUS);
        if (t >= 0 && t < hit) hit = t;
      }
      const x = x0 + dx * hit;
      const z = z0 + dz * hit;
      T.x[eid] = x;
      T.z[eid] = z;
      if (hit < 1) {
        V.x[eid] = 0;
        V.z[eid] = 0;
        w.doomed.add(eid);
      }
      if (Math.abs(x) > half || Math.abs(z) > half) w.doomed.add(eid);
    } else if (kind === EntityKind.Pickup) {
      // Arena pickups (heal cells) stay where they fell.
      if (w.config.content.arena.enabled) continue;
      const x = T.x[eid] ?? 0;
      const z = T.z[eid] ?? 0;
      let best = -1;
      let bestD2 = Infinity;
      for (let i = 0; i < up.length; i++) {
        const pe = up[i] as number;
        const ox = (T.x[pe] ?? 0) - x;
        const oz = (T.z[pe] ?? 0) - z;
        const d2 = ox * ox + oz * oz;
        const m = magnets[i] ?? 0;
        if (d2 <= m * m && d2 < bestD2) {
          bestD2 = d2;
          best = pe;
        }
      }
      if (best < 0) {
        V.x[eid] = 0;
        V.z[eid] = 0;
        continue;
      }
      const d = Math.sqrt(bestD2);
      if (d > 1e-6) {
        const step = Math.min(d, GEM_PULL_SPEED * dt);
        V.x[eid] = (((T.x[best] ?? 0) - x) / d) * GEM_PULL_SPEED;
        V.z[eid] = (((T.z[best] ?? 0) - z) / d) * GEM_PULL_SPEED;
        T.x[eid] = x + (((T.x[best] ?? 0) - x) / d) * step;
        T.z[eid] = z + (((T.z[best] ?? 0) - z) / d) * step;
      }
    }
  }
}

// ------------------------------------------------------------ combat

/** Hit an enemy: damage, knockback, and the kill (corpse, gem, event) at zero. */
export function hitEnemy(w: InternalWorld, eid: number, damage: number, by: PlayerId, dx: number, dz: number, knock: number): void {
  const { Health: H, Velocity: V } = w.c;
  if (isFlag(w, eid, EntityFlag.Dead)) return;
  const prog = w.config.content.progression;
  if (by > 0 && prog.critChance > 0 && critRoll(w.tick, w.c.Networked.netId[eid] ?? 0) < prog.critChance) {
    damage = Math.round(damage * prog.critMultiplier);
    // A rolling crit counter in timers bits 8..11 (snapshots carry it): clients draw a crit number when it changes.
    const t = w.c.SimState.timers[eid] ?? 0;
    w.c.SimState.timers[eid] = (t & ~0x0f00) | ((((t >>> 8) + 1) & 0xf) << 8);
  }
  damage = absorbShield(w, eid, damage);
  const before = H.hp[eid] ?? 0;
  const hp = before - damage;
  H.hp[eid] = hp;
  tallyDamage(w, by, Math.min(before, damage));
  if (hp <= 0) {
    killEnemy(w, eid, by);
    return;
  }
  const len = Math.hypot(dx, dz);
  if (knock > 0 && len > 1e-6) {
    const k = knock / massOf(enemyType(w, eid));
    // A fresh stagger starts from rest along the hit, so the push reads clearly instead of fighting the chase.
    const keep = staggerOf(w, eid) > 0 || k < 0.5 ? 1 : 0;
    V.x[eid] = (V.x[eid] ?? 0) * keep + (dx / len) * k;
    V.z[eid] = (V.z[eid] ?? 0) * keep + (dz / len) * k;
    if (k >= 0.5) setStagger(w, eid, Math.max(staggerOf(w, eid), staggerTicks(k)));
  }
}

/** Kill an enemy now (corpse, gem, event), credited to `by` (0: nobody). */
export function killEnemyBy(w: InternalWorld, eid: number, by: PlayerId): void {
  killEnemy(w, eid, by);
}

function killEnemy(w: InternalWorld, eid: number, by: PlayerId): void {
  const { Transform: T, Velocity: V, SimState: S, Health: H, Networked: N } = w.c;
  const G = w.c.Game;
  const type = G.type[eid] ?? 0;
  const def = enemyType(w, eid);
  H.hp[eid] = 0;
  S.flags[eid] = (S.flags[eid] ?? 0) | EntityFlag.Dead;
  S.cooldown[eid] = w.config.content.coop.corpseTicks;
  V.x[eid] = 0;
  V.z[eid] = 0;
  w.typeCount[type] = (w.typeCount[type] ?? 0) - 1;
  w.corpseCount++;
  w.kills++;
  w.events.push({ type: "enemy.killed", netId: N.netId[eid] ?? 0, by, enemyType: type, boss: def.boss === true, ...(isFlag(w, eid, EntityFlag.Elite) ? { elite: true } : {}) });
  G.level[eid] = 0;
  onEnemyDeath(w, eid, def);
  dropsOnDeath(w, eid, def);
  const xp = Math.round(enemyXp(w, eid) * xpBoostOf(w));
  if (xp <= 0) return;
  if (bossLoot(w, eid, def, xp)) return;
  const prog = w.config.content.progression;
  // A crowded floor merges gems into the nearest one.
  if (mergeGem(w, T.x[eid] ?? 0, T.z[eid] ?? 0, xp)) return;
  if (w.pickupCount < prog.maxPickups && w.byNetId.size < w.config.maxEntities) {
    const tier = def.xp >= 25 ? 2 : def.xp >= 5 ? 1 : 0;
    const g = spawnEntity(w, EntityKind.Pickup, [T.x[eid] ?? 0, 0.3, T.z[eid] ?? 0], { type: tier });
    G.value[g] = xp;
    w.events.push({ type: "entity.spawned", netId: N.netId[g] ?? 0, kind: EntityKind.Pickup });
  } else {
    // The floor is full: XP goes straight to the killer.
    const killer = w.players.get(by);
    if (killer !== undefined) addXp(w, killer, xp);
  }
}

/** Orbit blade angle for blade i of n at a tick (radians). Exported so renderers draw blades where the sim hits. */
export function orbitAngle(tick: number, tickRate: number, speed: number, i: number, n: number): number {
  return ((tick / tickRate) * speed + (Math.PI * 2 * i) / n) % (Math.PI * 2);
}

export function contentCombat(
  w: InternalWorld,
  forEnemiesNear: (x: number, z: number, r: number, fn: (eid: number) => boolean | void) => void,
): void {
  const { Transform: T, Networked: N, SimState: S, Health: H, Velocity: V } = w.c;
  const G = w.c.Game;
  const P = w.config.player;
  const content = w.config.content;
  const reachPad = w.maxEnemyRadius;
  turnBoomerangs(w, liveOrder(w));

  for (const eid of liveOrder(w)) {
    if (N.kind[eid] === EntityKind.Enemy && (S.cooldown[eid] ?? 0) > 0 && !isFlag(w, eid, EntityFlag.Dead)) {
      S.cooldown[eid] = (S.cooldown[eid] ?? 0) - 1;
    }
  }

  for (const [pid, pe] of sortedPlayers(w)) {
    const packed = G.weapons[pe] ?? 0;
    let wcd = G.wcd[pe] ?? 0;
    // Cooldowns run down even while downed, so a revive is not a stall.
    for (let s = 0; s < 4; s++) {
      const cd = slotByte(wcd, s);
      if (cd > 0) wcd = setByte(wcd, s, cd - 1);
    }
    if (!isUp(w, pe)) {
      G.wcd[pe] = wcd;
      continue;
    }
    const px = T.x[pe] ?? 0;
    const pz = T.z[pe] ?? 0;
    const ds = derivedStats(w, pe);
    for (let s = 0; s < 4; s++) {
      const wi = slotWeapon(packed, s);
      const def = wi >= 0 ? content.weapons[wi] : undefined;
      if (!def) continue;
      const sc = scaledWeapon(def, slotLevel(packed, s), ds);
      tallyWeapon(w, wi);
      if (def.kind === "orbit") {
        for (let b = 0; b < sc.count; b++) {
          const a = orbitAngle(w.tick, w.tickRate, sc.speed, b, sc.count);
          const bx = px + Math.cos(a) * sc.range;
          const bz = pz + Math.sin(a) * sc.range;
          forEnemiesNear(bx, bz, ORBIT_BLADE_RADIUS + reachPad, (o) => {
            if (((w.tick + (N.netId[o] ?? 0)) % ORBIT_HIT_EVERY) !== 0) return;
            const ox = (T.x[o] ?? 0) - bx;
            const oz = (T.z[o] ?? 0) - bz;
            const rr = ORBIT_BLADE_RADIUS + enemyType(w, o).radius;
            if (ox * ox + oz * oz > rr * rr) return;
            hitEnemy(w, o, sc.damage, pid, (T.x[o] ?? 0) - px, (T.z[o] ?? 0) - pz, sc.knockback);
          });
        }
        continue;
      }
      if (slotByte(wcd, s) > 0) continue;
      if (def.kind === "cone" || def.kind === "chain" || def.kind === "aura" || def.kind === "meteor") {
        if (fireShape(w, forEnemiesNear, pid, pe, wi, def, sc)) wcd = setByte(wcd, s, sc.cooldown);
        continue;
      }
      if (def.kind === "nova") {
        const r2 = sc.range * sc.range;
        let any = false;
        forEnemiesNear(px, pz, sc.range, (o) => {
          if (isFlag(w, o, EntityFlag.Dead)) return;
          const ox = (T.x[o] ?? 0) - px;
          const oz = (T.z[o] ?? 0) - pz;
          if (ox * ox + oz * oz <= r2) {
            any = true;
            return false;
          }
        });
        if (!any) continue;
        wcd = setByte(wcd, s, sc.cooldown);
        w.events.push({ type: "player.pulse", playerId: pid, netId: N.netId[pe] ?? 0 });
        forEnemiesNear(px, pz, sc.range, (o) => {
          const ox = (T.x[o] ?? 0) - px;
          const oz = (T.z[o] ?? 0) - pz;
          if (ox * ox + oz * oz > r2) return;
          hitEnemy(w, o, sc.damage, pid, ox, oz, sc.knockback);
        });
      } else if (def.kind === "bolt" || def.kind === "boomerang") {
        // bolt (and boomerang): aim at the nearest living enemy in range.
        let best = -1;
        let bestD2 = sc.range * sc.range;
        forEnemiesNear(px, pz, sc.range, (o) => {
          if (isFlag(w, o, EntityFlag.Dead)) return;
          const ox = (T.x[o] ?? 0) - px;
          const oz = (T.z[o] ?? 0) - pz;
          const d2 = ox * ox + oz * oz;
          if (d2 < bestD2 || (d2 === bestD2 && best >= 0 && (N.netId[o] ?? 0) < (N.netId[best] ?? 0))) {
            bestD2 = d2;
            best = o;
          }
        });
        if (best < 0) continue;
        wcd = setByte(wcd, s, sc.cooldown);
        const base = Math.atan2((T.z[best] ?? 0) - pz, (T.x[best] ?? 0) - px);
        const boomerang = def.kind === "boomerang";
        // A boomerang flies out to its range and back: twice the life, and it passes through everything.
        const life = Math.min(255, Math.ceil((sc.range / Math.max(1, sc.speed)) * w.tickRate) * (boomerang ? 2 : 1) + 4);
        for (let b = 0; b < sc.count; b++) {
          if (w.byNetId.size >= w.config.maxEntities) break;
          const a = base + (b - (sc.count - 1) / 2) * (boomerang ? 0.5 : 0.18);
          const p = spawnEntity(w, EntityKind.Projectile, [px, BOLT_HEIGHT, pz], { owner: pid, type: wi });
          V.x[p] = Math.cos(a) * sc.speed;
          V.z[p] = Math.sin(a) * sc.speed;
          T.yaw[p] = Math.atan2(-(V.x[p] ?? 0), -(V.z[p] ?? 0));
          G.value[p] = sc.damage;
          G.level[p] = boomerang ? 255 : sc.pierce;
          G.stats[p] = boomerang ? life - 4 : 0;
          S.cooldown[p] = life;
          w.events.push({ type: "entity.spawned", netId: N.netId[p] ?? 0, kind: EntityKind.Projectile });
        }
      }
    }
    G.wcd[pe] = wcd;
  }
  tallyWeapon(w, -1);

  // Projectiles: first enemy touched takes the hit; pierce counts down.
  const order = liveOrder(w);
  for (let k = 0; k < order.length; k++) {
    const p = order[k] as number;
    if (N.kind[p] !== EntityKind.Projectile || w.doomed.has(p) || isFlag(w, p, EntityFlag.Hostile) || isFlag(w, p, EntityFlag.Elite)) continue;
    const x = T.x[p] ?? 0;
    const z = T.z[p] ?? 0;
    let hit = -1;
    forEnemiesNear(x, z, BOLT_RADIUS + reachPad, (o) => {
      if (isFlag(w, o, EntityFlag.Dead) || (N.netId[o] ?? 0) === (G.xp[p] ?? 0)) return;
      const ox = (T.x[o] ?? 0) - x;
      const oz = (T.z[o] ?? 0) - z;
      const rr = BOLT_RADIUS + enemyType(w, o).radius;
      if (ox * ox + oz * oz <= rr * rr) {
        hit = o;
        return false;
      }
    });
    if (hit < 0) continue;
    const def = content.weapons[G.type[p] ?? 0];
    G.xp[p] = N.netId[hit] ?? 0;
    tallyWeapon(w, G.type[p] ?? 0);
    hitEnemy(w, hit, G.value[p] ?? 0, w.c.Owner.player[p] ?? 0, V.x[p] ?? 0, V.z[p] ?? 0, def?.knockback ?? 0);
    const pierce = (G.level[p] ?? 0) - 1;
    if (pierce < 0) w.doomed.add(p);
    else G.level[p] = pierce;
  }
  // Enemy shots and boss hazards (roles.ts): they hurt players, never enemies.
  hostileProjectiles(w, order);
  // Players' meteors (weapons.ts) land on enemies.
  friendlyHazards(w, forEnemiesNear, order);
  tallyWeapon(w, -1);

  // Contact damage to players that are up, not invulnerable.
  for (const [pid, pe] of sortedPlayers(w)) {
    if (!isUp(w, pe) || (G.iframes[pe] ?? 0) > 0) continue;
    const px = T.x[pe] ?? 0;
    const pz = T.z[pe] ?? 0;
    const netId = N.netId[pe] ?? 0;
    const armor = derivedStats(w, pe).armor;
    const hitIframes = content.coop.hitIframeTicks;
    forEnemiesNear(px, pz, P.radius + reachPad + 0.05, (o) => {
      if (isFlag(w, o, EntityFlag.Dead) || (S.cooldown[o] ?? 0) > 0) return;
      const def = enemyType(w, o);
      const raw = enemyDamage(w, o);
      if (raw <= 0) return;
      const ox = (T.x[o] ?? 0) - px;
      const oz = (T.z[o] ?? 0) - pz;
      const reach = P.radius + def.radius + 0.05;
      if (ox * ox + oz * oz > reach * reach) return;
      S.cooldown[o] = w.config.enemies.contactCooldownTicks;
      // A telegraphed charge hits twice as hard as a touch.
      const source = contactSource(w, o);
      const damage = Math.max(1, Math.round(raw * (source === "charge" ? 2 : 1)) - armor);
      const hp = Math.max(0, (H.hp[pe] ?? 0) - damage);
      H.hp[pe] = hp;
      w.events.push({ type: "player.hit", playerId: pid, netId, by: N.netId[o] ?? 0, damage, health: hp, source });
      if (hp === 0) {
        downPlayer(w, pe, pid);
        return false;
      }
      // Hit i-frames: one touch per window, however many enemies are touching.
      if (hitIframes > 0) {
        G.iframes[pe] = Math.max(G.iframes[pe] ?? 0, hitIframes);
        return false;
      }
    });
  }
}

setDownHook((w, eid, pid) => downPlayer(w, eid, pid));

function downPlayer(w: InternalWorld, eid: number, pid: PlayerId): void {
  const { SimState: S, Velocity: V } = w.c;
  const G = w.c.Game;
  S.flags[eid] = ((S.flags[eid] ?? 0) | EntityFlag.Downed) & ~EntityFlag.Dashing;
  setBleed(w, eid, w.config.content.coop.downedTicks);
  G.revive[eid] = 0;
  G.dash[eid] = 0;
  V.x[eid] = V.y[eid] = V.z[eid] = 0;
  w.events.push({ type: "player.downed", playerId: pid, netId: w.c.Networked.netId[eid] ?? 0 });
}

// ------------------------------------------------------------ pickups

export function contentPickups(w: InternalWorld): void {
  const { Transform: T, Networked: N } = w.c;
  if (w.pickupCount === 0) return;
  const up: number[] = [];
  for (const [, eid] of sortedPlayers(w)) if (isUp(w, eid)) up.push(eid);
  if (up.length === 0) return;
  const order = liveOrder(w);
  for (let k = 0; k < order.length; k++) {
    const g = order[k] as number;
    if (N.kind[g] !== EntityKind.Pickup || w.doomed.has(g)) continue;
    const x = T.x[g] ?? 0;
    const z = T.z[g] ?? 0;
    for (const pe of up) {
      const ox = (T.x[pe] ?? 0) - x;
      const oz = (T.z[pe] ?? 0) - z;
      if (ox * ox + oz * oz <= GEM_COLLECT * GEM_COLLECT) {
        const type = w.c.Game.type[g] ?? 0;
        const special = type >= PICKUP_SPECIAL ? w.config.content.pickups[type - PICKUP_SPECIAL] : undefined;
        w.doomed.add(g);
        if (special) applyPickup(w, pe, special);
        else shareXp(w, pe, up, w.c.Game.value[g] ?? 0);
        break;
      }
    }
  }
}

/**
 * A gem's XP: the collector gets it all; teammates get progression.xpShare
 * ("nearby": a fraction within a radius; "all": the full amount).
 */
export function shareXp(w: InternalWorld, collector: number, up: readonly number[], amount: number): void {
  addXp(w, collector, amount);
  const share = w.config.content.progression.xpShare;
  if (share.mode === "collector" || amount <= 0) return;
  const { Transform: T } = w.c;
  const r2 = share.radius * share.radius;
  const part = share.mode === "all" ? amount : Math.round(amount * share.fraction);
  if (part <= 0) return;
  for (const o of up) {
    if (o === collector) continue;
    if (share.mode === "nearby") {
      const dx = (T.x[o] ?? 0) - (T.x[collector] ?? 0);
      const dz = (T.z[o] ?? 0) - (T.z[collector] ?? 0);
      if (dx * dx + dz * dz > r2) continue;
    }
    addXp(w, o, part);
  }
}

// ------------------------------------------------------------ game rules

export function contentRules(w: InternalWorld): void {
  const { Transform: T, SimState: S, Health: H } = w.c;
  const G = w.c.Game;
  const coop = w.config.content.coop;
  const players = sortedPlayers(w);
  for (const [pid, eid] of players) {
    if ((G.iframes[eid] ?? 0) > 0) G.iframes[eid] = (G.iframes[eid] ?? 0) - 1;
    const buff = buffTicksOf(w, eid);
    if (buff > 0) setBuffTicks(w, eid, buff - 1);
    const flags = S.flags[eid] ?? 0;
    if ((flags & EntityFlag.Dead) !== 0) {
      // Out: back beside a teammate who is up once the respawn countdown ends (never with nobody up).
      if (coop.respawnTicks > 0) {
        const t = bleedTicks(w, eid);
        if (t > 1) setBleed(w, eid, t - 1);
        else {
          const anchor = players.find(([, o]) => o !== eid && isUp(w, o))?.[1];
          if (anchor !== undefined) respawnBeside(w, pid, eid, anchor);
          else setBleed(w, eid, 1);
        }
      }
      continue;
    }
    if ((flags & EntityFlag.Downed) === 0) {
      const ds = derivedStats(w, eid);
      if (ds.regen > 0 && w.tick % w.tickRate === 0) H.hp[eid] = Math.min(ds.maxHealth, (H.hp[eid] ?? 0) + ds.regen);
      if ((H.hp[eid] ?? 0) > ds.maxHealth) H.hp[eid] = ds.maxHealth;
      continue;
    }
    // Downed: a teammate standing close revives; otherwise bleed out.
    let reviver: PlayerId = 0;
    const r2 = coop.reviveRadius * coop.reviveRadius;
    for (const [opid, o] of players) {
      if (o === eid || !isUp(w, o)) continue;
      const ox = (T.x[o] ?? 0) - (T.x[eid] ?? 0);
      const oz = (T.z[o] ?? 0) - (T.z[eid] ?? 0);
      if (ox * ox + oz * oz <= r2) {
        reviver = opid;
        break;
      }
    }
    if (reviver !== 0) {
      const p = (G.revive[eid] ?? 0) + 1;
      G.revive[eid] = p;
      if (p >= coop.reviveTicks) {
        raise(w, eid, coop.reviveHealth);
        const by = w.players.get(reviver);
        if (by !== undefined && coop.reviveBuffTicks > 0) setBuffTicks(w, by, coop.reviveBuffTicks);
        w.events.push({ type: "player.revived", playerId: pid, netId: w.c.Networked.netId[eid] ?? 0, by: reviver });
      }
      continue;
    }
    G.revive[eid] = Math.max(0, (G.revive[eid] ?? 0) - 2);
    const bleed = bleedTicks(w, eid) - 1;
    setBleed(w, eid, Math.max(0, bleed));
    if (bleed <= 0) {
      // A free self-revive nobody pressed for is spent by itself, never wasted.
      if (selfRevivesLeft(w, eid) > 0) {
        selfRevive(w, eid);
        continue;
      }
      S.flags[eid] = (flags & ~EntityFlag.Downed) | EntityFlag.Dead;
      G.revive[eid] = 0;
      setBleed(w, eid, coop.respawnTicks);
      w.events.push({ type: "player.died", playerId: pid, netId: w.c.Networked.netId[eid] ?? 0 });
    }
  }
}

/** Players' Game.bleed: downed (or respawn) ticks left in bits 0..11, self-revives used this run in bits 12..15. */
const bleedTicks = (w: InternalWorld, eid: number): number => (w.c.Game.bleed[eid] ?? 0) & 0xfff;
const selfRevivesUsed = (w: InternalWorld, eid: number): number => ((w.c.Game.bleed[eid] ?? 0) >>> 12) & 0xf;
function setBleed(w: InternalWorld, eid: number, ticks: number, used = selfRevivesUsed(w, eid)): void {
  w.c.Game.bleed[eid] = (((used & 0xf) << 12) | (Math.max(0, Math.min(0xfff, ticks)) & 0xfff)) >>> 0;
}

/** Free self-revives a player has left this run. */
export function selfRevivesLeft(w: InternalWorld, eid: number): number {
  return Math.max(0, w.config.content.coop.selfRevives - selfRevivesUsed(w, eid));
}

/** Spend a free self-revive: up with revive health, i-frames, and a shove. */
function selfRevive(w: InternalWorld, eid: number): void {
  const used = selfRevivesUsed(w, eid) + 1;
  raise(w, eid, w.config.content.coop.reviveHealth);
  setBleed(w, eid, 0, used);
  shove(w, eid, w.config.content.coop.risePulseRadius);
  const pid = w.c.Owner.player[eid] ?? 0;
  w.events.push({ type: "player.revived", playerId: pid, netId: w.c.Networked.netId[eid] ?? 0, by: pid });
}

/** Bring one out player back next to `anchor` (a teammate who is up). */
function respawnBeside(w: InternalWorld, pid: PlayerId, eid: number, anchor: number): void {
  const { Transform: T } = w.c;
  let x = (T.x[anchor] ?? 0) + 1;
  let z = T.z[anchor] ?? 0;
  // Never inside a dungeon wall beside the teammate.
  const walls = wallsOf(w);
  if (walls.length > 0 && inWall(walls, x, z, w.config.player.radius + 0.05)) {
    x = T.x[anchor] ?? 0;
    z = T.z[anchor] ?? 0;
  }
  const y = w.config.arena.spawn[1];
  T.x[eid] = T.px[eid] = x;
  T.y[eid] = T.py[eid] = y;
  T.z[eid] = T.pz[eid] = z;
  w.colliders.get(eid)?.setTranslation({ x, y, z });
  raise(w, eid, 0.5);
  shove(w, eid, w.config.content.coop.risePulseRadius);
  w.events.push({ type: "player.respawned", playerId: pid, netId: w.c.Networked.netId[eid] ?? 0 });
}

/** Stand a downed or dead player up with a fraction of max health and fresh invulnerability. */
export function raise(w: InternalWorld, eid: number, healthFraction: number): void {
  const { SimState: S, Health: H } = w.c;
  const G = w.c.Game;
  S.flags[eid] = (S.flags[eid] ?? 0) & ~(EntityFlag.Downed | EntityFlag.Dead);
  setBleed(w, eid, 0);
  G.revive[eid] = 0;
  G.iframes[eid] = w.config.content.coop.iframeTicks;
  H.hp[eid] = Math.max(1, Math.round(derivedStats(w, eid).maxHealth * healthFraction));
}

// ------------------------------------------------------------ lifetime

export function contentLifetime(w: InternalWorld): void {
  flushRoleSpawns(w);
  const { Networked: N, SimState: S } = w.c;
  for (const eid of liveOrder(w)) {
    const kind = N.kind[eid];
    if (kind === EntityKind.Enemy) {
      if (((S.flags[eid] ?? 0) & EntityFlag.Dead) === 0) continue;
      const cd = (S.cooldown[eid] ?? 0) - 1;
      S.cooldown[eid] = Math.max(0, cd);
      if (cd <= 0) w.doomed.add(eid);
    } else if (kind === EntityKind.Projectile) {
      const cd = (S.cooldown[eid] ?? 0) - 1;
      S.cooldown[eid] = Math.max(0, cd);
      if (cd <= 0) w.doomed.add(eid);
    }
  }
}

// ------------------------------------------------------------ run control (server side)

/** Spawn one enemy of a type at (x, z), clamped inside the arena and off the pillars, with optional stat multipliers. */
export function spawnEnemyAt(w: InternalWorld, type: number, x: number, z: number, scale?: SpawnScale): number {
  const def = w.config.content.enemyTypes[type];
  if (!def) throw new RangeError(`engine-sim: unknown enemy type ${type}`);
  const half = w.config.arena.halfExtent - def.radius - 0.5;
  x = x < -half ? -half : x > half ? half : x;
  z = z < -half ? -half : z > half ? half : z;
  for (const p of w.config.arena.pillars) {
    const ox = x - p.x;
    const oz = z - p.z;
    const min = p.radius + def.radius + 0.05;
    if (ox * ox + oz * oz < min * min) x = p.x + (ox >= 0 ? min : -min);
  }
  const walls = wallsOf(w);
  if (walls.length > 0) [x, z] = pushOutOfWalls(walls, x, z, def.radius + 0.05);
  const eid = spawnEntity(w, EntityKind.Enemy, [x, def.radius, z], { type });
  const G = w.c.Game;
  // Elites: x6 health, x1.5 damage, x5 XP, and a flag clients draw as a gold rim at 1.5x scale.
  const elite = scale?.elite === true;
  const hp = Math.max(1, Math.min(0x7fffffff, Math.round(def.health * (scale?.health ?? 1) * (elite ? 6 : 1))));
  w.c.Health.hp[eid] = hp;
  G.stats[eid] = hp;
  G.value[eid] = Math.max(0, Math.round(def.damage * (scale?.damage ?? 1) * (elite ? 1.5 : 1)));
  G.xp[eid] = Math.max(0, Math.round(def.xp * (scale?.xp ?? 1) * (elite ? 5 : 1)));
  if (elite) w.c.SimState.flags[eid] = (w.c.SimState.flags[eid] ?? 0) | EntityFlag.Elite;
  G.bleed[eid] = 0;
  w.events.push({ type: "entity.spawned", netId: w.c.Networked.netId[eid] ?? 0, kind: EntityKind.Enemy, ...(scale?.from ? { from: scale.from } : {}) });
  return eid;
}

// ------------------------------------------------------------ spawn edge and stragglers (server side)

/** Distance from a player to the edge of the screen at heading `a` (radians from +x toward +z), m. */
export function viewRadius(w: InternalWorld, a: number): number {
  const radii = w.config.content.view.radii;
  const n = radii.length;
  let t = (a / (Math.PI * 2)) * n;
  t = ((t % n) + n) % n;
  const i = Math.floor(t);
  const f = t - i;
  const r0 = radii[i % n] ?? 22;
  const r1 = radii[(i + 1) % n] ?? 22;
  return r0 + (r1 - r0) * f;
}

/** True when (x, z) is on the screen of any player who is up (grown by `margin` m). */
export function onAnyScreen(w: InternalWorld, x: number, z: number, margin = 0): boolean {
  const T = w.c.Transform;
  for (const [, eid] of sortedPlayers(w)) {
    if (!isUp(w, eid)) continue;
    const ox = x - (T.x[eid] ?? 0);
    const oz = z - (T.z[eid] ?? 0);
    const r = viewRadius(w, Math.atan2(oz, ox)) + margin;
    if (ox * ox + oz * oz < r * r) return true;
  }
  return false;
}

/** Inside the arena with a margin, and clear of every pillar. */
export function clearSpot(w: InternalWorld, x: number, z: number, radius: number): boolean {
  const lim = w.config.arena.halfExtent - radius - 0.5;
  if (x < -lim || x > lim || z < -lim || z > lim) return false;
  for (const p of w.config.arena.pillars) {
    const ox = x - p.x;
    const oz = z - p.z;
    const min = p.radius + radius + 0.3;
    if (ox * ox + oz * oz < min * min) return false;
  }
  // A dungeon: on a floor (a room or corridor, never the rock between), clear of the walls.
  const floors = w.config.arena.floors;
  if (floors && floors.length > 0 && !onFloor(floors, x, z, radius + 0.3)) return false;
  const walls = wallsOf(w);
  if (walls.length > 0 && inWall(walls, x, z, radius + 0.3)) return false;
  return true;
}

/**
 * A point just outside the screen of player `eid`: at the view edge plus
 * `margin` (and up to 2 m more), on a heading inside `heading ± spread/2`
 * (any heading when `heading` is null). A point outside the arena, inside a
 * pillar or on any player's screen is rejected and another heading tried;
 * after half the tries the heading opens to the full circle. Null when
 * nothing fits: the caller skips the spawn rather than clamp it on screen.
 */
export function edgePoint(
  w: InternalWorld,
  eid: number,
  heading: number | null,
  spread: number,
  margin: number,
  radius: number,
  tries = 12,
): [number, number] | null {
  const T = w.c.Transform;
  const px = T.x[eid] ?? 0;
  const pz = T.z[eid] ?? 0;
  for (let i = 0; i < tries; i++) {
    const free = heading === null || i >= tries / 2;
    const a = free ? nextRandom(w) * Math.PI * 2 : heading + (nextRandom(w) - 0.5) * spread;
    const d = viewRadius(w, a) + margin + nextRandom(w) * 2;
    const x = px + Math.cos(a) * d;
    const z = pz + Math.sin(a) * d;
    if (clearSpot(w, x, z, radius) && !onAnyScreen(w, x, z, margin * 0.5)) return [x, z];
  }
  return null;
}

/** A point on a ring of `radius` around (cx, cz), retrying headings instead of clamping it to a wall or a pillar. */
export function ringSpot(w: InternalWorld, cx: number, cz: number, radius: number, enemyRadius: number, tries = 8): [number, number] | null {
  for (let i = 0; i < tries; i++) {
    const a = nextRandom(w) * Math.PI * 2;
    const x = cx + Math.cos(a) * radius;
    const z = cz + Math.sin(a) * radius;
    if (clearSpot(w, x, z, enemyRadius)) return [x, z];
  }
  return null;
}

/** Players who are up, in playerId order (ECS ids). */
export function upPlayers(w: InternalWorld): number[] {
  const out: number[] = [];
  for (const [, eid] of sortedPlayers(w)) if (isUp(w, eid)) out.push(eid);
  return out;
}

/**
 * Straggler recycling. Call every `period` ticks. A non-boss enemy that
 * has stayed beyond every player's view plus `margin` for `after` ticks is
 * moved to the spawn edge ahead of a moving player (it keeps its netId, so
 * the move costs one position update), or removed when there is no valid
 * spot. The pressure follows the players without filling the map.
 */
export function recycleStragglers(w: InternalWorld, period: number, after: number, margin: number): { moved: number; removed: number } {
  const { Transform: T, Velocity: V, Networked: N } = w.c;
  const G = w.c.Game;
  const up = upPlayers(w);
  let moved = 0;
  let removed = 0;
  if (up.length === 0) return { moved, removed };
  for (const eid of [...liveOrder(w)]) {
    if (N.kind[eid] !== EntityKind.Enemy || isFlag(w, eid, EntityFlag.Dead)) continue;
    const def = enemyType(w, eid);
    // Bosses, props and anything that stands still stay where they are.
    if (def.boss || def.prop || def.ai === "idle") continue;
    const x = T.x[eid] ?? 0;
    const z = T.z[eid] ?? 0;
    let far = true;
    for (const pe of up) {
      const ox = x - (T.x[pe] ?? 0);
      const oz = z - (T.z[pe] ?? 0);
      const r = viewRadius(w, Math.atan2(oz, ox)) + margin;
      if (ox * ox + oz * oz <= r * r) {
        far = false;
        break;
      }
    }
    if (!far) {
      G.bleed[eid] = 0;
      continue;
    }
    const t = Math.min(0xffff, (G.bleed[eid] ?? 0) + period);
    G.bleed[eid] = t;
    if (t < after) continue;
    const target = up[Math.floor(nextRandom(w) * up.length)] as number;
    const vx = V.x[target] ?? 0;
    const vz = V.z[target] ?? 0;
    const moving = vx * vx + vz * vz > 1;
    const spot = edgePoint(w, target, moving ? Math.atan2(vz, vx) : null, (100 * Math.PI) / 180, 2, def.radius, 8);
    if (spot) {
      T.x[eid] = T.px[eid] = spot[0];
      T.z[eid] = T.pz[eid] = spot[1];
      V.x[eid] = 0;
      V.z[eid] = 0;
      G.bleed[eid] = 0;
      moved++;
    } else {
      const netId = N.netId[eid] ?? 0;
      despawnEntity(w, eid);
      w.events.push({ type: "entity.removed", netId, kind: EntityKind.Enemy });
      removed++;
    }
  }
  return { moved, removed };
}

/** Clear every enemy, gem and projectile; reset each player to a fresh run at the spawn. */
export function resetRunState(w: InternalWorld): void {
  const { Networked: N, Transform: T, Velocity: V, SimState: S } = w.c;
  for (const eid of [...liveOrder(w)]) if (N.kind[eid] !== EntityKind.Player) despawnEntity(w, eid);
  w.doomed.clear();
  liveOrder(w);
  const [sx, sy, sz] = w.config.arena.spawn;
  const spawns = w.config.content.arena.enabled ? w.config.content.arena.spawns : [];
  sortedPlayers(w).forEach(([pid, eid], i) => {
    // Arena: one spawn point each, round robin. Co-op: a line at the spawn.
    const at = spawns[i % Math.max(1, spawns.length)];
    const x = at ? at[0] : sx + (pid - 1) * 1.5;
    const z = at ? at[1] : sz;
    T.x[eid] = T.px[eid] = x;
    T.y[eid] = T.py[eid] = sy;
    T.z[eid] = T.pz[eid] = z;
    V.x[eid] = V.y[eid] = V.z[eid] = 0;
    S.flags[eid] = 0;
    S.cooldown[eid] = 0;
    S.timers[eid] = 0;
    // A fresh run: rerolls and buffs go; the keeper stays.
    w.c.Game.value[eid] = (w.c.Game.value[eid] ?? 0) & (0xf << 12);
    initProgression(w, eid);
    w.colliders.get(eid)?.setTranslation({ x, y: sy, z });
  });
  w.kills = 0;
  resetTally(w);
}

/** Bring every dead (out) player back next to a living teammate (or the spawn). */
export function respawnDeadPlayers(w: InternalWorld): PlayerId[] {
  const { Transform: T } = w.c;
  const players = sortedPlayers(w);
  const anchor = players.find(([, e]) => isUp(w, e))?.[1];
  const out: PlayerId[] = [];
  for (const [pid, eid] of players) {
    if (!isFlag(w, eid, EntityFlag.Dead)) continue;
    const [sx, sy, sz] = w.config.arena.spawn;
    const x = anchor !== undefined ? (T.x[anchor] ?? 0) + 1 : sx;
    const z = anchor !== undefined ? (T.z[anchor] ?? 0) : sz;
    T.x[eid] = T.px[eid] = x;
    T.y[eid] = T.py[eid] = sy;
    T.z[eid] = T.pz[eid] = z;
    w.colliders.get(eid)?.setTranslation({ x, y: sy, z });
    raise(w, eid, 0.5);
    out.push(pid);
  }
  return out;
}

/** Pick a random spawn ring point around a random living player (server-side waves). */
export function ringPoint(w: InternalWorld, radius: number): [number, number] {
  const up: number[] = [];
  for (const [, eid] of sortedPlayers(w)) if (isUp(w, eid)) up.push(eid);
  const a = up.length > 0 ? up[Math.floor(nextRandom(w) * up.length)] : undefined;
  const [sx, , sz] = w.config.arena.spawn;
  const cx = a === undefined ? sx : (w.c.Transform.x[a] ?? 0);
  const cz = a === undefined ? sz : (w.c.Transform.z[a] ?? 0);
  const ang = nextRandom(w) * Math.PI * 2;
  return [cx + Math.cos(ang) * radius, cz + Math.sin(ang) * radius];
}
