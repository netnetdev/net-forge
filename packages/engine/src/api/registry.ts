import {
  GameDefinitionError,
  achievementSchema,
  keeperSchema,
  missionSchema,
  titleSchema,
  directorSchema,
  earnRuleSchema,
  earnStakeSchema,
  earnPotSchema,
  economySchema,
  metaUpgradeSchema,
  META_MAX_PER_STAT,
  META_MAX_TOTAL,
  META_MAX_UPGRADES,
  gameSchema,
  idSchema,
  parseOrThrow,
  prefabSchema,
  skuSchema,
  upgradeSchema,
  weaponSchema,
} from "./schemas.js";
import type {
  AchievementDef,
  AchievementInput,
  KeeperDef,
  KeeperInput,
  MissionDef,
  MissionInput,
  TitleDef,
  TitleInput,
  DirectorDef,
  DirectorInput,
  EarnRuleDef,
  EarnRuleInput,
  EarnStakeDef,
  EarnStakeInput,
  EarnPotDef,
  EarnPotInput,
  EconomyDef,
  EconomyInput,
  MetaUpgradeDef,
  MetaUpgradeInput,
  GameDef,
  GameInput,
  PrefabDef,
  PrefabInput,
  SkuDef,
  SkuInput,
  UpgradeDef,
  UpgradeInput,
  WeaponDef,
  WeaponInput,
} from "./schemas.js";

/** A read-only view of one player, as game logic sees it. */
export interface PlayerView {
  readonly id: number;
  readonly position: readonly [number, number, number];
  readonly health: number;
  readonly alive: boolean;
  /** Kills this run: enemies (survivor) or opponents (arena). */
  readonly kills: number;
  /** Times this player died this run. */
  readonly deaths: number;
  /** A server bot filling an empty seat (bots never earn). */
  readonly bot: boolean;
}

export interface SpawnRingOptions {
  readonly count: number;
  readonly radius: number;
  /** Centre on this player; default: each spawn picks a living player at random. */
  readonly around?: number;
}

/** Where `spawnEdge` places enemies around the target player's screen. */
export type EdgeSide = "any" | "ahead" | "behind" | "north" | "south" | "east" | "west";

export interface SpawnEdgeOptions {
  readonly count: number;
  /** The player whose screen edge to use; default: a living player at random for each spawn. */
  readonly around?: number;
  /**
   * Which side: "any" (default), "ahead" or "behind" the player's movement,
   * or a screen side ("north" is the top of the screen). A side spawns the
   * whole count from one direction, like a tide or a stream.
   */
  readonly side?: EdgeSide;
  /** Width of the arc on that side, degrees (default 50; ignored for "any"). */
  readonly spread?: number;
  /** Health, damage and XP multipliers for these spawns (default 1 each). */
  readonly scale?: { readonly health?: number; readonly damage?: number; readonly xp?: number };
  /** Elites: x6 health, x1.5 damage, x5 XP and a gold rim. */
  readonly elite?: boolean;
}

/**
 * What a system can do. Deliberately small: no renderer, no network, no
 * physics handles. Systems run only on the authoritative side (the room
 * server and the headless harness); clients receive the results in
 * snapshots. Everything here is still deterministic (tick timers and the
 * sim's own random), because run verification replays it.
 */
