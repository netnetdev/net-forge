import RAPIER from "@dimforge/rapier3d-deterministic-compat";
import type { Collider, KinematicCharacterController, World as PhysicsWorld } from "@dimforge/rapier3d-deterministic-compat";
import { addComponent, addEntity, createWorld as createEcsWorld, entityExists, removeEntity } from "bitecs";
import type { World as EcsWorld } from "bitecs";
import { EntityFlag, EntityKind } from "./api.js";
import type { EntityKindId, NetId, PlayerId, ResolvedSimConfig, SimConfig, SimEvent, SimWorld, Vec3 } from "./api.js";
import { resolveConfig } from "./config.js";
import { snapPos } from "./quant.js";

let rapierReady = false;

/** Load the Rapier WebAssembly. Call once per process before `createWorld`. Idempotent. */
export async function initSim(): Promise<void> {
  if (rapierReady) return;
  await RAPIER.init();
  rapierReady = true;
}

/** Collision groups: level geometry is group 1, characters group 2 and only collide with the level. */
export const GROUP_LEVEL = (0x0001 << 16) | 0xffff;
export const GROUP_CHARACTER = (0x0002 << 16) | 0x0001;
/** Query groups for character movement: as a character, against the level only. */
export const QUERY_LEVEL_ONLY = (0x0002 << 16) | 0x0001;

/**
 * Components: structure-of-arrays on typed arrays, indexed by ECS entity id
 * (bitECS 0.4 takes any object as a component). Float64 so the in-tick math
 * matches plain JS numbers; state is snapped to the wire grid every tick.
 */
export function createComponents(capacity: number) {
  const f64 = () => new Float64Array(capacity);
  return {
    /** Transform: position (m) and yaw (rad), plus last tick's for interpolation. */
    Transform: { x: f64(), y: f64(), z: f64(), yaw: f64(), px: f64(), py: f64(), pz: f64(), pyaw: f64() },
    Velocity: { x: f64(), y: f64(), z: f64() },
    Networked: { netId: new Uint32Array(capacity), kind: new Uint8Array(capacity) },
    Owner: { player: new Uint16Array(capacity) },
    Health: { hp: new Int32Array(capacity) },
    /** Per-entity sim bookkeeping that rides in snapshots. */
    SimState: {
      flags: new Uint8Array(capacity),
      ack: new Uint32Array(capacity),
      cooldown: new Int32Array(capacity),
      buttons: new Uint16Array(capacity),
      timers: new Uint16Array(capacity),
    },
    /** Game state (content mode): see EntityState for what each field means per kind. */
    Game: {
      type: new Uint8Array(capacity),
      value: new Int32Array(capacity),
      level: new Uint16Array(capacity),
      xp: new Uint32Array(capacity),
      weapons: new Uint32Array(capacity),
      wcd: new Uint32Array(capacity),
      stats: new Uint32Array(capacity),
      choices: new Uint32Array(capacity),
      bleed: new Uint16Array(capacity),
      revive: new Uint16Array(capacity),
      iframes: new Uint16Array(capacity),
      dash: new Uint32Array(capacity),
    },
    /** Body: a Rapier collider handle (characters). */
    Body: { handle: new Int32Array(capacity).fill(-1) },
    CharacterController: {},
    AIAgent: {},
    Player: {},
    Enemy: {},
  };
}
export type Components = ReturnType<typeof createComponents>;

/** Uniform grid used by AI separation and combat queries. */
export interface Grid {
  cell: number;
  dim: number;
  origin: number;
  start: Int32Array;
  count: Int32Array;
  items: Int32Array;
}

