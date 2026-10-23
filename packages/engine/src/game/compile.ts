/**
 * Compile a game manifest (what the model declared through the API) into
 * engine-sim content: enemy types, weapons, passives and progression. This
 * is how prefabs and weapons stop being validated-only and start running in
 * the sim.
 */
import type { ContentConfig, EnemyAi, EnemyTypeDef, SimConfig, StatDef, WeaponDef as SimWeaponDef, WeaponLevelStats } from "@netforge/engine-sim";
import type { GameManifest } from "../api/registry.js";
import { GameDefinitionError } from "../api/schemas.js";
import type { PrefabDef, WeaponDef as ApiWeaponDef } from "../api/schemas.js";
import { viewRadii, viewsFor } from "./view.js";
import { compilePlatformer, PLATFORMER_DEFAULTS } from "./platformer.js";
import type { CompiledPlatformer } from "./platformer.js";
import { compileRacer, RACER_DEFAULTS } from "./racer.js";
import type { CompiledRacer } from "./racer.js";
import type { CameraView } from "./view.js";

/** Templates that run on the survivor machinery (co-op, auto-firing weapons, downs and revives, keepers). */
export const COOP_TEMPLATES: ReadonlySet<string> = new Set(["survivor", "dungeon", "party"]);

/** Default enemy radius when a prefab gives none, m. */
const DEFAULT_RADIUS = 0.35;
/** Default contact damage when a prefab gives none. */
const DEFAULT_DAMAGE = 5;

/**
 * Survivor-machinery defaults every game gets unless it says otherwise
 * (GAME-DESIGN.md): a generous magnet, half a second of hit i-frames, a
 * solo pause on level-up cards and a shove plus a second of i-frames when
 * co-op cards open.
 */
export const SURVIVOR_DEFAULTS = {
  magnet: 3.75,
  hitIframes: 0.5,
  choicePulseRadius: 2.5,
  choicePulseIframes: 1,
  /** Co-op XP: half of each gem to teammates within 20 m. */
  share: { mode: "nearby", fraction: 0.5, radius: 20 },
  /** The reviver's buff: 5 s of x1.25 damage and x1.15 speed. */
  reviveBuff: { seconds: 5, damage: 1.25, speed: 1.15 },
  /** Going down is short: 10 s downed (crawling), one free get-up a run, then back in 5 s beside a teammate. */
  downed: { seconds: 10, crawl: 0.35, selfRevives: 1, respawn: 5 },
  /** Getting up shoves enemies within this radius, m. */
  risePulseRadius: 4,
} as const;

export interface CompiledGame {
  readonly manifest: GameManifest;
  /** Pass to engine-sim's createWorld (add a seed). Identical on the server and the client. */
  readonly sim: SimConfig;
  /** Enemy prefab ids by engine type index. */
  readonly enemyPrefabs: readonly string[];
  /** Engine type index by enemy prefab id. */
  readonly enemyType: ReadonlyMap<string, number>;
  /** Pickup prefab ids by gem tier (0 small, 1 medium, 2 large); several tiers may share a prefab. */
  readonly pickupPrefabs: readonly string[];
  /** Special pickup prefab ids (heals, vacuums, bombs, chests): entity type PICKUP_SPECIAL + index. */
  readonly specialPickups: readonly string[];
  /** Weapon ids by engine weapon index, then upgrade ids: the order of level-up offer indices. */
  readonly weaponIds: readonly string[];
  readonly upgradeIds: readonly string[];
  readonly tickRate: number;
  /** "arena": the shooter machinery (loadouts, respawn, rounds, seat-filling bots); "platformer": the race-to-the-flag machinery (platformer.ts); else the survivor machinery. */
  readonly mode: "survivor" | "arena" | "platformer" | "racer";
  /** Platformer: the courses, feel and upgrade stats (null for other templates). */
  readonly platformer?: CompiledPlatformer;
  /** Racer: the circuits, handling and upgrade stats (null for other templates). */
  readonly racer?: CompiledRacer;
  /** Arena: weapon indices in loadout slots 1..4. */
  readonly loadout: readonly number[];
  /** Arena: seats bots fill up to (0: none). */
  readonly bots: number;
  /** Arena: round length and frag limit; null for survivor runs. */
  readonly round: { readonly seconds: number; readonly frags: number | null } | null;
  /** What a player sees: screen-edge distances by heading (the director spawns past them; the playtest counts inside them as on screen). */
  readonly view: readonly number[];
}

