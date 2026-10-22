import { z } from "zod";
// Asset library: model appearances (see ./appearance.ts).
import { appearanceSchema } from "./appearance.js";

/**
 * Zod schemas for everything a game declares ("Everything
 * is typed with Zod schemas, so a bad prefab fails at build with a message
 * the agent can act on"). Messages are written for the agent that reads them.
 */

/** Templates carry the genre machinery; the model adds content and rules. */
export const TEMPLATES = ["survivor", "arena", "dungeon", "racer", "platformer", "tower-defense", "party", "idle", "cards", "collector"] as const;
/** Art styles of the asset library (§10). */
export const STYLES = ["pixel", "lowpoly", "toon", "voxel", "ps1", "handdrawn"] as const;

const ID = /^[a-z][a-z0-9_]{0,47}$/;
/** Library asset ids look like `style.lowpoly.mech_01`. Never a URL (§10). */
const ASSET_ID = /^style\.[a-z0-9]+\.[a-z0-9_]+$/;

export const idSchema = z
  .string()
  .regex(ID, "ids are lower_snake_case: start with a letter, then a-z, 0-9 or _, at most 48 characters");

export const assetIdSchema = z
  .string()
  .refine((s) => !/^[a-z]+:\/\//i.test(s) && !s.startsWith("/") && !s.startsWith("data:"), {
    message: "reference assets by library id (e.g. \"style.lowpoly.bat\"), never by URL or path",
  })
  .refine((s) => ASSET_ID.test(s), {
    message: "asset ids look like \"style.<style>.<name>\", e.g. \"style.lowpoly.mech_01\"",
  });

export const vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

/** A colour as "#rrggbb". */
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colours are "#rrggbb", e.g. "#ffb347"');

/** Lighting presets of the engine's render stack (sun, sky, fog and grading together). */
export const LOOK_PRESETS = ["night", "dusk", "day", "studio"] as const;
/** GPU particle presets the engine draws (one draw call for all of them). */
export const PARTICLE_PRESETS = ["sparks", "burst", "embers", "smoke", "hitSpark", "dust", "magic"] as const;
/** Ground decals left behind (scorch marks, splats, shock rings). */
export const DECAL_PRESETS = ["none", "scorch", "splat", "ring"] as const;
/** Procedural sound cues of the feel kit (no audio files needed). */
export const SOUND_CUES = ["none", "hit", "crunch", "boom", "zap", "chime", "thud"] as const;

/**
 * How the game looks (the engine's render stack):
 * one preset sets lighting, shadows, sky, fog and colour grading; the
 * other fields fine-tune it. Quality tiers still scale everything down on
 * slow devices, so turning things on here never breaks the frame-rate bar.
 */
export const lookSchema = z
  .object({
    preset: z.enum(LOOK_PRESETS).default("night"),
    /** Bloom strength on bright and emissive things (0 off, 1 default, 3 max). */
    bloom: z.number().min(0).max(3).optional(),
    /** Sun shadows (on by default above the low quality tier). */
    shadows: z.boolean().optional(),
    /** Toon outline pass around shapes. */
    outline: z.boolean().optional(),
    /** Fog density, 0 (none) to 1 (thick). */
    fog: z.number().min(0).max(1).optional(),
    /** Exposure multiplier (1 is the preset's own). */
    exposure: z.number().min(0.2).max(3).optional(),
    /** Saturation and contrast, 1 neutral. */
    saturation: z.number().min(0).max(2).optional(),
    contrast: z.number().min(0.5).max(1.5).optional(),
    /** Darkened screen edges, 0 to 1. */
    vignette: z.number().min(0).max(1).optional(),
    /** Colour tint over the whole frame (grading), e.g. "#ffd9a0" for warm. */
    tint: colorSchema.optional(),
  })
  .strict();

/**
 * Game feel for a prefab or a weapon. On a prefab it
 * is what its death and its hits look and sound like; on a weapon, its
 * impacts. Everything is client-side presentation: it never changes the
 * simulation, so it is safe to tune freely.
 */
export const feelSchema = z
  .object({
    /** Screen shake added (trauma, 0 to 1; 0.2 is a bump, 0.6 a big hit). */
    shake: z.number().min(0).max(1).optional(),
    /** Hit-stop in seconds (freeze the picture briefly on impact; 0.03 to 0.08 feels good, 0.2 max). */
    hitStop: z.number().min(0).max(0.2, "hitStop is in seconds; 0.2 is the cap").optional(),
    /** Particle burst preset. */
    particles: z.enum(PARTICLE_PRESETS).optional(),
    /** Particle and flash colour. */
    color: colorSchema.optional(),
    /** Decal left on the ground. */
    decal: z.enum(DECAL_PRESETS).optional(),
    /** Sound cue. */
    sound: z.enum(SOUND_CUES).optional(),
    /** White hit flash on damage (default true). */
    flash: z.boolean().optional(),
  })
  .strict();

/** An axis-aligned box on the ground: [x, z, halfX, halfZ] in metres. */
const boxSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().min(0.25).max(120), z.number().min(0.25).max(120)]);

export const placeSchema = z
  .object({
    /**
     * Folder of streamed chunks, relative to the game repo (§8). Reserved:
     * no template streams chunks yet, and the survivor template's arena is
     * built in, so this path is validated but not loaded.
     */
    chunks: z.string().min(1).refine((s) => !s.includes(".."), "chunk paths stay inside the game repo"),
    spawn: vec3Schema,
  })
  .strict();

const xySchema = z.tuple([z.number().min(-100).max(900), z.number().min(-60).max(220)]);
const positive = (what: string, max: number) => z.number().positive(`${what} must be above 0`).max(max, `${what} is at most ${max} m`);

/**
 * Platformer: one course, side view, in metres. x runs right (start to
 * flag), y runs up. Boxes are [x, y, width, height] with [x, y] the
 * bottom-left corner; ledges are [x, y, width] one-way platforms (stand on
 * top, jump up through, Down + Jump drops through).
 */