export interface InternalWorld extends SimWorld {
  tick: number;
  ecs: EcsWorld;
  physics: PhysicsWorld;
  kcc: KinematicCharacterController;
  levelColliders: Collider[];
  /** Character colliders by ECS entity id. */
  colliders: Map<number, Collider>;
  c: Components;
  capacity: number;
  rng: number;
  nextNetId: number;
  kills: number;
  byNetId: Map<NetId, number>;
  players: Map<PlayerId, number>;
  /** Live entity ids in ascending netId order: every float-affecting loop walks this. */
  order: number[];
  orderDirty: boolean;
  enemyCount: number;
  /** Enemies that are corpses (EntityFlag.Dead), counted in enemyCount. */
  corpseCount: number;
  pickupCount: number;
  /** Live (non-corpse) enemies per type. */
  typeCount: Int32Array;
  /** Largest enemy radius across types (grid query reach). */
  maxEnemyRadius: number;
  doomed: Set<number>;
  events: SimEvent[];
  grid: Grid;
  destroyed: boolean;
  /** Authority: multiplier on non-boss enemies' steering speed (the director's speed curve). */
  enemySpeed: number;
  /** Permanent (meta) stat bonuses by player id, fractions already capped by the engine (setMetaBonus). */
  meta: Map<PlayerId, MetaBonus>;
}

/**
 * A player's permanent stat bonus from meta upgrades bought with coins
 * (opt-in per game). Fractions: 0.05 is +5%.
 * speed, might and area multiply; haste cuts cooldowns; maxHealth and
 * magnet add that fraction of the base value.
 */
export interface MetaBonus {
  speed: number;
  maxHealth: number;
  magnet: number;
  might: number;
  haste: number;
  area: number;
}

export function internal(world: SimWorld): InternalWorld {
  const w = world as InternalWorld;
  if (w.destroyed) throw new Error("engine-sim: world was destroyed");
  return w;
}

function buildLevel(physics: PhysicsWorld, config: ResolvedSimConfig): Collider[] {
  const { halfExtent: h, wallHeight, pillars } = config.arena;
  const out: Collider[] = [];
  const add = (desc: RAPIER.ColliderDesc) => out.push(physics.createCollider(desc.setCollisionGroups(GROUP_LEVEL)));
  // Floor: top face at y = 0.
  add(RAPIER.ColliderDesc.cuboid(h + 1, 0.5, h + 1).setTranslation(0, -0.5, 0));
  // Four walls just outside the floor square.
  const t = 0.5;
  add(RAPIER.ColliderDesc.cuboid(h + 1, wallHeight / 2, t).setTranslation(0, wallHeight / 2, h + t));
  add(RAPIER.ColliderDesc.cuboid(h + 1, wallHeight / 2, t).setTranslation(0, wallHeight / 2, -h - t));
  add(RAPIER.ColliderDesc.cuboid(t, wallHeight / 2, h + 1).setTranslation(h + t, wallHeight / 2, 0));
  add(RAPIER.ColliderDesc.cuboid(t, wallHeight / 2, h + 1).setTranslation(-h - t, wallHeight / 2, 0));
  for (const p of pillars) {
    add(RAPIER.ColliderDesc.cylinder(p.height / 2, p.radius).setTranslation(p.x, p.height / 2, p.z));
  }
  // A dungeon's walls: boxes as tall as the outer wall.
  for (const b of config.arena.walls ?? []) {
    add(RAPIER.ColliderDesc.cuboid(b.hx, wallHeight / 2, b.hz).setTranslation(b.x, wallHeight / 2, b.z));
  }
  return out;
}

