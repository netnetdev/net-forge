import { Button, EntityFlag, EntityKind } from "./api.js";
import type { EntityKindId, InputCommand, PlayerId, SimWorld, StepResult, TickInputs } from "./api.js";
import { quantizeInput } from "./input.js";
import { snapPos, snapPosUp, snapVel, snapYaw } from "./quant.js";
import { nextRandom } from "./rng.js";
import { QUERY_LEVEL_ONLY, despawnEntity, internal, liveOrder, spawnEntity } from "./world.js";
import {
  choiceInput,
  contentAI,
  contentCombat,
  contentInput,
  contentLifetime,
  contentMovement,
  contentPaused,
  contentPickups,
  markSolo,
  contentRules,
} from "./content.js";
import type { InternalWorld } from "./world.js";
import { arenaCombat, arenaInput, arenaLifetime, arenaPickups, arenaRules } from "./arena.js";

/** Ticks a dead player waits before respawning. */
const RESPAWN_SECONDS = 2;
/** Neighbours examined per enemy for separation (bounds the worst case in a dense clump). */
const MAX_NEIGHBOURS = 12;

const NEUTRAL: InputCommand = { seq: 0, tick: 0, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 };

/**
 * THE API: advance the world exactly one fixed tick.
 *
 * Systems run in a fixed order: input, AI,
 * physics, combat, pickups, spawners, game rules, lifetime. Every loop that
 * touches floats walks entities in netId order, so a world restored from a
 * snapshot steps exactly like the one it was captured from.
 */
export function step(world: SimWorld, inputs: TickInputs): StepResult {
  const w = internal(world);
  const order = liveOrder(w);
  const { Transform: T } = w.c;
  // Previous transform, for render interpolation.
  for (const eid of order) {
    T.px[eid] = T.x[eid] ?? 0;
    T.py[eid] = T.y[eid] ?? 0;
    T.pz[eid] = T.z[eid] ?? 0;
    T.pyaw[eid] = T.yaw[eid] ?? 0;
  }

  const near = (x: number, z: number, r: number, fn: (eid: number) => boolean | void) => forEnemiesNear(w, x, z, r, fn);
  if (w.config.content.enabled) markSolo(w);
  if (w.config.content.enabled && contentPaused(w)) {
    // Solo with upgrade cards open: only the pick runs; nothing else moves.
    pausedInputs(w, inputs);
    w.tick++;
    const events = w.events;
    w.events = [];
    return { tick: w.tick, events };
  }
  const arena = w.config.content.enabled && w.config.content.arena.enabled;
  inputSystem(w, inputs);
  buildGrid(w);
  if (w.config.content.enabled) contentAI(w, near);
  else aiSystem(w);
  physicsSystem(w);
  buildGrid(w);
  if (arena) arenaCombat(w, near);
  else if (w.config.content.enabled) contentCombat(w, near);
  else combatSystem(w);
  pickupSystem(w);
  spawnerSystem(w);
  gameRulesSystem(w);
  lifetimeSystem(w);
  quantizeSystem(w);

  w.tick++;
  const events = w.events;
  w.events = [];
  return { tick: w.tick, events };
}

// ---------------------------------------------------------------- input

