/**
 * CRYPTWICK: the co-op dungeon crawl template.
 *
 * Four wickbearers go down into a candle-lit crypt, room by room. Rooms
 * wake as you near them: their dead stir and come for your light through
 * the doors. Clear a room for its reliquary (pick an upgrade) and to bring
 * back anyone who fell. Down the deepest stair the Wax Abbot waits. A run
 * is one descent: if the whole party falls, it is over, and the next one
 * starts from the top with nothing carried down.
 *
 * This file is the whole game as the model writes it: declarations only,
 * against the typed API in @netforge/engine. The crypt's floor plan is
 * dungeon(...) from a seed; the crawl (which rooms wake, what they hold,
 * when the party is safe) is the "crawl" system below. Everything else
 * (sim, pathing, netcode, renderer, referee) is the template's machinery.
 * Design rules: packages/engine/GAME-DESIGN.md.
 */
import { achievement, dungeon, earn, game, keeper, mission, prefab, store, system, title, upgrade, weapon } from "@netforge/engine";

// The crypt: ten rooms on a 24 m grid, grown from the seed. Change the seed for a new floor plan.
const CRYPT = dungeon({ seed: 2026, rooms: 10, cell: 24, size: [12, 18], corridor: 6, loops: 2 });

export default game({
  template: "dungeon",
  style: "lowpoly",
  places: { crypt: { chunks: "places/crypt", spawn: [0, 1, 0] } },
  field: CRYPT.field,
  look: { preset: "night", bloom: 1.2, fog: 0.5, vignette: 0.5, tint: "#ffd9a0" },
  players: {
    prefab: "style.lowpoly.rogue",
    max: 4,
    weapon: "candle_burst",
    xp: { base: 2, growth: 2, exponent: 2.4 },
    magnet: 4,
    hitIframes: 0.7,
    share: "nearby",
    crit: { chance: 0.08, multiplier: 2 },
    reviveBuff: { seconds: 5, damage: 1.3, speed: 1.15 },
    bossHealthPerPlayer: 0.45,
    // Permadeath runs: a fallen wickbearer bleeds for 12 s (crawl to a friend), with no free get-up.
    // Out, they stay out until the party clears a room. If everyone falls, the descent is over.
    downed: { seconds: 12, crawl: 0.35, selfRevives: 0, respawn: 0 },
  },
});

// The crypt's dead. Health in hit points, speed in m/s (wickbearers run at 7), damage per touch.
// Fodder sometimes leaves tallow (heal), a lure stone (pulls every shard) or a chapel bell (clears the room).
const LUCK = [{ id: "tallow", chance: 0.03 }, { id: "lure_stone", chance: 0.012 }, { id: "chapel_bell", chance: 0.01 }];
prefab("bone_rattler", { model: "style.lowpoly.skeleton_grunt", health: 22, speed: 3.6, radius: 0.4, damage: 7, ai: "chase", drops: ["wick_small", ...LUCK] });
prefab("crypt_bat", { model: "style.lowpoly.bat", appearance: { tint: "#6a5a8c" }, health: 9, speed: 5.4, radius: 0.3, damage: 3, ai: "runner", drops: ["wick_small", ...LUCK] });
prefab("grave_shambler", { model: "style.lowpoly.zombie_grunt", health: 55, speed: 2.4, radius: 0.5, damage: 11, ai: "tank", mass: 3, drops: ["wick_mid"] });
prefab("bone_archer", { model: "style.lowpoly.skeleton", appearance: { tint: "#d8cfb8" }, health: 24, speed: 2.8, radius: 0.4, damage: 5, ai: "ranged", attack: { damage: 9, range: 10, speed: 7 }, drops: ["wick_small"] });
prefab("wax_wisp", { model: "style.lowpoly.ghost_skull", appearance: { tint: "#ffcf7a" }, health: 18, speed: 3.4, radius: 0.4, damage: 8, ai: "bomber", attack: { radius: 2.5, damage: 26 }, drops: ["wick_small"] });
prefab("tomb_slime", { model: "style.lowpoly.slime_horned", health: 44, speed: 2.8, radius: 0.5, damage: 8, ai: "chase", split: { into: "crypt_bat", count: 3 }, drops: ["wick_small"] });
prefab("hex_imp", { model: "style.lowpoly.imp", health: 45, speed: 2.6, radius: 0.4, damage: 6, ai: "summoner", attack: { summon: "crypt_bat", count: 2 }, drops: ["wick_mid"] });
prefab("candle_mender", { model: "style.lowpoly.blob_wizard", health: 30, speed: 3, radius: 0.4, damage: 6, ai: "healer", drops: ["wick_mid"] });
prefab("ossuary_brute", { model: "style.lowpoly.orc_brute", appearance: { tint: "#8a8f7a" }, health: 170, speed: 2.2, radius: 0.8, damage: 18, ai: "tank", mass: 6, drops: ["wick_mid", "wick_mid"] });
prefab("grave_ram", { model: "style.lowpoly.demon_blue", health: 60, speed: 3, radius: 0.5, damage: 12, ai: "charger", drops: ["wick_mid"] });