export interface SystemContext {
  /** Fixed ticks since the run started. */
  readonly tick: () => number;
  /** Seconds since the run started (tick / tickRate). */
  readonly time: () => number;
  /** Living and dead players, in id order. */
  readonly players: () => readonly PlayerView[];
  /** Run `fn(n)` every `seconds`, n = 1, 2, 3, ... */
  readonly every: (seconds: number, fn: (n: number) => void) => void;
  /** Run `fn` once after `seconds`. */
  readonly after: (seconds: number, fn: () => void) => void;
  /** Run `fn` every tick. */
  readonly onTick: (fn: () => void) => void;
  /** Spawn at a point. `elite`: x6 health, x1.5 damage, x5 XP, a gold rim (and, with pickups, a chest). Prefer spawnEdge. */
  readonly spawn: (prefab: string, at: readonly [number, number, number], opts?: { readonly elite?: boolean }) => void;
  /** Spawn on a ring around players. Points outside the arena or in a pillar retry a new heading (never clamped to a wall). */
  readonly spawnRing: (prefab: string, opts: SpawnRingOptions) => void;
  /**
   * Spawn just outside the screen (never on it): the right way to bring
   * enemies in. Returns how many spawned (fewer when no valid spot).
   */
  readonly spawnEdge: (prefab: string, opts: SpawnEdgeOptions) => number;
  /** Raise a game event (earn rules key on these, e.g. "wave.cleared"). It credits `players` (ids), or everyone present. */
  readonly emit: (event: string, players?: readonly number[]) => void;
  /** Seeded random 0..1 from the sim's PRNG. */
  readonly random: () => number;
  /** Living enemies of a prefab, or of every enemy prefab. */
  readonly alive: (prefab?: string) => number;
  /**
   * Run `fn` when a game event happens: the sim's own ("enemy.killed",
   * "boss.killed", "player.downed", "player.revived", "player.levelup",
   * "player.died"; arena: "opponent.killed" crediting the killer,
   * "round.top", "round.finished"; "run.started" when a player's
   * earning run starts over, so a counter of yours can start over too) and
   * any you `emit`. `players` are the
   * ids it credits. A seat bot's death and a "round.top" with no other
   * person in the round still arrive here, but pay no earn rule, and
   * neither does anything you `emit` while handling them.
   */
  readonly on: (event: string, fn: (players: readonly number[]) => void) => void;
  /** Bring players who bled out back beside a living teammate. */
  readonly respawnDead: () => void;
  /** End the run: "won" or "lost". The room shows the end screen, then starts a fresh run. */
  readonly end: (outcome: "won" | "lost") => void;
  /** Spawn a pickup prefab (a gem, or a special pickup: heal, vacuum, bomb, chest) at a point. */
  readonly spawnPickup: (prefab: string, at: readonly [number, number, number]) => void;
  /**
   * A big centred banner every player sees ("THE TIDE RISES"). tone:
   * "info" (default), "danger" (a threat is coming) or "reward". Keep it a
   * few words; the HUD also points at off-screen bosses.
   */
  readonly announce: (text: string, opts?: { readonly tone?: "info" | "danger" | "reward" }) => void;
  /** True while any boss is alive (events usually wait for it). */
  readonly bossAlive: () => boolean;
  /** Stop the spawn director for `seconds` (a set piece, a breather). */
  readonly pauseDirector: (seconds: number) => void;
  /** Multiply the director's spawn rate by `multiplier` for `seconds` (a surge). */
  readonly surge: (multiplier: number, seconds: number) => void;
  /**
   * Put a countdown on the HUD: "THE BELL WARDEN" in `seconds`. The latest
   * call replaces the last; it clears itself at zero.
   */
  readonly upcoming: (label: string, seconds: number) => void;
  /** Multiply the XP of every gem dropped for `seconds` (an "ember hour"). */
  readonly xpBoost: (multiplier: number, seconds: number) => void;
  /** Scatter `count` of a prefab (props: urns, lanterns) over the field, off every screen. Returns how many. */
  readonly scatter: (prefab: string, count: number) => number;
  /** Remove every living enemy of a prefab at once (an event ends): no kills, no drops. Returns how many. */
  readonly clear: (prefab: string) => number;
  /**
   * True when the ground point (x, z) is on the screen of any player who is
   * up. Spawn where it is false (a dungeon room's far side), so enemies
   * never pop in where a player is looking.
   */
  readonly onScreen: (x: number, z: number) => boolean;
}

export type SystemSetup = (ctx: SystemContext) => void;