/** Create a world: static arena colliders, empty of entities, tick 0. Requires `initSim()`. */
export function createWorld(config?: SimConfig): SimWorld {
  if (!rapierReady) throw new Error("engine-sim: call `await initSim()` before createWorld");
  const resolved = resolveConfig(config);
  const capacity = resolved.maxEntities + 2;
  const physics = new RAPIER.World({ x: 0, y: -resolved.player.gravity, z: 0 });
  physics.timestep = 1 / resolved.tickRate;
  const levelColliders = buildLevel(physics, resolved);
  // One empty step so the broad phase holds the level before the first query.
  physics.step();

  const kcc = physics.createCharacterController(0.02);
  kcc.setUp({ x: 0, y: 1, z: 0 });
  kcc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
  kcc.setMinSlopeSlideAngle((35 * Math.PI) / 180);
  kcc.enableAutostep(0.35, 0.2, false);
  kcc.enableSnapToGround(0.3);
  kcc.setApplyImpulsesToDynamicBodies(false);

  const cell = Math.max(1, resolved.enemies.radius * 4);
  let maxEnemyRadius = 0;
  for (const t of resolved.content.enemyTypes) maxEnemyRadius = Math.max(maxEnemyRadius, t.radius);
  const dim = Math.ceil((resolved.arena.halfExtent * 2 + 2) / cell);
  const grid: Grid = {
    cell,
    dim,
    origin: -(resolved.arena.halfExtent + 1),
    start: new Int32Array(dim * dim + 1),
    count: new Int32Array(dim * dim),
    items: new Int32Array(capacity),
  };

  const world: InternalWorld = {
    tick: 0,
    tickRate: resolved.tickRate,
    dt: 1 / resolved.tickRate,
    config: resolved,
    ecs: createEcsWorld(),
    physics,
    kcc,
    levelColliders,
    colliders: new Map(),
    c: createComponents(capacity),
    capacity,
    rng: resolved.seed,
    nextNetId: 1,
    kills: 0,
    byNetId: new Map(),
    players: new Map(),
    order: [],
    orderDirty: false,
    enemyCount: 0,
    corpseCount: 0,
    pickupCount: 0,
    typeCount: new Int32Array(256),
    maxEnemyRadius,
    doomed: new Set(),
    events: [],
    grid,
    destroyed: false,
    enemySpeed: 1,
    meta: new Map(),
  };
  return world;
}

/** Free the world's physics memory. The world is unusable afterwards. */
export function destroyWorld(world: SimWorld): void {
  const w = internal(world);
  w.kcc.free();
  w.physics.free();
  w.destroyed = true;
}

/** Live entities in ascending netId order (compacting after removals). */
export function liveOrder(w: InternalWorld): number[] {
  if (w.orderDirty) {
    w.order = w.order.filter((eid) => entityExists(w.ecs, eid) && w.c.Networked.netId[eid] !== 0);
    w.orderDirty = false;
  }
  return w.order;
}

/**
 * Spawn an entity with a given netId (from a snapshot) or the next fresh
 * one. Keeps `order` sorted: fresh ids are always the largest; snapshot
 * restores insert in place.
 */