export const platformLevelSchema = z
  .object({
    /** Shown on the HUD when the round starts ("Mossy Steps"). */
    name: z.string().min(1).max(32).optional(),
    /** Where everyone starts (feet). */
    start: xySchema,
    /** The flag pole's foot: touching it finishes. */
    flag: xySchema,
    /** Below this height a body has fallen (default: 8 m below the lowest block). */
    killY: z.number().min(-80).max(200).optional(),
    blocks: z
      .array(z.tuple([z.number().min(-100).max(900), z.number().min(-60).max(220), positive("block width", 200), positive("block height", 120)]))
      .min(1, "a level needs at least one block to stand on")
      .max(400, "at most 400 blocks a level"),
    ledges: z.array(z.tuple([z.number().min(-100).max(900), z.number().min(-60).max(220), positive("ledge width", 60)])).max(200).default([]),
    /** Spikes, saws, lava: touching one is a fall back to the last checkpoint. */
    hazards: z.array(z.tuple([z.number().min(-100).max(900), z.number().min(-60).max(220), positive("hazard width", 60), positive("hazard height", 20)])).max(200).default([]),
    /** [x, y, power]: landing on one launches you up at `power` m/s (a jump is about 18; 24 is a big launch). */
    springs: z.array(z.tuple([z.number().min(-100).max(900), z.number().min(-60).max(220), z.number().min(8).max(40)])).max(64).default([]),
    /** Moving one-way platforms: `at` [x, y, width], swinging by `to` [dx, dy] and back every `seconds`. */
    movers: z
      .array(
        z
          .object({
            at: z.tuple([z.number().min(-100).max(900), z.number().min(-60).max(220), positive("mover width", 20)]),
            to: z.tuple([z.number().min(-40).max(40), z.number().min(-40).max(40)]),
            seconds: z.number().min(1).max(30),
            /** Where in its swing it starts, 0..1. */
            phase: z.number().min(0).max(1).default(0),
          })
          .strict(),
      )
      .max(32)
      .default([]),
    /** Coin centres [x, y]. Each player collects their own. */
    coins: z.array(xySchema).max(62, "at most 62 coins a level").default([]),
    /** Checkpoint flags (feet) in course order: a fall returns you to the last one you touched. */
    checkpoints: z.array(xySchema).max(16).default([]),
  })
  .strict();

/** Platformer feel numbers (the defaults are tuned; change a few at a time). */
export const motorSchema = z
  .object({
    runSpeed: z.number().min(3).max(14).optional(),
    jumpHeight: z.number().min(1).max(8).optional(),
    timeToApex: z.number().min(0.2).max(0.7).optional(),
    fallGravity: z.number().min(1).max(3).optional(),
    jumpCut: z.number().min(0.2).max(1).optional(),
    coyoteSeconds: z.number().min(0).max(0.25).optional(),
    bufferSeconds: z.number().min(0).max(0.25).optional(),
    airJumps: z.number().int().min(0).max(2).optional(),
    dashSpeed: z.number().min(6).max(30).optional(),
    airAccel: z.number().min(10).max(120).optional(),
    groundAccel: z.number().min(10).max(160).optional(),
  })
  .strict();

/**
 * Racer: one circuit, on the ground plane, in metres. points is the closed
 * centreline in driving order (a smooth curve runs through them); boosts and
 * coins are [lap fraction 0..1, lateral -1..1 of the half width].
 */
export const kartTrackSchema = z
  .object({
    /** Shown on the HUD when the race starts ("Harbour Loop"). */
    name: z.string().min(1).max(32).optional(),
    points: z
      .array(z.tuple([z.number().min(-2000).max(2000), z.number().min(-2000).max(2000)]))
      .min(4, "a track needs at least 4 control points")
      .max(64, "at most 64 control points"),
    /** Asphalt width, m. */
    width: z.number().min(8, "a track is at least 8 m wide").max(30),
    laps: z.number().int().min(1).max(9),
    /** Grass between the asphalt edge and the barrier, m (default 4). */
    verge: z.number().min(1).max(15).optional(),
    boosts: z.array(z.tuple([z.number().min(0).max(1), z.number().min(-1).max(1)])).max(24).default([]),
    coins: z.array(z.tuple([z.number().min(0).max(1), z.number().min(-1).max(1)])).max(62, "at most 62 coins a track").default([]),
  })
  .strict();

/** Racer handling (the defaults are tuned; change a few at a time). */
export const kartTuningSchema = z
  .object({
    topSpeed: z.number().min(10).max(45).optional(),
    accel: z.number().min(8).max(80).optional(),
    turn: z.number().min(1).max(4).optional(),
    grip: z.number().min(3).max(20).optional(),
    driftGrip: z.number().min(0.5).max(6).optional(),
    grass: z.number().min(0.2).max(1).optional(),
    boostSpeed: z.number().min(1).max(1.8).optional(),
  })
  .strict();

