/**
 * MOSSBOUND: the monster collector template (cabinet-launcher §2 play-style
 * cards: monster-collector RPG).
 *
 * Fen spirits live in the tall grass of a flooded marsh. Each keeper picks
 * one of three starters at camp, walks the reeds, meets wild spirits in the
 * grass and battles them turn by turn with a team of three, snaring the
 * ones worth keeping in a reed lantern. At the far end of the marsh the
 * Fenwarden waits: every keeper in the marsh wears down the same warden,
 * and it must fall before dusk.
 *
 * This file is the whole game as the model writes it: declarations only,
 * against the typed API in @netnetcapital/engine. Walking, encounters,
 * battles, catching, levels, netcode, renderer and referee are the
 * template's machinery.
 */
import { creature, earn, game, marsh, move, store, upgrade } from "@netnetcapital/engine";

export default game({
  template: "collector",
  style: "lowpoly",
  places: { fen: { chunks: "places/fen", spawn: [0, 0, 0] } },
  players: { prefab: "style.lowpoly.hooded_adventurer", max: 8 },
});

// The marsh: 30 x 20 tiles of 2 m. Camp in the west, the warden's mound in the east, water and rocks between.
marsh({
  size: [30, 20],
  camp: [2, 10],
  starters: ["mossling", "cindertail", "puddlewump"],
  starterLevel: 4,
  water: [
    [11, 0, 2, 6],
    [11, 14, 2, 6],
    [24, 0, 3, 3],
  ],
  blocked: [
    [19, 0, 1, 8],
    [19, 12, 1, 8],
    [8, 9, 1, 2],
    [15, 2, 1, 1],
    [16, 16, 1, 1],
  ],
  grass: [
    { at: [4, 2, 6, 5], rate: 0.22, pool: [{ creature: "sporecap", weight: 3, level: [2, 3] }, { creature: "voltmoth", weight: 2, level: [2, 3] }, { creature: "reedcrab", weight: 1, level: [2, 4] }] },
    { at: [4, 13, 6, 5], rate: 0.22, pool: [{ creature: "reedcrab", weight: 2, level: [2, 4] }, { creature: "sporecap", weight: 1, level: [3, 4] }, { creature: "pebblewing", weight: 1, level: [3, 4] }] },
    { at: [14, 7, 4, 6], rate: 0.2, pool: [{ creature: "pebblewing", weight: 2, level: [4, 6] }, { creature: "voltmoth", weight: 2, level: [4, 6] }, { creature: "bogling", weight: 1, level: [5, 6] }] },
    { at: [21, 4, 4, 12], rate: 0.18, pool: [{ creature: "bogling", weight: 2, level: [6, 8] }, { creature: "pebblewing", weight: 1, level: [6, 8] }, { creature: "reedcrab", weight: 1, level: [6, 8] }] },
  ],
  warden: { creature: "fenwarden", at: [27, 10], level: 9, hp: 700 },
  dusk: 600,
  snares: 6,
});

