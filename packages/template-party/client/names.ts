/**
 * Display names for the template's content ids. Labels only; the rules are
 * in src/game.ts. A Net Forge game generated on this template ships its own
 * table (the model writes it next to game.ts).
 */
export const WEAPON_NAMES: Readonly<Record<string, { name: string; line: string }>> = {
  confetti_pop: { name: "Confetti Pop", line: "Burst around you" },
  streamer: { name: "Streamer", line: "Seeks the nearest" },
  spinning_plates: { name: "Spinning Plates", line: "Plates circle you" },
  pie_toss: { name: "Pie Toss", line: "Lands on the crowd" },
  limbo_bar: { name: "Limbo Bar", line: "Sweeps ahead" },
  kazoo_chain: { name: "Kazoo Chain", line: "Jumps between foes" },
  confetti_cannon: { name: "Confetti Cannon", line: "A wide, heavy burst" },
  streamer_storm: { name: "Streamer Storm", line: "Six piercing streamers" },
  plate_carousel: { name: "Plate Carousel", line: "Six wide plates" },
};

export const UPGRADE_NAMES: Readonly<Record<string, { name: string; line: string }>> = {
  dance_shoes: { name: "Dance Shoes", line: "Move speed" },
  second_helping: { name: "Second Helping", line: "Max health" },
  party_hat: { name: "Party Hat", line: "More projectiles" },
  sugar_rush: { name: "Sugar Rush", line: "Fire rate" },
  disco_ball: { name: "Disco Ball", line: "Bigger area" },
  lucky_sock: { name: "Lucky Sock", line: "Damage" },
  goodie_bag: { name: "Goodie Bag", line: "Star reach" },
};

export const ENEMY_NAMES: Readonly<Record<string, string>> = {
  big_balloon: "The Big Balloon",
  party_pup: "The Party Pup",
};

export const RULE_NAMES: Readonly<Record<string, string>> = {
  first_win: "First Win",
  crowd_favourite: "Crowd Favourite",
  full_house: "Full House",
  confetti_storm: "Confetti Storm",
};

export const SKU_NAMES: Readonly<Record<string, string>> = {
  revive: "Revive",
  skin_disco: "Disco palette",
  lucky_charm: "Lucky charm",
};

/** The game's title (Net Forge reads it for the catalog). */
export const TITLE = "Romphouse";
