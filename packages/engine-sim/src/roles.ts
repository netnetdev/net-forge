/**
 * Enemy roles and boss patterns (content mode): cheap per-entity state
 * machines for every enemy whose `ai` is not plain "chase" or "idle".
 * Plain chasers (the crowd) never come here, so 2,000 fodder cost what they
 * always did. Every big hit is telegraphed: the telegraph word rides the
 * snapshot in the enemy's `level` field (api.ts Telegraph), so clients draw
 * the warning without any extra message.
 *
 * Per-enemy state (enemies only; players use these fields differently):
 *   Game.choices  phase (bits 0-3) | timer ticks (4-15) | aux (16-31: a locked angle, 65536 per turn)
 *   Game.level    telegraph word (wire)
 *   Game.iframes  attack cooldown ticks
 *   Game.wcd      shield points; Game.dash shield ticks left
 *   Game.weapons  bosses: mode ticks left (0-15) | far mode (bit 16)
 * Hostile projectiles: Game.value damage, Game.xp total delay (hazards),
 * Game.stats radius in cm (hazards), SimState.cooldown ticks left.
 *
 * Deterministic: integer state, the world PRNG or netId hashes, netId order.
 */
import { EntityFlag, EntityKind, Telegraph } from "./api.js";
import type { BossAttack, EnemyAttack, EnemyTypeDef, HitSource, PlayerId } from "./api.js";
import { nextRandom } from "./rng.js";
import { spawnEntity } from "./world.js";
import { segmentWalls, wallsOf } from "./walls.js";
import type { InternalWorld } from "./world.js";
import { clearSpot, derivedStats, enemyType, isFlag, isUp, killEnemyBy, segmentCircle, sortedPlayers, spawnEnemyAt, upPlayers, xpToNext } from "./content.js";

const TAU = Math.PI * 2;

export const Phase = { Move: 0, Windup: 1, Act: 2, Recover: 3 } as const;

/** Defaults per role (seconds and metres are converted at use). */
export const ROLE_DEFAULTS = {
  runner: { lead: 0.5 },
  // The lane it shows is exactly the ground the charge covers: speed x 3.4 x 0.6 s (about 6 m for a 3 m/s enemy).
  charger: { range: 6, windup: 0.55, act: 0.6, recover: 1, cooldown: 2.5, speed: 3.4 },
  ranged: { range: 10, windup: 0.3, cooldown: 2.6, speed: 7 },
  bomber: { range: 1.8, windup: 1, radius: 2.5, damage: 1.4 },
  shielder: { cooldown: 6, windup: 0.8, radius: 8, count: 6, share: 0.35, seconds: 8 },
  healer: { cooldown: 3.5, windup: 0.6, radius: 6, count: 6, share: 0.07 },
  summoner: { range: 10, cooldown: 7, windup: 0.9, count: 2, max: 4 },
} as const;

/** Boss attack timings (seconds) before enrage (x0.8 after). */
const BOSS = {
  slam: { windup: 0.85, radius: 4 },
  dash: { windup: 0.75, length: 11, act: 0.5 },
  leap: { windup: 1.15, radius: 2.6 },
  rain: { windup: 1.1, radius: 1.7, count: 4 },
  ring: { windup: 0.65, count: 14, speed: 8 },
  fan: { windup: 0.6, count: 7, speed: 10, spread: Math.PI / 3 },
  summon: { windup: 0.8, count: 3 },
  recover: 0.6,
  cooldown: 2.2,
} as const;
const NEAR: ReadonlySet<BossAttack> = new Set(["slam", "dash", "leap", "summon"]);
const FAR: ReadonlySet<BossAttack> = new Set(["rain", "ring", "fan", "dash", "leap", "summon"]);

// ------------------------------------------------------------ packed state

const phaseOf = (c: number) => c & 0xf;
const timerOf = (c: number) => (c >>> 4) & 0xfff;
const auxOf = (c: number) => c >>> 16;
const pack = (phase: number, timer: number, aux: number) => ((phase & 0xf) | ((Math.max(0, Math.min(0xfff, timer)) & 0xfff) << 4) | ((aux & 0xffff) << 16)) >>> 0;
const toAux = (a: number) => Math.round((((a % TAU) + TAU) % TAU) / TAU * 65536) & 0xffff;
const fromAux = (u: number) => (u / 65536) * TAU;

/** Telegraph word: kind, progress 0..1, and an angle (lanes) or a radius in metres (circles). */
export function teleWord(kind: number, progress: number, angleOrRadius: number, isRadius = false): number {
  const p = Math.max(0, Math.min(31, Math.round(progress * 31)));
  const v = isRadius ? Math.max(0, Math.min(255, Math.round(angleOrRadius * 10))) : Math.round((((angleOrRadius % TAU) + TAU) % TAU) / TAU * 256) & 0xff;
  return (kind & 7) | (p << 3) | (v << 8);
}

