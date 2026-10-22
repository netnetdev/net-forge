/**
 * VOLTYARD: the arena shooter template (game-runtime.md §14, week 9).
 *
 * Wirejacks duel at night in a yard of humming transformers. Move with one
 * hand, aim with the other, swap between a rifle, a scatter coil and a rail
 * lance. Every kill drops a cell that heals. Rounds last three minutes or
 * end at 25 kills; the top of the board takes the round. Bots fill empty
 * seats so a round always has a fight.
 *
 * This file is the whole game as the model writes it: declarations only,
 * against the typed API in @netnetcapital/engine. Everything else (sim,
 * netcode, lag compensation, renderer, bots, referee) is the template's
 * machinery.
 */
import { earn, game, prefab, store, system, upgrade, weapon } from "@netnetcapital/engine";

export default game({
  template: "arena",
  style: "lowpoly",
  tickRate: 60,
  places: { yard: { chunks: "places/yard", spawn: [0, 1, 0] } },
  players: {
    prefab: "style.lowpoly.mini_male_f",
    max: 16,
    loadout: ["arc_rifle", "scatter_coil", "rail_lance"],
    bots: 6,
    respawn: 3,
    drop: "volt_cell",
  },
  // The yard: 52 m square. Pillars are transformers, [x, z, radius]; spawns are [x, z].
  arena: {
    halfSize: 26,
    pillars: [
      [0, 0, 2.6],
      [9, 9, 1.4],
      [-9, 9, 1.4],
      [9, -9, 1.4],
      [-9, -9, 1.4],
      [0, 16, 1.8],
      [0, -16, 1.8],
      [16, 0, 1.8],
      [-16, 0, 1.8],
      [18, 18, 1.2],
      [-18, 18, 1.2],
      [18, -18, 1.2],
      [-18, -18, 1.2],
    ],
    spawns: [
      [22, 22],
      [-22, -22],
      [22, -22],
      [-22, 22],
      [0, 22],
      [0, -22],
      [22, 0],
      [-22, 0],
    ],
  },
  round: { seconds: 180, frags: 25 },
});

// The heal cell a downed wirejack drops: walking over it restores 35 health.
prefab("volt_cell", { model: "style.lowpoly.cell_heal", health: 1, speed: 0, kind: "pickup", value: 35 });

// The loadout. Damage in hit points (players have 100), cooldowns in seconds, ranges in metres.
weapon("arc_rifle", { kind: "blaster", damage: 12, cooldown: 0.15, range: 26, speed: 44, knockback: 0 });
weapon("scatter_coil", { kind: "blaster", damage: 9, cooldown: 0.75, range: 11, speed: 34, count: 7, spread: 26, knockback: 0 });
weapon("rail_lance", { kind: "beam", damage: 60, cooldown: 1.4, range: 40, knockback: 0 });

// Upgrades sold in the store, one level each, for the rest of the round.
upgrade("plating", { stat: "maxHealth", step: 25, maxLevel: 1 });
upgrade("servo", { stat: "speed", step: 0.08, maxLevel: 1 });
upgrade("capacitor", { stat: "haste", step: 0.12, maxLevel: 1 });

// Streaks: five kills without dying.
system("streaks", ({ on, emit }) => {
  const streak = new Map<number, number>();
  on("opponent.killed", (ids) => {
    for (const id of ids) {
      const n = (streak.get(id) ?? 0) + 1;
      streak.set(id, n);
      if (n === 5) emit("streak.five", [id]);
    }
  });
  on("player.died", (ids) => {
    for (const id of ids) streak.set(id, 0);
  });
  // A player's earning run started over (signed in, or staked): the streak does too.
  on("run.started", (ids) => {
    for (const id of ids) streak.set(id, 0);
  });
});

// Earn (mandatory, cabinet-launcher §0.2). Pays the game's coins (1 coin = 1 token), once per round each. Bots never earn; bot kills and a board of bots pay nothing.
earn.rule("live_wire", { when: "opponent.killed", n: 3, pay: 4, oncePer: "run" });
earn.rule("long_shift", { when: "opponent.killed", n: 12, pay: 10, oncePer: "run" });
earn.rule("overload", { when: "streak.five", n: 1, pay: 12, oncePer: "run" });
earn.rule("top_of_the_yard", { when: "round.top", n: 1, pay: 25, oncePer: "run" });
// Buy-in run (the mandatory sink loop): stake coins at run start to earn above free play.
// A staked run also pays up to stake x multiple, by the share of this run's earn the player makes.
// What it does not win back stays in the reward pool. Values are PLACEHOLDER (Q148).
earn.stake({ min: 10, max: 100, multiple: 2 });
// PvP pot: each entrant pays the entry before a round; the round splits the pot by the earn each entrant
// makes, and the recycle share stays in the reward pool. Values are PLACEHOLDER (Q148 c).
// Off until the R-16 legal review (ruled 2026-10-20): declared, not enabled, so no room takes an entry.
earn.pot({ entry: 20, recycle: 0.05 });

// Store (the Kit), priced in coins (the default coin model): three round upgrades
// used in a round, and two cosmetic finishes owned for good (kept in the profile).
store.sku("plating", { coins: 40 });
store.sku("servo", { coins: 40 });
store.sku("capacitor", { coins: 60 });
store.sku("skin_neon", { coins: 300, grants: { cosmetic: 1 } });
store.sku("skin_chrome", { coins: 500, grants: { cosmetic: 2 } });
// Losable gear: owned for good until lost. It brings one level of its upgrade into every staked run,
// and is lost when that run makes less than loseBelow of its most earn. Values are PLACEHOLDER (Q150).
store.sku("plating_kit", { coins: 120, grants: { gear: "plating", loseBelow: 0.25 } });