export const gameSchema = z
  .object({
    template: z.enum(TEMPLATES),
    style: z.enum(STYLES),
    places: z.record(idSchema, placeSchema).refine((p) => Object.keys(p).length > 0, "declare at least one place"),
    players: z
      .object({
        prefab: assetIdSchema,
        max: z.number().int().min(1).max(100, "an instance holds at most 100 players (spec §7); more players means more instances"),
        /** The weapon every player starts a run with (a declared weapon id). */
        weapon: idSchema.optional(),
        /**
         * XP to go from level L to L+1 is base + growth x (L - 1)^exponent.
         * Default base 5, growth 4, exponent 1. Early levels should come every
         * 6-10 seconds (GAME-DESIGN.md); an exponent of 1.3-1.8 keeps late
         * levels meaningful.
         */
        xp: z
          .object({
            base: z.number().min(1).max(10_000),
            growth: z.number().min(0).max(10_000),
            exponent: z.number().min(0.5, "xp.exponent is between 0.5 and 3").max(3, "xp.exponent is between 0.5 and 3").optional(),
          })
          .strict()
          .optional(),
        /** Card rerolls each player gets per run. Default 1. */
        rerolls: z.number().int().min(0).max(9).optional(),
        /** Pickup (magnet) radius in metres at level 1. Default 3.75. */
        magnet: z.number().min(0.5).max(20, "magnet is in metres; 20 is the cap").optional(),
        /** Seconds a player is immune to contact damage after a contact hit (hit i-frames). Default 0.5; 0 turns them off. */
        hitIframes: z.number().min(0).max(3, "hitIframes is in seconds; 3 is the cap").optional(),
        /**
         * Boss health grows with the players present when it spawns:
         * health x (1 - bossHealthPerPlayer + bossHealthPerPlayer x players). Default 0.55.
         */
        bossHealthPerPlayer: z.number().min(0).max(2).optional(),
        /**
         * Co-op XP: "nearby" (default for survivor games) gives every other
         * living player within 20 m half of each gem; "all" shares it fully;
         * "collector" keeps it with whoever picked it up. The object form sets
         * the fraction and radius.
         */
        share: z
          .union([
            z.enum(["collector", "nearby", "all"], { error: 'share is "collector", "nearby" or "all" (or { mode, fraction, radius })' }),
            z
              .object({
                mode: z.enum(["collector", "nearby", "all"]),
                fraction: z.number().min(0).max(1).default(0.5),
                radius: z.number().min(1).max(100, "radius is in metres; 100 is the cap").default(20),
              })
              .strict(),
          ])
          .optional(),
        /** Critical hits on enemies: chance per hit (0 to 0.5) and damage multiplier. Default none. */
        crit: z
          .object({
            chance: z.number().min(0).max(0.5, "crit.chance is 0 to 0.5"),
            multiplier: z.number().min(1.2).max(5).default(2),
          })
          .strict()
          .optional(),
        /** Co-op: the teammate who revives someone gets a short buff. Default 5 s, damage x1.25, speed x1.15. */
        reviveBuff: z
          .object({
            seconds: z.number().min(0).max(30),
            damage: z.number().min(1).max(3).default(1.25),
            speed: z.number().min(1).max(2).default(1.15),
          })
          .strict()
          .optional(),
        /**
         * Survivor: what going down costs. A downed keeper bleeds for `seconds`
         * and crawls at `crawl` of run speed; teammates revive by standing
         * close. `selfRevives` free get-ups per run (Sprint while downed; an
         * unused one stands you up when the timer runs out). Out of those, a
         * keeper is out for `respawn` seconds, then comes back beside a
         * teammate who is up. Defaults: 10 s, 0.35, 1, 5 s.
         */
        downed: z
          .object({
            seconds: z.number().min(3).max(60).default(10),
            crawl: z.number().min(0).max(1).default(0.35),
            selfRevives: z.number().int().min(0).max(5).default(1),
            respawn: z.number().min(0, "respawn is in seconds; 0 keeps a keeper out until respawnDead()").max(60).default(5),
          })
          .strict()
          .optional(),
        /** Co-op: a player joining a run in progress starts this many levels below the team's average, with that many cards to pick. Default 2. */
        lateJoinBehind: z.number().int().min(0).max(20).optional(),
        /** Arena: the weapons every player carries, slots 1 to 4 (declared weapon ids). */
        loadout: z.array(idSchema).min(1).max(4, "a loadout holds at most 4 weapons").optional(),
        /** Arena: bots fill empty seats up to this many players (0 to 32). They never earn, and killing one pays no earn rule. */
        bots: z.number().int().min(0).max(32).optional(),
        /** Arena: seconds a killed player waits to respawn. Default 3. */
        respawn: z.number().min(0.5).max(30).optional(),
        /** Arena: the pickup prefab a killed player drops; its value is the health it restores. */
        drop: idSchema.optional(),
        // Asset library: how the player's model is dressed (see ./appearance.ts).
        appearance: appearanceSchema.optional(),
      })
      .strict(),
    tickRate: z.union([z.literal(30), z.literal(60)]).optional(),
    /** Arena: the floor, cover and spawn points, in metres. The floor runs from -halfSize to +halfSize on x and z. */
    arena: z
      .object({
        halfSize: z.number().min(10).max(80),
        /** Round pillars of cover: [x, z, radius]. */
        pillars: z.array(z.tuple([z.number().finite(), z.number().finite(), z.number().min(0.3).max(8)])).max(48).default([]),
        /** Respawn points: [x, z]. */
        spawns: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(2, "declare at least 2 spawn points").max(32),
      })
      .strict()
      .optional(),
    /**
     * Survivor: the field, in metres (default 60 with 8 pillars). A bigger
     * field (up to 120) gives moving a value; pillars are [x, z, radius].
     */
    field: z
      .object({
        halfSize: z.number().min(20).max(120),
        pillars: z.array(z.tuple([z.number().finite(), z.number().finite(), z.number().min(0.3).max(8)])).max(64).default([]),
        /**
         * Dungeon walls: boxes [x, z, halfX, halfZ] standing on the floor.
         * Players, enemies and bolts all stop at them. Build them with
         * dungeon(...) rather than by hand.
         */
        walls: z.array(boxSchema).max(800, "800 wall boxes is the cap; merge runs into longer boxes").optional(),
        /**
         * Dungeon floors: rooms and corridors as boxes [x, z, halfX, halfZ].
         * With floors only they are ground: spawns land on them and enemies
         * path between them (round walls, through doors).
         */
        floors: z.array(boxSchema).max(200).optional(),
      })
      .strict()
      .optional(),
    /** Platformer: the courses, raced one a round in this order. */
    levels: z.array(platformLevelSchema).min(1).max(8, "at most 8 levels").optional(),
    /** Platformer: the jump and run feel. */
    motor: motorSchema.optional(),
    /** Racer: the circuits, raced one a round in this order. */
    tracks: z.array(kartTrackSchema).min(1).max(8, "at most 8 tracks").optional(),
    /** Racer: the karts' handling. */
    kart: kartTuningSchema.optional(),
    /** Arena: a round ends after `seconds`, or when a player reaches `frags` kills. Platformer and racer: the round's time limit. */
    round: z
      .object({
        seconds: z.number().min(60, "rounds are at least 60 seconds").max(600, "rounds are at most 10 minutes"),
        frags: z.number().int().min(1).max(500).optional(),
      })
      .strict()
      .optional(),
    /** How the game looks: lighting preset, bloom, shadows, fog, outline, grading. */
    look: lookSchema.optional(),
  })
  .strict();

