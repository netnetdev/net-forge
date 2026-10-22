/**
 * Display names for the template's content ids. Labels only; the rules are
 * in src/game.ts. A Net Forge game generated on this template ships its own
 * table (the model writes src/names.json; the build turns it into this
 * module), so the client imports only these names from here. Towers are
 * the "weapons" table, creeps the "enemies" table.
 */
export const TITLE = "Cogspire";

export const WEAPON_NAMES: Readonly<Record<string, { name: string; line: string }>> = {
  bolt_post: { name: "Bolt Post", line: "Fast single shots" },
  tar_mortar: { name: "Tar Mortar", line: "Slow, hits a crowd" },
  frost_vane: { name: "Frost Vane", line: "Slows what it hits" },
  arc_coil: { name: "Arc Coil", line: "Jumps between creeps" },
};

export const UPGRADE_NAMES: Readonly<Record<string, { name: string; line: string }>> = {
  overclock: { name: "Overclock", line: "Your towers fire faster" },
  tempered_brass: { name: "Tempered Brass", line: "Your towers hit harder" },
  spyglass: { name: "Spyglass", line: "Your towers reach further" },
  spare_bell: { name: "Spare Bell", line: "+5 bells for the team" },
};

export const ENEMY_NAMES: Readonly<Record<string, string>> = {
  rustling: "Rustling",
  gearbeetle: "Gearbeetle",
  cinder_moth: "Cinder Moth",
  boilerback: "Boilerback",
};

export const RULE_NAMES: Readonly<Record<string, string>> = {
  first_gear: "First Gear",
  long_shift: "Long Shift",
  boiler_breaker: "Boiler Breaker",
  scrap_heap: "Scrap Heap",
};

export const SKU_NAMES: Readonly<Record<string, string>> = {
  overclock: "Overclock",
  tempered_brass: "Tempered Brass",
  spyglass: "Spyglass",
  spare_bell: "Spare Bell",
  skin_verdigris: "Verdigris finish",
  skin_gilt: "Gilt finish",
  brass_gear: "Brass gear",
};

/** Player colours by slot, and a highlight palette (the generated names module carries both). */
export const KEEPER_COLORS = [0xffb347, 0x5ec8ff, 0x9dff7a, 0xff7ab8, 0xc9a7ff, 0xffe066, 0x7affd4, 0xff9a5c];
export const AURORA = { body: 0x3cf2c4, glow: 0xa77bff };