function inputSystem(w: InternalWorld, inputs: TickInputs): void {
  const { Transform: T, Velocity: V, SimState: S } = w.c;
  const P = w.config.player;
  // Players in ascending playerId order (Map iteration order is insertion order, which differs after restores).
  const ids = [...w.players.keys()].sort((a, b) => a - b);
  for (const pid of ids) {
    const eid = w.players.get(pid);
    if (eid === undefined) continue;
    const raw = inputs.get(pid);
    const cmd = raw ? quantizeInput(raw) : { ...NEUTRAL, yaw: T.yaw[eid] ?? 0 };
    if (raw && cmd.seq > (S.ack[eid] ?? 0)) S.ack[eid] = cmd.seq;
    const prevButtons = S.buttons[eid] ?? 0;
    if (w.config.content.enabled) {
      S.buttons[eid] = cmd.buttons;
      if (w.config.content.arena.enabled) arenaInput(w, eid, cmd, prevButtons);
      else contentInput(w, eid, cmd, prevButtons);
      continue;
    }
    const dead = ((S.flags[eid] ?? 0) & EntityFlag.Dead) !== 0;
    S.buttons[eid] = dead ? 0 : cmd.buttons;
    if (dead) {
      V.x[eid] = 0;
      V.z[eid] = 0;
      continue;
    }
    T.yaw[eid] = cmd.yaw;
    let mx = cmd.moveX;
    let mz = cmd.moveZ;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const speed = P.speed * ((cmd.buttons & Button.Sprint) !== 0 ? P.sprintMultiplier : 1);
    const s = Math.sin(cmd.yaw);
    const co = Math.cos(cmd.yaw);
    // yaw 0 faces -z. forward = (-sin, -cos), right = (cos, -sin).
    V.x[eid] = (mx * co - mz * s) * speed;
    V.z[eid] = (-mx * s - mz * co) * speed;
    // Jump buffer: a fresh press arms it for jumpBufferTicks.
    const pressed = (cmd.buttons & Button.Jump) !== 0 && (prevButtons & Button.Jump) === 0;
    if (pressed) {
      const timers = S.timers[eid] ?? 0;
      S.timers[eid] = (timers & 0xff) | (P.jumpBufferTicks << 8);
    }
  }
}

/** While paused: acknowledge inputs and take a card pick, nothing more. */
function pausedInputs(w: InternalWorld, inputs: TickInputs): void {
  const { SimState: S } = w.c;
  for (const pid of [...w.players.keys()].sort((a, b) => a - b)) {
    const eid = w.players.get(pid);
    const raw = inputs.get(pid);
    if (eid === undefined || !raw) continue;
    const cmd = quantizeInput(raw);
    if (cmd.seq > (S.ack[eid] ?? 0)) S.ack[eid] = cmd.seq;
    const prev = S.buttons[eid] ?? 0;
    S.buttons[eid] = cmd.buttons;
    choiceInput(w, eid, cmd.buttons & ~prev);
  }
}

// ---------------------------------------------------------------- grid

/** Counting sort of enemies into a uniform grid, in netId order. */
function buildGrid(w: InternalWorld): void {
  const g = w.grid;
  const { Transform: T, Networked: N } = w.c;
  g.count.fill(0);
  const order = liveOrder(w);
  const { SimState: S } = w.c;
  const skip = (eid: number) =>
    N.kind[eid] !== EntityKind.Enemy || w.doomed.has(eid) || ((S.flags[eid] ?? 0) & EntityFlag.Dead) !== 0;
  for (const eid of order) {
    if (skip(eid)) continue;
    const ci = cellOf(g, T.x[eid] ?? 0, T.z[eid] ?? 0);
    g.count[ci] = (g.count[ci] ?? 0) + 1;
  }
  let acc = 0;
  for (let i = 0; i < g.count.length; i++) {
    g.start[i] = acc;
    acc += g.count[i] ?? 0;
  }
  g.start[g.count.length] = acc;
  const fill = g.count;
  fill.fill(0);
  for (const eid of order) {
    if (skip(eid)) continue;
    const ci = cellOf(g, T.x[eid] ?? 0, T.z[eid] ?? 0);
    const at = (g.start[ci] ?? 0) + (fill[ci] ?? 0);
    g.items[at] = eid;
    fill[ci] = (fill[ci] ?? 0) + 1;
  }
}

function cellCoord(g: InternalWorld["grid"], v: number): number {
  const c = Math.floor((v - g.origin) / g.cell);
  return c < 0 ? 0 : c >= g.dim ? g.dim - 1 : c;
}
function cellOf(g: InternalWorld["grid"], x: number, z: number): number {
  return cellCoord(g, z) * g.dim + cellCoord(g, x);
}

