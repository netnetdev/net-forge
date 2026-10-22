/**
 * Public types of @netnetcapital/engine-sim.
 *
 * The sim is the one TypeScript module that runs identically in the browser
 * (client prediction) and on the room server (authority).
 * Everything a caller needs is in this file;
 * the ECS and Rapier internals stay behind `SimWorld`.
 *
 * THE API is `step(world, inputs)`. Around it:
 *   - `initSim()` once per process (loads the Rapier WebAssembly),
 *   - `createWorld(config)` / `destroyWorld(world)`,
 *   - `addPlayer` / `removePlayer`,
 *   - input commands: `quantizeInput`, `encodeInput(s)`, `decodeInput(s)`,
 *   - snapshots: `captureState` → `encodeSnapshot` (full or delta) on the
 *     server, `decodeSnapshot` → `applyState` on the client,
 *   - `renderView(world)` for the renderer (typed arrays, interpolation-ready),
 *   - `FixedStepper` for the fixed-timestep accumulator on either side.
 */

/** A 3-vector in metres, y up. */
export type Vec3 = readonly [x: number, y: number, z: number];

/** A player slot in a room, 1..65535. 0 means "no player". */
export type PlayerId = number;

/**
 * A stable network id for one entity (u32, never reused within a world).
 * 0 means "none". Snapshots are keyed by NetId, never by ECS entity id.
 */
export type NetId = number;

/** Default fixed tick rate in Hz (spec §4: 30 Hz default, 60 for shooters). */
export const DEFAULT_TICK_RATE = 30;

/** Snapshot wire format version (first byte after the magic). */
export const SNAPSHOT_VERSION = 2;

/** Fixed-point units per metre for positions in state and snapshots. */
export const POSITION_SCALE = 1024;
/** Fixed-point units per metre/second for velocities. */
export const VELOCITY_SCALE = 1024;
/** Yaw is a u16 turn: 65536 units per full revolution. */
export const YAW_UNITS = 65536;

/** Input button bits. Games may use bits 8..15 for their own actions. */
export const Button = {
  Jump: 1 << 0,
  Fire: 1 << 1,
  Alt: 1 << 2,
  Use: 1 << 3,
  /** Sprint in the arena; dash (with a short invulnerability) when content is configured. */
  Sprint: 1 << 4,
  /** Pick upgrade 1, 2 or 3 of a pending level-up (content mode). */
  Choice1: 1 << 5,
  Choice2: 1 << 6,
  Choice3: 1 << 7,
  /** Content mode: reroll the open cards (uses one of the run's rerolls). */
  Reroll: 1 << 8,
  /** Content mode: skip the open cards (a small heal instead). */
  Skip: 1 << 9,
  /** Between runs: ready for the next one (the end screen's "Play again" vote). */
  Ready: 1 << 10,
} as const;
export type ButtonBit = (typeof Button)[keyof typeof Button];

/**
 * Keeper (character) choice rides input bits 11..14 as index + 1 (0: no
 * choice). It is held, not pressed: the sim takes it while the keeper is
 * still level 1 with nothing pending (the start of a run), so a client
 * keeps sending its pick and it lands on the first tick of every run.
 */
export const KEEPER_SHIFT = 11;
export const KEEPER_MASK = 0xf << KEEPER_SHIFT;
/** Input bits that choose keeper `index` (0..14). */
export const keeperButtons = (index: number): number => (((index + 1) & 0xf) << KEEPER_SHIFT) >>> 0;

/**
 * A playable character: its start weapon and a signature passive at level 1.
 * Clients draw it from its index (Player `value` bits 12..15).
 */
export interface CharacterDef {
  /** Weapon index the keeper starts every run with. */
  readonly weapon: number;
  /** Passive stat index it starts at level 1 (-1: none). */
  readonly stat: number;
}

/** How a gem's XP is shared in co-op. */
export interface XpShare {
  /** "collector": the collector only. "nearby": `fraction` to every other living player within `radius` m. "all": the full amount to everyone up. */
  readonly mode: "collector" | "nearby" | "all";
  readonly fraction: number;
  readonly radius: number;
}

