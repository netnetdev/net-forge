import { DEFAULT_TICK_RATE } from "./api.js";
import type {
  ArenaConfig,
  ArenaRules,
  CoopRules,
  EnemyRules,
  EnemyTypeDef,
  PlayerRules,
  ProgressionRules,
  ResolvedContent,
  ResolvedSimConfig,
  SimConfig,
  ViewRules,
} from "./api.js";

export const DEFAULT_ARENA: ArenaConfig = {
  halfExtent: 60,
  wallHeight: 3,
  pillars: [
    { x: 14, z: 14, radius: 2, height: 4 },
    { x: -14, z: 14, radius: 2, height: 4 },
    { x: 14, z: -14, radius: 2, height: 4 },
    { x: -14, z: -14, radius: 2, height: 4 },
    { x: 32, z: 0, radius: 3, height: 5 },
    { x: -32, z: 0, radius: 3, height: 5 },
    { x: 0, z: 32, radius: 3, height: 5 },
    { x: 0, z: -32, radius: 3, height: 5 },
  ],
  spawn: [0, 1.0, 0],
};

export const DEFAULT_PLAYER: PlayerRules = {
  speed: 7,
  sprintMultiplier: 1.5,
  jumpVelocity: 7,
  gravity: 20,
  radius: 0.4,
  halfHeight: 0.5,
  maxHealth: 100,
  pulseRadius: 4,
  pulseCooldownTicks: 12,
  jumpBufferTicks: 4,
  coyoteTicks: 4,
};

export const DEFAULT_ENEMIES: EnemyRules = {
  target: 0,
  spawnPerTick: 64,
  spawnRadius: 30,
  speed: 3.5,
  radius: 0.35,
  maxHealth: 10,
  contactDamage: 1,
  contactCooldownTicks: 30,
};

export const DEFAULT_PROGRESSION: ProgressionRules = {
  xpBase: 5,
  xpGrowth: 4,
  magnet: 2.5,
  maxWeapons: 4,
  startWeapon: 0,
  maxPickups: 400,
  rerolls: 0,
  xpExponent: 1,
  loadout: [],
  xpShare: { mode: "collector", fraction: 0.5, radius: 20 },
  critChance: 0,
  critMultiplier: 2,
};

export const DEFAULT_ARENA_RULES: ArenaRules = {
  enabled: false,
  authority: true,
  externalHitscan: false,
  respawnTicks: 3 * 30,
  spawnIframeTicks: 2 * 30,
  spawns: [],
  dropHeal: 0,
  pickupTicks: 20 * 30,
};

export const DEFAULT_COOP: CoopRules = {
  downedTicks: 30 * 30,
  reviveTicks: 3 * 30,
  reviveRadius: 2.5,
  reviveHealth: 0.5,
  iframeTicks: 2 * 30,
  corpseTicks: 5,
  dashTicks: 6,
  dashSpeed: 3.2,
  dashCooldownTicks: 45,
  dashBufferTicks: 5,
  hitIframeTicks: 0,
  pauseSolo: false,
  soloFromFlag: false,
  choicePulseRadius: 0,
  choicePulseIframeTicks: 0,
  reviveBuffTicks: 0,
  reviveBuffMight: 1,
  reviveBuffSpeed: 1,
  crawlSpeed: 0,
  selfRevives: 0,
  selfReviveDelayTicks: 15,
  respawnTicks: 0,
  risePulseRadius: 0,
};

/** Default view: a 22 m circle (games compile their camera's real footprint into this). */
export const DEFAULT_VIEW: ViewRules = { radii: Array.from({ length: 32 }, () => 22) };

const finitePositive = (name: string, v: number): number => {
  if (!(Number.isFinite(v) && v > 0)) throw new RangeError(`engine-sim: ${name} must be a positive number, got ${v}`);
  return v;
};