/**
 * Enemy behaviours the sim runs (roles). Every big hit is telegraphed with
 * a ground marker that fills before it lands.
 *  - chase (default): runs at the nearest player. tank: chase, for slow heavy prefabs (give it mass).
 *  - idle / none: stands still.
 *  - runner: aims where the player will be in 0.5 s. Fast and fragile.
 *  - charger: inside attack.range (6 m) stops, shows a lane for 0.55 s, dashes 3.4x along it for 0.6 s, recovers 1 s.
 *  - ranged: keeps ~80% of attack.range (10 m), backs off, shows an aim line 0.3 s, fires a slow shot (attack.speed 7 m/s).
 *  - bomber: next to a player stops, arms a 1 s fuse circle (attack.radius 2.5 m), explodes for 1.4x damage; the blast hurts enemies too.
 *  - shielder: every 6 s shields the 6 nearest allies for 35% of their health, 8 s.
 *  - healer: every 3.5 s heals the 6 nearest allies 7%.
 *  - summoner: keeps its distance and calls attack.count (2) attack.summon adds every 7 s, at most 4 alive.
 *  - flee: runs from the nearest player. wander: drifts.
 * Anything else is rejected at build time, never silently ignored.
 */
export const AI_BEHAVIOURS = ["none", "chase", "idle", "tank", "runner", "charger", "ranged", "bomber", "shielder", "healer", "summoner", "flee", "wander"] as const;

/** Attacks a boss can declare. Each one is telegraphed. */
export const BOSS_ATTACKS = ["slam", "dash", "leap", "rain", "ring", "fan", "summon"] as const;

/** Numbers for an enemy's role attack (all optional; the role's defaults fill the rest). Seconds and metres. */
export const attackSchema = z
  .object({
    damage: z.number().min(0).max(1_000_000).optional(),
    range: z.number().min(0.5).max(40).optional(),
    windup: z.number().min(0.2, "a telegraph shorter than 0.2 s cannot be read; use 0.3 s or more").max(5).optional(),
    cooldown: z.number().min(0.2).max(60).optional(),
    speed: z.number().min(0.5).max(40).optional(),
    radius: z.number().min(0.3).max(12).optional(),
    /** summoner: the enemy prefab it calls. */
    summon: idSchema.optional(),
    /** summoner: adds per call; shielder and healer: allies affected. */
    count: z.number().int().min(1).max(12).optional(),
  })
  .strict();

/**
 * A boss's patterns: it alternates near and far modes every 4-9 s and picks
 * telegraphed attacks: slam (circle around it, 0.85 s), dash (11 m lane,
 * 0.75 s), leap (lands on a circle at the target, 1.15 s), rain (4 circles
 * near players), ring (14 shots outward), fan (7 shots at the target),
 * summon (adds). Below enrageAt of its health it moves 15% faster, winds up
 * 20% quicker and throws more. A "mini" boss raises "miniboss.killed" when
 * it dies; a "final" boss (default) raises "boss.killed".
 */
export const bossSchema = z
  .object({
    attacks: z.array(z.enum(BOSS_ATTACKS, { error: `boss attacks are: ${BOSS_ATTACKS.join(", ")}` })).min(1).max(7),
    enrageAt: z.number().min(0).max(1).default(0.5),
    /** The enemy prefab "summon" calls. */
    summon: idSchema.optional(),
    rank: z.enum(["final", "mini"]).default("final"),
  })
  .strict();

export const prefabSchema = z
  .object({
    model: assetIdSchema,
    health: z.number().int().min(1).max(1_000_000),
    speed: z.number().min(0).max(50, "speed is in metres per second; 50 is the cap"),
    /** Behaviour (role); enemies default to "chase". See AI_BEHAVIOURS. */
    ai: z.enum(AI_BEHAVIOURS, { error: `ai is one of: ${AI_BEHAVIOURS.join(", ")}. Unknown behaviours are rejected, not ignored.` }).optional(),
    /** The role's attack numbers (charger, ranged, bomber, support, summoner). */
    attack: attackSchema.optional(),
    /** On death, `count` (1-4) enemies of prefab `into` burst out where it fell. */
    split: z.object({ into: idSchema, count: z.number().int().min(1).max(4) }).strict().optional(),
    radius: z.number().min(0.05).max(20).optional(),
    damage: z.number().int().min(0).max(1_000_000).optional(),
    /**
     * What it drops: pickup ids (XP gems always drop), or { id, chance }
     * for special pickups (heals, vacuums, bombs, chests) on a 0..1 chance.
     */
    drops: z.array(z.union([idSchema, z.object({ id: idSchema, chance: z.number().min(0).max(1) }).strict()])).max(16).default([]),
    /** Pickups: what it does when collected (default: an XP gem worth `value`). */
    pickup: z
      .object({
        effect: z.enum(["heal", "vacuum", "bomb", "chest"], { error: "pickup effects: heal, vacuum (pulls every gem), bomb (clears the screen), chest (card picks)" }),
        /** heal: fraction of max health (0..1) or hit points; chest: card picks (1-3). */
        amount: z.number().min(0).max(100_000).optional(),
        /** chest: a boss chest. A weapon the player holds with its paired passive jumps to max level, so its evolution is on the cards. Bosses drop it instead of the plain chest. */
        evolve: z.boolean().optional(),
      })
      .strict()
      .optional(),
    /** Enemies: a breakable prop (urn, lantern) that never moves or hurts; scatter it from a system. */
    prop: z.boolean().optional(),
    /** "enemy" (default) or "pickup". A prefab another prefab drops is a pickup unless it says otherwise. */
    kind: z.enum(["enemy", "pickup"]).optional(),
    /** Pickups: the XP the gem is worth (default 1). */
    value: z.number().int().min(0).max(100_000).optional(),
    /**
     * Enemies: a boss (heavy, a HUD bar, a gem burst worth 1-2 levels).
     * true: a plain final boss that chases; or { attacks, enrageAt, summon, rank } for a pattern fight.
     */
    boss: z
      .union([z.boolean(), bossSchema], {
        error: `boss is true, or { attacks: [...], enrageAt, summon, rank } with attacks from: ${BOSS_ATTACKS.join(", ")}`,
      })
      .optional(),
    /** Enemies: knockback resistance (default 1, bosses 20). Knockback divides by it; above about 8 an enemy shrugs off light hits. */
    mass: z.number().min(0.1).max(1000).optional(),
    /** How its hits and its death look and sound (client-side only). */
    feel: feelSchema.optional(),
    // Asset library: how the model is dressed (see ./appearance.ts).
    appearance: appearanceSchema.optional(),
  })
  .strict();

