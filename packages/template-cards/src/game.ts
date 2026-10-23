/**
 * INKWRIT: the card battler template (play style:
 * card battler).
 *
 * Scribes duel in a lamplit study. Every card is an inked creature or a
 * spell written on a page: blot imps, ledger crabs, folio wyrms, a splash
 * of ink. One against one, a person against a person or against the
 * gauntlet's AI scribes. A run is four duels; after each, you draft one of
 * three new cards into your deck.
 *
 * This file is the whole game as the model writes it: declarations only,
 * against the typed API in @netforge/engine. The duel, the draft, the
 * shuffle, hidden hands, the AI, netcode, renderer and referee are the
 * template's machinery.
 */
import { card, cardTable, earn, game, store, upgrade } from "@netforge/engine";

export default game({
  template: "cards",
  style: "lowpoly",
  places: { study: { chunks: "places/study", spawn: [0, 0, 0] } },
  players: { prefab: "style.lowpoly.hooded_adventurer", max: 2 },
});

// The table: hero health, hands, the board, the gauntlet and its AI scribes (tier n plays duel n against the AI).
cardTable({
  health: 20,
  startHand: 3,
  handMax: 7,
  boardMax: 5,
  manaMax: 10,
  turnSeconds: 30,
  draftSeconds: 15,
  duels: 4,
  starter: ["blot_imp", "blot_imp", "quill_sprite", "quill_sprite", "ink_frog", "ink_frog", "margin_bat", "ledger_crab", "serif_fox", "splash", "splash", "blotting_sand"],
  ai: [
    { health: 14, smart: 0.3 },
    { health: 16, smart: 0.55 },
    { health: 20, smart: 0.75 },
    { health: 24, smart: 0.9 },
  ],
});

// Units: cost in mana, attack and health. guard units must be attacked first; rush units attack the turn they land.
card("blot_imp", { model: "style.lowpoly.imp", kind: "unit", cost: 1, attack: 2, health: 1 });
card("quill_sprite", { model: "style.lowpoly.bee", kind: "unit", cost: 1, attack: 1, health: 2, rush: true });
card("ink_frog", { model: "style.lowpoly.frog", kind: "unit", cost: 2, attack: 2, health: 3 });
card("margin_bat", { model: "style.lowpoly.bat", kind: "unit", cost: 2, attack: 3, health: 1, rush: true });
card("ledger_crab", { model: "style.lowpoly.crab", kind: "unit", cost: 3, attack: 2, health: 5, guard: true });
card("serif_fox", { model: "style.lowpoly.fox", kind: "unit", cost: 3, attack: 3, health: 3, effect: { kind: "draw", amount: 1 } });
card("gloss_wolf", { model: "style.lowpoly.wolf", kind: "unit", cost: 4, attack: 4, health: 4 });
card("stamp_golem", { model: "style.lowpoly.yeti", kind: "unit", cost: 5, attack: 4, health: 7, guard: true });
card("folio_wyrm", { model: "style.lowpoly.dragon_whelp", kind: "unit", cost: 6, attack: 5, health: 5, effect: { kind: "damage", amount: 2, target: "all_enemies" } });
card("grand_errata", { model: "style.lowpoly.dragon", kind: "unit", cost: 8, attack: 8, health: 8 });
// Spells: an effect only. "enemy" lets the player pick an enemy unit or the hero.
card("splash", { model: "style.lowpoly.crystal", kind: "spell", cost: 1, effect: { kind: "damage", amount: 2, target: "enemy" } });
card("blotting_sand", { model: "style.lowpoly.gem_mid", kind: "spell", cost: 2, effect: { kind: "heal", amount: 5, target: "own_hero" } });
card("underline", { model: "style.lowpoly.gem_pink", kind: "spell", cost: 2, effect: { kind: "buff", amount: 2, target: "own_unit" } });
card("second_draft", { model: "style.lowpoly.chest", kind: "spell", cost: 3, effect: { kind: "draw", amount: 2 } });
card("ink_storm", { model: "style.lowpoly.meteor", kind: "spell", cost: 4, effect: { kind: "damage", amount: 2, target: "all_enemies" } });
card("final_word", { model: "style.lowpoly.crystal_rock", kind: "spell", cost: 5, effect: { kind: "damage", amount: 5, target: "enemy" } });

// Store upgrades: one level each, for the rest of the run (hero health, unit attack, first-turn mana, starting hand).
upgrade("thick_vellum", { stat: "maxHealth", step: 5, maxLevel: 1 });
upgrade("sharp_nib", { stat: "might", step: 1, maxLevel: 1 });
upgrade("quick_ink", { stat: "haste", step: 1, maxLevel: 1 });
upgrade("spare_page", { stat: "amount", step: 1, maxLevel: 1 });

// Earn (mandatory). Pays the game's coins (1 coin = 1 token), once per run each. Values are PLACEHOLDER.
// duel.won counts duels won against a person (never against the AI, never a forfeit); ai.beaten counts gauntlet AI scribes beaten.
earn.rule("first_ink", { when: "ai.beaten", n: 1, pay: 5, oncePer: "run" });
earn.rule("full_gauntlet", { when: "ai.beaten", n: 4, pay: 20, oncePer: "run" });
earn.rule("inked_duel", { when: "duel.won", n: 1, pay: 12, oncePer: "run" });
earn.rule("signed_and_sealed", { when: "duel.won", n: 3, pay: 25, oncePer: "run" });
// Buy-in run (the mandatory sink loop): stake coins at run start to earn above free play. Values are PLACEHOLDER.
earn.stake({ min: 10, max: 100, multiple: 2 });

// Store (the Kit), priced in coins: four run upgrades and two finishes for your quill, owned for good.
store.sku("thick_vellum", { coins: 40 });
store.sku("sharp_nib", { coins: 60 });
store.sku("quick_ink", { coins: 40 });
store.sku("spare_page", { coins: 50 });
store.sku("skin_vermilion", { coins: 300, grants: { cosmetic: 1 } });
store.sku("skin_gold_leaf", { coins: 500, grants: { cosmetic: 2 } });
// Losable gear: one level of its upgrade in every staked run, lost when that run makes under loseBelow of its most earn. PLACEHOLDER.
store.sku("bound_folio", { coins: 120, grants: { gear: "thick_vellum", loseBelow: 0.25 } });
