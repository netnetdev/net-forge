/**
 * Display names for the template's content ids. Labels only; the rules are
 * in src/game.ts. A Net Forge game generated on this template ships its own
 * table (the model writes src/names.json; the build turns it into this
 * module), so the client imports only these names from here.
 */
export const TITLE = "Voltyard";

export const WEAPON_NAMES: Readonly<Record<string, { name: string; line: string }>> = {
  arc_rifle: { name: "Arc Rifle", line: "Fast, steady" },
  scatter_coil: { name: "Scatter Coil", line: "Close range spread" },
  rail_lance: { name: "Rail Lance", line: "Instant, long range" },
};

export const UPGRADE_NAMES: Readonly<Record<string, { name: string; line: string }>> = {
  plating: { name: "Plating", line: "+25 max health" },
  servo: { name: "Servo", line: "Move faster" },
  capacitor: { name: "Capacitor", line: "Fire faster" },
};

// Bosses and creatures by prefab id (the yard has none; a game that adds enemies labels them here).
export const ENEMY_NAMES: Readonly<Record<string, string>> = {
};

export const RULE_NAMES: Readonly<Record<string, string>> = {
  live_wire: "Live Wire",
  long_shift: "Long Shift",
  overload: "Overload",
  top_of_the_yard: "Top of the Yard",
};

export const SKU_NAMES: Readonly<Record<string, string>> = {
  plating: "Plating",
  servo: "Servo",
  capacitor: "Capacitor",
  skin_neon: "Neon finish",
  skin_chrome: "Chrome finish",
  plating_kit: "Plating kit",
};

/** Player colours by slot, and a highlight palette (the generated names module carries both). */
export const KEEPER_COLORS = [0x16e0ff, 0xff4fd8, 0xc6ff3d, 0xffb020, 0x9c7bff, 0xff5a4f, 0x3dffb0, 0xf2f2f2];
export const AURORA = { body: 0x3cf2c4, glow: 0xa77bff };