export const WEAPON_KINDS = ["nova", "bolt", "orbit", "blaster", "beam", "cone", "chain", "aura", "meteor", "boomerang"] as const;

/** Numbers a weapon level can change. */
export const LEVEL_FIELDS = ["damage", "cooldown", "count", "pierce", "range", "speed", "knockback", "spread"] as const;

/**
 * One weapon level: what changes from the level before. A number adds
 * (count: 1, pierce: 1, cooldown: -0.1 seconds), a percent string scales
 * ("+40%" damage, "-20%" cooldown). Cards show these changes.
 */
const levelChange = z.union([z.number().finite(), z.string().regex(/^[+-]\d+(\.\d+)?%$/, 'percent changes look like "+40%" or "-20%"')]).optional();
export const weaponLevelSchema = z
  .object({
    damage: levelChange,
    cooldown: levelChange,
    count: levelChange,
    pierce: levelChange,
    range: levelChange,
    speed: levelChange,
    knockback: levelChange,
    spread: levelChange,
  })
  .strict()
  .refine((r) => Object.values(r).some((v) => v !== undefined), `a level changes at least one of: ${LEVEL_FIELDS.join(", ")}`);

/**
 * A weapon.
 * Survivor template (fires by itself):
 *  - nova: hits every enemy within `range` m, every `cooldown` s, when one is in range;
 *  - bolt: shoots `count` projectiles at the nearest enemy within `range` m at `speed` m/s, each passing through `pierce` enemies;
 *  - orbit: `count` blades circle at `range` m, `speed` rad/s, hitting what they touch;
 *  - cone: sweeps `spread` degrees (360: all around) where the player faces, `range` m deep;
 *  - chain: strikes the nearest enemy in `range`, then jumps `count` times to the nearest enemy within `speed` m (default 4);
 *  - aura: a field of `range` m around the player, damaging everything inside every `cooldown` s;
 *  - meteor: `count` circles of `blast` m land on random enemies within `range` m, 0.6 s after they show;
 *  - boomerang: `count` blades fly out `range` m at `speed` m/s and come back, hitting everything both ways.
 * levels: [...] declares each level's change (see weaponLevelSchema); without it each level adds 25%
 * damage, cuts cooldowns 6%, adds a projectile or blade every second level and grows novas and auras 8%.
 * evolve: { into, requires }: at max level, with the passive `requires` taken, the evolution card
 * always shows; the weapon `into` (declared like any weapon, never offered on its own) replaces it.
 * Arena template (fires while the player holds fire, along their aim):
 *  - blaster: `count` projectiles fanned over `spread` degrees at `speed` m/s for `range` m;
 *  - beam: an instant hit to `range` m, stopped by pillars (lag-compensated on the server);
 *  - nova: hits every opponent within `range` m.
 */
export const weaponSchema = z
  .object({
    model: assetIdSchema.optional(),
    kind: z.enum(WEAPON_KINDS),
    damage: z.number().min(0).max(1_000_000),
    cooldown: z.number().min(1 / 30, "cooldown is in seconds; the floor is one tick (1/30 s)").max(8),
    range: z.number().min(0.5).max(40, "range is in metres; 40 is the cap"),
    count: z.number().int().min(1).max(16).default(1),
    speed: z.number().min(0).max(80).optional(),
    pierce: z.number().int().min(0).max(255).default(0),
    /** Metres per second pushed into each enemy it hits (divided by the enemy's mass). Enemies knocked hard stagger, slide, bounce off pillars and shove the enemies behind them. */
    knockback: z.number().min(0).max(50).default(2),
    /** Default 8, or levels.length + 1 when levels are declared. */
    maxLevel: z.number().int().min(1).max(15).optional(),
    /** Arena blaster: the fan of `count` projectiles; cone: the sweep (360: all around). Degrees. */
    spread: z.number().min(0).max(360).optional(),
    /** Meteor: blast radius, m (default 1.6). */
    blast: z.number().min(0.3).max(12).optional(),
    /** What each level changes, from level 2 up: [{ count: 1 }, { damage: "+40%" }, { cooldown: "-20%" }, ...]. */
    levels: z.array(weaponLevelSchema).min(1).max(14).optional(),
    /** Evolution: { into: weapon id, requires: upgrade id }. */
    evolve: z.object({ into: idSchema, requires: idSchema }).strict().optional(),
    /** How its impacts look and sound (client-side only). */
    feel: feelSchema.optional(),
  })
  .strict();

export const STAT_KINDS = ["speed", "maxHealth", "magnet", "might", "haste", "regen", "armor", "area", "amount"] as const;

/**
 * A passive upgrade offered at level-up. Per level: speed and might
 * multiply by (1 + step x level); haste cuts cooldowns by step x level;
 * maxHealth and magnet (m) add step x level; regen heals step x level per
 * second; armor removes step x level from each hit (floor 1); area grows
 * novas, auras, cones, meteors and orbits by (1 + step x level); amount adds
 * step x level projectiles, blades, jumps or meteors. Up to 8 passives.
 */
export const upgradeSchema = z
  .object({
    stat: z.enum(STAT_KINDS),
    step: z.number().min(0).max(1000),
    maxLevel: z.number().int().min(1).max(15).default(5),
  })
  .strict();

/**
 * A value over run time: a constant, or keyframes [[seconds, value], ...]
 * in increasing time, linear between them and held after the last one.
 * "Make it harder" is a matter of raising the values.
 */
export const curveSchema = z.union([
  z.number().min(0).max(100_000),
  z
    .array(z.tuple([z.number().min(0, "keyframe times are seconds from the run start"), z.number().min(0).max(100_000)]))
    .min(1, "a curve needs at least one [seconds, value] keyframe")
    .max(32, "at most 32 keyframes")
    .refine((k) => k.every((p, i) => i === 0 || p[0] > (k[i - 1]?.[0] ?? -1)), "keyframe times must increase: [[0, 1], [60, 2], ...]"),
]);