/** Entity kinds carried in snapshots. */
export const EntityKind = {
  Player: 1,
  Enemy: 2,
  Projectile: 3,
  Pickup: 4,
} as const;
export type EntityKindId = (typeof EntityKind)[keyof typeof EntityKind];

/** Per-entity state flag bits (EntityState.flags). */
export const EntityFlag = {
  Grounded: 1 << 0,
  /** Players: dead (arena: respawning; co-op: out until `respawnDead`). Enemies: a corpse, removed after `coop.corpseTicks`. */
  Dead: 1 << 1,
  /** Players in co-op: downed, bleeding out, can be revived by a teammate. */
  Downed: 1 << 2,
  /** Players: dashing (invulnerable). */
  Dashing: 1 << 3,
  /**
   * Players: the only player in the room (set by the authority from the
   * true player count). Solo upgrade cards pause the sim; co-op cards shove
   * enemies back instead. Predicting clients read it, never count players.
   */
  Solo: 1 << 4,
  /** Enemies: carrying a shield (a shielder's gift); hits drain the shield first. */
  Shielded: 1 << 5,
  /** Enemies: an elite (bigger, tougher, gold rim). Projectiles: a ground hazard (it does not move; it lands when its timer ends). */
  Elite: 1 << 6,
  /** Projectiles: hostile (an enemy's shot or hazard; it hurts players, never enemies). */
  Hostile: 1 << 7,
} as const;

/**
 * One player's input for one tick. Serializable and sequence-numbered.
 *
 * The sim quantizes every command on entry (`quantizeInput`), so a client's
 * prediction and the server's authority consume bit-identical inputs.
 * Wire size: 15 bytes (`INPUT_BYTES`).
 */
export interface InputCommand {
  /** Client sequence number, strictly increasing per player (u32). */
  seq: number;
  /** The sim tick the client produced this for (u32). Informational: `step` does not reject a mismatch. */
  tick: number;
  /** Strafe right (+) / left (-), -1..1 in the character's frame. Quantized to 1/127. */
  moveX: number;
  /** Forward (+) / back (-), -1..1 in the character's frame. Quantized to 1/127. */
  moveZ: number;
  /** Facing in radians about +y (0 faces -z). Quantized to a u16 turn. */
  yaw: number;
  /** Bitmask of `Button` (u16). */
  buttons: number;
}

/** Bytes per encoded InputCommand. */
export const INPUT_BYTES = 15;

/**
 * The inputs for one tick, by player. A player with no entry this tick gets
 * a neutral input (no move, no buttons, facing kept). A room server that
 * wants "repeat last input on packet loss" passes the repeat explicitly.
 */
export type TickInputs = ReadonlyMap<PlayerId, InputCommand>;

/** A cylindrical pillar in the arena (static collider). */
export interface Pillar {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly height: number;
}

/**
 * An axis-aligned box standing on the floor, `wallHeight` tall: a dungeon's
 * walls. Centre (x, z) and half sizes hx, hz in metres.
 */
export interface WallBox {
  readonly x: number;
  readonly z: number;
  readonly hx: number;
  readonly hz: number;
}

/** The static level. Part of the world's config, never of a snapshot. */
export interface ArenaConfig {
  /** The floor is a square from -halfExtent to +halfExtent on x and z (m). */
  readonly halfExtent: number;
  readonly wallHeight: number;
  readonly pillars: readonly Pillar[];
  /**
   * Wall boxes inside the square (a dungeon). Players collide with them in
   * physics; enemies and bolts are resolved against them like pillars.
   */
  readonly walls?: readonly WallBox[];
  /**
   * Walkable floor rectangles (rooms and corridors). When present, only
   * these are ground: spawns land on them, and enemies path between them
   * on a flow field instead of running straight at a player behind a wall.
   */
  readonly floors?: readonly WallBox[];
  /** Where players spawn and respawn. */
  readonly spawn: Vec3;
}

