/**
 * @netforge/engine: the API a game is written against.
 *
 * This entry point is all a generated game may import. It is declarative
 * and typed (Zod-validated): game, prefab, system, earn, store, and the
 * headless test harness. Rendering, input, netcode and physics are not
 * reachable from here; they live in "@netforge/engine/runtime", which
 * templates and the Launcher shell use and game code does not.
 */
export { dungeon, dungeonSchema } from "./api/dungeon.js";
export type { DungeonLayout, DungeonRoom, DungeonSpec } from "./api/dungeon.js";
export { game, prefab, weapon, upgrade, system, director, earn, store, keeper, achievement, mission, title, economy, metaUpgrade, STAKE_REASON, POT_REASON } from "./api/registry.js";
export type { EdgeSide, GameManifest, PlayerView, SpawnEdgeOptions, SpawnRingOptions, SystemContext, SystemSetup } from "./api/registry.js";
export {
  GameDefinitionError,
  TEMPLATES,
  STYLES,
  AI_BEHAVIOURS,
  WEAPON_KINDS,
  STAT_KINDS,
  LOOK_PRESETS,
  PARTICLE_PRESETS,
  DECAL_PRESETS,
  SOUND_CUES,
  TITLE_STATS,
  META_STATS,
  META_MAX_PER_STAT,
  META_MAX_TOTAL,
  META_MAX_LEVELS,
  META_MAX_UPGRADES,
  META_MIN_GROWTH,
  STAKE_MAX_MULTIPLE,
  STAKE_MAX_COINS,
} from "./api/schemas.js";
export type {
  AssetId,
  Curve,
  CurveInput,
  DirectorDef,
  DirectorInput,
  DecalPreset,
  FeelDef,
  LookDef,
  LookInput,
  LookPreset,
  ParticlePreset,
  SoundCue,
  EarnRuleDef,
  KeeperDef,
  KeeperInput,
  AchievementDef,
  AchievementInput,
  MissionDef,
  MissionInput,
  TitleDef,
  TitleInput,
  TitleStat,
  EarnRuleInput,
  EarnStakeDef,
  EarnStakeInput,
  EarnPotDef,
  EarnPotInput,
  GameDef,
  GameInput,
  PrefabDef,
  PrefabInput,
  SkuDef,
  SkuInput,
  SkuGrant,
  EconomyDef,
  EconomyInput,
  MetaUpgradeDef,
  MetaUpgradeInput,
  MetaStat,
  Style,
  Template,
  UpgradeDef,
  UpgradeInput,
  WeaponDef,
  WeaponInput,
} from "./api/schemas.js";
// Board genres (rules/): each template's own declarations.
export { towerBoard, tower, waves, TOWER_KINDS, TOWER_STATS } from "./api/tower.js";
export { saltFlat, plant, PLANT_KINDS, IDLE_STATS, IDLE_MIN_SHIFT, IDLE_MAX_TEND } from "./api/idle.js";
export type { SaltFlatDef, SaltFlatInput, PlantDef, PlantInput } from "./api/idle.js";
export { marsh, creature, move, ELEMENTS, MOVE_EFFECTS, COLLECTOR_STATS } from "./api/collector.js";
export type { MarshDef, MarshInput, CreatureDef, CreatureInput, MoveDef, MoveInput, Element } from "./api/collector.js";
export type { TowerBoardDef, TowerBoardInput, TowerDef, TowerInput, WavesDef, WavesInput } from "./api/tower.js";
export { card, cardTable, CARD_STATS, EFFECT_KINDS, EFFECT_TARGETS } from "./api/cards.js";
export type { CardDef, CardInput, CardTableDef, CardTableInput } from "./api/cards.js";
// Asset library: model appearances.
export { APPEARANCE_PARTS, appearanceSchema } from "./api/appearance.js";
export type { AppearanceDef, AppearanceInput, AppearancePart } from "./api/appearance.js";
export type { FunMetrics, HarnessAssertion, HarnessOptions, HarnessReport } from "./api/harness.js";

import { runHarness } from "./api/harness.js";

/** `engine.test.run({ ticks, bots, assert })`: the headless playtest (§12). */
export const engine = {
  test: { run: runHarness },
} as const;
