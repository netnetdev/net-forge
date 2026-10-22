/**
 * Display names for the template's content ids. Labels only; the rules are
 * in src/game.ts. A Net Forge game generated on this template ships its own
 * table (the model writes src/names.json; the build turns it into this
 * module). Plants are the "weapons" table.
 */
export const TITLE = "Brineworks";

export const WEAPON_NAMES: Readonly<Record<string, { name: string; line: string }>> = {
  hand_pump: { name: "Hand Pump", line: "Draws brine" },
  boil_pan: { name: "Boil Pan", line: "Boils brine into salt" },
  steam_pump: { name: "Steam Pump", line: "Draws a lot of brine" },
  sun_pan: { name: "Sun Pan", line: "Boils fast" },
  crystal_kiln: { name: "Crystal Kiln", line: "Cuts salt into crystals" },
};

export const UPGRADE_NAMES: Readonly<Record<string, { name: string; line: string }>> = {
  bellows: { name: "Bellows", line: "Plants work 15% faster" },
  long_rake: { name: "Long Rake", line: "+30% salt a rake" },
  quick_hands: { name: "Quick Hands", line: "Rake faster" },
};

// Creatures by id (the flat has none; a game that adds some labels them here).
export const ENEMY_NAMES: Readonly<Record<string, string>> = {
};

export const RULE_NAMES: Readonly<Record<string, string>> = {
  first_crate: "First Crates",
  long_haul: "Long Haul",
  full_hold: "Full Hold",
  cutter: "Cutter",
};

export const SKU_NAMES: Readonly<Record<string, string>> = {
  bellows: "Bellows",
  long_rake: "Long Rake",
  quick_hands: "Quick Hands",
  skin_saltwhite: "Saltwhite finish",
  skin_rust: "Rust finish",
  brass_bellows: "Brass bellows",
};

export const KEEPER_COLORS = [0xffb347, 0x5ec8ff, 0x9dff7a, 0xff7ab8, 0xc9a7ff, 0xffe066, 0x7affd4, 0xff9a5c];
export const AURORA = { body: 0x3cf2c4, glow: 0xa77bff };
