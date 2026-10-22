/**
 * Display names for the template's content ids. Labels only; the rules are
 * in src/game.ts. A Net Forge game generated on this template ships its own
 * table (the model writes src/names.json; the build turns it into this
 * module), so the client imports only these names from here.
 */
export const TITLE = "Torquebay";

// The racer has no weapons; the table stays for the generator's names.json shape.
export const WEAPON_NAMES: Readonly<Record<string, { name: string; line: string }>> = {
};

export const UPGRADE_NAMES: Readonly<Record<string, { name: string; line: string }>> = {
  turbo: { name: "Turbo", line: "Boosts last 25% longer" },
  tuned_engine: { name: "Tuned engine", line: "5% more top speed" },
  soft_tyres: { name: "Soft tyres", line: "Drifts charge faster" },
  bumpers: { name: "Bumpers", line: "Lose less on grass and walls" },
};

// The harbour has no creatures; a game that adds named things labels them here.
export const ENEMY_NAMES: Readonly<Record<string, string>> = {
};

export const RULE_NAMES: Readonly<Record<string, string>> = {
  hot_lap: "Hot Lap",
  chequered: "Chequered",
  clean_line: "Clean Line",
  pole_to_flag: "Pole to Flag",
};

export const SKU_NAMES: Readonly<Record<string, string>> = {
  turbo: "Turbo",
  tuned_engine: "Tuned engine",
  soft_tyres: "Soft tyres",
  skin_flame: "Flame paint",
  skin_chrome: "Chrome paint",
  bumper_kit: "Bumper kit",
};

/** Kart colours by slot (the generated names module carries these too). */
export const KEEPER_COLORS = [0xffb347, 0x5ec8ff, 0x9dff7a, 0xff7ab8, 0xc9a7ff, 0xffe066, 0x7affd4, 0xff9a5c];
export const AURORA = { body: 0xff5a1f, glow: 0xffd23f };