/** Arena defaults: a 3 minute round, a 3 s respawn, 2 s spawn protection, heal cells last 20 s. */
export const ARENA_DEFAULTS = { roundSeconds: 180, respawnSeconds: 3, spawnProtectSeconds: 2, pickupSeconds: 20, pillarHeight: 2.4 } as const;
const ARENA_KINDS = new Set(["blaster", "beam", "nova"]);
const SURVIVOR_KINDS = new Set(["nova", "bolt", "orbit", "cone", "chain", "aura", "meteor", "boomerang"]);

/** Default speed per weapon kind: m/s for projectiles, rad/s for orbits, jump reach (m) for chains. */
const DEFAULT_SPEED: Readonly<Record<string, number>> = { bolt: 20, boomerang: 14, orbit: 3, chain: 4 };

/** Base numbers of a weapon at level 1 (sim units). */
function baseLevel(w: ApiWeaponDef, tickRate: number): WeaponLevelStats {
  return {
    damage: w.damage,
    cooldownTicks: w.cooldown * tickRate,
    range: w.range,
    count: w.count,
    speed: w.speed ?? DEFAULT_SPEED[w.kind] ?? 0,
    pierce: w.pierce,
    knockback: w.knockback,
    spread: ((w.spread ?? (w.kind === "cone" ? 90 : 0)) * Math.PI) / 180,
  };
}

/** Every level's numbers: level 1 is the weapon's own, each declared level applies its changes to the one before. */
export function levelTable(w: ApiWeaponDef, tickRate: number): WeaponLevelStats[] {
  const out: WeaponLevelStats[] = [baseLevel(w, tickRate)];
  for (const change of w.levels ?? []) {
    const prev = out[out.length - 1] as WeaponLevelStats;
    const next: Record<string, number> = { ...prev };
    for (const [field, v] of Object.entries(change)) {
      const key = field === "cooldown" ? "cooldownTicks" : field;
      const before = next[key] ?? 0;
      if (typeof v === "number") next[key] = before + (field === "cooldown" ? v * tickRate : field === "spread" ? (v * Math.PI) / 180 : v);
      else next[key] = before * (1 + Number(v.slice(0, -1)) / 100);
    }
    next.cooldownTicks = Math.max(1, next.cooldownTicks ?? 1);
    next.count = Math.max(1, Math.round(next.count ?? 1));
    next.pierce = Math.max(0, Math.round(next.pierce ?? 0));
    out.push(next as unknown as WeaponLevelStats);
  }
  return out;
}

/** A declared ai as the sim's role ("tank" is a chaser: its weight is in its stats). */
function enemyAi(ai: PrefabDef["ai"]): EnemyAi {
  if (ai === undefined || ai === "chase" || ai === "tank") return "chase";
  if (ai === "none" || ai === "idle") return "idle";
  return ai;
}

function compileAttack(id: string, p: PrefabDef, tickRate: number, ref: (from: string, field: string, to: string | undefined) => number | undefined) {
  const a = p.attack ?? {};
  const t = (s: number | undefined) => (s === undefined ? undefined : Math.max(1, Math.round(s * tickRate)));
  const summon = ref(id, "attack.summon", a.summon);
  const windupTicks = t(a.windup);
  const cooldownTicks = t(a.cooldown);
  return {
    ...(a.damage !== undefined ? { damage: a.damage } : {}),
    ...(a.range !== undefined ? { range: a.range } : {}),
    ...(windupTicks !== undefined ? { windupTicks } : {}),
    ...(cooldownTicks !== undefined ? { cooldownTicks } : {}),
    ...(a.speed !== undefined ? { speed: a.speed } : {}),
    ...(a.radius !== undefined ? { radius: a.radius } : {}),
    ...(summon !== undefined ? { summon } : {}),
    ...(a.count !== undefined ? { count: a.count } : {}),
  };
}