export interface GameManifest {
  readonly game: GameDef;
  readonly prefabs: ReadonlyMap<string, PrefabDef>;
  readonly weapons: ReadonlyMap<string, WeaponDef>;
  readonly upgrades: ReadonlyMap<string, UpgradeDef>;
  readonly systems: ReadonlyMap<string, SystemSetup>;
  readonly earnRules: ReadonlyMap<string, EarnRuleDef>;
  /** The buy-in run terms (earn.stake; every game has one). */
  readonly stake: EarnStakeDef;
  /** A PvP pot (earn.pot), or null: arena games only, optional. */
  readonly pot: EarnPotDef | null;
  readonly skus: ReadonlyMap<string, SkuDef>;
  /** The spawn director, if the game declared one. */
  readonly director: DirectorDef | null;
  /** Keepers in declaration order (the keeper index). */
  readonly keepers: ReadonlyMap<string, KeeperDef>;
  readonly achievements: ReadonlyMap<string, AchievementDef>;
  readonly missions: ReadonlyMap<string, MissionDef>;
  /** End-screen titles in declaration order. */
  readonly titles: ReadonlyMap<string, TitleDef>;
  /** The coin model (economy(...); the recommended default when not declared). */
  readonly economy: EconomyDef;
  /** Meta upgrades in declaration order (empty unless economy({ metaUpgrades: true })). */
  readonly metaUpgrades: ReadonlyMap<string, MetaUpgradeDef>;
  /**
   * Genre content the board-style templates declare (tower defense, idle,
   * cards, collector): their own typed declarations, validated by their own
   * schemas, keyed "<kind>:<id>" in declaration order (see declareContent).
   */
  readonly content: ReadonlyMap<string, unknown>;
}

interface Registry {
  game: GameDef | null;
  director: DirectorDef | null;
  prefabs: Map<string, PrefabDef>;
  weapons: Map<string, WeaponDef>;
  upgrades: Map<string, UpgradeDef>;
  systems: Map<string, SystemSetup>;
  earnRules: Map<string, EarnRuleDef>;
  stake: EarnStakeDef | null;
  pot: EarnPotDef | null;
  skus: Map<string, SkuDef>;
  keepers: Map<string, KeeperDef>;
  achievements: Map<string, AchievementDef>;
  missions: Map<string, MissionDef>;
  titles: Map<string, TitleDef>;
  economy: EconomyDef | null;
  metaUpgrades: Map<string, MetaUpgradeDef>;
  content: Map<string, unknown>;
}

const fresh = (): Registry => ({
  game: null,
  director: null,
  prefabs: new Map(),
  weapons: new Map(),
  upgrades: new Map(),
  systems: new Map(),
  earnRules: new Map(),
  stake: null,
  pot: null,
  skus: new Map(),
  keepers: new Map(),
  achievements: new Map(),
  missions: new Map(),
  titles: new Map(),
  economy: null,
  metaUpgrades: new Map(),
  content: new Map(),
});
let reg: Registry = fresh();
/**
 * Set by `collectManifest`: the module that declared this registry is done.
 * The next declaration starts a fresh registry, so a process can load more
 * than one game module in turn (the room server hosts every template), each
 * manifest collecting its own game right after importing it.
 */
let sealed = false;

function unseal(): void {
  if (!sealed) return;
  reg = fresh();
  sealed = false;
}

const unique = <T>(map: Map<string, T>, kind: string, id: string): void => {
  if (map.has(id)) throw new GameDefinitionError(`${kind} "${id}"`, [`${kind} "${id}" is declared twice; ids must be unique`]);
};
const checkId = (kind: string, id: string): string => parseOrThrow(idSchema, id, `${kind} id`);

/** Declare the game. Exactly one per game module; it is the module's default export. */
export function game(def: GameInput): GameDef {
  unseal();
  if (reg.game) throw new GameDefinitionError("game()", ["game() is called twice; a game module declares exactly one game"]);
  const parsed = parseOrThrow(gameSchema, def, "game()");
  reg.game = parsed;
  return parsed;
}

/** Declare a prefab: a spawnable entity template. */
export function prefab(id: string, def: PrefabInput): PrefabDef {
  unseal();
  checkId("prefab", id);
  unique(reg.prefabs, "prefab", id);
  const parsed = parseOrThrow(prefabSchema, def, `prefab("${id}")`);
  reg.prefabs.set(id, parsed);
  return parsed;
}