/** Decode a telegraph word (clients and bots). */
export function decodeTelegraph(word: number): { kind: number; progress: number; angle: number; radius: number } {
  const v = (word >>> 8) & 0xff;
  return { kind: word & 7, progress: ((word >>> 3) & 31) / 31, angle: (v / 256) * TAU, radius: v / 10 };
}

const ticks = (w: InternalWorld, seconds: number) => Math.max(1, Math.round(seconds * w.tickRate));

const NO_ATTACK: EnemyAttack = {};
/** The attack numbers for an enemy: its prefab's `attack`, else the role defaults. */
function atk(def: EnemyTypeDef): EnemyAttack {
  return def.attack ?? NO_ATTACK;
}

// ------------------------------------------------------------ queued spawns

/** Spawns asked for during a step's loops (summons, splits), made after them in order. */
const queued = new WeakMap<InternalWorld, { type: number; x: number; z: number; health: number; from: number }[]>();

function queueSpawn(w: InternalWorld, type: number, x: number, z: number, health: number, from = 0): void {
  let q = queued.get(w);
  if (!q) {
    q = [];
    queued.set(w, q);
  }
  q.push({ type, x, z, health, from });
}

/** Make the queued spawns (call once per step, outside entity loops). */
export function flushRoleSpawns(w: InternalWorld): void {
  const q = queued.get(w);
  if (!q || q.length === 0) return;
  queued.set(w, []);
  for (const s of q) {
    if (w.byNetId.size >= w.config.maxEntities - 64) break;
    const def = w.config.content.enemyTypes[s.type];
    if (!def || !clearSpot(w, s.x, s.z, def.radius)) continue;
    spawnEnemyAt(w, s.type, s.x, s.z, { health: s.health, from: s.from || 1 });
  }
}

/** Splitters: on death, queue `split.count` of `split.type` where it fell. */
export function onEnemyDeath(w: InternalWorld, eid: number, def: EnemyTypeDef): void {
  if (!def.split) return;
  const T = w.c.Transform;
  const x = T.x[eid] ?? 0;
  const z = T.z[eid] ?? 0;
  const scale = Math.max(0.2, (w.c.Game.stats[eid] ?? def.health) / Math.max(1, def.health));
  for (let i = 0; i < def.split.count; i++) {
    const a = (TAU * i) / def.split.count + ((w.c.Networked.netId[eid] ?? 0) % 7) * 0.3;
    queueSpawn(w, def.split.type, x + Math.cos(a) * 0.7, z + Math.sin(a) * 0.7, scale, w.c.Networked.netId[eid] ?? 1);
  }
}

// ------------------------------------------------------------ damage to players

/** Hit every up player within `r` of (x, z) for `damage` (armor applies; i-frames and dashes dodge). */
export function blastPlayers(w: InternalWorld, x: number, z: number, r: number, damage: number, by: number, source: HitSource, enemyType?: number): void {
  const { Transform: T, Health: H, Networked: N } = w.c;
  const P = w.config.player;
  for (const [pid, pe] of sortedPlayers(w)) {
    if (!isUp(w, pe) || (w.c.Game.iframes[pe] ?? 0) > 0) continue;
    const ox = (T.x[pe] ?? 0) - x;
    const oz = (T.z[pe] ?? 0) - z;
    const reach = r + P.radius;
    if (ox * ox + oz * oz > reach * reach) continue;
    hurtPlayer(w, pid, pe, damage, by, source, enemyType);
  }
}

/** One telegraphed hit on a player. */
export function hurtPlayer(w: InternalWorld, pid: PlayerId, pe: number, raw: number, by: number, source: HitSource, enemyType?: number): void {
  const { Health: H, Networked: N } = w.c;
  const damage = Math.max(1, Math.round(raw) - derivedStats(w, pe).armor);
  const hp = Math.max(0, (H.hp[pe] ?? 0) - damage);
  H.hp[pe] = hp;
  w.events.push({ type: "player.hit", playerId: pid, netId: N.netId[pe] ?? 0, by, damage, health: hp, source, ...(enemyType !== undefined ? { enemyType } : {}) });
  if (hp === 0) downPlayerExternal(w, pe, pid);
  else {
    const hit = w.config.content.coop.hitIframeTicks;
    if (hit > 0) w.c.Game.iframes[pe] = Math.max(w.c.Game.iframes[pe] ?? 0, hit);
  }
}