export function resolveConfig(config: SimConfig = {}): ResolvedSimConfig {
  const tickRate = config.tickRate ?? DEFAULT_TICK_RATE;
  if (!Number.isInteger(tickRate) || tickRate < 1 || tickRate > 240) {
    throw new RangeError(`engine-sim: tickRate must be an integer 1..240, got ${tickRate}`);
  }
  const maxEntities = config.maxEntities ?? 8192;
  if (!Number.isInteger(maxEntities) || maxEntities < 1 || maxEntities > 1 << 20) {
    throw new RangeError(`engine-sim: maxEntities must be an integer 1..2^20, got ${maxEntities}`);
  }
  const arena: ArenaConfig = { ...DEFAULT_ARENA, ...config.arena };
  const player: PlayerRules = { ...DEFAULT_PLAYER, ...config.player };
  const enemies: EnemyRules = { ...DEFAULT_ENEMIES, ...config.enemies };
  finitePositive("arena.halfExtent", arena.halfExtent);
  finitePositive("player.speed", player.speed);
  finitePositive("player.radius", player.radius);
  finitePositive("enemies.radius", enemies.radius);
  if (!Number.isInteger(enemies.target) || enemies.target < 0) {
    throw new RangeError(`engine-sim: enemies.target must be a non-negative integer`);
  }
  return {
    tickRate,
    seed: (config.seed ?? 1) >>> 0,
    maxEntities,
    arena,
    player,
    enemies,
    content: resolveContent(config, enemies),
  };
}

const intIn = (name: string, v: number, lo: number, hi: number): number => {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new RangeError(`engine-sim: ${name} must be an integer ${lo}..${hi}, got ${v}`);
  return v;
};
const nonNeg = (name: string, v: number): number => {
  if (!(Number.isFinite(v) && v >= 0)) throw new RangeError(`engine-sim: ${name} must be a non-negative number, got ${v}`);
  return v;
};