/** Declare a weapon (survivor template): it fires by itself; players gain and level weapons at level-up. */
export function weapon(id: string, def: WeaponInput): WeaponDef {
  unseal();
  checkId("weapon", id);
  unique(reg.weapons, "weapon", id);
  const parsed = parseOrThrow(weaponSchema, def, `weapon("${id}")`);
  reg.weapons.set(id, parsed);
  return parsed;
}

/** Declare a passive upgrade offered at level-up (survivor template). */
export function upgrade(id: string, def: UpgradeInput): UpgradeDef {
  unseal();
  checkId("upgrade", id);
  unique(reg.upgrades, "upgrade", id);
  if (reg.upgrades.size >= 8) throw new GameDefinitionError(`upgrade("${id}")`, ["at most 8 passive upgrades per game"]);
  const parsed = parseOrThrow(upgradeSchema, def, `upgrade("${id}")`);
  reg.upgrades.set(id, parsed);
  return parsed;
}

/**
 * Declare the spawn director (at most one per game): who spawns, how many,
 * how fast and how tough, over the run's clock. See directorSchema.
 */
export function director(def: DirectorInput): DirectorDef {
  if (reg.director) throw new GameDefinitionError("director()", ["director() is called twice; a game has at most one director"]);
  const parsed = parseOrThrow(directorSchema, def, "director()");
  reg.director = parsed;
  return parsed;
}

/** Declare a system. `setup` runs once when a run starts and schedules work with `every`, `after`, `onTick`. */
export function system(name: string, setup: SystemSetup): void {
  unseal();
  checkId("system", name);
  unique(reg.systems, "system", name);
  if (typeof setup !== "function") throw new GameDefinitionError(`system("${name}")`, ["the second argument must be a function"]);
  reg.systems.set(name, setup);
}

/**
 * Declare a keeper (a playable character): a start weapon and a signature
 * passive. Players pick one before their first level; at most 15.
 */
export function keeper(id: string, def: KeeperInput): KeeperDef {
  unseal();
  checkId("keeper", id);
  unique(reg.keepers, "keeper", id);
  if (reg.keepers.size >= 15) throw new GameDefinitionError(`keeper("${id}")`, ["at most 15 keepers per game"]);
  const parsed = parseOrThrow(keeperSchema, def, `keeper("${id}")`);
  reg.keepers.set(id, parsed);
  return parsed;
}

/** Declare an achievement (counted per player per run; it unlocks keepers, never coins). */
export function achievement(id: string, def: AchievementInput): AchievementDef {
  unseal();
  checkId("achievement", id);
  unique(reg.achievements, "achievement", id);
  const parsed = parseOrThrow(achievementSchema, def, `achievement("${id}")`);
  reg.achievements.set(id, parsed);
  return parsed;
}

/** Declare a daily goal (the HUD shows three a day; it pays nothing). */
export function mission(id: string, def: MissionInput): MissionDef {
  unseal();
  checkId("mission", id);
  unique(reg.missions, "mission", id);
  const parsed = parseOrThrow(missionSchema, def, `mission("${id}")`);
  reg.missions.set(id, parsed);
  return parsed;
}

/** Declare an end-screen title ("The Butcher": the most kills). */
export function title(id: string, def: TitleInput): TitleDef {
  unseal();
  checkId("title", id);
  unique(reg.titles, "title", id);
  const parsed = parseOrThrow(titleSchema, def, `title("${id}")`);
  reg.titles.set(id, parsed);
  return parsed;
}

/**
 * Declare the game's coin model (at most once). Without it a game uses the
 * recommended default: coins buy cosmetics, unlocks and in-run consumables,
 * never permanent stat power. economy({ store: "cosmetics" }) sells looks
 * only; economy({ metaUpgrades: true }) opts in to metaUpgrade(...).
 */
export function economy(def: EconomyInput = {}): EconomyDef {
  unseal();
  if (reg.economy) throw new GameDefinitionError("economy()", ["economy() is called twice; a game has one coin model"]);
  const parsed = parseOrThrow(economySchema, def, "economy()");
  reg.economy = parsed;
  return parsed;
}