// The Marrow Knight guards the middle of the crypt: a mini-boss with two telegraphed attacks and a hoard.
prefab("marrow_knight", {
  model: "style.lowpoly.monarch",
  appearance: { tint: "#cfc6b0", accent: "#ff9a3d", scale: 1.5 },
  health: 420,
  speed: 2.6,
  radius: 1.2,
  damage: 16,
  boss: { attacks: ["slam", "dash"], rank: "mini" },
  drops: ["wick_large"],
});
// The Wax Abbot waits in the deepest room: slams, rings of wax, a charge, and the dead called to his side.
prefab("wax_abbot", {
  model: "style.lowpoly.demon",
  appearance: { tint: "#efe2c4", accent: "#ff8a3d" },
  health: 2800,
  speed: 2.4,
  radius: 1.5,
  damage: 26,
  boss: { attacks: ["slam", "ring", "dash", "summon"], summon: "bone_rattler", enrageAt: 0.5 },
  drops: ["wick_large"],
});

// Props: broken columns and bone heaps to break for shards and luck, scattered over the floors at the start.
prefab("crypt_urn", { model: "style.lowpoly.column_broken", appearance: { tint: "#8f8578" }, health: 25, speed: 0, radius: 0.5, damage: 0, prop: true, drops: ["wick_small", { id: "tallow", chance: 0.15 }, { id: "lure_stone", chance: 0.04 }] });
prefab("bone_pile", { model: "style.lowpoly.rock_small", appearance: { tint: "#cdbf9e" }, health: 50, speed: 0, radius: 0.6, damage: 0, prop: true, drops: ["wick_mid", { id: "tallow", chance: 0.25 }, { id: "reliquary", chance: 0.08 }] });

// Special pickups. A cleared room leaves a reliquary at its heart; bosses leave the hoard.
prefab("tallow", { model: "style.lowpoly.cell_heal", appearance: { tint: "#ffe2a8" }, health: 1, speed: 0, kind: "pickup", pickup: { effect: "heal", amount: 0.3 } });
prefab("lure_stone", { model: "style.lowpoly.crystal", health: 1, speed: 0, kind: "pickup", pickup: { effect: "vacuum" } });
prefab("chapel_bell", { model: "style.lowpoly.grenade", health: 1, speed: 0, kind: "pickup", pickup: { effect: "bomb" } });
prefab("reliquary", { model: "style.lowpoly.chest", health: 1, speed: 0, kind: "pickup", pickup: { effect: "chest", amount: 1 } });
prefab("abbey_hoard", { model: "style.lowpoly.chest", appearance: { tint: "#ffcf5a", scale: 1.6 }, health: 1, speed: 0, kind: "pickup", pickup: { effect: "chest", amount: 3, evolve: true } });

