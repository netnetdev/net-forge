/**
 * @netnetcapital/engine/game: runs a declared game on engine-sim. Used by
 * the room server, the headless harness and template clients; generated
 * game code never imports it (it sees only the declarative API).
 *
 *  - compileGame(manifest): prefabs, weapons and upgrades → sim content.
 *  - GameRunner: systems on a run clock, game events, earn, run phases.
 *  - engineSimAdapter(...): the netcode SimAdapter over engine-sim.
 *  - EarnTracker: earn rules counted per player per run.
 */
export { compileGame, prefabKind, ARENA_DEFAULTS } from "./compile.js";
export type { CompiledGame } from "./compile.js";
export { GameRunner } from "./runner.js";
export type { KillFeedEntry, RunInfo, RunPhase, RunPlayerInfo, RunnerOptions, RunnerStep } from "./runner.js";
export { arenaBotInput, arenaBotMemory, sightBlocked } from "./arena-bot.js";
export type { ArenaBotMemory, ArenaBotOpponent, ArenaBotView, ArenaBotWeapon } from "./arena-bot.js";
export { EarnTracker } from "./earn.js";
export type { EarnAward, GameEvent } from "./earn.js";
export { engineSimAdapter, engineSchema, disposeEngineWorld, F, CROWD_UNITS, PLAYER_UNITS } from "./adapter.js";
export type { EngineAdapterOptions, EngineRoomWorld } from "./adapter.js";
export { collectManifest, resetRegistry } from "../api/registry.js";
export { botInput, HumanBot } from "./bot.js";
export type { BotView, BotDanger, HumanBotOptions, HumanBotView } from "./bot.js";
export { Director, curveAt } from "./director.js";
export { SURVIVOR_VIEWS, DUNGEON_VIEWS, viewsFor, footprint, viewRadii, radiusAt, insideView } from "./view.js";
export type { CameraView } from "./view.js";
export { threatOf, laneLength } from "./threats.js";
export type { ThreatShape } from "./threats.js";
export { levelTable } from "./compile.js";
export { profileSpec, openKeepers, ownedCosmetics, ownedGear, metaPrice, metaBonus, packMeta, unpackMeta, todaysGoals, utcDay, skuKind, RESERVED_COMMANDS } from "./profile.js";
export type { ProfileSpec, ProfileSku, ProfileUnlockState, RunProgress, SkuKind } from "./profile.js";
export { RaceRunner } from "./race.js";
export type { RaceCore, RaceInfo, RacePhase, RacePlayerInfo, RaceRunnerOptions, RaceSimEvent, RaceStep } from "./race.js";
export { compilePlatformer, platformAutopilot, planCourse, routeFor, unroutable, botDelaySeconds, platformAdapter, platformBotInput, platformSchema, PlatformCore, PF, PLATFORMER_DEFAULTS, raceInputCodec } from "./platformer.js";
export type { CompiledPlatformer, PlanResult, PlatformAdapterOptions, PlatformBotMemory, PlatformRoomWorld } from "./platformer.js";
export { compileRacer, kartAdapter, kartAutopilot, kartBotInput, kartFromValues, kartSchema, KartCore, KF, RACER_DEFAULTS } from "./racer.js";
export type { CompiledRacer, KartAdapterOptions, KartRoomWorld } from "./racer.js";