/**
 * Declare a meta upgrade: a permanent stat bonus a player buys with coins,
 * level by level (opt-in: economy({ metaUpgrades: true })). The engine caps
 * meta power at +15% per stat and +30% in total, and costs grow
 * geometrically. The store shows every level's bonus and price.
 */
export function metaUpgrade(id: string, def: MetaUpgradeInput): MetaUpgradeDef {
  unseal();
  checkId("meta upgrade", id);
  unique(reg.metaUpgrades, "meta upgrade", id);
  if (reg.metaUpgrades.size >= META_MAX_UPGRADES) throw new GameDefinitionError(`metaUpgrade("${id}")`, [`at most ${META_MAX_UPGRADES} meta upgrades per game`]);
  const parsed = parseOrThrow(metaUpgradeSchema, def, `metaUpgrade("${id}")`);
  reg.metaUpgrades.set(id, parsed);
  return parsed;
}

/** Earn rules (every game must have at least one). */
export const earn = {
  rule(id: string, def: EarnRuleInput): EarnRuleDef {
    unseal();
    checkId("earn rule", id);
    unique(reg.earnRules, "earn rule", id);
    const parsed = parseOrThrow(earnRuleSchema, def, `earn.rule("${id}")`);
    reg.earnRules.set(id, parsed);
    return parsed;
  },
  /**
   * The buy-in run, the mandatory sink loop: earning
   * above free play takes a stake of the game's coins at run start. One per
   * game, written on one line so Net Forge's Launch panel can read and edit it.
   */
  stake(def: EarnStakeInput): EarnStakeDef {
    unseal();
    if (reg.stake) throw new GameDefinitionError("earn.stake", ["a game declares earn.stake(...) once"]);
    const parsed = parseOrThrow(earnStakeSchema, def, "earn.stake");
    reg.stake = parsed;
    return parsed;
  },
  /**
   * A PvP pot, optional, for the arena
   * template: entrants pay `entry` coins before a round, the result splits
   * the pot, and `recycle` of it stays in the reward pool.
   */
  pot(def: EarnPotInput): EarnPotDef {
    unseal();
    if (reg.pot) throw new GameDefinitionError("earn.pot", ["a game declares earn.pot(...) once"]);
    const parsed = parseOrThrow(earnPotSchema, def, "earn.pot");
    reg.pot = parsed;
    return parsed;
  },
};

/** Store SKUs: upgrades and cosmetics priced in the game's coins (and/or USDG). */
export const store = {
  sku(id: string, def: SkuInput): SkuDef {
    unseal();
    checkId("sku", id);
    unique(reg.skus, "sku", id);
    const parsed = parseOrThrow(skuSchema, def, `store.sku("${id}")`);
    reg.skus.set(id, parsed);
    return parsed;
  },
};

/**
 * Collect and cross-check what the game module declared. Called by the
 * build and the runtime after importing the module, not by game code.
 */