// Creatures. Base stats at level 1 (each grows 12% a level); catchRate scales every snare.
creature("mossling", { model: "style.lowpoly.frog", element: "root", hp: 46, atk: 48, def: 50, spd: 44, moves: ["leaf_lash", "sap_drink"] });
creature("cindertail", { model: "style.lowpoly.fox", element: "spark", hp: 40, atk: 54, def: 42, spd: 58, moves: ["ember_nip", "static_dash"] });
creature("puddlewump", { model: "style.lowpoly.slime_drop", element: "tide", hp: 52, atk: 44, def: 52, spd: 40, moves: ["splash_jab", "bubble_ward"] });
creature("sporecap", { model: "style.lowpoly.mushroom_imp", element: "root", hp: 42, atk: 46, def: 46, spd: 38, moves: ["spore_puff", "leaf_lash"], catchRate: 0.9 });
creature("voltmoth", { model: "style.lowpoly.bee", element: "spark", hp: 36, atk: 50, def: 38, spd: 64, moves: ["static_dash", "ember_nip"], catchRate: 0.85 });
creature("reedcrab", { model: "style.lowpoly.crab", element: "tide", hp: 48, atk: 50, def: 60, spd: 36, moves: ["splash_jab", "shell_up"], catchRate: 0.8 });
creature("pebblewing", { model: "style.lowpoly.pebble_flyer", element: "stone", hp: 44, atk: 48, def: 56, spd: 50, moves: ["gravel_toss", "shell_up"], catchRate: 0.7 });
creature("bogling", { model: "style.lowpoly.blob_orc", element: "stone", hp: 60, atk: 52, def: 54, spd: 30, moves: ["gravel_toss", "mire_slam"], catchRate: 0.6, size: 1.3 });
creature("fenwarden", { model: "style.lowpoly.mushroom_king", element: "stone", hp: 120, atk: 66, def: 64, spd: 40, moves: ["mire_slam", "gravel_toss", "sap_drink"], boss: true, size: 3.4 });

// Moves. power 40 is a plain hit; drain heals half the damage, heal restores a share of max health, guard halves the next hit.
move("leaf_lash", { element: "root", power: 40 });
move("sap_drink", { element: "root", power: 30, effect: "drain" });
move("spore_puff", { element: "root", power: 45, accuracy: 0.9 });
move("ember_nip", { element: "spark", power: 40 });
move("static_dash", { element: "spark", power: 55, accuracy: 0.85 });
move("splash_jab", { element: "tide", power: 40 });
move("bubble_ward", { element: "tide", power: 0, effect: "heal", amount: 0.3 });
move("gravel_toss", { element: "stone", power: 40 });
move("shell_up", { element: "stone", power: 0, effect: "guard" });
move("mire_slam", { element: "stone", power: 70, accuracy: 0.8 });

// Store upgrades: one level each, for the rest of the run, on the buyer's own team.
upgrade("thornbark", { stat: "might", step: 0.15, maxLevel: 1 });
upgrade("mossmail", { stat: "armor", step: 0.15, maxLevel: 1 });
upgrade("spare_snares", { stat: "amount", step: 3, maxLevel: 1 });
upgrade("fen_tonic", { stat: "regen", step: 0.03, maxLevel: 1 });

// Earn (mandatory, cabinet-launcher §0.2). Pays the game's coins (1 coin = 1 token), once per run each. Values are PLACEHOLDER (Q148, Q160).
earn.rule("first_snare", { when: "creature.caught", n: 1, pay: 5, oncePer: "run" });
earn.rule("full_lantern", { when: "creature.caught", n: 3, pay: 20, oncePer: "run" });
earn.rule("warden_breaker", { when: "warden.defeated", n: 1, pay: 50, oncePer: "run" });
earn.rule("seasoned", { when: "level.five", n: 1, pay: 5, oncePer: "run" });
// Buy-in run (the mandatory sink loop): stake coins at run start to earn above free play.
// A staked run also pays up to stake x multiple, by the share of this run's earn the player makes. Values are PLACEHOLDER (Q148, Q160).
earn.stake({ min: 20, max: 200, multiple: 2 });

// Store (the Kit), priced in coins: four run upgrades and two keeper finishes owned for good (kept in the profile).
store.sku("thornbark", { coins: 40 });
store.sku("mossmail", { coins: 40 });
store.sku("spare_snares", { coins: 60 });
store.sku("fen_tonic", { coins: 50 });
store.sku("skin_lichen", { coins: 300, grants: { cosmetic: 1 } });
store.sku("skin_amber", { coins: 500, grants: { cosmetic: 2 } });
// Losable gear: owned for good until lost. It brings one level of its upgrade into every staked run,
// and is lost when that run makes less than loseBelow of its most earn. Values are PLACEHOLDER (Q150).
store.sku("lucky_reed", { coins: 150, grants: { gear: "thornbark", loseBelow: 0.25 } });
