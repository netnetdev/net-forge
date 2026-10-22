/**
 * Display names for the template's content ids. Labels only; the rules are
 * in src/game.ts. A Net Forge game generated on this template ships its own
 * table (the model writes it next to game.ts).
 */
export const WEAPON_NAMES: Readonly<Record<string, { name: string; line: string }>> = {
  candle_burst: { name: "Candle Burst", line: "Burst around you" },
  wax_dart: { name: "Wax Dart", line: "Seeks the nearest" },
  censer_chain: { name: "Censer Chain", line: "Censers circle you" },
  bone_spear: { name: "Bone Spear", line: "Long, piercing" },
  sexton_scythe: { name: "Sexton Scythe", line: "Sweeps ahead" },
  vesper_arc: { name: "Vesper Arc", line: "Jumps between foes" },
  ember_halo: { name: "Ember Halo", line: "Burns what is close" },
  falling_wax: { name: "Falling Wax", line: "Lands on the crowd" },
  chapel_blaze: { name: "Chapel Blaze", line: "A wide, heavy burst" },
  wax_volley: { name: "Wax Volley", line: "Six piercing darts" },
  thurible_halo: { name: "Thurible Halo", line: "Six wide censers" },
  relic_lance: { name: "Relic Lance", line: "Pierces everything" },
  reaper_wheel: { name: "Reaper Wheel", line: "Sweeps all around" },
  matins_storm: { name: "Matins Storm", line: "Ten jumps" },
  pyre: { name: "Pyre", line: "A wide burning field" },
};

export const UPGRADE_NAMES: Readonly<Record<string, { name: string; line: string }>> = {
  soft_soles: { name: "Soft Soles", line: "Move speed" },
  warded_heart: { name: "Warded Heart", line: "Max health" },
  lodestone: { name: "Lodestone", line: "Shard reach" },
  tallow_oil: { name: "Tallow Oil", line: "Damage" },
  bellows: { name: "Bellows", line: "Fire rate" },
  hymnal: { name: "Hymnal", line: "Regenerate" },
  stained_glass: { name: "Stained Glass", line: "Bigger area" },
  twin_wick: { name: "Twin Wick", line: "More projectiles" },
};

export const ENEMY_NAMES: Readonly<Record<string, string>> = {
  marrow_knight: "The Marrow Knight",
  wax_abbot: "The Wax Abbot",
  ossuary_brute: "Ossuary Brute",
};

export const RULE_NAMES: Readonly<Record<string, string>> = {
  first_doors: "First Doors",
  deep_delve: "Deep Delve",
  abbot_breaker: "Abbot Breaker",
  bone_breaker: "Bone Breaker",
};

export const SKU_NAMES: Readonly<Record<string, string>> = {
  revive: "Revive",
  skin_ossuary: "Ossuary palette",
  wick_charm: "Wick charm",
};

/** The game's title (Net Forge reads it for the catalog). */
export const TITLE = "Cryptwick";
