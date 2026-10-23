/**
 * EMBERWATCH: the survivor-like co-op template.
 *
 * One lantern against the dark, growing into a bonfire. Four keepers hold
 * a field at night. The opening is a handful of shades; the swarm grows by
 * the minute until thousands flood the field, and at ten minutes the Bell
 * Warden comes. Weapons fire by themselves; gems from fallen enemies level
 * you up; pick one of three upgrades; stand next to a downed teammate to
 * revive them.
 *
 * This file is the whole game as the model writes it: declarations only,
 * against the typed API in @netforge/engine. Everything else (sim,
 * netcode, renderer, referee) is the template's machinery. Design rules:
 * packages/engine/GAME-DESIGN.md.
 */
import { achievement, director, earn, game, keeper, mission, prefab, store, system, title, upgrade, weapon } from "@netforge/engine";

export default game({
  template: "survivor",
  style: "lowpoly",
  places: { field: { chunks: "places/field", spawn: [0, 1, 0] } },
  // A 150 x 150 m field: room to move, with stone pillars to kite around.
  field: {
    halfSize: 75,
    pillars: [
      [14, 14, 2], [-14, 14, 2], [14, -14, 2], [-14, -14, 2],
      [32, 0, 3], [-32, 0, 3], [0, 32, 3], [0, -32, 3],
      [55, 40, 3], [-55, 40, 3], [55, -40, 3], [-55, -40, 3],
      [40, 62, 2.5], [-40, 62, 2.5], [40, -62, 2.5], [-40, -62, 2.5],
      [66, 0, 3], [-66, 0, 3], [0, 66, 3], [0, -66, 3],
    ],
  },
  players: {
    prefab: "style.lowpoly.hooded_adventurer",
    max: 4,
    weapon: "ember_nova",
    // Level 2 after 2 gems, then a level every 6-10 s early; the exponent keeps late levels meaningful.
    xp: { base: 2, growth: 2, exponent: 2.6 },
    magnet: 4,
    hitIframes: 0.7,
    // Co-op: half of every gem goes to teammates within 20 m, so the team levels together.
    share: "nearby",
    // One hit in twelve lands twice as hard (the numbers show it in gold).
    crit: { chance: 0.08, multiplier: 2 },
    // Whoever revives a teammate burns hotter for a few seconds.
    reviveBuff: { seconds: 5, damage: 1.3, speed: 1.15 },
    // Bosses grow 40% per extra keeper (a squad spreads its fire; 55% made the first fight drag in co-op).
    bossHealthPerPlayer: 0.4,
    // Going down is short: 10 s downed (you can crawl), one free get-up a run (Space), then back in 5 s beside a teammate.
    downed: { seconds: 10, crawl: 0.35, selfRevives: 1, respawn: 5 },
  },
});