/** Visit enemies in grid cells overlapping a circle; stops early if `fn` returns false. */
function forEnemiesNear(w: InternalWorld, x: number, z: number, r: number, fn: (eid: number) => boolean | void): void {
  const g = w.grid;
  const x0 = cellCoord(g, x - r);
  const x1 = cellCoord(g, x + r);
  const z0 = cellCoord(g, z - r);
  const z1 = cellCoord(g, z + r);
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      const ci = cz * g.dim + cx;
      const s = g.start[ci] ?? 0;
      const e = s + (g.count[ci] ?? 0);
      for (let i = s; i < e; i++) {
        if (fn(g.items[i] ?? 0) === false) return;
      }
    }
  }
}

// ---------------------------------------------------------------- AI

/** Chase the nearest living player, with separation from neighbours. Navmesh steering comes later (§3). */
function aiSystem(w: InternalWorld): void {
  const { Transform: T, Velocity: V, Networked: N, SimState: S } = w.c;
  const E = w.config.enemies;
  if (w.enemyCount === 0) return;
  const targets: number[] = [];
  for (const pid of [...w.players.keys()].sort((a, b) => a - b)) {
    const eid = w.players.get(pid);
    if (eid !== undefined && ((S.flags[eid] ?? 0) & EntityFlag.Dead) === 0) targets.push(eid);
  }
  const sepDist = E.radius * 2.2;
  const steer = Math.min(1, 6 * w.dt);
  for (const eid of liveOrder(w)) {
    if (N.kind[eid] !== EntityKind.Enemy) continue;
    const x = T.x[eid] ?? 0;
    const z = T.z[eid] ?? 0;
    let dx = 0;
    let dz = 0;
    let best = Infinity;
    for (const t of targets) {
      const ox = (T.x[t] ?? 0) - x;
      const oz = (T.z[t] ?? 0) - z;
      const d2 = ox * ox + oz * oz;
      if (d2 < best) {
        best = d2;
        dx = ox;
        dz = oz;
      }
    }
    let desX = 0;
    let desZ = 0;
    if (best !== Infinity && best > 1e-6) {
      const d = Math.sqrt(best);
      desX = (dx / d) * E.speed;
      desZ = (dz / d) * E.speed;
    }
    let sx = 0;
    let sz = 0;
    let seen = 0;
    forEnemiesNear(w, x, z, sepDist, (o) => {
      if (o === eid) return;
      const ox = x - (T.x[o] ?? 0);
      const oz = z - (T.z[o] ?? 0);
      const d2 = ox * ox + oz * oz;
      if (d2 >= sepDist * sepDist) return;
      if (d2 < 1e-8) {
        // Exactly stacked: break the tie by netId so the pair separates.
        const sign = (N.netId[eid] ?? 0) < (N.netId[o] ?? 0) ? 1 : -1;
        sx += sign * E.speed;
      } else {
        const d = Math.sqrt(d2);
        const push = ((sepDist - d) / sepDist) * E.speed * 2;
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
}

// ---------------------------------------------------------------- physics

function physicsSystem(w: InternalWorld): void {
  const { Transform: T, Velocity: V, Networked: N, SimState: S } = w.c;
  const P = w.config.player;
  const E = w.config.enemies;
  const dt = w.dt;
  const half = w.config.arena.halfExtent;
  const pillars = w.config.arena.pillars;

  // Characters: Rapier kinematic character controller against the level.
  for (const pid of [...w.players.keys()].sort((a, b) => a - b)) {
    const eid = w.players.get(pid);
    if (eid === undefined) continue;
    const col = w.colliders.get(eid);
    if (!col) continue;
    const flags = S.flags[eid] ?? 0;
    // A downed keeper still moves when the game lets them crawl (coop.crawlSpeed); never jumps.
    const downed = (flags & EntityFlag.Downed) !== 0;
    if ((flags & EntityFlag.Dead) !== 0 || (downed && !(w.config.content.coop.crawlSpeed > 0))) continue;
    const timers = S.timers[eid] ?? 0;
    let coyote = timers & 0xff;
    let buffer = downed ? 0 : timers >> 8;
    const grounded = (flags & EntityFlag.Grounded) !== 0;
    if (grounded) coyote = P.coyoteTicks;
    let vy = (V.y[eid] ?? 0) - P.gravity * dt;
    if (buffer > 0 && coyote > 0) {
      vy = P.jumpVelocity;
      buffer = 0;
      coyote = 0;
    }
    col.setTranslation({ x: T.x[eid] ?? 0, y: T.y[eid] ?? 0, z: T.z[eid] ?? 0 });
    w.kcc.computeColliderMovement(col, { x: (V.x[eid] ?? 0) * dt, y: vy * dt, z: (V.z[eid] ?? 0) * dt }, undefined, QUERY_LEVEL_ONLY);
    const m = w.kcc.computedMovement();
    const nowGrounded = w.kcc.computedGrounded();
    T.x[eid] = (T.x[eid] ?? 0) + m.x;
    T.y[eid] = (T.y[eid] ?? 0) + m.y;
    T.z[eid] = (T.z[eid] ?? 0) + m.z;
    if (nowGrounded && vy < 0) vy = 0;
    // Hit a ceiling: stop rising.
    if (vy > 0 && m.y < vy * dt * 0.5) vy = 0;
    V.y[eid] = vy;
    S.flags[eid] = nowGrounded ? flags | EntityFlag.Grounded : flags & ~EntityFlag.Grounded;
    if (!nowGrounded && coyote > 0) coyote--;
    if (buffer > 0) buffer--;
    S.timers[eid] = (coyote & 0xff) | ((buffer & 0xff) << 8);
    // Fell out of the world (should not happen with walls): put back at spawn.
    if ((T.y[eid] ?? 0) < -20) {
      const [sx, sy, sz] = w.config.arena.spawn;
      T.x[eid] = sx;
      T.y[eid] = sy;
      T.z[eid] = sz;
      V.y[eid] = 0;
    }
  }

  if (w.config.content.enabled) {
    contentMovement(w);
    w.physics.step();
    return;
  }
  // Enemies: integrate in the plane, then resolve against pillars, players and the walls.
  const players: number[] = [];
  for (const eid of w.players.values()) {
    if (((S.flags[eid] ?? 0) & EntityFlag.Dead) === 0) players.push(eid);
  }
  players.sort((a, b) => (N.netId[a] ?? 0) - (N.netId[b] ?? 0));
  const lim = half - E.radius;
  for (const eid of liveOrder(w)) {
    if (N.kind[eid] !== EntityKind.Enemy) continue;
    let x = (T.x[eid] ?? 0) + (V.x[eid] ?? 0) * dt;
    let z = (T.z[eid] ?? 0) + (V.z[eid] ?? 0) * dt;
    for (const p of pillars) {
      const ox = x - p.x;
      const oz = z - p.z;
      const min = p.radius + E.radius;
      const d2 = ox * ox + oz * oz;
      if (d2 < min * min) {
        const d = Math.sqrt(d2);
        if (d > 1e-6) {
          x = p.x + (ox / d) * min;
          z = p.z + (oz / d) * min;
        } else {
          x = p.x + min;
        }
      }
    }
    for (const pe of players) {
      const ox = x - (T.x[pe] ?? 0);
      const oz = z - (T.z[pe] ?? 0);
      const min = P.radius + E.radius;
      const d2 = ox * ox + oz * oz;
      if (d2 < min * min && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        x = (T.x[pe] ?? 0) + (ox / d) * min;
        z = (T.z[pe] ?? 0) + (oz / d) * min;
      }
    }
    T.x[eid] = x < -lim ? -lim : x > lim ? lim : x;
    T.z[eid] = z < -lim ? -lim : z > lim ? lim : z;
    T.y[eid] = E.radius;
  }

  w.physics.step();
}

// ---------------------------------------------------------------- combat

function combatSystem(w: InternalWorld): void {
  const { Transform: T, Networked: N, SimState: S, Health: H } = w.c;
  const P = w.config.player;
  const E = w.config.enemies;
  for (const eid of liveOrder(w)) {
    if (N.kind[eid] === EntityKind.Enemy && (S.cooldown[eid] ?? 0) > 0) S.cooldown[eid] = (S.cooldown[eid] ?? 0) - 1;
  }
  for (const pid of [...w.players.keys()].sort((a, b) => a - b)) {
    const pe = w.players.get(pid);
    if (pe === undefined) continue;
    if (((S.flags[pe] ?? 0) & EntityFlag.Dead) !== 0) continue;
    const px = T.x[pe] ?? 0;
    const pz = T.z[pe] ?? 0;
    const netId = N.netId[pe] ?? 0;
    if ((S.cooldown[pe] ?? 0) > 0) S.cooldown[pe] = (S.cooldown[pe] ?? 0) - 1;

    // Fire: a radial pulse that kills every enemy inside pulseRadius.
    if (((S.buttons[pe] ?? 0) & Button.Fire) !== 0 && (S.cooldown[pe] ?? 0) === 0) {
      S.cooldown[pe] = P.pulseCooldownTicks;
      w.events.push({ type: "player.pulse", playerId: pid, netId });
      const r2 = P.pulseRadius * P.pulseRadius;
      forEnemiesNear(w, px, pz, P.pulseRadius, (o) => {
        if (w.doomed.has(o)) return;
        const ox = (T.x[o] ?? 0) - px;
        const oz = (T.z[o] ?? 0) - pz;
        if (ox * ox + oz * oz > r2) return;
        H.hp[o] = 0;
        w.doomed.add(o);
        w.kills++;
        w.events.push({ type: "enemy.killed", netId: N.netId[o] ?? 0, by: pid, enemyType: 0, boss: false });
      });
    }

    // Contact damage from enemies touching the player.
    const reach = P.radius + E.radius + 0.05;
    forEnemiesNear(w, px, pz, reach, (o) => {
      if (w.doomed.has(o) || (S.cooldown[o] ?? 0) > 0) return;
      const ox = (T.x[o] ?? 0) - px;
      const oz = (T.z[o] ?? 0) - pz;
      if (ox * ox + oz * oz > reach * reach) return;
      if (((S.flags[pe] ?? 0) & EntityFlag.Dead) !== 0) return false;
      S.cooldown[o] = E.contactCooldownTicks;
      const hp = Math.max(0, (H.hp[pe] ?? 0) - E.contactDamage);
      H.hp[pe] = hp;
      w.events.push({ type: "player.hit", playerId: pid, netId, by: N.netId[o] ?? 0, damage: E.contactDamage, health: hp });
      if (hp === 0) {
        S.flags[pe] = (S.flags[pe] ?? 0) | EntityFlag.Dead;
        S.cooldown[pe] = Math.round(RESPAWN_SECONDS * w.tickRate);
        w.events.push({ type: "player.died", playerId: pid, netId });
        return false;
      }
    });
  }
}

// ---------------------------------------------------------------- pickups

/** XP gems in content mode; the week-2 arena has none. */
function pickupSystem(w: InternalWorld): void {
  if (w.config.content.enabled && w.config.content.arena.enabled) arenaPickups(w);
  else if (w.config.content.enabled) contentPickups(w);
}

// ---------------------------------------------------------------- spawners

/** Keep `enemies.target` alive: spawn on a ring around a random living player (or the arena spawn). */
function spawnerSystem(w: InternalWorld): void {
  const E = w.config.enemies;
  const { Transform: T, SimState: S } = w.c;
  if (E.target === 0) return;
  const alive = w.config.content.enabled ? w.enemyCount - w.corpseCount : w.enemyCount - countDoomedEnemies(w);
  let want = Math.min(E.target - alive, E.spawnPerTick, w.config.maxEntities - w.byNetId.size);
  if (want <= 0) return;
  const anchors: number[] = [];
  for (const pid of [...w.players.keys()].sort((a, b) => a - b)) {
    const eid = w.players.get(pid);
    if (eid !== undefined && ((S.flags[eid] ?? 0) & EntityFlag.Dead) === 0) anchors.push(eid);
  }
  const half = w.config.arena.halfExtent - E.radius - 0.5;
  const [sx, , sz] = w.config.arena.spawn;
  while (want-- > 0) {
    const a = anchors.length > 0 ? anchors[Math.floor(nextRandom(w) * anchors.length)] : undefined;
    const cx = a === undefined ? sx : (T.x[a] ?? 0);
    const cz = a === undefined ? sz : (T.z[a] ?? 0);
    const ang = nextRandom(w) * Math.PI * 2;
    const r = E.spawnRadius * (0.8 + 0.4 * nextRandom(w));
    let x = cx + Math.cos(ang) * r;
    let z = cz + Math.sin(ang) * r;
    x = x < -half ? -half : x > half ? half : x;
    z = z < -half ? -half : z > half ? half : z;
    for (const p of w.config.arena.pillars) {
      const ox = x - p.x;
      const oz = z - p.z;
      const min = p.radius + E.radius + 0.05;
      if (ox * ox + oz * oz < min * min) x = p.x + (ox >= 0 ? min : -min);
    }
    const eid = spawnEntity(w, EntityKind.Enemy, [x, E.radius, z]);
    w.events.push({ type: "entity.spawned", netId: w.c.Networked.netId[eid] ?? 0, kind: EntityKind.Enemy });
  }
}

function countDoomedEnemies(w: InternalWorld): number {
  let n = 0;
  for (const eid of w.doomed) if (w.c.Networked.kind[eid] === EntityKind.Enemy) n++;
  return n;
}

// ---------------------------------------------------------------- game rules

/** Arena: dead players count down and respawn at the arena spawn with full health. Content mode: co-op downed, revive, regen. */
function gameRulesSystem(w: InternalWorld): void {
  if (w.config.content.enabled) {
    if (w.config.content.arena.enabled) arenaRules(w);
    else contentRules(w);
    return;
  }
  const { Transform: T, Velocity: V, SimState: S, Health: H, Networked: N } = w.c;
  for (const pid of [...w.players.keys()].sort((a, b) => a - b)) {
    const eid = w.players.get(pid);
    if (eid === undefined) continue;
    if (((S.flags[eid] ?? 0) & EntityFlag.Dead) === 0) continue;
    const cd = (S.cooldown[eid] ?? 0) - 1;
    S.cooldown[eid] = Math.max(0, cd);
    if (cd > 0) continue;
    const [x, y, z] = w.config.arena.spawn;
    T.x[eid] = T.px[eid] = x;
    T.y[eid] = T.py[eid] = y;
    T.z[eid] = T.pz[eid] = z;
    V.x[eid] = V.y[eid] = V.z[eid] = 0;
    H.hp[eid] = w.config.player.maxHealth;
    S.flags[eid] = 0;
    S.timers[eid] = 0;
    w.events.push({ type: "player.respawned", playerId: pid as PlayerId, netId: N.netId[eid] ?? 0 });
  }
}

// ---------------------------------------------------------------- lifetime

function lifetimeSystem(w: InternalWorld): void {
  if (w.config.content.enabled) contentLifetime(w);
  if (w.config.content.enabled && w.config.content.arena.enabled) arenaLifetime(w);
  if (w.doomed.size === 0) return;
  const doomed = [...w.doomed].sort((a, b) => (w.c.Networked.netId[a] ?? 0) - (w.c.Networked.netId[b] ?? 0));
  w.doomed.clear();
  for (const eid of doomed) {
    const netId = w.c.Networked.netId[eid] ?? 0;
    const kind = w.c.Networked.kind[eid] ?? 0;
    despawnEntity(w, eid);
    if (kind !== 0) w.events.push({ type: "entity.removed", netId, kind: kind as EntityKindId });
  }
}

// ---------------------------------------------------------------- quantize

/** Snap all state onto the wire grid so capture → apply is lossless. */
function quantizeSystem(w: InternalWorld): void {
  const { Transform: T, Velocity: V, Networked: N } = w.c;
  for (const eid of liveOrder(w)) {
    T.x[eid] = snapPos(T.x[eid] ?? 0);
    T.y[eid] = N.kind[eid] === EntityKind.Player ? snapPosUp(T.y[eid] ?? 0) : snapPos(T.y[eid] ?? 0);
    T.z[eid] = snapPos(T.z[eid] ?? 0);
    T.yaw[eid] = snapYaw(T.yaw[eid] ?? 0);
    V.x[eid] = snapVel(V.x[eid] ?? 0);
    V.y[eid] = snapVel(V.y[eid] ?? 0);
    V.z[eid] = snapVel(V.z[eid] ?? 0);
  }
}