export function spawnEntity(
  w: InternalWorld,
  kind: EntityKindId,
  pos: Vec3,
  opts: { netId?: NetId; owner?: PlayerId; type?: number } = {},
): number {
  if (w.byNetId.size >= w.config.maxEntities) throw new RangeError("engine-sim: maxEntities reached");
  const eid = addEntity(w.ecs);
  if (eid >= w.capacity) {
    removeEntity(w.ecs, eid);
    throw new RangeError("engine-sim: entity id beyond capacity");
  }
  const { c } = w;
  const netId = opts.netId ?? w.nextNetId++;
  if (opts.netId !== undefined && opts.netId >= w.nextNetId) w.nextNetId = opts.netId + 1;
  addComponent(w.ecs, eid, c.Transform);
  addComponent(w.ecs, eid, c.Velocity);
  addComponent(w.ecs, eid, c.Networked);
  addComponent(w.ecs, eid, c.Health);
  addComponent(w.ecs, eid, c.SimState);
  c.Networked.netId[eid] = netId;
  c.Networked.kind[eid] = kind;
  const x = snapPos(pos[0]);
  const y = snapPos(pos[1]);
  const z = snapPos(pos[2]);
  c.Transform.x[eid] = c.Transform.px[eid] = x;
  c.Transform.y[eid] = c.Transform.py[eid] = y;
  c.Transform.z[eid] = c.Transform.pz[eid] = z;
  c.Transform.yaw[eid] = c.Transform.pyaw[eid] = 0;
  c.Velocity.x[eid] = c.Velocity.y[eid] = c.Velocity.z[eid] = 0;
  c.SimState.flags[eid] = 0;
  c.SimState.ack[eid] = 0;
  c.SimState.cooldown[eid] = 0;
  c.SimState.buttons[eid] = 0;
  c.SimState.timers[eid] = 0;
  c.Owner.player[eid] = opts.owner ?? 0;
  const G = c.Game;
  G.type[eid] = opts.type ?? 0;
  G.value[eid] = 0;
  G.level[eid] = 0;
  G.xp[eid] = 0;
  G.weapons[eid] = 0;
  G.wcd[eid] = 0;
  G.stats[eid] = 0;
  G.choices[eid] = 0;
  G.bleed[eid] = 0;
  G.revive[eid] = 0;
  G.iframes[eid] = 0;
  G.dash[eid] = 0;

  if (kind === EntityKind.Player) {
    const owner = opts.owner ?? 0;
    addComponent(w.ecs, eid, c.Owner);
    addComponent(w.ecs, eid, c.Player);
    addComponent(w.ecs, eid, c.CharacterController);
    addComponent(w.ecs, eid, c.Body);
    c.Health.hp[eid] = w.config.player.maxHealth;
    const { radius, halfHeight } = w.config.player;
    // A parentless collider moved directly by the controller: its position
    // is set immediately, so a restored world queries exactly like the original.
    const col = w.physics.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius).setTranslation(x, y, z).setCollisionGroups(GROUP_CHARACTER),
    );
    w.colliders.set(eid, col);
    c.Body.handle[eid] = col.handle;
    w.players.set(owner, eid);
    initProgression(w, eid);
  } else if (kind === EntityKind.Enemy) {
    addComponent(w.ecs, eid, c.Enemy);
    addComponent(w.ecs, eid, c.AIAgent);
    const t = G.type[eid] ?? 0;
    c.Health.hp[eid] = w.config.content.enemyTypes[t]?.health ?? w.config.enemies.maxHealth;
    w.enemyCount++;
    w.typeCount[t] = (w.typeCount[t] ?? 0) + 1;
  } else if (kind === EntityKind.Pickup) {
    c.Health.hp[eid] = 0;
    w.pickupCount++;
  } else {
    c.Health.hp[eid] = 0;
  }

  w.byNetId.set(netId, eid);
  const last = w.order[w.order.length - 1];
  if (last === undefined || (c.Networked.netId[last] ?? 0) < netId) {
    w.order.push(eid);
  } else {
    // Out-of-order insert (snapshot restore): binary search by netId.
    let lo = 0;
    let hi = w.order.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((c.Networked.netId[w.order[mid] ?? 0] ?? 0) < netId) lo = mid + 1;
      else hi = mid;
    }
    w.order.splice(lo, 0, eid);
  }
  return eid;
}

export function despawnEntity(w: InternalWorld, eid: number): void {
  const { c } = w;
  const netId = c.Networked.netId[eid] ?? 0;
  const kind = c.Networked.kind[eid] ?? 0;
  if (netId === 0) return;
  const col = w.colliders.get(eid);
  if (col) {
    w.physics.removeCollider(col, false);
    w.colliders.delete(eid);
    c.Body.handle[eid] = -1;
  }
  if (kind === EntityKind.Player) {
    const owner = c.Owner.player[eid] ?? 0;
    if (w.players.get(owner) === eid) w.players.delete(owner);
  } else if (kind === EntityKind.Enemy) {
    w.enemyCount--;
    if (((c.SimState.flags[eid] ?? 0) & EntityFlag.Dead) !== 0) w.corpseCount--;
    else {
      const t = c.Game.type[eid] ?? 0;
      w.typeCount[t] = (w.typeCount[t] ?? 0) - 1;
    }
  } else if (kind === EntityKind.Pickup) {
    w.pickupCount--;
  }
  w.byNetId.delete(netId);
  c.Networked.netId[eid] = 0;
  removeEntity(w.ecs, eid);
  w.orderDirty = true;
}