export interface PlayerRules {
  /** Ground speed, m/s. */
  readonly speed: number;
  /** Sprint multiplier while Button.Sprint is held. */
  readonly sprintMultiplier: number;
  /** Initial jump velocity, m/s. */
  readonly jumpVelocity: number;
  /** Gravity, m/s² (positive number, applied downward). */
  readonly gravity: number;
  /** Capsule radius and half-height of the cylindrical part, m. */
  readonly radius: number;
  readonly halfHeight: number;
  readonly maxHealth: number;
  /** Fire = radial pulse: radius (m), cooldown (ticks). */
  readonly pulseRadius: number;
  readonly pulseCooldownTicks: number;
  /** Ticks after a jump input during which a landing still jumps (jump buffer). */
  readonly jumpBufferTicks: number;
  /** Ticks after leaving the ground during which a jump still works (coyote time). */
  readonly coyoteTicks: number;
}

export interface EnemyRules {
  /** The spawner keeps this many enemies alive. 0 disables enemies. */
  readonly target: number;
  /** Max enemies spawned per tick while below target. */
  readonly spawnPerTick: number;
  /** Spawn ring distance from the nearest player, m. */
  readonly spawnRadius: number;
  readonly speed: number;
  readonly radius: number;
  readonly maxHealth: number;
  /** Damage per contact, and ticks between contacts from one enemy. */
  readonly contactDamage: number;
  readonly contactCooldownTicks: number;
}

/**
 * One enemy prefab, compiled from the game API (`prefab(...)`). Enemy type
 * 0 is always the arena's `EnemyRules` (the built-in target spawner uses it).
 */
export interface EnemyTypeDef {
  readonly health: number;
  /** m/s. */
  readonly speed: number;
  /** m. */
  readonly radius: number;
  /** Contact damage per touch. */
  readonly damage: number;
  /** XP carried by the gem it drops; 0 drops nothing. */
  readonly xp: number;
  readonly boss?: boolean;
  /** Knockback divisor. Default 1; bosses want 10+. */
  readonly mass?: number;
  /** Behaviour (default "chase"). "idle" stands still. */
  readonly ai?: EnemyAi;
  /** Numbers for the behaviour's attack (defaults per role in roles.ts). */
  readonly attack?: EnemyAttack;
  /** On death, spawn `count` enemies of type `type` where it fell (splitters). */
  readonly split?: { readonly type: number; readonly count: number };
  /** Boss patterns (bosses only): attacks it picks from, the enrage threshold, and the add it summons. */
  readonly pattern?: BossPattern;
  /** Special pickups it may drop: an index into content.pickups and a chance 0..1 (rolled on the sim's PRNG). */
  readonly drops?: readonly { readonly pickup: number; readonly chance: number }[];
  /** A breakable prop (urn, lantern): it never moves, never hurts, and is never recycled. */
  readonly prop?: boolean;
}

/** What a special pickup does when a player collects it. */
export type PickupEffect = "heal" | "vacuum" | "bomb" | "chest";

/**
 * A special pickup (content.pickups). Entities carry PICKUP_SPECIAL + index
 * as their type; gem tiers stay 0..2.
 *  - heal: `amount` of max health (0..1) or hit points (above 1);
 *  - vacuum: every gem on the floor flies to the collector;
 *  - bomb: kills every non-boss enemy on the collector's screen;
 *  - chest: `amount` card picks (1-3; a ready evolution shows first).
 */
export interface PickupTypeDef {
  readonly effect: PickupEffect;
  readonly amount: number;
  /** Chests: a weapon the player holds with its paired passive jumps to max level, so its evolution is on the cards. */
  readonly evolve?: boolean;
}

/** Pickup entity types from here up are special pickups (index = type - PICKUP_SPECIAL). */
export const PICKUP_SPECIAL = 16;

/**
 * Attack numbers for an enemy role. Every field is optional; the role's
 * defaults (roles.ts ROLE_DEFAULTS) fill the rest. Seconds and metres.
 */
export interface EnemyAttack {
  /** Damage of the attack (default: the enemy's contact damage, x1.4 for a blast). */
  readonly damage?: number;
  /** Trigger or keep-away distance, m. */
  readonly range?: number;
  /** Telegraph time before it lands, ticks. */
  readonly windupTicks?: number;
  /** Ticks between attacks. */
  readonly cooldownTicks?: number;
  /** Charge speed multiple, or shot speed m/s. */
  readonly speed?: number;
  /** Blast or aura radius, m. */
  readonly radius?: number;
  /** Summoners: the enemy type index they call. */
  readonly summon?: number;
  /** Summoners: adds per call; support roles: allies affected. */
  readonly count?: number;
}