// Enemies. Health in hit points, speed in m/s (keepers run at 7), radius in m, damage per touch.
// Each role joins the run on its own minute (see the director), one new idea at a time.
// Fodder sometimes drops a meal (heal), a lodestar (pulls every gem) or a flare (clears the screen).
const LUCK = [{ id: "hearth_meal", chance: 0.012 }, { id: "lodestar", chance: 0.008 }, { id: "flare", chance: 0.006 }];
// The first enemies are warm embers-gone-wrong: orange against the cold floor, so you read them at a glance.
prefab("shade", { model: "style.lowpoly.ghost", appearance: { tint: "#ff8a3d", accent: "#ffd27a" }, health: 20, speed: 3.8, radius: 0.35, damage: 6, ai: "chase", drops: ["ember_small", ...LUCK] });
prefab("gnat", { model: "style.lowpoly.bee", appearance: { tint: "#ffc24a" }, health: 9, speed: 5.6, radius: 0.25, damage: 3, ai: "runner", drops: ["ember_small", ...LUCK] });
prefab("husk", { model: "style.lowpoly.mushroom_imp", health: 45, speed: 2.6, radius: 0.5, damage: 10, ai: "tank", mass: 3, drops: ["ember_mid"] });
prefab("spitter", { model: "style.lowpoly.frog", appearance: { tint: "#6f9a4e", scale: 0.4 }, health: 20, speed: 2.8, radius: 0.4, damage: 5, ai: "ranged", attack: { damage: 8, range: 10, speed: 7 }, drops: ["ember_small"] });
prefab("ram", { model: "style.lowpoly.triceratops", health: 40, speed: 3, radius: 0.45, damage: 12, ai: "charger", drops: ["ember_mid"] });
prefab("bloat", { model: "style.lowpoly.slime_pink", health: 18, speed: 3.2, radius: 0.45, damage: 8, ai: "bomber", attack: { radius: 2.5, damage: 28 }, drops: ["ember_small"] });
prefab("aegis", { model: "style.lowpoly.mech", health: 35, speed: 3, radius: 0.4, damage: 6, ai: "shielder", drops: ["ember_mid"] });
prefab("mender", { model: "style.lowpoly.blob_wizard", health: 30, speed: 3, radius: 0.4, damage: 6, ai: "healer", drops: ["ember_mid"] });
prefab("brute", { model: "style.lowpoly.orc_brute", health: 160, speed: 2.2, radius: 0.8, damage: 18, ai: "tank", mass: 6, drops: ["ember_mid", "ember_mid"] });
prefab("brood", { model: "style.lowpoly.slime_green", health: 40, speed: 3, radius: 0.5, damage: 8, ai: "chase", split: { into: "shade", count: 3 }, drops: ["ember_small"] });
prefab("caller", { model: "style.lowpoly.imp", health: 45, speed: 2.6, radius: 0.4, damage: 6, ai: "summoner", attack: { summon: "gnat", count: 2 }, drops: ["ember_mid"] });

// Bosses. The Ash Matron at 1:45, the Gloam Ram at 4:30, the Bell Warden at 10:00. Every attack is telegraphed.
// The Matron is the first real fight: a winged silhouette no mob shares, two attacks to learn
// (a slam ring around her, a fan of embers at you), about 45 s solo, and a hoard chest when she falls.
prefab("ash_matron", {
  model: "style.lowpoly.dragon",
  appearance: { tint: "#5d5551", accent: "#ff6a2a" },
  health: 290,
  speed: 2.6,
  radius: 1.5,
  damage: 16,
  boss: { attacks: ["slam", "fan"], rank: "mini" },
  drops: ["ember_large"],
});
prefab("gloam_ram", {
  model: "style.lowpoly.trex",
  appearance: { tint: "#5b3a8c", accent: "#c9a7ff" },
  health: 1500,
  speed: 2.8,
  radius: 1.5,
  damage: 22,
  boss: { attacks: ["dash", "leap", "rain"], rank: "mini" },
  drops: ["ember_large"],
});
prefab("bell_warden", {
  model: "style.lowpoly.mushroom_king",
  health: 14500,
  speed: 2.4,
  radius: 1.8,
  damage: 30,
  // The bell tolls: slams, rings of shards, a charge down a lane, and shades called to its side.
  boss: { attacks: ["slam", "ring", "dash", "summon"], summon: "shade", enrageAt: 0.5 },
  drops: ["ember_large"],
});

// The Lantern Thief: an event's runaway carrier. It flees; catch it for a chest.
prefab("lantern_thief", { model: "style.lowpoly.fox", appearance: { tint: "#ffd36b" }, health: 140, speed: 6.2, radius: 0.45, damage: 0, ai: "flee", drops: [{ id: "ember_chest", chance: 1 }] });

// Props: break them for gems and luck. Scattered over the field at the start. Stumps and campfires
// come from the same Kenney Nature Kit as the treeline, so the field reads as one place.
prefab("ember_urn", { model: "style.lowpoly.stump", health: 25, speed: 0, radius: 0.5, damage: 0, prop: true, drops: ["ember_small", { id: "hearth_meal", chance: 0.12 }, { id: "lodestar", chance: 0.04 }] });
prefab("brazier", { model: "style.lowpoly.campfire", health: 60, speed: 0, radius: 0.6, damage: 0, prop: true, drops: ["ember_mid", { id: "hearth_meal", chance: 0.25 }, { id: "ember_chest", chance: 0.1 }] });

