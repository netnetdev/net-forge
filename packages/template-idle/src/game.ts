/**
 * BRINEWORKS: the idle template (cabinet-launcher §2 play-style cards: idle).
 *
 * A white salt flat under a hot sky. Up to eight players each run a works on
 * the flat: pumps draw brine, pans boil it into salt, kilns cut salt into
 * crystals, and salt buys and levels more plants. A barge on the canal
 * takes crystals for a contract everyone fills together. A shift lasts
 * fifteen minutes; then the flat is raked clean and a new shift begins.
 *
 * Works run only while their player is on the flat and has tended them in
 * the last two minutes (a rake, a purchase, a shipment): no offline
 * production, nothing for an idle tab.
 *
 * This file is the whole game as the model writes it: declarations only,
 * against the typed API in @netnetcapital/engine.
 */
import { earn, game, plant, saltFlat, store, upgrade } from "@netnetcapital/engine";

export default game({
  template: "idle",
  style: "lowpoly",
  places: { flat: { chunks: "places/flat", spawn: [0, 0, 0] } },
  players: { prefab: "style.lowpoly.worker", max: 8 },
});

// The flat: a fifteen-minute shift, works that stall two minutes after the last tend,
// a rake every 0.4 s for 3 kg, 3 L of brine to a kg of salt, 25 kg of salt to a crystal, a crate every 150 kg.
saltFlat({
  shift: 900,
  tend: 120,
  start: 20,
  rake: { salt: 3, cooldown: 0.4 },
  brinePerSalt: 3,
  saltPerCrystal: 25,
  packEvery: 150,
  contract: { crystals: 60 },
});

// Plants. cost is kg of salt for the first level, growth the price rise a level; rate is a second, a level
// (pumps: litres of brine; pans: kg of salt boiled; kilns: crystals cut).
plant("hand_pump", { model: "style.lowpoly.barrel", kind: "pump", cost: 15, growth: 1.15, rate: 3 });
plant("boil_pan", { model: "style.lowpoly.crate", kind: "pan", cost: 25, growth: 1.15, rate: 1 });
plant("steam_pump", { model: "style.lowpoly.generator", kind: "pump", cost: 400, growth: 1.18, rate: 30 });
plant("sun_pan", { model: "style.lowpoly.barrels", kind: "pan", cost: 600, growth: 1.18, rate: 10 });
plant("crystal_kiln", { model: "style.lowpoly.generator_large", kind: "kiln", cost: 900, growth: 1.25, rate: 0.05 });

// Store upgrades: one level each, for the rest of the shift, on the buyer's own works.
upgrade("bellows", { stat: "might", step: 0.15, maxLevel: 1 });
upgrade("long_rake", { stat: "amount", step: 0.3, maxLevel: 1 });
upgrade("quick_hands", { stat: "haste", step: 0.25, maxLevel: 1 });

// Earn (mandatory, cabinet-launcher §0.2). Pays the game's coins (1 coin = 1 token), once a shift each. Values are PLACEHOLDER (Q148, Q158).
earn.rule("first_crate", { when: "salt.packed", n: 30, pay: 5, oncePer: "run" });
earn.rule("long_haul", { when: "salt.packed", n: 300, pay: 20, oncePer: "run" });
earn.rule("full_hold", { when: "contract.filled", n: 1, pay: 50, oncePer: "run" });
earn.rule("cutter", { when: "crystal.cut", n: 30, pay: 5, oncePer: "run" });
// Buy-in run (the mandatory sink loop): stake coins at shift start to earn above free play. Values are PLACEHOLDER (Q148, Q158).
earn.stake({ min: 20, max: 200, multiple: 2 });

// Store (the Kit), priced in coins: three shift upgrades, two finishes owned for good, one piece of losable gear.
store.sku("bellows", { coins: 40 });
store.sku("long_rake", { coins: 40 });
store.sku("quick_hands", { coins: 60 });
store.sku("skin_saltwhite", { coins: 300, grants: { cosmetic: 1 } });
store.sku("skin_rust", { coins: 500, grants: { cosmetic: 2 } });
// Losable gear: owned for good until lost. It brings one level of its upgrade into every staked shift,
// and is lost when that shift makes less than loseBelow of its most earn. Values are PLACEHOLDER (Q150).
store.sku("brass_bellows", { coins: 150, grants: { gear: "bellows", loseBelow: 0.25 } });