/** What a boss can do. Each is telegraphed before it lands. */
export type BossAttack = "slam" | "dash" | "leap" | "rain" | "ring" | "fan" | "summon";

export interface BossPattern {
  readonly attacks: readonly BossAttack[];
  /** Health fraction below which the boss enrages (faster, shorter wind-ups, more projectiles). 0 never. */
  readonly enrageAt: number;
  /** Enemy type index `summon` calls (default: type 0). */
  readonly summon?: number;
  /** A mini-boss: its death raises "miniboss.killed", not "boss.killed". */
  readonly mini?: boolean;
}

/** What dealt a hit to a player. Everything but "contact" was telegraphed first. */
export type HitSource = "contact" | "charge" | "blast" | "projectile" | "slam" | "hazard";

/** Enemy behaviours the sim runs (content mode). */
export type EnemyAi =
  | "chase"
  | "idle"
  | "runner"
  | "charger"
  | "ranged"
  | "bomber"
  | "shielder"
  | "healer"
  | "summoner"
  | "flee"
  | "wander";

/**
 * Enemy telegraph word (EntityState.level on enemies and hostile
 * projectiles; it rides snapshots): kind in bits 0-2, fill progress 0..31
 * in bits 3-7, and an angle (lanes, 256 steps of a turn) or a radius
 * (circles, in 0.1 m) in bits 8-15.
 */
export const Telegraph = {
  None: 0,
  /** A circle around the entity (blast, slam) or at a hazard. */
  Circle: 1,
  /** A lane from the entity along the angle (charge, dash). */
  Lane: 2,
  /** A support pulse (shield, heal, summon) about to go off. */
  Aura: 3,
} as const;

/**
 * Per-spawn multipliers (the spawn director's difficulty curve and density
 * compensation). Health and damage are rounded to integers on the entity.
 */
export interface SpawnScale {
  readonly health?: number;
  readonly damage?: number;
  readonly xp?: number;
  /** An elite: x6 health, x1.5 damage, x5 XP, EntityFlag.Elite (on top of the multipliers above). */
  readonly elite?: boolean;
  /** The enemy it came out of (summons, splits): reported on entity.spawned. */
  readonly from?: number;
}

/**
 * The visible ground around a player, as distances from the player to the
 * edge of the screen at evenly spaced headings (index i is the heading
 * 2*pi*i/n, measured from +x toward +z). The spawn director spawns just
 * outside it, and the playtest counts what is inside it as "on screen".
 */
export interface ViewRules {
  readonly radii: readonly number[];
}

/**
 * Weapon behaviours (content mode). Survivor weapons fire by themselves:
 *  - `nova`: a burst that hits every enemy within `range`, when one is in range.
 *  - `bolt`: `count` projectiles at the nearest enemy within `range`, moving at `speed` m/s, passing through `pierce` enemies.
 *  - `orbit`: `count` blades circling at `range` m and `speed` rad/s; each blade hits an enemy at most every 8 ticks.
 * Arena weapons fire on Button.Fire along the player's aim (yaw):
 *  - `blaster`: `count` projectiles fanned over `spread` radians at `speed` m/s for `range` m.
 *  - `beam`: an instant hitscan to `range` m (stopped by pillars and walls); a room server resolves it with lag compensation.
 *  - `nova` (arena): a blast hitting every opponent within `range` m.
 */
export type WeaponKind = "nova" | "bolt" | "orbit" | "blaster" | "beam" | "cone" | "chain" | "aura" | "meteor" | "boomerang";

/** A weapon's numbers at one level (absolute, before passives). */
export interface WeaponLevelStats {
  readonly damage: number;
  readonly cooldownTicks: number;
  readonly range: number;
  readonly count: number;
  readonly speed: number;
  readonly pierce: number;
  readonly knockback: number;
  /** Cone: total angle, radians. */
  readonly spread: number;
}