let downHook: ((w: InternalWorld, eid: number, pid: PlayerId) => void) | null = null;
/** content.ts registers its downPlayer here (avoids an import cycle at module load). */
export function setDownHook(fn: (w: InternalWorld, eid: number, pid: PlayerId) => void): void {
  downHook = fn;
}
function downPlayerExternal(w: InternalWorld, eid: number, pid: PlayerId): void {
  downHook?.(w, eid, pid);
}

/** The contact source of an enemy right now: a charging enemy or a dashing boss hits as a telegraphed "charge". */
export function contactSource(w: InternalWorld, eid: number): HitSource {
  const def = enemyType(w, eid);
  if ((def.ai === "charger" || def.pattern) && phaseOf(w.c.Game.choices[eid] ?? 0) === Phase.Act) return "charge";
  return "contact";
}

// ------------------------------------------------------------ hostile projectiles and hazards

/** Fire an enemy shot from (x, z) along angle `a`. */
export function fireShot(w: InternalWorld, from: number, x: number, z: number, a: number, speed: number, damage: number, range: number): void {
  if (w.byNetId.size >= w.config.maxEntities - 32) return;
  const { Velocity: V, Transform: T, SimState: S, Networked: N } = w.c;
  const G = w.c.Game;
  const p = spawnEntity(w, EntityKind.Projectile, [x, 0.8, z], { owner: 0, type: G.type[from] ?? 0 });
  V.x[p] = Math.cos(a) * speed;
  V.z[p] = Math.sin(a) * speed;
  T.yaw[p] = Math.atan2(-(V.x[p] ?? 0), -(V.z[p] ?? 0));
  S.flags[p] = EntityFlag.Hostile;
  S.cooldown[p] = Math.min(65535, Math.ceil((range / Math.max(0.5, speed)) * w.tickRate));
  G.value[p] = Math.max(1, Math.round(damage));
  w.events.push({ type: "entity.spawned", netId: N.netId[p] ?? 0, kind: EntityKind.Projectile });
}

/** A ground hazard: a circle of `r` at (x, z) that lands after `delay` ticks. */
export function placeHazard(w: InternalWorld, from: number, x: number, z: number, r: number, delay: number, damage: number): void {
  if (w.byNetId.size >= w.config.maxEntities - 32) return;
  const { SimState: S, Networked: N } = w.c;
  const G = w.c.Game;
  const p = spawnEntity(w, EntityKind.Projectile, [x, 0.05, z], { owner: 0, type: G.type[from] ?? 0 });
  S.flags[p] = EntityFlag.Hostile | EntityFlag.Elite;
  S.cooldown[p] = delay + 1;
  G.xp[p] = delay;
  G.stats[p] = Math.round(r * 100);
  G.value[p] = Math.max(1, Math.round(damage));
  G.level[p] = teleWord(Telegraph.Circle, 0, r, true);
  w.events.push({ type: "entity.spawned", netId: N.netId[p] ?? 0, kind: EntityKind.Projectile });
}

/** Move and land hostile projectiles and hazards (call in combat, before lifetime). */
export function hostileProjectiles(w: InternalWorld, order: readonly number[]): void {
  const { Transform: T, Networked: N, SimState: S } = w.c;
  const G = w.c.Game;
  const P = w.config.player;
  for (let k = 0; k < order.length; k++) {
    const p = order[k] as number;
    if (N.kind[p] !== EntityKind.Projectile || w.doomed.has(p) || !isFlag(w, p, EntityFlag.Hostile)) continue;
    const x = T.x[p] ?? 0;
    const z = T.z[p] ?? 0;
    if (isFlag(w, p, EntityFlag.Elite)) {
      const left = S.cooldown[p] ?? 0;
      const total = Math.max(1, G.xp[p] ?? 1);
      const r = (G.stats[p] ?? 100) / 100;
      G.level[p] = teleWord(Telegraph.Circle, 1 - (left - 1) / total, r, true);
      if (left <= 1) {
        blastPlayers(w, x, z, r, G.value[p] ?? 1, 0, "hazard", G.type[p] ?? 0);
        w.doomed.add(p);
      }
      continue;
    }
    for (const [pid, pe] of sortedPlayers(w)) {
      if (!isUp(w, pe)) continue;
      const ox = (T.x[pe] ?? 0) - x;
      const oz = (T.z[pe] ?? 0) - z;
      const reach = P.radius + 0.3;
      if (ox * ox + oz * oz > reach * reach) continue;
      if ((G.iframes[pe] ?? 0) === 0) hurtPlayer(w, pid, pe, G.value[p] ?? 1, 0, "projectile", G.type[p] ?? 0);
      w.doomed.add(p);
      break;
    }
  }
}

// ------------------------------------------------------------ shields, heals