/** One enemy the director can spawn, and when. */
export const directorEntrySchema = z
  .object({
    /** An enemy prefab id. */
    prefab: idSchema,
    /** Relative pick weight (default 1). */
    weight: z.number().positive().max(1000).default(1),
    /** Seconds into the run it joins the pool (default 0). */
    from: z.number().min(0).default(0),
    /** Seconds into the run it leaves the pool (default never). */
    until: z.number().min(0).optional(),
    /** Spawned together from one direction: a fixed size or [min, max] (default 1). A stream of 8-12 runners reads as one threat. */
    group: z.union([z.number().int().min(1).max(200), z.tuple([z.number().int().min(1).max(200), z.number().int().min(1).max(200)])]).default(1),
  })
  .strict();

/**
 * The spawn director: one per game. It replaces "top the crowd up to N"
 * loops. Every tick it spawns enemies from `pool` at `rate` per second,
 * up to `alive` living enemies, just outside each player's screen (never
 * on it), with new enemies' health, damage and XP scaled by the curves.
 * More players raise `alive` and `rate` by `perPlayer` each; a living boss
 * multiplies `rate` by `whileBoss`. At the cap, the bodies it could not
 * spawn become `crowded` multipliers on the next spawns (tougher, not
 * more). Stragglers far off screen are moved back to the edge ahead of a
 * moving player (`recycle`).
 */
export const directorSchema = z
  .object({
    /** Living enemies to aim for (one player). */
    alive: curveSchema,
    /** Spawns per second (one player). */
    rate: curveSchema,
    /** New enemies' health, damage and gem XP multipliers. Default 1. */
    health: curveSchema.default(1),
    damage: curveSchema.default(1),
    xp: curveSchema.default(1),
    /** Every non-boss enemy's speed multiplier over the run (0.25 to 3). Default 1. Late swarms that close in faster make kiting harder. */
    speed: curveSchema.default(1),
    pool: z.array(directorEntrySchema).min(1, "the director needs at least one enemy in its pool").max(32),
    /** Pool entries older than `after` seconds (since their `from`) pick at weight x `weight`, so the mix keeps changing. */
    fade: z.object({ after: z.number().min(1), weight: z.number().min(0).max(1) }).strict().optional(),
    /** Each player past the first adds this fraction to `alive` and `rate`. Default 0.6. */
    perPlayer: z.number().min(0).max(2).default(0.6),
    /** Rate multiplier while any boss is alive. Default 0.5. */
    whileBoss: z.number().min(0).max(1).default(0.5),
    /** Multipliers a spawn gets for each body the cap held back. Default health 1.6, damage 1.25, xp 1.6. */
    crowded: z
      .object({ health: z.number().min(1).max(10).default(1.6), damage: z.number().min(1).max(10).default(1.25), xp: z.number().min(1).max(10).default(1.6) })
      .strict()
      .default({ health: 1.6, damage: 1.25, xp: 1.6 }),
    /** Move stragglers far off screen back to the edge: after `seconds` beyond the view plus `margin` m. Default on, 2.5 s, 8 m. */
    recycle: z
      .union([z.boolean(), z.object({ seconds: z.number().min(0.5).max(30).default(2.5), margin: z.number().min(0).max(40).default(8) }).strict()])
      .default(true),
    /** Elites from the current pool: the first at `from` seconds, then one every `every` [min, max] seconds. */
    elites: z
      .object({ from: z.number().min(0), every: z.tuple([z.number().min(5), z.number().min(5)]) })
      .strict()
      .refine((e) => e.every[0] <= e.every[1], "elites.every is [min, max] seconds")
      .optional(),
    /** Share of spawns placed ahead of a moving player (0 to 1, default 0.35): pressure meets you instead of trailing you. */
    ahead: z.number().min(0).max(1).default(0.35),
    /** Enemies spawned at once when the run starts (default 0). */
    start: z.number().int().min(0).max(100).default(0),
    /** Hard cap on living enemies, whatever the curves say (default 2000). */
    max: z.number().int().min(1).max(2000, "2,000 living enemies is the template's cap").default(2000),
  })
  .strict();

export const earnRuleSchema = z
  .object({
    /** A game event name, e.g. "wave.cleared". The room server is the referee (§11). */
    when: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "events are dotted names like \"wave.cleared\""),
    /** Fire when the event's count reaches n (e.g. the 10th wave). */
    n: z.number().int().min(1).default(1),
    /** Coins paid (1 coin = 1 game token, shown under the token's own name and symbol). */
    pay: z.number().positive(),
    oncePer: z.enum(["run", "day", "lifetime"]),
  })
  .strict();

/**
 * Buy-in runs, the mandatory sink loop (the sink loop is a
 * stake). Earning above free play needs a
 * stake of the game's coins at run start. The referee fixes the stake when
 * the run starts (server state, never the client). A staked run pays its
 * free earn as usual plus a share of `stake x multiple`: the share is the
 * part of the run's free earn the player actually made (skill decides it).
 * What the run does not win back stays in the RewardVault for other
 * players. Every game declares one, on one line in game.ts:
 * `earn.stake({ min: 20, max: 200, multiple: 2 });`
 */
/** PLACEHOLDER: the most a stake's payout ceiling may be, as a multiple of the stake. */
export const STAKE_MAX_MULTIPLE = 2;
/** Highest stake one run may take, in coins (the source reader's bound too). */
export const STAKE_MAX_COINS = 1_000_000;

export const earnStakeSchema = z
  .object({
    /** Smallest stake a run takes, in coins. */
    min: z.number().positive().max(STAKE_MAX_COINS),
    /** Largest stake a run takes, in coins. */
    max: z.number().positive().max(STAKE_MAX_COINS),
    /** The stake's payout ceiling is stake x multiple (1 to STAKE_MAX_MULTIPLE). */
    multiple: z.number().min(1).max(STAKE_MAX_MULTIPLE, `the payout ceiling is at most ${STAKE_MAX_MULTIPLE}x the stake`),
  })
  .strict()
  .refine((s) => s.min <= s.max, "stake min must not be above max")
  .refine((s) => [s.min, s.max].every((v) => Math.round(v * 1e6) / 1e6 === v), "stakes have up to 6 decimals")
  .refine((s) => Math.round(s.multiple * 100) / 100 === s.multiple, "multiple has up to 2 decimals");