export function collectManifest(): GameManifest {
  const issues: string[] = [];
  if (!reg.game) issues.push("no game() declaration; export default game({...})");
  if (reg.earnRules.size === 0) issues.push("every game needs at least one earn.rule(...)");
  if (!reg.stake) issues.push("every game needs a buy-in run: earn.stake({ min, max, multiple }) (the sink loop)");
  if (reg.pot && reg.game && reg.game.template !== "arena") issues.push("earn.pot(...) is for player-versus-player games: the arena template");
  for (const id of [...reg.skus.keys(), ...reg.metaUpgrades.keys()]) if (id === POT_REASON) issues.push(`"${POT_REASON}" is the pot's coin spend reason; pick another id`);
  for (const id of reg.skus.keys()) if (id === STAKE_REASON) issues.push(`store.sku("${id}"): "${STAKE_REASON}" is the buy-in run's coin spend reason; pick another id`);
  for (const id of reg.metaUpgrades.keys()) if (id === STAKE_REASON) issues.push(`metaUpgrade("${id}"): "${STAKE_REASON}" is the buy-in run's coin spend reason; pick another id`);
  for (const [id, p] of reg.prefabs) {
    for (const d of p.drops) {
      const did = typeof d === "string" ? d : d.id;
      if (!reg.prefabs.has(did)) issues.push(`prefab "${id}" drops "${did}", which is not a declared prefab`);
    }
  }
  if (reg.weapons.size > 15) issues.push("at most 15 weapons per game");
  const start = reg.game?.players.weapon;
  if (start !== undefined && !reg.weapons.has(start)) issues.push(`players.weapon is "${start}", which is not a declared weapon`);
  for (const id of reg.game?.players.loadout ?? []) if (!reg.weapons.has(id)) issues.push(`players.loadout has "${id}", which is not a declared weapon`);
  const drop = reg.game?.players.drop;
  if (drop !== undefined && !reg.prefabs.has(drop)) issues.push(`players.drop is "${drop}", which is not a declared prefab`);
  for (const e of reg.director?.pool ?? []) {
    if (!reg.prefabs.has(e.prefab)) issues.push(`director pool has "${e.prefab}", which is not a declared prefab`);
    if (Array.isArray(e.group) && e.group[0] > e.group[1]) issues.push(`director pool "${e.prefab}": group [min, max] needs min <= max`);
    if (e.until !== undefined && e.until <= e.from) issues.push(`director pool "${e.prefab}": until must be after from`);
  }
  for (const [id, k] of reg.keepers) {
    if (!reg.weapons.has(k.weapon)) issues.push(`keeper "${id}" starts with "${k.weapon}", which is not a declared weapon`);
    if (k.passive !== undefined && !reg.upgrades.has(k.passive)) issues.push(`keeper "${id}" has passive "${k.passive}", which is not a declared upgrade`);
    if (k.unlock !== undefined && !reg.achievements.has(k.unlock)) issues.push(`keeper "${id}" unlocks with "${k.unlock}", which is not a declared achievement`);
  }
  if (reg.keepers.size > 0 && [...reg.keepers.values()].every((k) => k.unlock !== undefined)) {
    issues.push("at least one keeper needs no unlock (everyone must have a keeper to start with)");
  }
  const [firstKeeper, first] = [...reg.keepers][0] ?? [];
  if (first?.unlock !== undefined) issues.push(`keeper "${firstKeeper}" is declared first, so it is everyone's default: it cannot have an unlock (declare a free keeper first)`);
  issues.push(...economyIssues(reg));
  if (issues.length > 0 || !reg.game || !reg.stake) throw new GameDefinitionError("game module", issues);
  sealed = true;
  return {
    game: reg.game,
    prefabs: reg.prefabs,
    weapons: reg.weapons,
    upgrades: reg.upgrades,
    systems: reg.systems,
    earnRules: reg.earnRules,
    stake: reg.stake,
    pot: reg.pot,
    skus: reg.skus,
    director: reg.director,
    keepers: reg.keepers,
    achievements: reg.achievements,
    missions: reg.missions,
    titles: reg.titles,
    economy: reg.economy ?? parseOrThrow(economySchema, {}, "economy()"),
    metaUpgrades: reg.metaUpgrades,
    content: reg.content,
  };
}

/**
 * A genre declaration (rules/genres: tower(...), board(...), card(...)):
 * stored under "<kind>:<id>" for the genre's compile step to read. Ids are
 * unique per kind. Game code calls the genre's own typed function, never this.
 */
export function declareContent(kind: string, id: string, value: unknown): void {
  unseal();
  const key = `${kind}:${id}`;
  if (reg.content.has(key)) throw new GameDefinitionError(`${kind}("${id}")`, [`${kind} "${id}" is declared twice; ids must be unique`]);
  reg.content.set(key, value);
}

/** Genre content of one kind, in declaration order (id, value). */
export function contentOf<T>(m: Pick<GameManifest, "content">, kind: string): [string, T][] {
  const out: [string, T][] = [];
  for (const [k, v] of m.content) if (k.startsWith(`${kind}:`)) out.push([k.slice(kind.length + 1), v as T]);
  return out;
}