/** A hit on a shielded enemy drains the shield first. Returns the damage left for its health. */
export function absorbShield(w: InternalWorld, eid: number, damage: number): number {
  if (!isFlag(w, eid, EntityFlag.Shielded)) return damage;
  const G = w.c.Game;
  const shield = G.wcd[eid] ?? 0;
  const left = shield - damage;
  if (left > 0) {
    G.wcd[eid] = left;
    return 0;
  }
  G.wcd[eid] = 0;
  G.dash[eid] = 0;
  w.c.SimState.flags[eid] = (w.c.SimState.flags[eid] ?? 0) & ~EntityFlag.Shielded;
  return -left;
}

/** Up to `count` living, non-boss allies of `eid` within `r`, nearest first (netId breaks ties). */
function alliesNear(w: InternalWorld, eid: number, r: number, count: number, near: (x: number, z: number, r: number, fn: (o: number) => boolean | void) => void): number[] {
  const T = w.c.Transform;
  const N = w.c.Networked;
  const x = T.x[eid] ?? 0;
  const z = T.z[eid] ?? 0;
  const found: { o: number; d2: number }[] = [];
  near(x, z, r, (o) => {
    if (o === eid || isFlag(w, o, EntityFlag.Dead) || enemyType(w, o).boss) return;
    const ox = (T.x[o] ?? 0) - x;
    const oz = (T.z[o] ?? 0) - z;
    const d2 = ox * ox + oz * oz;
    if (d2 <= r * r) found.push({ o, d2 });
  });
  found.sort((a, b) => a.d2 - b.d2 || (N.netId[a.o] ?? 0) - (N.netId[b.o] ?? 0));
  return found.slice(0, count).map((f) => f.o);
}

/** Per-tick upkeep for every living enemy with role state: shields run out. Cheap: flags check first. */
export function roleUpkeep(w: InternalWorld, eid: number): void {
  if (!isFlag(w, eid, EntityFlag.Shielded)) return;
  const G = w.c.Game;
  const t = (G.dash[eid] ?? 0) - 1;
  G.dash[eid] = Math.max(0, t);
  if (t <= 0) {
    G.wcd[eid] = 0;
    w.c.SimState.flags[eid] = (w.c.SimState.flags[eid] ?? 0) & ~EntityFlag.Shielded;
  }
}

// ------------------------------------------------------------ the roles

/**
 * Steer result: STEER (steer toward `steerTo`; separation still applies) or
 * HOLD (the role set the velocity itself). A shared scratch object, so the
 * crowd's hot loop allocates nothing.
 */
export const HOLD = 0;
export const STEER = 1;
export type Steer = 0 | 1;
export const steerTo = { x: 0, z: 0 };
const to = (x: number, z: number): Steer => {
  steerTo.x = x;
  steerTo.z = z;
  return STEER;
};

/** True for enemies that run a role state machine (not plain chase or idle). */
export const hasRole = (def: EnemyTypeDef): boolean => (def.ai !== undefined && def.ai !== "chase" && def.ai !== "idle") || def.pattern !== undefined;

/**
 * One tick of an enemy's role. `tx, tz` is the nearest up player's ECS id
 * position offset (dx, dz from the enemy) and `target` its ECS id (-1 none).
 * Returns where to steer, or HOLD when the role set the velocity itself.
 */