// Shards (pickups): the XP each is worth.
prefab("wick_small", { model: "style.lowpoly.gem_small", health: 1, speed: 0, kind: "pickup", value: 1 });
prefab("wick_mid", { model: "style.lowpoly.gem_mid", health: 1, speed: 0, kind: "pickup", value: 6 });
prefab("wick_large", { model: "style.lowpoly.gem_large", health: 1, speed: 0, kind: "pickup", value: 60 });

// Weapons fire by themselves. Cooldowns in seconds, ranges in metres. Each pairs with a passive to evolve.
weapon("candle_burst", {
  kind: "nova", damage: 13, cooldown: 1.1, range: 3.8, knockback: 2.5,
  levels: [{ damage: "+30%" }, { range: "+15%" }, { cooldown: "-15%" }, { damage: "+30%" }, { range: "+15%" }, { damage: "+25%", knockback: 3 }],
  evolve: { into: "chapel_blaze", requires: "bellows" },
});
weapon("wax_dart", {
  kind: "bolt", damage: 14, cooldown: 0.6, range: 13, speed: 24, pierce: 1, knockback: 2,
  levels: [{ count: 1 }, { damage: "+40%" }, { cooldown: "-20%" }, { pierce: 1 }, { count: 1 }, { damage: "+40%" }],
  evolve: { into: "wax_volley", requires: "twin_wick" },
});
weapon("censer_chain", {
  kind: "orbit", damage: 8, cooldown: 0.1, range: 2.4, count: 2, speed: 3.6, knockback: 3,
  levels: [{ count: 1 }, { damage: "+30%" }, { range: "+20%" }, { count: 1 }, { speed: "+25%" }, { damage: "+40%" }],
  evolve: { into: "thurible_halo", requires: "stained_glass" },
});
weapon("bone_spear", {
  kind: "bolt", damage: 30, cooldown: 1.6, range: 18, speed: 34, pierce: 6, knockback: 4,
  levels: [{ damage: "+30%" }, { pierce: 3 }, { cooldown: "-20%" }, { count: 1 }, { damage: "+40%" }],
  evolve: { into: "relic_lance", requires: "tallow_oil" },
});
weapon("sexton_scythe", {
  kind: "cone", damage: 18, cooldown: 1.1, range: 4, spread: 100, knockback: 6,
  levels: [{ damage: "+30%" }, { spread: 40 }, { range: "+20%" }, { cooldown: "-20%" }, { damage: "+40%" }],
  evolve: { into: "reaper_wheel", requires: "soft_soles" },
});
weapon("vesper_arc", {
  kind: "chain", damage: 16, cooldown: 1.3, range: 9, count: 2, speed: 4, knockback: 1,
  levels: [{ count: 1 }, { damage: "+35%" }, { count: 1 }, { cooldown: "-20%" }, { count: 2 }],
  evolve: { into: "matins_storm", requires: "lodestone" },
});
weapon("ember_halo", {
  kind: "aura", damage: 5, cooldown: 0.5, range: 2.5, knockback: 1,
  levels: [{ range: "+20%" }, { damage: "+40%" }, { range: "+20%" }, { cooldown: "-20%" }, { damage: "+40%" }],
  evolve: { into: "pyre", requires: "warded_heart" },
});
weapon("falling_wax", {
  kind: "meteor", damage: 40, cooldown: 2.2, range: 11, count: 1, blast: 1.8, knockback: 6,
  levels: [{ count: 1 }, { damage: "+40%" }, { cooldown: "-20%" }, { count: 1 }, { damage: "+40%" }],
});