// Special pickups. Elites always drop a chest; bosses drop a meal, a lodestar and a chest.
prefab("hearth_meal", { model: "style.lowpoly.cell_heal", health: 1, speed: 0, kind: "pickup", pickup: { effect: "heal", amount: 0.25 } });
prefab("lodestar", { model: "style.lowpoly.crystal", health: 1, speed: 0, kind: "pickup", pickup: { effect: "vacuum" } });
prefab("flare", { model: "style.lowpoly.grenade", health: 1, speed: 0, kind: "pickup", pickup: { effect: "bomb" } });
prefab("ember_chest", { model: "style.lowpoly.chest", health: 1, speed: 0, kind: "pickup", pickup: { effect: "chest", amount: 2 } });
// A boss's hoard: three picks, and a weapon you hold with its paired passive jumps to max so it evolves.
prefab("hoard_chest", { model: "style.lowpoly.chest", appearance: { tint: "#ffcf5a", scale: 1.6 }, health: 1, speed: 0, kind: "pickup", pickup: { effect: "chest", amount: 3, evolve: true } });

// Gems (pickups): the XP each is worth.
prefab("ember_small", { model: "style.lowpoly.gem_small", health: 1, speed: 0, kind: "pickup", value: 1 });
prefab("ember_mid", { model: "style.lowpoly.gem_mid", health: 1, speed: 0, kind: "pickup", value: 6 });
prefab("ember_large", { model: "style.lowpoly.gem_large", health: 1, speed: 0, kind: "pickup", value: 60 });

// Weapons fire by themselves. Cooldowns in seconds, ranges in metres.
// Each level is a named change the card shows; at max level, with its paired
// passive taken, a weapon evolves (the card always shows). 8 weapons + 7 evolutions = 15.
weapon("ember_nova", {
  kind: "nova", damage: 12, cooldown: 1.1, range: 3.8, knockback: 2.5,
  levels: [{ damage: "+30%" }, { range: "+15%" }, { cooldown: "-15%" }, { damage: "+30%" }, { range: "+15%" }, { damage: "+25%", knockback: 3 }],
  evolve: { into: "sun_bell", requires: "bellows" },
});
weapon("spark_bolt", {
  kind: "bolt", damage: 14, cooldown: 0.6, range: 14, speed: 24, pierce: 1, knockback: 2,
  levels: [{ count: 1 }, { damage: "+40%" }, { cooldown: "-20%" }, { pierce: 1 }, { count: 1 }, { damage: "+40%" }],
  evolve: { into: "star_volley", requires: "twin_wick" },
});
weapon("halo_shards", {
  kind: "orbit", damage: 8, cooldown: 0.1, range: 2.4, count: 2, speed: 3.6, knockback: 3,
  levels: [{ count: 1 }, { damage: "+30%" }, { range: "+20%" }, { count: 1 }, { speed: "+25%" }, { damage: "+40%" }],
  evolve: { into: "halo_crown", requires: "lantern_glass" },
});
weapon("cinder_lance", {
  kind: "bolt", damage: 30, cooldown: 1.6, range: 22, speed: 34, pierce: 6, knockback: 4,
  levels: [{ damage: "+30%" }, { pierce: 3 }, { cooldown: "-20%" }, { count: 1 }, { damage: "+40%" }],
  evolve: { into: "sunspear", requires: "kindling" },
});
weapon("ash_whip", {
  kind: "cone", damage: 18, cooldown: 1.1, range: 4, spread: 100, knockback: 6,
  levels: [{ damage: "+30%" }, { spread: 40 }, { range: "+20%" }, { cooldown: "-20%" }, { damage: "+40%" }],
  evolve: { into: "ember_whirl", requires: "swift_boots" },
});
weapon("arc_wire", {
  kind: "chain", damage: 16, cooldown: 1.3, range: 9, count: 2, speed: 4, knockback: 1,
  levels: [{ count: 1 }, { damage: "+35%" }, { count: 1 }, { cooldown: "-20%" }, { count: 2 }],
  evolve: { into: "storm_wire", requires: "lodestone" },
});
weapon("hearth_ring", {
  kind: "aura", damage: 5, cooldown: 0.5, range: 2.5, knockback: 1,
  levels: [{ range: "+20%" }, { damage: "+40%" }, { range: "+20%" }, { cooldown: "-20%" }, { damage: "+40%" }],
  evolve: { into: "bonfire", requires: "hearth_heart" },
});
weapon("falling_star", {
  kind: "meteor", damage: 40, cooldown: 2.2, range: 12, count: 1, blast: 1.8, knockback: 6,
  levels: [{ count: 1 }, { damage: "+40%" }, { cooldown: "-20%" }, { count: 1 }, { damage: "+40%" }],
});