export interface WeaponDef {
  readonly kind: WeaponKind;
  readonly damage: number;
  /** Ticks between shots (nova, bolt). Orbit ignores it. */
  readonly cooldownTicks: number;
  readonly range: number;
  readonly count: number;
  readonly speed: number;
  readonly pierce: number;
  /** m/s pushed into the enemy (divided by its mass). */
  readonly knockback: number;
  /** 1..15. */
  readonly maxLevel: number;
  /** Arena blaster: total fan angle of `count` projectiles, radians. Default 0. Cone: total angle of the sweep. */
  readonly spread?: number;
  /** Explicit numbers per level (index 0 is level 1). Without it, each level adds 25% damage, -6% cooldown, +1 count every 2 levels and +8% nova range. */
  readonly levels?: readonly WeaponLevelStats[];
  /** Meteor: blast radius, m (default 1.6). */
  readonly blast?: number;
  /** An evolution target: never offered on its own, only as an evolution. */
  readonly evolved?: boolean;
  /** Evolution: at max level, with passive `requires` (index into content.stats) taken, this weapon becomes weapon `into`. */
  readonly evolve?: { readonly into: number; readonly requires: number };
}

export type StatKind = "speed" | "maxHealth" | "magnet" | "might" | "haste" | "regen" | "armor" | "area" | "amount";

/**
 * A passive upgrade. Per level: speed and might multiply by (1 + step x level),
 * haste multiplies cooldowns by (1 - step x level) (floor 0.3), maxHealth and
 * magnet add step x level, regen heals step x level per second, armor removes
 * step x level from each contact hit (floor 1).
 */
export interface StatDef {
  readonly stat: StatKind;
  readonly step: number;
  /** 1..15. */
  readonly maxLevel: number;
}

export interface ProgressionRules {
  /** XP to reach level L+1 from L: xpBase + xpGrowth x (L - 1). */
  readonly xpBase: number;
  readonly xpGrowth: number;
  /** Base pickup (magnet) radius, m. */
  readonly magnet: number;
  /** Weapon slots per player (1..4). */
  readonly maxWeapons: number;
  /** Weapon index every player starts a run with, or -1. */
  readonly startWeapon: number;
  /** Most gems on the floor; past it XP goes straight to the killer. */
  readonly maxPickups: number;
  /** Card rerolls each player gets per run (Button.Reroll). */
  readonly rerolls: number;
  /** Curve exponent: XP to reach L+1 is xpBase + xpGrowth x (L - 1)^xpExponent. Default 1 (linear). */
  readonly xpExponent: number;
  /** Arena: the weapon indices every player carries in slots 1..4 (the loadout). Empty: `startWeapon` only. */
  readonly loadout: readonly number[];
  /** Co-op XP sharing (default: the collector only). */
  readonly xpShare: XpShare;
  /**
   * Critical hits: a hit on an enemy crits when critRoll(tick, enemy netId) < critChance,
   * dealing critMultiplier x damage. The roll is a fixed hash, so clients can mark crit numbers.
   */
  readonly critChance: number;
  readonly critMultiplier: number;
}

/**
 * Player ids from here up are server-side bots (seat fillers). They play
 * through the same sim; their arena beams resolve in the sim, never through
 * the room's lag compensation (a bot sees the present).
 */
export const BOT_PLAYER_BASE = 0xff00;

/**
 * Arena (shooter) mode: players aim with `yaw` and move in the world frame,
 * fire their selected loadout weapon on `Button.Fire`, hurt each other, die
 * and respawn at the spawn point farthest from their opponents.
 */
export interface ArenaRules {
  readonly enabled: boolean;
  /**
   * True on the authoritative side (room server, harness): projectiles,
   * hits, deaths, respawns and pickups happen. A predicting client sets it
   * false and predicts only its own movement, aim, weapon choice and cooldowns.
   */
  readonly authority: boolean;
  /**
   * True on a room server: human players' beams are resolved by the room's
   * lag-compensated rewind (`beamShot`, `applyBeamHit`), not in `step`.
   * Bots (`BOT_PLAYER_BASE` and up) always resolve in `step`.
   */
  readonly externalHitscan: boolean;
  /** Ticks a killed player waits before respawning. */
  readonly respawnTicks: number;
  /** Invulnerable ticks after a respawn (firing ends it early). */
  readonly spawnIframeTicks: number;
  /** Respawn points (x, z), m. Empty: the arena spawn. */
  readonly spawns: readonly (readonly [number, number])[];
  /** Health a killed player's dropped pickup restores (0: no drop). */
  readonly dropHeal: number;
  /** Ticks a dropped pickup stays on the floor. */
  readonly pickupTicks: number;
}