function splitOf(id: string, s: { into: string; count: number }, ref: (from: string, field: string, to: string | undefined) => number | undefined, issues: string[]) {
  if (s.into === id) {
    issues.push(`prefab "${id}" splits into itself, which never ends: split into a smaller prefab`);
    return {};
  }
  const type = ref(id, "split.into", s.into);
  return type === undefined ? {} : { split: { type, count: s.count } };
}

/** "enemy" or "pickup": explicit, else a prefab something drops is a pickup. */
export function prefabKind(m: GameManifest, id: string, p: PrefabDef): "enemy" | "pickup" {
  if (p.kind) return p.kind;
  if (p.pickup) return "pickup";
  for (const other of m.prefabs.values()) if (other.drops.some((d) => (typeof d === "string" ? d : d.id) === id)) return "pickup";
  return "enemy";
}

export function compileGame(m: GameManifest, opts: { maxEntities?: number; views?: readonly CameraView[] } = {}): CompiledGame {
  const issues: string[] = [];
  if (m.game.template === "platformer") return compilePlatformerGame(m, issues);
  if (m.game.template === "racer") return compileRacerGame(m, issues);
  const tickRate = m.game.tickRate ?? 30;
  const enemyPrefabs: string[] = [];
  const enemyTypes: EnemyTypeDef[] = [];
  const pickups: { id: string; value: number }[] = [];
  for (const [id, p] of m.prefabs) {
    // Gems only: special pickups (p.pickup) have their own types.
    if (prefabKind(m, id, p) === "pickup" && !p.pickup) pickups.push({ id, value: p.value ?? 1 });
  }
  // Special pickups (heals, vacuums, bombs, chests): entity types PICKUP_SPECIAL + index.
  const specialIds = [...m.prefabs].filter(([id, p]) => p.pickup && prefabKind(m, id, p) === "pickup").map(([id]) => id);
  // Enemy type indices first: roles and bosses refer to other enemies (summons, splits).
  const enemyIndex = new Map<string, number>();
  for (const [id, p] of m.prefabs) if (prefabKind(m, id, p) === "enemy") enemyIndex.set(id, enemyIndex.size);
  const enemyRef = (from: string, field: string, to: string | undefined): number | undefined => {
    if (to === undefined) return undefined;
    const i = enemyIndex.get(to);
    if (i === undefined) issues.push(`prefab "${from}" ${field} "${to}", which is not an enemy prefab`);
    return i;
  };
  for (const [id, p] of m.prefabs) {
    if (prefabKind(m, id, p) !== "enemy") continue;
    let xp = 0;
    const specialDrops: { pickup: number; chance: number }[] = [];
    for (const d of p.drops) {
      const did = typeof d === "string" ? d : d.id;
      const drop = m.prefabs.get(did);
      if (!drop || prefabKind(m, did, drop) !== "pickup") {
        issues.push(`prefab "${id}" drops "${did}", which is an enemy; drops must be pickups`);
        continue;
      }
      const special = specialIds.indexOf(did);
      if (special >= 0) specialDrops.push({ pickup: special, chance: typeof d === "string" ? 1 : d.chance });
      else if (typeof d === "string") xp += drop.value ?? 1;
      else issues.push(`prefab "${id}" drops "${did}" with a chance; chances are for special pickups (pickup: { effect }); XP gems always drop`);
    }
    enemyPrefabs.push(id);
    enemyTypes.push({
      health: p.health,
      speed: p.speed,
      radius: p.radius ?? DEFAULT_RADIUS,
      damage: p.damage ?? DEFAULT_DAMAGE,
      xp,
      ...(p.boss ? { boss: true } : {}),
      mass: p.mass ?? (p.boss ? 20 : 1),
      ai: p.prop ? "idle" : enemyAi(p.ai),
      ...(specialDrops.length ? { drops: specialDrops } : {}),
      ...(p.prop ? { prop: true } : {}),
      ...(p.attack ? { attack: compileAttack(id, p, tickRate, enemyRef) } : {}),
      ...(p.split ? splitOf(id, p.split, enemyRef, issues) : {}),
      ...(typeof p.boss === "object"
        ? {
            pattern: {
              attacks: p.boss.attacks,
              enrageAt: p.boss.enrageAt,
              ...(p.boss.summon !== undefined ? { summon: enemyRef(id, "boss.summon", p.boss.summon) ?? 0 } : {}),
              ...(p.boss.rank === "mini" ? { mini: true } : {}),
            },
          }
        : {}),
    });
  }
  if (enemyTypes.length > 255) issues.push("at most 255 enemy prefabs");

  const weaponIds = [...m.weapons.keys()];
  const upgradeIds = [...m.upgrades.keys()];
  // Evolution targets are never offered on their own.
  const evolvedIds = new Set<string>();
  for (const [id, w] of m.weapons) {
    if (!w.evolve) continue;
    if (w.evolve.into === id) issues.push(`weapon "${id}" evolves into itself: evolve into a separate, stronger weapon`);
    else if (!m.weapons.has(w.evolve.into)) issues.push(`weapon "${id}" evolves into "${w.evolve.into}", which is not a declared weapon`);
    if (!m.upgrades.has(w.evolve.requires)) issues.push(`weapon "${id}" evolves with "${w.evolve.requires}", which is not a declared upgrade`);
    evolvedIds.add(w.evolve.into);
  }
  const weapons: SimWeaponDef[] = [...m.weapons.entries()].map(([id, w]) => {
    if (w.levels && w.maxLevel !== undefined && w.maxLevel !== w.levels.length + 1) {
      issues.push(`weapon "${id}" declares ${w.levels.length} levels and maxLevel ${w.maxLevel}: drop maxLevel (it is levels.length + 1)`);
    }
    const table = w.levels ? levelTable(w, tickRate) : undefined;
    const base = baseLevel(w, tickRate);
    return {
      kind: w.kind,
      damage: w.damage,
      cooldownTicks: Math.min(255, Math.max(1, Math.round(base.cooldownTicks))),
      range: w.range,
      count: w.count,
      speed: base.speed,
      pierce: w.pierce,
      knockback: w.knockback,
      maxLevel: table ? table.length : (w.maxLevel ?? 8),
      ...(w.spread !== undefined || w.kind === "cone" ? { spread: base.spread } : {}),
      ...(w.blast !== undefined ? { blast: w.blast } : {}),
      ...(table ? { levels: table } : {}),
      ...(evolvedIds.has(id) ? { evolved: true } : {}),
      ...(w.evolve && m.weapons.has(w.evolve.into) && m.upgrades.has(w.evolve.requires)
        ? { evolve: { into: weaponIds.indexOf(w.evolve.into), requires: upgradeIds.indexOf(w.evolve.requires) } }
        : {}),
    };
  });
  const stats: StatDef[] = [...m.upgrades.values()].map((u) => ({ stat: u.stat, step: u.step, maxLevel: u.maxLevel }));
  const start = m.game.players.weapon;
  const startWeapon = start === undefined ? -1 : weaponIds.indexOf(start);

  // The co-op family on the survivor machinery: the survivor-like, the dungeon crawl and the party rounds.
  const coopFamily = COOP_TEMPLATES.has(m.game.template);
  if (coopFamily) {
    if (enemyTypes.length === 0) issues.push(`a ${m.game.template} game needs at least one enemy prefab`);
    if (weapons.length === 0) issues.push(`a ${m.game.template} game needs at least one weapon(...)`);
    if (start === undefined && m.keepers.size === 0) issues.push(`a ${m.game.template} game sets players.weapon (the weapon every run starts with) or declares keeper(...)s`);
    for (const [id, w] of m.weapons) {
      if (!SURVIVOR_KINDS.has(w.kind)) issues.push(`weapon "${id}" is a ${w.kind}; survivor weapons fire by themselves: nova, bolt or orbit (or cone, chain, aura, meteor, boomerang)`);
    }
  }
  const arenaMode = m.game.template === "arena";
  const loadoutIds = m.game.players.loadout ?? [];
  const loadout = loadoutIds.map((id) => weaponIds.indexOf(id)).filter((i) => i >= 0);
  let dropHeal = 0;
  if (arenaMode) {
    const a = m.game.arena;
    if (!a) issues.push("an arena game sets arena: { halfSize, pillars, spawns } (the floor, cover and spawn points)");
    if (loadoutIds.length === 0) issues.push('an arena game sets players.loadout: the weapons every player carries, e.g. ["rifle", "scatter", "beam"]');
    for (const [id, w] of m.weapons) {
      if (!ARENA_KINDS.has(w.kind)) issues.push(`weapon "${id}" is a ${w.kind}; arena weapons fire where the player aims: blaster, beam or nova`);
    }
    if (a) {
      const h = a.halfSize;
      a.pillars.forEach(([x, z, r], i) => {
        if (Math.abs(x) + r > h || Math.abs(z) + r > h) issues.push(`arena.pillars[${i}] at [${x}, ${z}] does not fit on the floor (halfSize ${h})`);
      });
      a.spawns.forEach(([x, z], i) => {
        if (Math.abs(x) > h - 1 || Math.abs(z) > h - 1) issues.push(`arena.spawns[${i}] at [${x}, ${z}] is off the floor (keep 1 m inside halfSize ${h})`);
        for (const [px, pz, r] of a.pillars) {
          if (Math.hypot(x - px, z - pz) < r + 1) issues.push(`arena.spawns[${i}] at [${x}, ${z}] is inside a pillar; move it 1 m clear`);
        }
      });
    }
    const drop = m.game.players.drop;
    if (drop !== undefined) {
      const p = m.prefabs.get(drop);
      if (!p || prefabKind(m, drop, p) !== "pickup") issues.push(`players.drop "${drop}" must be a pickup prefab (kind: "pickup", value: the health it restores)`);
      else dropHeal = p.value ?? 0;
    }
  } else if (m.game.arena || loadoutIds.length > 0 || m.game.round) {
    issues.push("arena, round and players.loadout are for the arena template");
  }
  if (m.keepers.size > 0 && !coopFamily) issues.push("keeper(...) is for the co-op templates (survivor, dungeon, party)");
  const fieldDef = arenaMode ? undefined : m.game.field;
  if (fieldDef?.walls || fieldDef?.floors) {
    const h = fieldDef.halfSize;
    const off = (b: readonly number[]) => Math.abs(b[0] ?? 0) + (b[2] ?? 0) > h + 1e-6 || Math.abs(b[1] ?? 0) + (b[3] ?? 0) > h + 1e-6;
    (fieldDef.walls ?? []).forEach((b, i) => {
      if (off(b)) issues.push(`field.walls[${i}] at [${b[0]}, ${b[1]}] does not fit on the field (halfSize ${h})`);
    });
    (fieldDef.floors ?? []).forEach((b, i) => {
      if (off(b)) issues.push(`field.floors[${i}] at [${b[0]}, ${b[1]}] does not fit on the field (halfSize ${h})`);
    });
    const floors = fieldDef.floors ?? [];
    if (floors.length > 0 && !floors.some(([x, z, hx, hz]) => Math.abs(x) < hx - 1 && Math.abs(z) < hz - 1)) {
      issues.push("players start at [0, 0]: one of field.floors must cover it (dungeon(...) puts the start room there)");
    }
  }
  if (issues.length > 0) throw new GameDefinitionError("game module", issues);

  // Gem tiers follow the drop value: a tier's prefab is the pickup whose value is closest.
  const tierOf = (xp: number) => (xp >= 25 ? 2 : xp >= 5 ? 1 : 0);
  const pickupPrefabs: string[] = [0, 1, 2].map((tier) => {
    const exact = pickups.find((p) => tierOf(p.value) === tier);
    return exact?.id ?? pickups[0]?.id ?? "";
  });

  const a = arenaMode ? m.game.arena : undefined;
  const field = arenaMode ? undefined : m.game.field;
  const view = viewRadii(opts.views ?? viewsFor(m.game.template));
  const pickupDefs = specialIds.map((id) => {
    const p = m.prefabs.get(id)?.pickup;
    return { effect: p?.effect ?? "heal", amount: p?.amount ?? (p?.effect === "chest" ? 2 : p?.effect === "heal" ? 0.3 : 1), ...(p?.evolve ? { evolve: true } : {}) } as const;
  });
  // Elites drop the plain chest; bosses the boss chest (evolve) when the game declares one.
  const lootOf = (effect: string) => pickupDefs.findIndex((d) => d.effect === effect && !("evolve" in d && d.evolve));
  const plainChest = lootOf("chest");
  const bossChest = pickupDefs.findIndex((d) => d.effect === "chest" && "evolve" in d && d.evolve);
  const pl = m.game.players;
  const share = typeof pl.share === "string" ? { mode: pl.share, fraction: SURVIVOR_DEFAULTS.share.fraction, radius: SURVIVOR_DEFAULTS.share.radius } : (pl.share ?? SURVIVOR_DEFAULTS.share);
  const buff = pl.reviveBuff ?? SURVIVOR_DEFAULTS.reviveBuff;
  const down = pl.downed ?? SURVIVOR_DEFAULTS.downed;
  // Keepers: index order is declaration order; each starts with its weapon and its passive at level 1.
  const characters = [...m.keepers.values()].map((k) => ({ weapon: weaponIds.indexOf(k.weapon), stat: k.passive ? upgradeIds.indexOf(k.passive) : -1 }));
  const content: ContentConfig = {
    enemyTypes,
    weapons,
    stats,
    progression: {
      startWeapon: arenaMode ? (loadout[0] ?? startWeapon) : startWeapon,
      ...(arenaMode ? { loadout } : {}),
      ...(pl.xp ? { xpBase: pl.xp.base, xpGrowth: pl.xp.growth, xpExponent: pl.xp.exponent ?? 1 } : {}),
      ...(arenaMode
        ? {}
        : {
            magnet: pl.magnet ?? SURVIVOR_DEFAULTS.magnet,
            rerolls: pl.rerolls ?? 1,
            xpShare: { mode: share.mode, fraction: share.fraction, radius: share.radius },
          }),
      ...(pl.crit ? { critChance: pl.crit.chance, critMultiplier: pl.crit.multiplier } : {}),
    },
    ...(characters.length > 0 && !arenaMode ? { characters } : {}),
    view: { radii: view },
    ...(pickupDefs.length ? { pickups: pickupDefs, loot: { chest: plainChest >= 0 ? plainChest : bossChest, heal: lootOf("heal"), vacuum: lootOf("vacuum"), ...(bossChest >= 0 ? { bossChest } : {}) } } : {}),
    ...(arenaMode
      ? {}
      : {
          coop: {
            hitIframeTicks: Math.round((pl.hitIframes ?? SURVIVOR_DEFAULTS.hitIframes) * tickRate),
            pauseSolo: true,
            choicePulseRadius: SURVIVOR_DEFAULTS.choicePulseRadius,
            choicePulseIframeTicks: Math.round(SURVIVOR_DEFAULTS.choicePulseIframes * tickRate),
            reviveBuffTicks: Math.min(4095, Math.round(buff.seconds * tickRate)),
            reviveBuffMight: buff.damage,
            reviveBuffSpeed: buff.speed,
            downedTicks: Math.round(down.seconds * tickRate),
            crawlSpeed: down.crawl,
            selfRevives: down.selfRevives,
            respawnTicks: Math.min(4095, Math.round(down.respawn * tickRate)),
            risePulseRadius: SURVIVOR_DEFAULTS.risePulseRadius,
          },
        }),
    ...(a
      ? {
          arena: {
            enabled: true,
            spawns: a.spawns.map(([x, z]) => [x, z] as const),
            respawnTicks: Math.max(1, Math.round((m.game.players.respawn ?? ARENA_DEFAULTS.respawnSeconds) * tickRate)),
            spawnIframeTicks: Math.round(ARENA_DEFAULTS.spawnProtectSeconds * tickRate),
            dropHeal,
            pickupTicks: Math.round(ARENA_DEFAULTS.pickupSeconds * tickRate),
          },
        }
      : {}),
  };
  return {
    manifest: m,
    sim: {
      tickRate,
      maxEntities: opts.maxEntities ?? (arenaMode ? 2048 : 4096),
      enemies: { target: 0 },
      ...(a
        ? {
            arena: {
              halfExtent: a.halfSize,
              wallHeight: 3,
              pillars: a.pillars.map(([x, z, radius]) => ({ x, z, radius, height: ARENA_DEFAULTS.pillarHeight })),
              spawn: [0, 1, 0] as const,
            },
          }
        : field
          ? {
              arena: {
                halfExtent: field.halfSize,
                wallHeight: 3,
                pillars: field.pillars.map(([x, z, radius]) => ({ x, z, radius, height: radius >= 2.5 ? 5 : 4 })),
                ...(field.walls ? { walls: field.walls.map(([x, z, hx, hz]) => ({ x, z, hx, hz })) } : {}),
                ...(field.floors ? { floors: field.floors.map(([x, z, hx, hz]) => ({ x, z, hx, hz })) } : {}),
                spawn: [0, 1, 0] as const,
              },
            }
          : {}),
      content,
    },
    mode: arenaMode ? "arena" : "survivor",
    loadout,
    bots: arenaMode ? (m.game.players.bots ?? 0) : 0,
    round: arenaMode ? { seconds: m.game.round?.seconds ?? ARENA_DEFAULTS.roundSeconds, frags: m.game.round?.frags ?? null } : null,
    view,
    enemyPrefabs,
    enemyType: new Map(enemyPrefabs.map((id, i) => [id, i])),
    pickupPrefabs,
    specialPickups: specialIds,
    weaponIds,
    upgradeIds,
    tickRate,
  };
}