function resolveContent(config: SimConfig, enemies: EnemyRules): ResolvedContent {
  const c = config.content ?? {};
  const base: EnemyTypeDef = {
    health: enemies.maxHealth,
    speed: enemies.speed,
    radius: enemies.radius,
    damage: enemies.contactDamage,
    xp: 1,
  };
  const enemyTypes = c.enemyTypes && c.enemyTypes.length > 0 ? c.enemyTypes : [base];
  if (enemyTypes.length > 255) throw new RangeError("engine-sim: at most 255 enemy types");
  enemyTypes.forEach((t, i) => {
    intIn(`enemyTypes[${i}].health`, t.health, 1, 1_000_000);
    nonNeg(`enemyTypes[${i}].speed`, t.speed);
    finitePositive(`enemyTypes[${i}].radius`, t.radius);
    nonNeg(`enemyTypes[${i}].damage`, t.damage);
    intIn(`enemyTypes[${i}].xp`, t.xp, 0, 100_000);
    if (t.mass !== undefined) finitePositive(`enemyTypes[${i}].mass`, t.mass);
  });
  const weapons = c.weapons ?? [];
  if (weapons.length > 15) throw new RangeError("engine-sim: at most 15 weapons");
  weapons.forEach((w, i) => {
    nonNeg(`weapons[${i}].damage`, w.damage);
    intIn(`weapons[${i}].cooldownTicks`, w.cooldownTicks, 1, 255);
    finitePositive(`weapons[${i}].range`, w.range);
    intIn(`weapons[${i}].count`, w.count, 1, 16);
    nonNeg(`weapons[${i}].speed`, w.speed);
    intIn(`weapons[${i}].pierce`, w.pierce, 0, 255);
    nonNeg(`weapons[${i}].knockback`, w.knockback);
    intIn(`weapons[${i}].maxLevel`, w.maxLevel, 1, 15);
    if (w.spread !== undefined) nonNeg(`weapons[${i}].spread`, w.spread);
  });
  const stats = c.stats ?? [];
  if (stats.length > 8) throw new RangeError("engine-sim: at most 8 passive stats");
  if (weapons.length + stats.length > 254) throw new RangeError("engine-sim: too many upgrades");
  stats.forEach((st, i) => {
    nonNeg(`stats[${i}].step`, st.step);
    intIn(`stats[${i}].maxLevel`, st.maxLevel, 1, 15);
  });
  const progression: ProgressionRules = { ...DEFAULT_PROGRESSION, ...c.progression };
  intIn("progression.maxWeapons", progression.maxWeapons, 1, 4);
  if (weapons.length > 0) intIn("progression.startWeapon", progression.startWeapon, -1, weapons.length - 1);
  intIn("progression.maxPickups", progression.maxPickups, 0, 100_000);
  finitePositive("progression.xpBase", progression.xpBase);
  finitePositive("progression.xpExponent", progression.xpExponent);
  const coop: CoopRules = { ...DEFAULT_COOP, ...c.coop };
  intIn("coop.downedTicks", coop.downedTicks, 1, 4095);
  intIn("coop.reviveTicks", coop.reviveTicks, 1, 65535);
  intIn("coop.iframeTicks", coop.iframeTicks, 0, 65535);
  intIn("coop.corpseTicks", coop.corpseTicks, 1, 255);
  intIn("coop.dashTicks", coop.dashTicks, 0, 255);
  intIn("coop.dashCooldownTicks", coop.dashCooldownTicks, 0, 255);
  intIn("coop.dashBufferTicks", coop.dashBufferTicks, 0, 255);
  if (progression.loadout.length > 4) throw new RangeError("engine-sim: a loadout holds at most 4 weapons");
  progression.loadout.forEach((wi, i) => intIn(`progression.loadout[${i}]`, wi, 0, Math.max(0, weapons.length - 1)));
  const arena: ArenaRules = { ...DEFAULT_ARENA_RULES, ...c.arena };
  intIn("arena.respawnTicks", arena.respawnTicks, 1, 65535);
  intIn("arena.spawnIframeTicks", arena.spawnIframeTicks, 0, 65535);
  intIn("arena.dropHeal", arena.dropHeal, 0, 100_000);
  intIn("arena.pickupTicks", arena.pickupTicks, 1, 65535);
  arena.spawns.forEach(([x, z], i) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) throw new RangeError(`engine-sim: arena.spawns[${i}] must be finite`);
  });
  if (arena.enabled && weapons.length === 0) throw new RangeError("engine-sim: arena mode needs at least one weapon");
  intIn("coop.hitIframeTicks", coop.hitIframeTicks, 0, 255);
  nonNeg("coop.choicePulseRadius", coop.choicePulseRadius);
  intIn("coop.choicePulseIframeTicks", coop.choicePulseIframeTicks, 0, 255);
  const view = c.view ?? DEFAULT_VIEW;
  if (view.radii.length < 4 || view.radii.length > 256) throw new RangeError("engine-sim: view.radii needs 4..256 entries");
  view.radii.forEach((r, i) => finitePositive(`view.radii[${i}]`, r));
  const pickups = c.pickups ?? [];
  if (pickups.length > 200) throw new RangeError("engine-sim: at most 200 special pickups");
  const loot = c.loot ?? { chest: -1, heal: -1, vacuum: -1 };
  const mergeGemsAbove = c.mergeGemsAbove ?? 300;
  const share = progression.xpShare;
  if (share.mode !== "collector" && share.mode !== "nearby" && share.mode !== "all") throw new RangeError(`engine-sim: progression.xpShare.mode must be collector, nearby or all`);
  nonNeg("progression.xpShare.fraction", share.fraction);
  nonNeg("progression.xpShare.radius", share.radius);
  if (!(progression.critChance >= 0 && progression.critChance <= 1)) throw new RangeError("engine-sim: progression.critChance must be 0..1");
  finitePositive("progression.critMultiplier", progression.critMultiplier);
  intIn("coop.reviveBuffTicks", coop.reviveBuffTicks, 0, 4095);
  finitePositive("coop.reviveBuffMight", coop.reviveBuffMight);
  finitePositive("coop.reviveBuffSpeed", coop.reviveBuffSpeed);
  if (!(coop.crawlSpeed >= 0 && coop.crawlSpeed <= 1)) throw new RangeError(`engine-sim: coop.crawlSpeed must be 0..1, got ${coop.crawlSpeed}`);
  intIn("coop.selfRevives", coop.selfRevives, 0, 15);
  intIn("coop.selfReviveDelayTicks", coop.selfReviveDelayTicks, 0, 4095);
  intIn("coop.respawnTicks", coop.respawnTicks, 0, 4095);
  nonNeg("coop.risePulseRadius", coop.risePulseRadius);
  const characters = c.characters ?? [];
  if (characters.length > 15) throw new RangeError("engine-sim: at most 15 characters");
  characters.forEach((ch, i) => {
    intIn(`characters[${i}].weapon`, ch.weapon, 0, Math.max(0, weapons.length - 1));
    intIn(`characters[${i}].stat`, ch.stat, -1, Math.max(-1, stats.length - 1));
  });
  return { enabled: weapons.length > 0, enemyTypes, weapons, stats, progression, coop, arena, view, pickups, loot, mergeGemsAbove, characters };
}