// Evolutions: about x1.7 damage and a new shape. Never offered on their own.
weapon("sun_bell", { kind: "nova", damage: 40, cooldown: 0.8, range: 9, knockback: 9 });
weapon("star_volley", { kind: "bolt", damage: 34, cooldown: 0.4, range: 16, speed: 28, count: 6, pierce: 3, knockback: 3 });
weapon("halo_crown", { kind: "orbit", damage: 20, cooldown: 0.1, range: 3.6, count: 6, speed: 4.5, knockback: 4 });
weapon("sunspear", { kind: "bolt", damage: 80, cooldown: 1, range: 28, speed: 40, count: 3, pierce: 30, knockback: 6 });
weapon("ember_whirl", { kind: "cone", damage: 45, cooldown: 0.8, range: 5.5, spread: 360, knockback: 8 });
weapon("storm_wire", { kind: "chain", damage: 34, cooldown: 0.9, range: 11, count: 9, speed: 5, knockback: 2 });
weapon("bonfire", { kind: "aura", damage: 12, cooldown: 0.4, range: 4.5, knockback: 2 });

// Passive upgrades offered at level-up next to new weapons and weapon levels (up to 8).
// Each evolution pairs with one of them.
upgrade("swift_boots", { stat: "speed", step: 0.07, maxLevel: 5 });
upgrade("hearth_heart", { stat: "maxHealth", step: 20, maxLevel: 5 });
upgrade("lodestone", { stat: "magnet", step: 0.8, maxLevel: 5 });
upgrade("kindling", { stat: "might", step: 0.1, maxLevel: 5 });
upgrade("bellows", { stat: "haste", step: 0.06, maxLevel: 5 });
upgrade("warm_tea", { stat: "regen", step: 1, maxLevel: 3 });
upgrade("lantern_glass", { stat: "area", step: 0.1, maxLevel: 5 });
upgrade("twin_wick", { stat: "amount", step: 1, maxLevel: 2 });

// The run's pacing: a quiet opening that grows into the crowd. Curves are
// [seconds, value] keyframes; spawns land just off screen, never on it.
director({
  // Playtest round 1: danger by 0:30. The first shades reach you by about 0:20, a stream of
  // gnats joins at 0:25, the first elite at 0:45 and the Ash Matron at 1:45.
  start: 10,
  ahead: 0.5,
  alive: [[0, 20], [30, 55], [60, 100], [120, 140], [180, 220], [300, 650], [420, 1300], [540, 2000]],
  rate: [[0, 2], [30, 4], [60, 5], [120, 6], [180, 8], [240, 14], [300, 24], [420, 60], [540, 120]],
  health: [[0, 1], [60, 1.35], [120, 1.7], [180, 2], [300, 3.3], [420, 5.5], [540, 9]],
  // Touches stay survivable; the telegraphed attacks are what should kill you.
  damage: [[0, 1], [60, 1.15], [180, 1.5], [360, 3.2], [480, 4.6], [600, 6]],
  // Late, the swarm closes in faster: kiting forever stops working after 6:00.
  speed: [[0, 1], [240, 1], [360, 1.2], [480, 1.45], [600, 1.6]],
  // Minute 1 is crowded, so each early gem is worth a little less: level 5 still lands near 1:00.
  // Late crowds are bigger, not richer: XP per gem stays flat, so density adds danger rather than power.
  xp: [[0, 0.7], [120, 0.8], [300, 0.8], [540, 0.8]],
  pool: [
    { prefab: "shade", weight: 10 },
    { prefab: "gnat", from: 25, weight: 2, group: [6, 9] },
    // A spitter's slow, telegraphed shot is the first thing that makes kiting cost something.
    { prefab: "spitter", from: 35, weight: 1.5 },
    { prefab: "ram", from: 70, weight: 1.2 },
    { prefab: "husk", from: 90, weight: 3 },
    { prefab: "bloat", from: 240, weight: 3 },
    // After 4:00 the swarm brings its range and its telegraphs back in force: spit, charge lanes and
    // fuse circles you must read and dodge. A perfect kite stops being enough.
    { prefab: "spitter", from: 240, weight: 4 },
    { prefab: "ram", from: 240, weight: 3 },
    { prefab: "aegis", from: 330, weight: 1 },
    { prefab: "mender", from: 330, weight: 1 },
    { prefab: "brute", from: 390, weight: 1 },
    { prefab: "brood", from: 390, weight: 2 },
    { prefab: "caller", from: 450, weight: 1 },
  ],
  fade: { after: 260, weight: 0.3 },
  // Each keeper past the first adds 30% more crowd: a squad spreads out, and the base curve is already sized for one keeper late.
  perPlayer: 0.3,
  // Bodies the cap holds back come back tougher, and worth only a little more.
  crowded: { health: 1.6, damage: 1.25, xp: 1.2 },
  // An elite (x6 health, gold rim) at 0:45, then every 40-55 s.
  elites: { from: 45, every: [40, 55] },
});