/**
 * PvP pots (the sink loop), for player-versus-
 * player games (the arena template). Each player who wants in pays the
 * same `entry` in coins before a round; at the round's end the pot, less
 * the `recycle` share that stays in the reward pool, is split by how much
 * of the round's earn each entrant made (the room's verified units, never
 * a draw). A round where no entrant earned recycles the whole pot.
 */
export const earnPotSchema = z
  .object({
    /** Coins each entrant pays in. */
    entry: z.number().positive().max(STAKE_MAX_COINS),
    /** Share of every pot that stays in the reward pool (0.01 to 0.5). */
    recycle: z.number().min(0.01).max(0.5),
    /**
     * Pots are OFF by default until a legal review clears
     * them. A declared pot runs only with `enabled: true`; without it the
     * terms are kept for later and no room takes an entry.
     */
    enabled: z.boolean().default(false),
  })
  .strict();

/**
 * What buying a SKU gives (the recommended coin model). Leave `grants` out for an in-run consumable: a
 * room command applied once ("revive", or a run upgrade named after a
 * declared passive). `{ cosmetic: n }` is a look the player owns for good
 * (cosmetic id n, drawn by the client). `{ keeper: id }` unlocks a keeper
 * for good: a character, a starting loadout or a sidegrade, never more
 * power than the keepers anyone can earn. Owned grants live in the
 * player's profile on the room server, never in the browser.
 */
export const skuGrantSchema = z.union([
  z.object({ cosmetic: z.number().int().min(1, "cosmetic 0 is the default look; number owned looks from 1").max(255) }).strict(),
  z.object({ keeper: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, "a keeper id") }).strict(),
  /**
   * Losable gear (the sink loop): owned in the
   * profile, it brings one level of the named run upgrade into every
   * STAKED run, and is lost when that run makes less than `loseBelow` of
   * its most earn (0 to 1). Its coins stayed in the reward pool when it
   * was bought, so a lost piece needs no transfer to recycle.
   */
  z
    .object({
      gear: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/, "an upgrade id"),
      loseBelow: z.number().min(0).max(1),
    })
    .strict(),
]);

/**
 * A store item. Every game has coins (1 coin = 1 game token, shown under
 * the token's own name, symbol and logo): price cosmetics, unlocks and
 * in-run consumables in `coins`. Players spend earned coins first, off
 * chain, then their wallet. `usdg` sells the item for dollars as well.
 * `token` is the old name for `coins` and reads as coins. Permanent stat
 * power is never a SKU: it is a metaUpgrade, opt-in through economy().
 */
export const skuSchema = z
  .object({
    /** Price in coins (whole coins, 1 coin = 1 game token). */
    coins: z.number().int().min(1).max(1_000_000).optional(),
    /** Price in USDG. */
    usdg: z.number().min(0).max(1000).optional(),
    /** @deprecated Use `coins`. */
    token: z.number().int().min(1).max(1_000_000).optional(),
    /** What it gives for good: { cosmetic: n } or { keeper: id }. Omit for an in-run consumable. */
    grants: skuGrantSchema.optional(),
  })
  .strict()
  .refine((s) => !(s.coins !== undefined && s.token !== undefined), "use coins only (token is the old name for coins)")
  .refine((s) => s.usdg !== undefined || s.coins !== undefined || s.token !== undefined, "a SKU needs a coins price, a usdg price, or both")
  .transform((s) => ({
    ...(s.coins !== undefined || s.token !== undefined ? { coins: (s.coins ?? s.token) as number } : {}),
    ...(s.usdg !== undefined ? { usdg: s.usdg } : {}),
    ...(s.grants !== undefined ? { grants: s.grants } : {}),
  }));

/**
 * The game's coin model. The
 * default needs no declaration: coins buy cosmetics, unlocks (keepers,
 * starting loadouts, sidegrades) and in-run consumables (a revive), and
 * never permanent stat power.
 *   economy({ store: "cosmetics" })     cosmetics only: no unlocks, no consumables.
 *   economy({ metaUpgrades: true })     opt in to metaUpgrade(...): permanent stat
 *                                       upgrades for coins, under the engine's caps.
 */
export const economySchema = z
  .object({
    /** "default": cosmetics, unlocks and consumables. "cosmetics": cosmetics only. */
    store: z.enum(["default", "cosmetics"]).default("default"),
    /** Permanent stat upgrades priced in coins (metaUpgrade). Off unless declared; never with store "cosmetics". */
    metaUpgrades: z.boolean().default(false),
  })
  .strict()
  .refine((e) => !(e.store === "cosmetics" && e.metaUpgrades), "a cosmetics-only store sells no meta upgrades");

/** Stats a meta upgrade may raise (each a percentage of the base). */
export const META_STATS = ["speed", "maxHealth", "magnet", "might", "haste", "area"] as const;
/** Hard caps (engine-enforced, not a game setting): +15% to any one stat from meta upgrades, +30% across all of them. */
export const META_MAX_PER_STAT = 0.15;
export const META_MAX_TOTAL = 0.3;
/** Most levels of one meta upgrade, most meta upgrades per game, and the slowest cost growth (geometric). */
export const META_MAX_LEVELS = 5;
export const META_MAX_UPGRADES = 8;
export const META_MIN_GROWTH = 1.5;

/**
 * A meta upgrade (opt-in: economy({ metaUpgrades: true })): a permanent,
 * per-player stat bonus bought with coins, one level at a time. Level k
 * costs round(cost x growth^(k-1)) coins and adds `step` (0.05 = +5%) to
 * `stat`. speed, might and area multiply; haste cuts cooldowns; maxHealth
 * and magnet add that share of the base. The engine caps the sum per stat
 * at +15% and across stats at +30%, and the store shows each level's
 * bonus and price.
 */
export const metaUpgradeSchema = z
  .object({
    stat: z.enum(META_STATS),
    /** Bonus per level as a fraction: 0.05 is +5%. */
    step: z.number().positive().max(META_MAX_PER_STAT, "one level adds at most +15%"),
    levels: z.number().int().min(1).max(META_MAX_LEVELS, `at most ${META_MAX_LEVELS} levels`),
    /** Coins for the first level. */
    cost: z.number().int().min(1).max(1_000_000),
    /** Each level costs this many times the last (geometric, at least 1.5). */
    growth: z.number().min(META_MIN_GROWTH, `meta costs grow geometrically: growth at least ${META_MIN_GROWTH}`).max(4).default(2),
  })
  .strict()
  .refine((m) => m.step * m.levels <= META_MAX_PER_STAT + 1e-9, "step x levels must stay within +15% (META_MAX_PER_STAT)");

