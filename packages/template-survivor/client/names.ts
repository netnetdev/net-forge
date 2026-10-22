/**
 * Display names for the template's content ids. Labels only; the rules are
 * in src/game.ts. A Net Forge game generated on this template ships its own
 * table (the model writes it next to game.ts).
 */
export const WEAPON_NAMES: Readonly<Record<string, { name: string; line: string }>> = {
  ember_nova: { name: "Ember Nova", line: "Burst around you" },
  spark_bolt: { name: "Spark Bolt", line: "Seeks the nearest" },
  halo_shards: { name: "Halo Shards", line: "Blades circle you" },
  cinder_lance: { name: "Cinder Lance", line: "Long, piercing" },
  ash_whip: { name: "Ash Whip", line: "Sweeps ahead" },
  arc_wire: { name: "Arc Wire", line: "Jumps between foes" },
  hearth_ring: { name: "Hearth Ring", line: "Burns what is close" },
  falling_star: { name: "Falling Star", line: "Lands on the crowd" },
  sun_bell: { name: "Sun Bell", line: "A wide, heavy burst" },
  star_volley: { name: "Star Volley", line: "Six piercing bolts" },
  halo_crown: { name: "Halo Crown", line: "Six wide blades" },
  sunspear: { name: "Sunspear", line: "Pierces everything" },
  ember_whirl: { name: "Ember Whirl", line: "Sweeps all around" },
  storm_wire: { name: "Storm Wire", line: "Ten jumps" },
  bonfire: { name: "Bonfire", line: "A wide burning field" },
};

export const UPGRADE_NAMES: Readonly<Record<string, { name: string; line: string }>> = {
  swift_boots: { name: "Swift Boots", line: "Move speed" },
  hearth_heart: { name: "Hearth Heart", line: "Max health" },
  lodestone: { name: "Lodestone", line: "Gem reach" },
  kindling: { name: "Kindling", line: "Damage" },
  bellows: { name: "Bellows", line: "Fire rate" },
  warm_tea: { name: "Warm Tea", line: "Regenerate" },
  lantern_glass: { name: "Lantern Glass", line: "Bigger area" },
  twin_wick: { name: "Twin Wick", line: "More projectiles" },
};

export const ENEMY_NAMES: Readonly<Record<string, string>> = {
  lantern_thief: "Lantern Thief",
  bell_warden: "The Bell Warden",
  ash_matron: "The Ash Matron",
  gloam_ram: "The Gloam Ram",
};

export const RULE_NAMES: Readonly<Record<string, string>> = {
  first_light: "First Light",
  night_watch: "Night Watch",
  bell_breaker: "Bell Breaker",
  swarm_breaker: "Swarm Breaker",
};

export const SKU_NAMES: Readonly<Record<string, string>> = {
  revive: "Revive",
  skin_aurora: "Aurora palette",
  ember_charm: "Ember charm",
};

/** Keeper colours by player slot, and the Aurora palette. */
export const KEEPER_COLORS = [0xffb347, 0x5ec8ff, 0x9dff7a, 0xff7ab8, 0xc9a7ff, 0xffe066, 0x7affd4, 0xff9a5c];
export const AURORA = { body: 0x3cf2c4, glow: 0xa77bff };