export interface CoopRules {
  /** Ticks a downed player bleeds before they are out (dead until `respawnDead`). */
  readonly downedTicks: number;
  /** Ticks a teammate must stand within `reviveRadius` to revive. */
  readonly reviveTicks: number;
  readonly reviveRadius: number;
  /** Health after a revive, as a fraction of max. */
  readonly reviveHealth: number;
  /** Invulnerable ticks after a revive or a respawn. */
  readonly iframeTicks: number;
  /** Ticks a killed enemy stays as a corpse (so clients see it die). */
  readonly corpseTicks: number;
  /** Dash: ticks, speed multiplier, cooldown ticks, input buffer ticks. */
  readonly dashTicks: number;
  readonly dashSpeed: number;
  readonly dashCooldownTicks: number;
  readonly dashBufferTicks: number;
  /** Ticks a player is immune to contact damage after taking a contact hit (hit i-frames). */
  readonly hitIframeTicks: number;
  /** Pause the whole sim while the only player in the world has upgrade cards open. */
  readonly pauseSolo: boolean;
  /**
   * Prediction worlds hold only their own character, so they cannot count
   * players: they take EntityFlag.Solo from snapshots instead of setting it.
   * The adapter sets this on client worlds.
   */
  readonly soloFromFlag: boolean;
  /** Co-op: opening cards knocks enemies back within this radius (m) and grants these i-frame ticks. */
  readonly choicePulseRadius: number;
  readonly choicePulseIframeTicks: number;
  /** A teammate who revives someone gets a buff for this many ticks (0: none; max 4095). */
  readonly reviveBuffTicks: number;
  /** While buffed: damage multiplier and move speed multiplier. */
  readonly reviveBuffMight: number;
  readonly reviveBuffSpeed: number;
  /** A downed player crawls at this fraction of run speed (0: they cannot move). */
  readonly crawlSpeed: number;
  /**
   * Free self-revives per player per run (0..15): Sprint while downed stands
   * you up (after `selfReviveDelayTicks`), and an unused one is spent by
   * itself when the downed timer runs out. Stored in Game.bleed bits 12..15.
   */
  readonly selfRevives: number;
  readonly selfReviveDelayTicks: number;
  /**
   * Ticks a dead (out) player waits before coming back beside a teammate who
   * is up (0: out until `respawnDead`). Counted down in Game.bleed bits 0..11.
   */
  readonly respawnTicks: number;
  /** Getting up (self-revive or respawn) shoves enemies within this radius, m (0: none). */
  readonly risePulseRadius: number;
}

/**
 * Game content: when `weapons` is non-empty the world runs in content mode
 * (auto-firing weapons, XP gems, level-ups, co-op downed and revive, dash)
 * instead of the week-2 arena rules (Fire = pulse, respawn on death).
 */
export interface ContentConfig {
  readonly enemyTypes?: readonly EnemyTypeDef[];
  readonly weapons?: readonly WeaponDef[];
  readonly stats?: readonly StatDef[];
  readonly progression?: Partial<ProgressionRules>;
  readonly coop?: Partial<CoopRules>;
  /** Arena (shooter) mode; off unless `enabled`. */
  readonly arena?: Partial<ArenaRules>;
  readonly view?: ViewRules;
  /** Special pickups (heals, vacuums, bombs, chests). */
  readonly pickups?: readonly PickupTypeDef[];
  /** Loot: the special pickups elites and bosses drop (indices into pickups; -1 none). */
  readonly loot?: { readonly chest: number; readonly heal: number; readonly vacuum: number; readonly bossChest?: number };
  /** Gems on the floor above this merge into the nearest gem instead of a new one (default 300). */
  readonly mergeGemsAbove?: number;
  /** Playable characters (keepers); empty: everyone starts with `progression.startWeapon`. At most 15. */
  readonly characters?: readonly CharacterDef[];
}

