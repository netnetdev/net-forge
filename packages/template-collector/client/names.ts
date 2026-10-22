/**
 * Display names for the template's content ids. Labels only; the rules are
 * in src/game.ts. A Net Forge game generated on this template ships its own
 * table (the model writes src/names.json; the build turns it into this
 * module), so the client imports only these names from here. Creatures are
 * the "weapons" table ({ name, line }); moves read as their ids.
 */
export const TITLE = "Mossbound";

export const WEAPON_NAMES: Readonly<Record<string, { name: string; line: string }>> = {
  mossling: { name: "Mossling", line: "Steady and hard to tire" },
  cindertail: { name: "Cindertail", line: "Quick, hits first" },
  puddlewump: { name: "Puddlewump", line: "Soaks hits, heals itself" },
  sporecap: { name: "Sporecap", line: "A cloud of spores" },
  voltmoth: { name: "Voltmoth", line: "Fastest in the reeds" },
  reedcrab: { name: "Reedcrab", line: "Shell like a door" },
  pebblewing: { name: "Pebblewing", line: "A flying stone" },
  bogling: { name: "Bogling", line: "Slow, heavy fists" },
  fenwarden: { name: "Fenwarden", line: "Keeper of the mound" },
};

export const UPGRADE_NAMES: Readonly<Record<string, { name: string; line: string }>> = {
  thornbark: { name: "Thornbark", line: "Your team hits harder" },
  mossmail: { name: "Mossmail", line: "Your team takes less" },
  spare_snares: { name: "Spare snares", line: "+3 snares this run" },
  fen_tonic: { name: "Fen tonic", line: "Heal while you walk" },
};

export const ENEMY_NAMES: Readonly<Record<string, string>> = {
  fenwarden: "Fenwarden",
};

export const RULE_NAMES: Readonly<Record<string, string>> = {
  first_snare: "First Snare",
  full_lantern: "Full Lantern",
  warden_breaker: "Warden Breaker",
  seasoned: "Seasoned",
};

export const SKU_NAMES: Readonly<Record<string, string>> = {
  thornbark: "Thornbark",
  mossmail: "Mossmail",
  spare_snares: "Spare snares",
  fen_tonic: "Fen tonic",
  skin_lichen: "Lichen cloak",
  skin_amber: "Amber cloak",
  lucky_reed: "Lucky reed",
};

/** Player colours by slot, and a highlight palette (the generated names module carries both). */
export const KEEPER_COLORS = [0x9dff7a, 0x5ec8ff, 0xffb347, 0xff7ab8, 0xc9a7ff, 0xffe066, 0x7affd4, 0xff9a5c];
export const AURORA = { body: 0x3cf2c4, glow: 0xa77bff };