/**
 * A keeper (a playable character): its start weapon and one signature
 * passive at level 1. `unlock` names an achievement that unlocks it (no
 * unlock and not sold: available from the start). A keeper declared with
 * no unlock can instead be sold for coins by a store SKU with
 * { grants: { keeper } }; it is earned or bought, never both. The first
 * keeper is everyone's default and is always free.
 */
export const keeperSchema = z
  .object({
    name: z.string().min(1).max(24),
    /** One line under the name on the picker. */
    text: z.string().max(80).optional(),
    /** The keeper's model (defaults to players.prefab) and tint. */
    model: assetIdSchema.optional(),
    tint: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colours are "#rrggbb", e.g. "#ffd23f"').optional(),
    weapon: idSchema,
    passive: idSchema.optional(),
    unlock: idSchema.optional(),
  })
  .strict();

const eventName = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, 'events are dotted names like "player.evolved"');

/**
 * An achievement: a player reaches it when their count of `when` reaches
 * `n` in one run ("evolve a weapon": { when: "player.evolved" }). It pays
 * nothing; keepers can unlock with it.
 */
export const achievementSchema = z
  .object({
    title: z.string().min(1).max(32),
    text: z.string().max(80).optional(),
    when: eventName,
    n: z.number().int().min(1).max(100_000).default(1),
  })
  .strict();

/**
 * A daily goal ("kill an elite", "survive a Tide"): the HUD shows a few
 * each day, chosen from those declared, with each player's count of `when`
 * in the run. It pays nothing (coin rewards are earn rules).
 */
export const missionSchema = z
  .object({
    text: z.string().min(1).max(60),
    when: eventName,
    n: z.number().int().min(1).max(100_000).default(1),
  })
  .strict();

/** What end-screen titles rank players by. */
export const TITLE_STATS = ["kills", "damage", "revives", "downs", "level", "pickups"] as const;

/** An end-screen title: who had the most (or the least) of a stat this run ("The Butcher": { most: "kills" }). */
export const titleSchema = z
  .object({
    text: z.string().min(1).max(32),
    most: z.enum(TITLE_STATS).optional(),
    least: z.enum(TITLE_STATS).optional(),
  })
  .strict()
  .refine((t) => (t.most === undefined) !== (t.least === undefined), "a title ranks by exactly one of most or least");

export type SkuGrant = z.output<typeof skuGrantSchema>;
export type EconomyInput = z.input<typeof economySchema>;
export type EconomyDef = z.output<typeof economySchema>;
export type MetaUpgradeInput = z.input<typeof metaUpgradeSchema>;
export type MetaUpgradeDef = z.output<typeof metaUpgradeSchema>;
export type MetaStat = (typeof META_STATS)[number];
export type KeeperInput = z.input<typeof keeperSchema>;
export type KeeperDef = z.output<typeof keeperSchema>;
export type AchievementInput = z.input<typeof achievementSchema>;
export type AchievementDef = z.output<typeof achievementSchema>;
export type MissionInput = z.input<typeof missionSchema>;
export type MissionDef = z.output<typeof missionSchema>;
export type TitleInput = z.input<typeof titleSchema>;
export type TitleDef = z.output<typeof titleSchema>;
export type TitleStat = (typeof TITLE_STATS)[number];

export type CurveInput = z.input<typeof curveSchema>;
export type Curve = z.output<typeof curveSchema>;
export type DirectorInput = z.input<typeof directorSchema>;
export type DirectorDef = z.output<typeof directorSchema>;
export type LookInput = z.input<typeof lookSchema>;
export type LookDef = z.output<typeof lookSchema>;
export type FeelDef = z.output<typeof feelSchema>;
export type LookPreset = (typeof LOOK_PRESETS)[number];
export type ParticlePreset = (typeof PARTICLE_PRESETS)[number];
export type DecalPreset = (typeof DECAL_PRESETS)[number];
export type SoundCue = (typeof SOUND_CUES)[number];
export type GameInput = z.input<typeof gameSchema>;
export type GameDef = z.output<typeof gameSchema>;
export type PrefabInput = z.input<typeof prefabSchema>;
export type PrefabDef = z.output<typeof prefabSchema>;
export type EarnRuleInput = z.input<typeof earnRuleSchema>;
export type EarnRuleDef = z.output<typeof earnRuleSchema>;
export type EarnStakeInput = z.input<typeof earnStakeSchema>;
export type EarnStakeDef = z.output<typeof earnStakeSchema>;
export type EarnPotInput = z.input<typeof earnPotSchema>;
export type EarnPotDef = z.output<typeof earnPotSchema>;
export type SkuInput = z.input<typeof skuSchema>;
export type WeaponInput = z.input<typeof weaponSchema>;
export type WeaponDef = z.output<typeof weaponSchema>;
export type UpgradeInput = z.input<typeof upgradeSchema>;
export type UpgradeDef = z.output<typeof upgradeSchema>;
export type SkuDef = z.output<typeof skuSchema>;
export type AssetId = string;
export type Template = (typeof TEMPLATES)[number];
export type Style = (typeof STYLES)[number];

/** Thrown for any invalid declaration; `issues` are agent-readable lines. */
export class GameDefinitionError extends Error {
  readonly issues: readonly string[];
  constructor(where: string, issues: readonly string[]) {
    super(`${where}:\n  - ${issues.join("\n  - ")}`);
    this.name = "GameDefinitionError";
    this.issues = issues;
  }
}

export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown, where: string): z.output<S> {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  throw new GameDefinitionError(
    where,
    r.error.issues.map((i) => `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`),
  );
}
export type PlatformLevelInput = z.input<typeof platformLevelSchema>;
export type PlatformLevelDef = z.output<typeof platformLevelSchema>;
export type MotorDef = z.output<typeof motorSchema>;
export type KartTrackInput = z.input<typeof kartTrackSchema>;
export type KartTrackDefSchema = z.output<typeof kartTrackSchema>;