export function roleSteer(
  w: InternalWorld,
  eid: number,
  def: EnemyTypeDef,
  target: number,
  dx: number,
  dz: number,
  near: (x: number, z: number, r: number, fn: (o: number) => boolean | void) => void,
): Steer {
  const { Velocity: V, Transform: T } = w.c;
  const G = w.c.Game;
  const c = G.choices[eid] ?? 0;
  let phase = phaseOf(c);
  let timer = timerOf(c);
  let aux = auxOf(c);
  let cd = G.iframes[eid] ?? 0;
  if (cd > 0) cd--;
  const d = Math.hypot(dx, dz);
  const ux = d > 1e-6 ? dx / d : 0;
  const uz = d > 1e-6 ? dz / d : 0;
  const a = atk(def);
  const speed = def.speed;
  let out: Steer = to(ux * speed, uz * speed);
  let tele = 0;
  const stop = () => {
    V.x[eid] = 0;
    V.z[eid] = 0;
  };

  if (def.pattern) {
    out = bossSteer(w, eid, def, target, dx, dz, d, near);
    return out;
  }

  switch (def.ai) {
    case "runner": {
      if (target >= 0) {
        const lead = ROLE_DEFAULTS.runner.lead;
        const px = dx + (V.x[target] ?? 0) * lead;
        const pz = dz + (V.z[target] ?? 0) * lead;
        const l = Math.hypot(px, pz) || 1;
        out = to((px / l) * speed, (pz / l) * speed);
      }
      break;
    }
    case "flee": {
      out = to(-ux * speed, -uz * speed);
      break;
    }
    case "wander": {
      const n = w.c.Networked.netId[eid] ?? 0;
      const h = Math.imul((n * 2654435761) ^ Math.floor(w.tick / 60), 0x85ebca6b) >>> 0;
      const ang = (h / 4294967296) * TAU;
      out = to(Math.cos(ang) * speed * 0.6, Math.sin(ang) * speed * 0.6);
      break;
    }
    case "charger": {
      const D = ROLE_DEFAULTS.charger;
      const windup = a.windupTicks ?? ticks(w, D.windup);
      if (phase === Phase.Move) {
        if (target >= 0 && cd === 0 && d < (a.range ?? D.range)) {
          phase = Phase.Windup;
          timer = windup;
          aux = toAux(Math.atan2(dz, dx));
        }
      }
      if (phase === Phase.Windup) {
        stop();
        tele = teleWord(Telegraph.Lane, 1 - timer / windup, fromAux(aux));
        if (--timer <= 0) {
          phase = Phase.Act;
          timer = ticks(w, D.act);
        }
        out = HOLD;
      } else if (phase === Phase.Act) {
        // Walls and pillars end a charge: the next stride would leave clear ground.
        const v = speed * (a.speed ?? D.speed);
        const ang = fromAux(aux);
        const nx = (T.x[eid] ?? 0) + (Math.cos(ang) * v) / w.tickRate;
        const nz = (T.z[eid] ?? 0) + (Math.sin(ang) * v) / w.tickRate;
        if (!clearSpot(w, nx, nz, def.radius)) timer = 1;
        V.x[eid] = Math.cos(ang) * v;
        V.z[eid] = Math.sin(ang) * v;
        if (--timer <= 0) {
          phase = Phase.Recover;
          timer = ticks(w, D.recover);
        }
        out = HOLD;
      } else if (phase === Phase.Recover) {
        stop();
        if (--timer <= 0) {
          phase = Phase.Move;
          cd = a.cooldownTicks ?? ticks(w, D.cooldown);
        }
        out = HOLD;
      }
      break;
    }
    case "ranged":
    case "summoner": {
      const D = def.ai === "ranged" ? ROLE_DEFAULTS.ranged : ROLE_DEFAULTS.summoner;
      const keep = (a.range ?? D.range) * 0.8;
      // Keep about 80% of range: back off when crowded, close in when far, else strafe.
      if (d < keep * 0.75) out = to(-ux * speed, -uz * speed);
      else if (d > keep * 1.15) out = to(ux * speed, uz * speed);
      else {
        const side = (w.c.Networked.netId[eid] ?? 0) % 2 === 0 ? 1 : -1;
        out = to(-uz * speed * 0.5 * side, ux * speed * 0.5 * side);
      }
      const windup = a.windupTicks ?? ticks(w, D.windup);
      // Shooters need a clear line: cover (pillars) blocks the shot, so they keep strafing for an angle.
      if (phase === Phase.Move && cd === 0 && target >= 0 && d < (a.range ?? D.range) * 1.2 && (def.ai !== "ranged" || clearLine(w, eid, dx, dz))) {
        if (def.ai === "summoner" && countNear(w, eid, a.summon ?? 0, 15, near) >= ROLE_DEFAULTS.summoner.max) cd = ticks(w, 2);
        else {
          phase = Phase.Windup;
          timer = windup;
          aux = toAux(Math.atan2(dz, dx));
        }
      }
      if (phase === Phase.Windup) {
        stop();
        tele = def.ai === "ranged" ? teleWord(Telegraph.Lane, 1 - timer / windup, fromAux(aux)) : teleWord(Telegraph.Aura, 1 - timer / windup, 1.5, true);
        if (--timer <= 0) {
          const x = T.x[eid] ?? 0;
          const z = T.z[eid] ?? 0;
          if (def.ai === "ranged") {
            const sp = a.speed ?? ROLE_DEFAULTS.ranged.speed;
            fireShot(w, eid, x, z, fromAux(aux), sp, a.damage ?? def.damage, (a.range ?? D.range) * 1.6);
          } else {
            const n = a.count ?? ROLE_DEFAULTS.summoner.count;
            const ratio = Math.max(0.2, (G.stats[eid] ?? def.health) / Math.max(1, def.health));
            for (let i = 0; i < n; i++) {
              const ang = nextRandom(w) * TAU;
              queueSpawn(w, a.summon ?? 0, x + Math.cos(ang) * 1.6, z + Math.sin(ang) * 1.6, ratio, w.c.Networked.netId[eid] ?? 1);
            }
          }
          phase = Phase.Move;
          cd = a.cooldownTicks ?? ticks(w, D.cooldown);
        }
        out = HOLD;
      }
      break;
    }
    case "bomber": {
      const D = ROLE_DEFAULTS.bomber;
      const windup = a.windupTicks ?? ticks(w, D.windup);
      const r = a.radius ?? D.radius;
      if (phase === Phase.Move && target >= 0 && d < (a.range ?? D.range)) {
        phase = Phase.Windup;
        timer = windup;
      }
      if (phase === Phase.Windup) {
        stop();
        tele = teleWord(Telegraph.Circle, 1 - timer / windup, r, true);
        if (--timer <= 0) {
          const x = T.x[eid] ?? 0;
          const z = T.z[eid] ?? 0;
          const dmg = a.damage ?? Math.max(1, (G.value[eid] || def.damage) * D.damage);
          blastPlayers(w, x, z, r, dmg, w.c.Networked.netId[eid] ?? 0, "blast");
          // The blast hurts enemies too: bait bombers into the crowd.
          near(x, z, r + w.maxEnemyRadius, (o) => {
            if (o === eid || isFlag(w, o, EntityFlag.Dead)) return;
            const ox = (T.x[o] ?? 0) - x;
            const oz = (T.z[o] ?? 0) - z;
            if (ox * ox + oz * oz > r * r) return;
            blastHits.push(o);
          });
          blastDamage = dmg * 4;
          G.level[eid] = 0;
          G.choices[eid] = 0;
          killEnemyBy(w, eid, 0);
          return HOLD;
        }
        out = HOLD;
      }
      break;
    }
    case "shielder":
    case "healer": {
      const D = def.ai === "shielder" ? ROLE_DEFAULTS.shielder : ROLE_DEFAULTS.healer;
      const windup = a.windupTicks ?? ticks(w, D.windup);
      // Support stays a little behind the pack: chase, but stop short.
      out = d < 5 ? to(-ux * speed * 0.5, -uz * speed * 0.5) : to(ux * speed, uz * speed);
      if (phase === Phase.Move && cd === 0) {
        phase = Phase.Windup;
        timer = windup;
      }
      if (phase === Phase.Windup) {
        tele = teleWord(Telegraph.Aura, 1 - timer / windup, a.radius ?? D.radius, true);
        if (--timer <= 0) {
          const allies = alliesNear(w, eid, a.radius ?? D.radius, a.count ?? D.count, near);
          for (const o of allies) {
            const max = G.stats[o] || enemyType(w, o).health;
            if (def.ai === "shielder") {
              G.wcd[o] = Math.max(G.wcd[o] ?? 0, Math.round(max * ROLE_DEFAULTS.shielder.share));
              G.dash[o] = ticks(w, ROLE_DEFAULTS.shielder.seconds);
              w.c.SimState.flags[o] = (w.c.SimState.flags[o] ?? 0) | EntityFlag.Shielded;
            } else {
              w.c.Health.hp[o] = Math.min(max, (w.c.Health.hp[o] ?? 0) + Math.max(1, Math.round(max * ROLE_DEFAULTS.healer.share)));
            }
          }
          phase = Phase.Move;
          cd = a.cooldownTicks ?? ticks(w, D.cooldown);
        }
      }
      break;
    }
    default:
      break;
  }
  G.choices[eid] = pack(phase, timer, aux);
  G.iframes[eid] = cd;
  G.level[eid] = tele;
  return out;
}