/** The platformer template: no enemies or weapons, a race over declared levels (platformer.ts). */
function compilePlatformerGame(m: GameManifest, issues: string[]): CompiledGame {
  const tickRate = m.game.tickRate ?? PLATFORMER_DEFAULTS.tickRate;
  const platformer = compilePlatformer(m, tickRate, issues);
  if (issues.length > 0) throw new GameDefinitionError("game module", issues);
  return {
    manifest: m,
    sim: { tickRate, enemies: { target: 0 } },
    mode: "platformer",
    platformer,
    loadout: [],
    bots: m.game.players.bots ?? PLATFORMER_DEFAULTS.bots,
    round: { seconds: m.game.round?.seconds ?? PLATFORMER_DEFAULTS.roundSeconds, frags: null },
    view: [],
    enemyPrefabs: [],
    enemyType: new Map(),
    pickupPrefabs: [],
    specialPickups: [],
    weaponIds: [],
    upgradeIds: [...m.upgrades.keys()],
    tickRate,
  };
}

/** The racer template: karts on circuits, a race a round (racer.ts). */
function compileRacerGame(m: GameManifest, issues: string[]): CompiledGame {
  const tickRate = m.game.tickRate ?? RACER_DEFAULTS.tickRate;
  const racer = compileRacer(m, issues);
  if (issues.length > 0) throw new GameDefinitionError("game module", issues);
  return {
    manifest: m,
    sim: { tickRate, enemies: { target: 0 } },
    mode: "racer",
    racer,
    loadout: [],
    bots: m.game.players.bots ?? RACER_DEFAULTS.bots,
    round: { seconds: m.game.round?.seconds ?? RACER_DEFAULTS.roundSeconds, frags: null },
    view: [],
    enemyPrefabs: [],
    enemyType: new Map(),
    pickupPrefabs: [],
    specialPickups: [],
    weaponIds: [],
    upgradeIds: [...m.upgrades.keys()],
    tickRate,
  };
}
