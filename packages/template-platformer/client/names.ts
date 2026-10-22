/**
 * Display names for the template's content ids. Labels only; the rules are
 * in src/game.ts. A Net Forge game generated on this template ships its own
 * table (the model writes src/names.json; the build turns it into this
 * module), so the client imports only these names from here.
 */
export const TITLE = "Skyledge";

// The platformer has no weapons; the table stays for the generator's names.json shape.
export const WEAPON_NAMES: Readonly<Record<string, { name: string; line: string }>> = {
};

export const UPGRADE_NAMES: Readonly<Record<string, { name: string; line: string }>> = {
  feather: { name: "Feather", line: "One extra jump in the air" },
  sprint: { name: "Sprint", line: "Run 10% faster" },
  shield: { name: "Shield", line: "Shrug off one thorn hit a life" },
};

// The cliffs have no creatures; a game that adds named things labels them here.
export const ENEMY_NAMES: Readonly<Record<string, string>> = {
};

export const RULE_NAMES: Readonly<Record<string, string>> = {
  pocketful: "Pocketful",
  summit: "Summit",
  clean_climb: "Clean Climb",
  first_flag: "First Flag",
};

export const SKU_NAMES: Readonly<Record<string, string>> = {
  feather: "Feather",
  sprint: "Sprint",
  shield: "Shield",
  skin_sunset: "Sunset outfit",
  skin_frost: "Frost outfit",
  shield_charm: "Shield charm",
};

/** Climber colours by slot (the generated names module carries these too). */
export const KEEPER_COLORS = [0xffd23f, 0x5fd0ff, 0xff7a59, 0x7ee08a, 0xc08bff, 0xff5fa2, 0xf6f1e4, 0x3de0c0];
export const AURORA = { body: 0xffd23f, glow: 0xff7a59 };