export interface ResolvedContent {
  readonly enabled: boolean;
  readonly enemyTypes: readonly EnemyTypeDef[];
  readonly weapons: readonly WeaponDef[];
  readonly stats: readonly StatDef[];
  readonly progression: ProgressionRules;
  readonly coop: CoopRules;
  readonly arena: ArenaRules;
  readonly view: ViewRules;
  readonly pickups: readonly PickupTypeDef[];
  readonly loot: { readonly chest: number; readonly heal: number; readonly vacuum: number; readonly bossChest?: number };
  readonly mergeGemsAbove: number;
  readonly characters: readonly CharacterDef[];
}

export interface SimConfig {
  /** Fixed tick rate in Hz. Default `DEFAULT_TICK_RATE`. */
  readonly tickRate?: number;
  /** Seed for the sim's PRNG (u32). Default 1. */
  readonly seed?: number;
  /** Hard cap on live entities. Default 8192. */
  readonly maxEntities?: number;
  readonly arena?: Partial<ArenaConfig>;
  readonly player?: Partial<PlayerRules>;
  readonly enemies?: Partial<EnemyRules>;
  readonly content?: ContentConfig;
}

export interface ResolvedSimConfig {
  readonly tickRate: number;
  readonly seed: number;
  readonly maxEntities: number;
  readonly arena: ArenaConfig;
  readonly player: PlayerRules;
  readonly enemies: EnemyRules;
  readonly content: ResolvedContent;
}

/**
 * A simulation world. Opaque on purpose: callers read it through the
 * functions in this package, never through ECS or Rapier handles.
 */
export interface SimWorld {
  /** Ticks stepped so far. */
  readonly tick: number;
  readonly tickRate: number;
  /** Seconds per tick, 1 / tickRate. */
  readonly dt: number;
  readonly config: ResolvedSimConfig;
}

/** Things that happened during one step, in the order they happened. */
export type SimEvent =
  | { readonly type: "player.joined"; readonly playerId: PlayerId; readonly netId: NetId }
  | { readonly type: "player.left"; readonly playerId: PlayerId; readonly netId: NetId }
  | {
      readonly type: "player.hit";
      readonly playerId: PlayerId;
      readonly netId: NetId;
      readonly by: NetId;
      readonly damage: number;
      readonly health: number;
      /** What hit: a touch, or a telegraphed attack (charge, blast, boss pattern, enemy projectile). Default "contact". */
      readonly source?: HitSource;
      /** The enemy type that hit, when `by` is not an enemy (a shot or a hazard it left). */
      readonly enemyType?: number;
    }
  | { readonly type: "player.died"; readonly playerId: PlayerId; readonly netId: NetId }
  /** Arena: a player was killed; `by` is the player credited (0: no one). */
  | { readonly type: "player.killed"; readonly playerId: PlayerId; readonly netId: NetId; readonly by: PlayerId }
  /** Arena: a player fired weapon slot `slot` (0..3). */
  | { readonly type: "player.shot"; readonly playerId: PlayerId; readonly netId: NetId; readonly slot: number }
  | { readonly type: "player.respawned"; readonly playerId: PlayerId; readonly netId: NetId }
  | { readonly type: "player.pulse"; readonly playerId: PlayerId; readonly netId: NetId }
  | {
      readonly type: "enemy.killed";
      readonly netId: NetId;
      /** The player whose weapon landed the kill (0 if none). */
      readonly by: PlayerId;
      /** Enemy type index (0 in the arena). */
      readonly enemyType: number;
      readonly boss: boolean;
      /** An elite (gold rim) died. */
      readonly elite?: boolean;
    }
  | { readonly type: "player.downed"; readonly playerId: PlayerId; readonly netId: NetId }
  | { readonly type: "player.revived"; readonly playerId: PlayerId; readonly netId: NetId; readonly by: PlayerId }
  | { readonly type: "player.levelup"; readonly playerId: PlayerId; readonly netId: NetId; readonly level: number }
  | { readonly type: "player.upgraded"; readonly playerId: PlayerId; readonly netId: NetId; readonly upgrade: number; readonly evolved?: boolean }
  | { readonly type: "player.collected"; readonly playerId: PlayerId; readonly netId: NetId; readonly effect: PickupEffect }
  | {
      readonly type: "entity.spawned";
      readonly netId: NetId;
      readonly kind: EntityKindId;
      /** Spawned out of another enemy (a summon or a split), so it may appear on screen. */
      readonly from?: NetId;
    }
  | { readonly type: "entity.removed"; readonly netId: NetId; readonly kind: EntityKindId };