/** Spawn a player's character. Throws if the id is already present. */
export function addPlayer(world: SimWorld, playerId: PlayerId, spawn?: Vec3): NetId {
  const w = internal(world);
  if (!Number.isInteger(playerId) || playerId < 1 || playerId > 0xffff) {
    throw new RangeError(`engine-sim: playerId must be 1..65535, got ${playerId}`);
  }
  if (w.players.has(playerId)) throw new Error(`engine-sim: player ${playerId} already in world`);
  const eid = spawnEntity(w, EntityKind.Player, spawn ?? w.config.arena.spawn, { owner: playerId });
  const netId = w.c.Networked.netId[eid] ?? 0;
  w.events.push({ type: "player.joined", playerId, netId });
  return netId;
}

/** Remove a player's character. No-op if absent. */
export function removePlayer(world: SimWorld, playerId: PlayerId): void {
  const w = internal(world);
  const eid = w.players.get(playerId);
  if (eid === undefined) return;
  const netId = w.c.Networked.netId[eid] ?? 0;
  despawnEntity(w, eid);
  w.meta.delete(playerId);
  w.events.push({ type: "player.left", playerId, netId });
}

/** The NetId of a player's character, if present. */
export function playerNetId(world: SimWorld, playerId: PlayerId): NetId | undefined {
  const w = internal(world);
  const eid = w.players.get(playerId);
  return eid === undefined ? undefined : w.c.Networked.netId[eid];
}

/** The last input seq the sim consumed for this player (the reconciliation ack). 0 if none or absent. */
export function lastProcessedSeq(world: SimWorld, playerId: PlayerId): number {
  const w = internal(world);
  const eid = w.players.get(playerId);
  return eid === undefined ? 0 : (w.c.SimState.ack[eid] ?? 0);
}

/**
 * A fresh run for one player character: level 1, no XP, the start weapon at
 * level 1, no passives, full health. No-op for the pulse arena (no content).
 */
export function initProgression(w: InternalWorld, eid: number): void {
  const G = w.c.Game;
  const content = w.config.content;
  G.level[eid] = content.enabled ? 1 : 0;
  G.xp[eid] = 0;
  G.weapons[eid] = 0;
  G.wcd[eid] = 0;
  G.stats[eid] = 0;
  G.choices[eid] = 0;
  G.bleed[eid] = 0;
  G.revive[eid] = 0;
  // Arena: joining (and every fresh round) starts with spawn protection, like a respawn; firing ends it.
  G.iframes[eid] = content.enabled && content.arena.enabled ? content.arena.spawnIframeTicks : 0;
  G.dash[eid] = 0;
  if (content.enabled && content.arena.enabled && content.progression.loadout.length > 0) {
    // Arena: the whole loadout, one weapon per slot, slot 1 selected (choices = 0).
    let packed = 0;
    content.progression.loadout.forEach((wi, s) => {
      packed |= ((wi + 1) | (1 << 4)) << (s * 8);
    });
    G.weapons[eid] = packed >>> 0;
  } else if (content.enabled && content.characters.length > 0) {
    // A keeper: its start weapon and signature passive (index in Game.value bits 12..15).
    const ch = content.characters[((G.value[eid] ?? 0) >>> 12) & 0xf] ?? content.characters[0];
    if (ch) {
      G.weapons[eid] = ((ch.weapon + 1) | (1 << 4)) >>> 0;
      if (ch.stat >= 0) G.stats[eid] = (1 << (ch.stat * 4)) >>> 0;
    }
  } else if (content.enabled && content.progression.startWeapon >= 0) {
    G.weapons[eid] = (content.progression.startWeapon + 1) | (1 << 4);
  }
  w.c.Health.hp[eid] = w.config.player.maxHealth;
}