// Evolutions: about x1.7 damage and a new shape. Never offered on their own.
weapon("chapel_blaze", { kind: "nova", damage: 40, cooldown: 0.8, range: 8, knockback: 9 });
weapon("wax_volley", { kind: "bolt", damage: 34, cooldown: 0.4, range: 15, speed: 28, count: 6, pierce: 3, knockback: 3 });
weapon("thurible_halo", { kind: "orbit", damage: 20, cooldown: 0.1, range: 3.6, count: 6, speed: 4.5, knockback: 4 });
weapon("relic_lance", { kind: "bolt", damage: 80, cooldown: 1, range: 22, speed: 40, count: 3, pierce: 30, knockback: 6 });
weapon("reaper_wheel", { kind: "cone", damage: 45, cooldown: 0.8, range: 5.5, spread: 360, knockback: 8 });
weapon("matins_storm", { kind: "chain", damage: 34, cooldown: 0.9, range: 11, count: 9, speed: 5, knockback: 2 });
weapon("pyre", { kind: "aura", damage: 12, cooldown: 0.4, range: 4.5, knockback: 2 });

// Passive upgrades offered at level-up next to new weapons and weapon levels. Each evolution pairs with one.
upgrade("soft_soles", { stat: "speed", step: 0.07, maxLevel: 5 });
upgrade("warded_heart", { stat: "maxHealth", step: 20, maxLevel: 5 });
upgrade("lodestone", { stat: "magnet", step: 0.8, maxLevel: 5 });
upgrade("tallow_oil", { stat: "might", step: 0.1, maxLevel: 5 });
upgrade("bellows", { stat: "haste", step: 0.06, maxLevel: 5 });
upgrade("hymnal", { stat: "regen", step: 1, maxLevel: 3 });
upgrade("stained_glass", { stat: "area", step: 0.1, maxLevel: 5 });
upgrade("twin_wick", { stat: "amount", step: 1, maxLevel: 2 });

/**
 * What a woken room holds, by its depth (doors from the start): [prefab, count] for one
 * wickbearer. Each extra wickbearer adds 35% more. Deeper rooms repeat the last row.
 */
const ENCOUNTERS: readonly (readonly (readonly [string, number])[])[] = [
  [["bone_rattler", 7], ["crypt_bat", 5]],
  [["bone_rattler", 9], ["bone_archer", 3], ["grave_shambler", 2]],
  [["grave_shambler", 3], ["crypt_bat", 9], ["wax_wisp", 4], ["bone_archer", 3]],
  [["tomb_slime", 3], ["hex_imp", 2], ["bone_rattler", 10], ["grave_ram", 2], ["candle_mender", 1]],
  [["ossuary_brute", 1], ["bone_archer", 5], ["wax_wisp", 5], ["grave_ram", 3], ["candle_mender", 2], ["bone_rattler", 10]],
];
/** Everything a room can send: a room is cleared when none of these is left standing. */
const DEAD = ["bone_rattler", "crypt_bat", "grave_shambler", "bone_archer", "wax_wisp", "tomb_slime", "hex_imp", "candle_mender", "ossuary_brute", "grave_ram", "marrow_knight", "wax_abbot"];
/** Seconds the crypt stays quiet with no fight before the nearest sleeping room wakes by itself. */
const STIR_AFTER = 18;