/** Enemies hit by a bomber's blast this step, and the blast damage (applied by applyBlasts after the AI loop). */
const blastHits: number[] = [];
let blastDamage = 0;

/** Apply this tick's bomber blasts to the enemies they caught (after the AI loop, netId order). */
export function applyBlasts(w: InternalWorld, hit: (eid: number, damage: number) => void): void {
  if (blastHits.length === 0) return;
  const N = w.c.Networked;
  const list = [...new Set(blastHits)].sort((a, b) => (N.netId[a] ?? 0) - (N.netId[b] ?? 0));
  const dmg = blastDamage;
  blastHits.length = 0;
  for (const o of list) hit(o, dmg);
}

/** No pillar between an enemy and the point (dx, dz) away from it. */
function clearLine(w: InternalWorld, eid: number, dx: number, dz: number): boolean {
  const x = w.c.Transform.x[eid] ?? 0;
  const z = w.c.Transform.z[eid] ?? 0;
  for (const p of w.config.arena.pillars) if (segmentCircle(x, z, dx, dz, p.x, p.z, p.radius) >= 0) return false;
  if (segmentWalls(wallsOf(w), x, z, dx, dz, 0.1) >= 0) return false;
  return true;
}

function countNear(w: InternalWorld, eid: number, type: number, r: number, near: (x: number, z: number, r: number, fn: (o: number) => boolean | void) => void): number {
  const T = w.c.Transform;
  const x = T.x[eid] ?? 0;
  const z = T.z[eid] ?? 0;
  let n = 0;
  near(x, z, r, (o) => {
    if (o === eid || isFlag(w, o, EntityFlag.Dead) || (w.c.Game.type[o] ?? 0) !== type) return;
    const ox = (T.x[o] ?? 0) - x;
    const oz = (T.z[o] ?? 0) - z;
    if (ox * ox + oz * oz <= r * r) n++;
  });
  return n;
}

