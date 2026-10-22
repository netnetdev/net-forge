/**
 * Display names for the template's content ids. Labels only; the rules are
 * in src/game.ts. A Net Forge game generated on this template ships its own
 * table (the model writes src/names.json; the build turns it into this
 * module). Cards are the "weapons" table ({ name, line }).
 */
export const TITLE = "Inkwrit";

export const WEAPON_NAMES: Readonly<Record<string, { name: string; line: string }>> = {
  blot_imp: { name: "Blot Imp", line: "Small and spiteful" },
  quill_sprite: { name: "Quill Sprite", line: "Strikes at once" },
  ink_frog: { name: "Ink Frog", line: "Sturdy for its cost" },
  margin_bat: { name: "Margin Bat", line: "Strikes at once" },
  ledger_crab: { name: "Ledger Crab", line: "Guards your hero" },
  serif_fox: { name: "Serif Fox", line: "Draws a card" },
  gloss_wolf: { name: "Gloss Wolf", line: "A solid hunter" },
  stamp_golem: { name: "Stamp Golem", line: "A wall of ink" },
  folio_wyrm: { name: "Folio Wyrm", line: "Scorches every foe" },
  grand_errata: { name: "Grand Errata", line: "The last word" },
  splash: { name: "Splash", line: "2 damage" },
  blotting_sand: { name: "Blotting Sand", line: "Heal your hero 5" },
  underline: { name: "Underline", line: "+2/+2 to a unit" },
  second_draft: { name: "Second Draft", line: "Draw two cards" },
  ink_storm: { name: "Ink Storm", line: "2 to every foe" },
  final_word: { name: "Final Word", line: "5 damage" },
};

export const UPGRADE_NAMES: Readonly<Record<string, { name: string; line: string }>> = {
  thick_vellum: { name: "Thick Vellum", line: "+5 hero health" },
  sharp_nib: { name: "Sharp Nib", line: "+1 attack on your units" },
  quick_ink: { name: "Quick Ink", line: "+1 mana in your first turn" },
  spare_page: { name: "Spare Page", line: "+1 card in your first hand" },
};

// Creatures by prefab id (the duel has none; a game that adds them labels them here).
export const ENEMY_NAMES: Readonly<Record<string, string>> = {
};

export const RULE_NAMES: Readonly<Record<string, string>> = {
  first_ink: "First Ink",
  full_gauntlet: "Full Gauntlet",
  inked_duel: "Inked Duel",
  signed_and_sealed: "Signed and Sealed",
};

export const SKU_NAMES: Readonly<Record<string, string>> = {
  thick_vellum: "Thick Vellum",
  sharp_nib: "Sharp Nib",
  quick_ink: "Quick Ink",
  spare_page: "Spare Page",
  skin_vermilion: "Vermilion quill",
  skin_gold_leaf: "Gold leaf quill",
  bound_folio: "Bound folio",
};

/** Player colours by slot, and a highlight palette (the generated names module carries both). */
export const KEEPER_COLORS = [0x2f5d8a, 0xb2382e, 0x3f7a4a, 0x8a5a2b, 0x6b4a8a, 0xc9a227, 0x2a7a7a, 0x8a2a5a];
export const AURORA = { body: 0x3cf2c4, glow: 0xa77bff };