export interface StepResult {
  /** The tick number this step produced (world.tick after the step). */
  readonly tick: number;
  readonly events: readonly SimEvent[];
}

/**
 * One entity's networked state. Every field is an integer: positions and
 * velocities in fixed point (`POSITION_SCALE`, `VELOCITY_SCALE`), yaw as a
 * u16 turn. The sim keeps its own state on this grid at every tick
 * boundary, so capture → apply is lossless.
 */
export interface EntityState {
  netId: NetId;
  kind: EntityKindId;
  /** Owning player, or 0. */
  owner: PlayerId;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  health: number;
  /** `EntityFlag` bits. */
  flags: number;
  /** Players: last input seq processed (the reconciliation ack). Others: 0. */
  ack: number;
  /** Players: ticks until Fire is ready. Enemies: ticks until next contact. */
  cooldown: number;
  /** Players: last buttons held (edge detection). Others: 0. */
  buttons: number;
  /** Players: coyote/jump-buffer timers packed (coyote | buffer << 8). Others: 0. */
  timers: number;
  /** Enemies: type index. Pickups: gem tier. Projectiles: weapon index. Players: cosmetic id. */
  type: number;
  /** Pickups: XP value. Projectiles: damage. */
  value: number;
  /** Players: level (1..). Projectiles: pierce left. */
  level: number;
  /** Players: XP toward the next level. Projectiles: last enemy hit (netId). */
  xp: number;
  /** Players: 4 weapon slots, 8 bits each: (weapon index + 1) | level << 4. */
  weapons: number;
  /** Players: 4 weapon cooldowns in ticks, 8 bits each. */
  wcd: number;
  /** Players: up to 6 passive stat levels, 4 bits each. */
  stats: number;
  /** Players: 3 offered upgrades (index + 1), 8 bits each, then pending level-ups in bits 24..31. */
  choices: number;
  /** Players: downed ticks left (co-op). */
  bleed: number;
  /** Players: revive progress ticks while downed. */
  revive: number;
  /** Players: invulnerable ticks left. */
  iframes: number;
  /** Players: dash ticks left | cooldown << 8 | buffered press << 16. */
  dash: number;
}

/** A whole world's networked state at one tick. Entities sorted by netId. */
export interface SimState {
  tick: number;
  /** PRNG state (u32). */
  rng: number;
  /** Next NetId to assign. */
  nextNetId: number;
  /** Enemies killed so far (game-rules counter). */
  kills: number;
  entities: EntityState[];
}

/** One player as game logic sees it (`listPlayers`). */
export interface PlayerSummary {
  readonly playerId: PlayerId;
  readonly netId: NetId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly level: number;
  /** Not downed and not dead. */
  readonly up: boolean;
  readonly downed: boolean;
  readonly dead: boolean;
  /** Arena: the selected loadout slot (0..3). */
  readonly slot: number;
  /** The keeper (character) index; 0 when the game declares none. */
  readonly keeper: number;
  /** A revive buff is running. */
  readonly buffed: boolean;
  /** Free self-revives left this run (coop.selfRevives). */
  readonly selfRevives: number;
}

/**
 * Dense, renderer-friendly arrays for the current tick, plus the previous
 * tick's transform for interpolation (`alpha` from `FixedStepper`). Valid
 * until the next `step` or `applyState` on the same world.
 */
export interface RenderView {
  readonly tick: number;
  readonly count: number;
  readonly netId: Uint32Array;
  readonly kind: Uint8Array;
  readonly owner: Uint16Array;
  readonly health: Uint16Array;
  readonly flags: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly yaw: Float32Array;
  readonly prevX: Float32Array;
  readonly prevY: Float32Array;
  readonly prevZ: Float32Array;
  readonly prevYaw: Float32Array;
}

/** Result of advancing a `FixedStepper` by wall-clock time. */
export interface StepperAdvance {
  /** Fixed ticks to run now (0..maxTicksPerAdvance). */
  readonly ticks: number;
  /** Interpolation factor 0..1 between the last two ticks, for rendering. */
  readonly alpha: number;
  /** Ticks dropped because the caller fell too far behind (spiral-of-death guard). */
  readonly dropped: number;
}