/** The hunters: the Ash Matron at 1:45, the Gloam Ram at 4:30, the Bell Warden at ten minutes. */
const MATRON_AT = 105;
const RAM_AT = 270;
const BOSS_AT = 600;

const TIDE_SIDES = ["north", "south", "east", "west"] as const;

system("run", ({ every, after, spawnEdge, emit, respawnDead, on, end, announce, scatter, upcoming }) => {
  scatter("ember_urn", 45);
  scatter("brazier", 12);
  // The HUD counts down to the next hunter.
  upcoming("THE ASH MATRON", MATRON_AT);
  after(MATRON_AT, () => upcoming("THE GLOAM RAM", RAM_AT - MATRON_AT));
  after(RAM_AT, () => upcoming("THE BELL WARDEN", BOSS_AT - RAM_AT));
  // Each minute survived is a wave on the HUD: anyone who bled out comes back.
  every(60, () => {
    emit("wave.cleared");
    respawnDead();
  });
  after(MATRON_AT, () => {
    announce("THE ASH MATRON RISES", { tone: "danger" });
    spawnEdge("ash_matron", { count: 1 });
  });
  after(RAM_AT, () => {
    announce("THE GLOAM RAM CHARGES", { tone: "danger" });
    spawnEdge("gloam_ram", { count: 1 });
  });
  after(BOSS_AT, () => {
    announce("THE BELL TOLLS", { tone: "danger" });
    spawnEdge("bell_warden", { count: 1 });
  });
  // The first minute has teeth: the dark closes in from every side, twice, before the Matron.
  // Break through the ring (dash, or burn a gap) instead of kiting forever.
  for (const at of [35, 80]) {
    after(at, () => {
      announce("THE DARK CLOSES IN", { tone: "danger" });
      spawnEdge("shade", { count: at < 60 ? 30 : 40, side: "any" });
    });
  }
  on("miniboss.killed", () => announce("A HUNTER FALLS · TAKE THE HOARD", { tone: "reward" }));
  on("boss.killed", () => end("won"));
});

// Events: one every 75 s from 4:00, never the same twice in a row, and never while a boss lives.
system("events", ({ every, after, spawnEdge, announce, random, bossAlive, xpBoost, surge, clear, emit, players }) => {
  let last = -1;
  after(240, () => {
    const fire = () => {
      if (bossAlive()) return;
      let pick = Math.floor(random() * 3);
      if (pick === last) pick = (pick + 1) % 3;
      last = pick;
      if (pick === 0) {
        // The Tide: a wall of shades sweeps in from one side.
        const side = TIDE_SIDES[Math.floor(random() * TIDE_SIDES.length)] ?? "north";
        announce("THE TIDE RISES", { tone: "danger" });
        spawnEdge("shade", { count: 220, side, spread: 80 });
        surge(1.5, 20);
        // Still standing when it passes: the Tide is survived.
        after(30, () => emit("tide.survived", players().filter((p) => p.alive).map((p) => p.id)));
      } else if (pick === 1) {
        announce("EMBER HOUR", { tone: "reward" });
        xpBoost(2, 30);
      } else {
        announce("A LANTERN THIEF FLEES", { tone: "reward" });
        spawnEdge("lantern_thief", { count: 1, side: "ahead", spread: 90 });
        after(15, () => {
          clear("lantern_thief");
        });
      }
    };
    fire();
    every(75, fire);
  });
});

