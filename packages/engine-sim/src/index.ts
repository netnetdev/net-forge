/**
 * @netnetcapital/engine-sim: the shared simulation.
 * Types and constants are in ./api.ts; see README.md for the contract.
 */
export * from "./api.js";
export { initSim, createWorld, destroyWorld, addPlayer, removePlayer, playerNetId, lastProcessedSeq } from "./world.js";
export { step } from "./step.js";
export { quantizeInput, encodeInput, decodeInput, encodeInputs, decodeInputs } from "./input.js";
export { captureState, applyState, encodeSnapshot, decodeSnapshot, snapshotBaseTick } from "./snapshot.js";
export { renderView } from "./render.js";
export { FixedStepper } from "./stepper.js";
export { DEFAULT_ARENA, DEFAULT_PLAYER, DEFAULT_ENEMIES, DEFAULT_PROGRESSION, DEFAULT_COOP, DEFAULT_ARENA_RULES, DEFAULT_VIEW, resolveConfig } from "./config.js";
export {
  spawnEnemy,
  setEnemySpeed,
  spawnEnemyScaled,
  edgeSpawnPoint,
  ringSpawnPoint,
  recycleEnemies,
  viewEdge,
  isOnScreen,
  simPaused,
  enemyMaxHealth,
  entityPosition,
  enemyCount,
  entityHeadroom,
  listPlayers,
  resetRun,
  respawnDead,
  revivePlayer,
  setCosmetic,
  setMetaBonus,
  metaBonusOf,
  META_MAX_PER_STAT,
  META_MAX_TOTAL,
  spawnRingPoint,
  simRandom,
  xpForLevel,
  maxHealthFor,
  entityHealth,
  decodeChoices,
  orbitAngle,
  slotLevel,
  slotWeapon,
  statLevel,
  ORBIT_BLADE_RADIUS,
  ORBIT_HIT_EVERY,
  beamShot,
  applyBeamHit,
  arenaHitboxes,
  arenaSpawn,
  grantUpgrade,
  listPickups,
  beamRange,
  selectedSlot,
  ARENA_BOLT_RADIUS,
  ARENA_SPAWN_CLEAR,
  ARENA_HITBOX_PAD,
} from "./control.js";
export type { BeamShot, ArenaHitbox } from "./control.js";
export type { EdgeSpawnOptions } from "./control.js";
export type { MetaBonus } from "./world.js";
export {
  createPhysics,
  restorePhysics,
  PhysicsWorld,
  Layer,
  ALL_LAYERS,
  layerMask,
  collisionGroups,
  layersCollide,
  resolveCharacter,
} from "./physics/index.js";
export type {
  PhysicsOptions,
  LayerName,
  LayerBit,
  BodyId,
  JointId,
  Quat,
  BodyType,
  ShapeDesc,
  BodyDesc,
  PhysicsEvent,
  PhysicsEventType,
  RayHit,
  ShapeHit,
  QueryOptions,
  JointKind,
  JointDesc,
  KnockbackOptions,
  CharacterDesc,
  ResolvedCharacterDesc,
  CharacterInput,
  CharacterState,
  CharacterReport,
  PhysicsStepResult,
} from "./physics/index.js";
export { decodeTelegraph, teleWord, ROLE_DEFAULTS } from "./roles.js";
export { weaponModsFor } from "./control.js";
export { scaledWeapon, METEOR_FALL_SECONDS } from "./weapons.js";
export type { Scaled } from "./weapons.js";
export { grantXp, playerBuild, grantLevels, pendingCards } from "./control.js";
export type { PlayerBuild } from "./control.js";
export { critRoll } from "./content.js";
export { spawnPickupAt, setXpBoost, removeEnemies, scatterEnemies } from "./control.js";
export { enemyTypeOf } from "./control.js";
export { inWall, onFloor, pushOutOfWalls, segmentWalls } from "./walls.js";
export * from "./platform.js";
export * from "./kart.js";