system("crawl", ({ onTick, tick, players, spawn, alive, emit, announce, upcoming, respawnDead, spawnPickup, scatter, random, onScreen, on, end, clear, bossAlive }) => {
  scatter("crypt_urn", 36);
  scatter("bone_pile", 14);
  const woken = new Set<number>([CRYPT.start.id]);
  const cleared = new Set<number>([CRYPT.start.id]);
  const active: number[] = [];
  // Spawns waiting for a spot in their room that nobody is looking at.
  const queue: { prefab: string; room: number; elite: boolean; since: number }[] = [];
  let quietSince = tick();
  let fightSince = 0;
  let wakes = 0;
  let knightDone = false;

  const living = () => DEAD.reduce((n, id) => n + alive(id), 0);
  const pointIn = (room: number, margin: number): [number, number] => {
    const r = CRYPT.rooms[room] ?? CRYPT.start;
    return [r.x + (random() * 2 - 1) * (r.hx - margin), r.z + (random() * 2 - 1) * (r.hz - margin)];
  };

  const wake = (room: number) => {
    if (woken.has(room)) return;
    woken.add(room);
    if (active.length === 0) fightSince = tick();
    active.push(room);
    wakes++;
    const r = CRYPT.rooms[room] ?? CRYPT.start;
    const party = Math.max(1, players().filter((p) => !p.bot).length);
    const add = (prefab: string, count: number, elite = false) => {
      for (let i = 0; i < count; i++) queue.push({ prefab, room, elite, since: tick() });
    };
    if (room === CRYPT.boss.id) {
      announce("THE WAX ABBOT WAKES", { tone: "danger" });
      add("wax_abbot", 1);
      add("bone_rattler", 6);
      return;
    }
    const row = ENCOUNTERS[Math.min(r.depth - 1, ENCOUNTERS.length - 1)] ?? ENCOUNTERS[0] ?? [];
    for (const [prefab, n] of row) add(prefab, Math.max(1, Math.round(n * (1 + 0.35 * (party - 1)))));
    // Every third room brings an elite; the Marrow Knight guards the first room three doors down.
    if (wakes % 3 === 0) add("bone_rattler", 1, true);
    if (!knightDone && r.depth >= 3) {
      knightDone = true;
      announce("THE MARROW KNIGHT STIRS", { tone: "danger" });
      add("marrow_knight", 1);
    }
  };

  const clearActive = () => {
    for (const room of active) {
      cleared.add(room);
      const r = CRYPT.rooms[room] ?? CRYPT.start;
      if (room !== CRYPT.boss.id) spawnPickup("reliquary", [r.x, 0.5, r.z]);
      emit("room.cleared");
    }
    active.length = 0;
    respawnDead();
    announce("THE ROOM FALLS SILENT", { tone: "reward" });
    quietSince = tick();
  };

  onTick(() => {
    const t = tick();
    // Bring in what waits, off every screen, inside its own room (after 3 s, wherever it fits).
    for (let i = 0; i < queue.length && i < 8; i++) {
      const q = queue[i];
      if (!q) continue;
      const late = t - q.since > 90;
      for (let k = 0; k < 4; k++) {
        const [x, z] = pointIn(q.room, 1.5);
        if (!late && onScreen(x, z)) continue;
        spawn(q.prefab, [x, 0.5, z], { elite: q.elite });
        queue.splice(i--, 1);
        break;
      }
    }
    if (t % 10 !== 0) return;
    // Where the party stands wakes the rooms around it.
    for (const p of players()) {
      if (!p.alive) continue;
      const here = CRYPT.roomAt(p.position[0], p.position[2]);
      if (here < 0) continue;
      if (!woken.has(here) && active.length < 2) wake(here);
      if (cleared.has(here)) for (const next of CRYPT.rooms[here]?.links ?? []) if (!woken.has(next) && active.length < 2) wake(next);
    }
    if (active.length > 0) {
      // A long fight down to its last few: the stragglers slink back into the dark (never a boss).
      if (queue.length === 0 && !bossAlive() && t - fightSince > 75 * 30 && living() <= 3) for (const id of DEAD) clear(id);
      if (queue.length === 0 && living() === 0) clearActive();
      return;
    }
    // Quiet too long: the nearest sleeping room next to a cleared one stirs by itself.
    if (t - quietSince >= STIR_AFTER * 30) {
      let pick = -1;
      for (const r of CRYPT.rooms) {
        if (woken.has(r.id) || !r.links.some((l) => cleared.has(l))) continue;
        if (pick < 0 || r.depth < (CRYPT.rooms[pick]?.depth ?? 99)) pick = r.id;
      }
      if (pick >= 0) {
        announce("SOMETHING STIRS IN THE DARK", { tone: "danger" });
        wake(pick);
      }
    } else if (t - quietSince === 30) upcoming("THE CRYPT STIRS", STIR_AFTER - 1);
  });

  on("miniboss.killed", () => announce("THE KNIGHT FALLS · TAKE THE HOARD", { tone: "reward" }));
  on("boss.killed", () => end("won"));
});