/** The coin spend reason a buy-in run's stake is spent under (the referee reads it at run start). */
export const STAKE_REASON = "stake";
/** The coin spend reason a PvP pot entry is spent under. */
export const POT_REASON = "pot";

/** A coin spend's reason (the SKU or meta upgrade id) must fit the referee's ledger. */
const SPEND_REASON = /^[a-z][a-z0-9_]{1,30}$/;

/** The coin model's cross-checks. */
function economyIssues(r: Registry): string[] {
  const issues: string[] = [];
  const e = r.economy ?? { store: "default" as const, metaUpgrades: false };
  const firstKeeper = [...r.keepers.keys()][0];
  const looks = new Map<number, string>();
  for (const [id, sku] of r.skus) {
    if (sku.coins !== undefined && !SPEND_REASON.test(id)) issues.push(`store.sku("${id}"): a coin-priced SKU id is 2-31 characters (a-z, 0-9, _)`);
    const g = sku.grants;
    if (e.store === "cosmetics" && !(g && "cosmetic" in g)) {
      issues.push(`store.sku("${id}"): economy({ store: "cosmetics" }) sells looks only; give it grants: { cosmetic: <id> } or remove it`);
    }
    if (!g) continue;
    if ("keeper" in g) {
      const k = r.keepers.get(g.keeper);
      if (!k) issues.push(`store.sku("${id}") unlocks keeper "${g.keeper}", which is not a declared keeper`);
      else if (g.keeper === firstKeeper) issues.push(`store.sku("${id}") sells keeper "${g.keeper}", the free default keeper`);
      else if (k.unlock !== undefined) {
        issues.push(`keeper "${g.keeper}" is both unlocked by an achievement ("${k.unlock}") and sold by store.sku("${id}"); a keeper is earned or bought, never both (drop its unlock, or the SKU)`);
      }
    } else if ("gear" in g) {
      if (!r.upgrades.has(g.gear)) issues.push(`store.sku("${id}") is gear for "${g.gear}", which is not a declared upgrade`);
      if (sku.coins === undefined || sku.usdg !== undefined) issues.push(`store.sku("${id}"): gear sells for coins only (its coins stay in the reward pool when it is lost)`);
    } else {
      const other = looks.get(g.cosmetic);
      if (other !== undefined) issues.push(`store.sku("${id}") and store.sku("${other}") both grant cosmetic ${g.cosmetic}`);
      looks.set(g.cosmetic, id);
    }
  }
  if (r.metaUpgrades.size > 0 && !e.metaUpgrades) {
    issues.push("metaUpgrade(...) is opt-in: declare economy({ metaUpgrades: true }) to sell permanent stat upgrades for coins");
  }
  const perStat = new Map<string, number>();
  let total = 0;
  for (const [id, m] of r.metaUpgrades) {
    if (!SPEND_REASON.test(id)) issues.push(`metaUpgrade("${id}"): its id is 2-31 characters (a-z, 0-9, _)`);
    if (r.skus.has(id)) issues.push(`metaUpgrade("${id}") and store.sku("${id}") share an id; ids are coin spend reasons and must differ`);
    const v = m.step * m.levels;
    perStat.set(m.stat, (perStat.get(m.stat) ?? 0) + v);
    total += v;
  }
  for (const [stat, v] of perStat) {
    if (v > META_MAX_PER_STAT + 1e-9) issues.push(`meta upgrades raise ${stat} by +${Math.round(v * 100)}% at their top levels; the engine caps one stat at +${Math.round(META_MAX_PER_STAT * 100)}%`);
  }
  if (total > META_MAX_TOTAL + 1e-9) issues.push(`meta upgrades add +${Math.round(total * 100)}% in total at their top levels; the engine caps all meta power at +${Math.round(META_MAX_TOTAL * 100)}%`);
  return issues;
}

/** Forget all declarations (the build and tests load several game modules in one process). */
export function resetRegistry(): void {
  reg = fresh();
  sealed = false;
}