// Keepers: pick one before your first level. Each starts with its own weapon and a
// signature passive. New keepers unlock with achievements, never with coins.
keeper("lamplighter", { name: "Lamplighter", text: "A steady nova and a long reach for embers.", weapon: "ember_nova", passive: "lodestone" });
keeper("sparkwright", { name: "Sparkwright", text: "Bolts at range, and quicker hands.", model: "style.lowpoly.rogue", tint: "#7ad7ff", weapon: "spark_bolt", passive: "bellows", unlock: "five_minutes" });
keeper("ash_warden", { name: "Ash Warden", text: "A sweeping whip and swift boots.", model: "style.lowpoly.monarch", tint: "#ff8a4a", weapon: "ash_whip", passive: "swift_boots", unlock: "evolver" });
keeper("star_caller", { name: "Star Caller", text: "Calls stars down; a wider glass.", model: "style.lowpoly.mini_female_c", tint: "#d9a8ff", weapon: "falling_star", passive: "lantern_glass", unlock: "bell_silenced" });

// Achievements (counted in a run; they unlock keepers and pay nothing).
achievement("five_minutes", { title: "Five Minutes of Night", text: "Hold the field for 5:00.", when: "wave.cleared", n: 5 });
achievement("evolver", { title: "Evolved", text: "Evolve a weapon.", when: "player.evolved" });
achievement("bell_silenced", { title: "The Bell Is Silent", text: "Break the Bell Warden.", when: "boss.killed" });
achievement("elite_hunter", { title: "Elite Hunter", text: "Kill 5 elites in one run.", when: "elite.killed", n: 5 });

// Daily goals: the HUD shows three a day. They point at the game's systems and pay nothing.
mission("evolve", { text: "Evolve a weapon", when: "player.evolved" });
mission("elite", { text: "Kill an elite", when: "elite.killed" });
mission("tide", { text: "Survive a Tide", when: "tide.survived" });
mission("revive", { text: "Revive a keeper", when: "player.revived" });
mission("chest", { text: "Open 2 chests", when: "chest.collected", n: 2 });
mission("thief", { text: "Catch the Lantern Thief", when: "lantern_thief.killed" });
mission("matron", { text: "Fell the Ash Matron", when: "miniboss.killed" });

// End-screen titles: who led the run at what.
title("butcher", { text: "The Butcher", most: "kills" });
title("furnace", { text: "The Furnace", most: "damage" });
title("medic", { text: "Field Medic", most: "revives" });
title("untouchable", { text: "Untouchable", least: "downs" });
title("magpie", { text: "Magpie", most: "pickups" });

// Earn (mandatory). Pays the game's coins (1 coin = 1 token), once per run each.
earn.rule("first_light", { when: "wave.cleared", n: 2, pay: 5, oncePer: "run" });
earn.rule("night_watch", { when: "wave.cleared", n: 7, pay: 20, oncePer: "run" });
earn.rule("bell_breaker", { when: "boss.killed", n: 1, pay: 50, oncePer: "run" });
earn.rule("swarm_breaker", { when: "enemy.killed", n: 500, pay: 5, oncePer: "run" });
// Buy-in run (the mandatory sink loop): stake coins at run start to earn above free play.
// A staked run also pays up to stake x multiple, by the share of this run's earn the player makes.
// What it does not win back stays in the reward pool. Values are PLACEHOLDER.
earn.stake({ min: 20, max: 200, multiple: 2 });

// Store (the Kit), priced in coins (the default coin model): a revive used while
// downed, and a cosmetic keeper palette owned for good (kept in the profile).
store.sku("revive", { coins: 50 });
store.sku("skin_aurora", { coins: 300, grants: { cosmetic: 1 } });
// Losable gear: owned for good until lost. It brings one level of its upgrade into every staked run,
// and is lost when that run makes less than loseBelow of its most earn. Values are PLACEHOLDER.
store.sku("ember_charm", { coins: 150, grants: { gear: "kindling", loseBelow: 0.25 } });