// Keepers: pick one before your first level. New keepers unlock with achievements, never with coins.
keeper("lampwright", { name: "Lampwright", text: "A steady candle burst and a long reach for shards.", weapon: "candle_burst", passive: "lodestone" });
keeper("sexton", { name: "Sexton", text: "A sweeping scythe and soft soles.", model: "style.lowpoly.hooded_adventurer", tint: "#9fd17a", weapon: "sexton_scythe", passive: "soft_soles", unlock: "three_doors" });
keeper("vesper", { name: "Vesper", text: "Arcs that leap between the dead; quicker hands.", model: "style.lowpoly.mini_female_c", tint: "#7ad7ff", weapon: "vesper_arc", passive: "bellows", unlock: "knight_felled" });
keeper("chandler", { name: "Chandler", text: "Calls falling wax; a wider glass.", model: "style.lowpoly.monarch", tint: "#ffcf7a", weapon: "falling_wax", passive: "stained_glass", unlock: "abbot_silenced" });

// Achievements (counted in a run; they unlock keepers and pay nothing).
achievement("three_doors", { title: "Three Doors Down", text: "Clear three rooms in one descent.", when: "room.cleared", n: 3 });
achievement("knight_felled", { title: "Marrow and Bone", text: "Fell the Marrow Knight.", when: "miniboss.killed" });
achievement("abbot_silenced", { title: "The Candle Outlasts", text: "Silence the Wax Abbot.", when: "boss.killed" });
achievement("evolver", { title: "Rekindled", text: "Evolve a weapon.", when: "player.evolved" });

// Daily goals: the HUD shows three a day. They point at the game's systems and pay nothing.
mission("rooms", { text: "Clear 4 rooms", when: "room.cleared", n: 4 });
mission("elite", { text: "Kill an elite", when: "elite.killed" });
mission("revive", { text: "Revive a wickbearer", when: "player.revived" });
mission("chest", { text: "Open 3 reliquaries", when: "chest.collected", n: 3 });
mission("knight", { text: "Fell the Marrow Knight", when: "miniboss.killed" });
mission("evolve", { text: "Evolve a weapon", when: "player.evolved" });

// End-screen titles: who led the descent at what.
title("gravedigger", { text: "The Gravedigger", most: "kills" });
title("pyre", { text: "The Pyre", most: "damage" });
title("chaplain", { text: "Chaplain", most: "revives" });
title("unscathed", { text: "Unscathed", least: "downs" });
title("magpie", { text: "Magpie", most: "pickups" });

// Earn (mandatory). Pays the game's coins (1 coin = 1 token), once per run each.
// Pay amounts copy EMBERWATCH's (5, 20, 50, 5) until CRYPTWICK's own are set: PLACEHOLDER.
earn.rule("first_doors", { when: "room.cleared", n: 2, pay: 5, oncePer: "run" });
earn.rule("deep_delve", { when: "room.cleared", n: 7, pay: 20, oncePer: "run" });
earn.rule("abbot_breaker", { when: "boss.killed", n: 1, pay: 50, oncePer: "run" });
earn.rule("bone_breaker", { when: "enemy.killed", n: 60, pay: 5, oncePer: "run" });
// Buy-in run (the mandatory sink loop): stake coins at run start to earn above free play.
// A staked run also pays up to stake x multiple, by the share of this run's earn the player makes.
// What it does not win back stays in the reward pool. Values are PLACEHOLDER.
earn.stake({ min: 20, max: 200, multiple: 2 });

// Store (the Kit), priced in coins (the default coin model): a revive used while
// downed, and a cosmetic wickbearer palette owned for good (kept in the profile).
// Prices copy EMBERWATCH's until CRYPTWICK's own are set: PLACEHOLDER.
store.sku("revive", { coins: 50 });
store.sku("skin_ossuary", { coins: 300, grants: { cosmetic: 1 } });
// Losable gear: owned for good until lost. It brings one level of its upgrade into every staked run,
// and is lost when that run makes less than loseBelow of its most earn. Values are PLACEHOLDER.
store.sku("wick_charm", { coins: 150, grants: { gear: "tallow_oil", loseBelow: 0.25 } });