// ------------------------------------------------------------ bosses

const ATTACKS: readonly BossAttack[] = ["slam", "dash", "leap", "rain", "ring", "fan", "summon"];

/** True when a boss is below its enrage threshold. */
export function enraged(w: InternalWorld, eid: number, def: EnemyTypeDef): boolean {
  const p = def.pattern;
  if (!p || p.enrageAt <= 0) return false;
  const max = w.c.Game.stats[eid] || def.health;
  return (w.c.Health.hp[eid] ?? 0) < max * p.enrageAt;
}

function bossSteer(
  w: InternalWorld,
  eid: number,
  def: EnemyTypeDef,
  target: number,
  dx: number,
  dz: number,
  d: number,
  near: (x: number, z: number, r: number, fn: (o: number) => boolean | void) => void,
): Steer {
  const { Velocity: V, Transform: T } = w.c;
  const G = w.c.Game;
  const pattern = def.pattern as NonNullable<EnemyTypeDef["pattern"]>;
  const rage = enraged(w, eid, def);
  const k = rage ? 0.8 : 1;
  const c = G.choices[eid] ?? 0;
  let phase = phaseOf(c);
  let timer = timerOf(c);
  let aux = auxOf(c);
  let cd = G.iframes[eid] ?? 0;
  if (cd > 0) cd--;
  // Near and far modes alternate every 4-9 s.
  let mode = G.weapons[eid] ?? 0;
  let modeLeft = mode & 0xffff;
  let far = (mode >>> 16) & 1;
  if (modeLeft === 0) {
    far ^= 1;
    modeLeft = ticks(w, 4 + nextRandom(w) * 5);
  } else modeLeft--;
  G.weapons[eid] = (modeLeft | (far << 16)) >>> 0;
  const ux = d > 1e-6 ? dx / d : 0;
  const uz = d > 1e-6 ? dz / d : 0;
  const speed = def.speed * (rage ? 1.15 : 1);
  let out: Steer = to(ux * speed, uz * speed);
  let tele = 0;
  const attack = ATTACKS[aux & 7] ?? "slam";
  const x = T.x[eid] ?? 0;
  const z = T.z[eid] ?? 0;
  const dmg = G.value[eid] || def.damage;

  if (phase === Phase.Move && cd === 0 && target >= 0) {
    const pool = pattern.attacks.filter((at) => (far ? FAR : NEAR).has(at) && (at !== "slam" || d < BOSS.slam.radius + def.radius + 3));
    const pick = pool.length > 0 ? pool[Math.floor(nextRandom(w) * pool.length)] : undefined;
    if (pick) {
      phase = Phase.Windup;
      const wind = BOSS[pick].windup * k;
      timer = ticks(w, wind);
      const ang = Math.atan2(dz, dx);
      aux = ATTACKS.indexOf(pick) | (toAux(ang) & 0xfff8);
      if (pick === "leap") {
        // The landing circle shows where the boss will come down; the boss flies there over the wind-up.
        const tx = T.x[target] ?? 0;
        const tz = T.z[target] ?? 0;
        placeHazard(w, eid, tx, tz, BOSS.leap.radius + def.radius * 0.5, timer, dmg * 1.5);
      } else if (pick === "rain") {
        const ups = upPlayers(w);
        for (let i = 0; i < BOSS.rain.count + (rage ? 2 : 0); i++) {
          const pe = ups[i % Math.max(1, ups.length)];
          if (pe === undefined) break;
          const ox = (nextRandom(w) - 0.5) * 6;
          const oz = (nextRandom(w) - 0.5) * 6;
          placeHazard(w, eid, (T.x[pe] ?? 0) + ox, (T.z[pe] ?? 0) + oz, BOSS.rain.radius, timer, dmg);
        }
      }
    }
  }
  if (phase === Phase.Windup) {
    const total = ticks(w, BOSS[attack].windup * k);
    const prog = 1 - timer / total;
    const ang = fromAux(aux & 0xfff8);
    if (attack === "leap") {
      // Glide toward the landing circle.
      const tx = Math.cos(ang);
      const tz = Math.sin(ang);
      const dist = Math.min(14, d);
      V.x[eid] = (tx * dist) / Math.max(0.1, total / w.tickRate);
      V.z[eid] = (tz * dist) / Math.max(0.1, total / w.tickRate);
    } else {
      V.x[eid] = 0;
      V.z[eid] = 0;
    }
    if (attack === "slam") tele = teleWord(Telegraph.Circle, prog, BOSS.slam.radius + def.radius, true);
    else if (attack === "dash") tele = teleWord(Telegraph.Lane, prog, ang);
    else if (attack === "ring" || attack === "fan" || attack === "summon") tele = teleWord(Telegraph.Aura, prog, def.radius + 1, true);
    if (--timer <= 0) {
      phase = Phase.Act;
      timer = attack === "dash" ? ticks(w, BOSS.dash.act) : 1;
      if (attack === "slam") blastPlayers(w, x, z, BOSS.slam.radius + def.radius, dmg * 1.6, w.c.Networked.netId[eid] ?? 0, "slam");
      else if (attack === "ring") {
        const n = BOSS.ring.count + (rage ? 6 : 0);
        for (let i = 0; i < n; i++) fireShot(w, eid, x, z, (TAU * i) / n, BOSS.ring.speed, dmg * 0.6, 22);
      } else if (attack === "fan") {
        const n = BOSS.fan.count + (rage ? 2 : 0);
        for (let i = 0; i < n; i++) fireShot(w, eid, x, z, ang + (i / Math.max(1, n - 1) - 0.5) * BOSS.fan.spread, BOSS.fan.speed, dmg * 0.6, 22);
      } else if (attack === "summon") {
        const n = BOSS.summon.count + (rage ? 2 : 0);
        for (let i = 0; i < n; i++) {
          const a2 = nextRandom(w) * TAU;
          queueSpawn(w, pattern.summon ?? 0, x + Math.cos(a2) * (def.radius + 1.5), z + Math.sin(a2) * (def.radius + 1.5), 1, w.c.Networked.netId[eid] ?? 1);
        }
      }
    }
    out = HOLD;
  } else if (phase === Phase.Act) {
    if (attack === "dash") {
      const v = BOSS.dash.length / BOSS.dash.act;
      const ang = fromAux(aux & 0xfff8);
      V.x[eid] = Math.cos(ang) * v;
      V.z[eid] = Math.sin(ang) * v;
    } else {
      V.x[eid] = 0;
      V.z[eid] = 0;
    }
    if (--timer <= 0) {
      phase = Phase.Recover;
      timer = ticks(w, BOSS.recover * k);
    }
    out = HOLD;
  } else if (phase === Phase.Recover) {
    V.x[eid] = 0;
    V.z[eid] = 0;
    if (--timer <= 0) {
      phase = Phase.Move;
      cd = ticks(w, BOSS.cooldown * k);
    }
    out = HOLD;
  }
  G.choices[eid] = pack(phase, timer, aux);
  G.iframes[eid] = cd;
  G.level[eid] = tele;
  return out;
}

/**
 * Boss loot: a ring of large gems worth about one and a half levels of the
 * players' average level, instead of a single gem. Returns true when it
 * dropped (the caller skips its normal gem).
 */
export function bossLoot(w: InternalWorld, eid: number, def: EnemyTypeDef, xp: number): boolean {
  if (!def.boss) return false;
  const ups = upPlayers(w);
  let lv = 1;
  for (const pe of ups) lv += (w.c.Game.level[pe] ?? 1) - 1;
  lv = Math.max(1, Math.round(lv / Math.max(1, ups.length)) + (ups.length > 0 ? 0 : 0));
  const total = Math.max(xp, Math.round(xpToNext(w, lv) * 1.5));
  const n = 12;
  const each = Math.max(1, Math.round(total / n));
  const T = w.c.Transform;
  const x = T.x[eid] ?? 0;
  const z = T.z[eid] ?? 0;
  for (let i = 0; i < n; i++) {
    if (w.byNetId.size >= w.config.maxEntities - 16) break;
    const a = (TAU * i) / n;
    const gx = x + Math.cos(a) * (def.radius + 1.2);
    const gz = z + Math.sin(a) * (def.radius + 1.2);
    const g = spawnEntity(w, EntityKind.Pickup, [gx, 0.3, gz], { type: 2 });
    w.c.Game.value[g] = each;
    w.events.push({ type: "entity.spawned", netId: w.c.Networked.netId[g] ?? 0, kind: EntityKind.Pickup });
  }
  return true;
}
