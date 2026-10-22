/**
 * SKYLEDGE: the platformer template (play style
 * "platformer"). Up to eight climbers race along cliffside courses to the
 * flag: run, jump (hold for height, tap for a hop), dash across gaps, ride
 * moving platforms, bounce off springs and stay off the thorns. Coins hang
 * along every route; each climber collects their own. A round is one
 * course; the next round runs the next course. Seat bots fill empty places
 * so a round always has a race.
 *
 * This file is the whole game as the model writes it: declarations only,
 * against the typed API in @netnetcapital/engine. Everything else (the
 * motor, netcode, renderer, bots, route planner, referee) is the template's
 * machinery.
 *
 * Course coordinates are metres, side view: x runs right from the start to
 * the flag, y runs up. blocks are [x, y, width, height] from the bottom-left
 * corner; ledges are [x, y, width] one-way platforms; hazards are
 * [x, y, width, height]; springs are [x, y, power]; coins and checkpoints
 * are [x, y].
 */
import { earn, game, store, system, upgrade } from "@netnetcapital/engine";

/** Ground from x0 to x1, its top at y (4 m deep). */
const ground = (x0: number, x1: number, y = 0): [number, number, number, number] => [x0, y - 4, x1 - x0, 4];
/** A row of n coins from x, `gap` metres apart, at height y. */
const coins = (x: number, y: number, n: number, gap = 1.2): [number, number][] => Array.from({ length: n }, (_, i) => [x + i * gap, y]);

export default game({
  template: "platformer",
  style: "lowpoly",
  tickRate: 60,
  places: { cliffs: { chunks: "places/cliffs", spawn: [0, 0, 0] } },
  players: { prefab: "style.lowpoly.rogue", max: 8, bots: 3 },
  // A course has three minutes; the round closes a few seconds after every person has finished.
  round: { seconds: 180 },
  levels: [
    {
      name: "Mossy Steps",
      start: [0, 0],
      flag: [128, 4.5],
      blocks: [
        ground(-8, 24),
        [14, 0, 3, 1.2],
        [17, 0, 3, 2.4],
        ground(28, 50),
        ground(55, 80),
        [62, 5, 7, 0.8],
        ground(90, 100),
        [100, -4, 4, 5.5],
        [104, -4, 4, 7],
        [108, -4, 30, 8.5],
      ],
      ledges: [[40, 2.6, 4]],
      hazards: [[35, 0, 2, 0.5], [72, 0, 2, 0.5]],
      springs: [[59, 0, 21]],
      movers: [{ at: [81, 0, 3], to: [5, 0], seconds: 4 }],
      coins: [...coins(4, 1, 5), ...coins(14.8, 2.4, 1), ...coins(18, 3.6, 2), ...coins(41, 3.6, 3), ...coins(63, 6.4, 5), ...coins(84, 1.4, 3), ...coins(112, 5.4, 4)],
      checkpoints: [[31, 0], [92, 0]],
    },
    {
      name: "Windmill Gap",
      start: [0, 0],
      flag: [150, 6],
      blocks: [
        ground(-8, 18),
        [12, 0, 6, 2],
        ground(24, 34, 2),
        [38, -2, 6, 4],
        ground(52, 70, 1),
        [58, 1, 2, 2.2],
        ground(84, 96, 3),
        [96, -1, 8, 4],
        ground(118, 160, 6),
        [126, 6, 3, 2],
      ],
      ledges: [[46, 3.6, 3], [74, 3.4, 3], [104, 4.8, 3], [110, 6.2, 3]],
      hazards: [[64, 1, 3, 0.5], [88, 3, 2, 0.5], [136, 6, 2, 0.5]],
      springs: [],
      movers: [
        { at: [74, 1, 3], to: [0, 4], seconds: 3.5 },
        { at: [112, 2, 3], to: [0, 3], seconds: 3, phase: 0.5 },
      ],
      coins: [...coins(13, 3, 4), ...coins(26, 3.2, 5), ...coins(47, 4.8, 2), ...coins(58.3, 4, 1), ...coins(85, 4.4, 3), ...coins(105, 6, 2), ...coins(130, 7.4, 6)],
      checkpoints: [[54, 1], [120, 6]],
    },
    {
      name: "Summit Run",
      start: [0, 0],
      flag: [168, 14],
      blocks: [
        ground(-8, 20),
        [20, -4, 6, 5],
        [30, -4, 6, 7],
        ground(42, 60, 3),
        [48, 3, 3, 1],
        ground(66, 82, 5),
        [74, 5, 2, 3],
        [88, 4, 6, 1],
        ground(98, 120, 8),
        [124, 9, 6, 1],
        [134, 10, 6, 1],
        ground(146, 176, 14),
      ],
      ledges: [[60, 6.5, 4], [113, 11, 4]],
      hazards: [[54, 3, 3, 0.5], [102, 8, 2, 0.5], [110, 8, 2, 0.5], [156, 14, 2, 0.5]],
      springs: [[16, 0, 22], [80, 5, 22], [118, 8, 21]],
      movers: [{ at: [138, 11, 3], to: [5, 2], seconds: 3.2 }],
      coins: [...coins(8, 1.2, 4), ...coins(16, 6, 3), ...coins(43, 4.4, 4), ...coins(61, 8, 3), ...coins(89, 6.2, 4), ...coins(125, 11, 3), ...coins(150, 15.4, 5)],
      checkpoints: [[44, 3], [100, 8], [148, 14]],
    },
  ],
});

// Run upgrades, sold in the store for the rest of the round (one level each).
// Platformer upgrades raise speed (run speed), amount (extra air jumps), magnet (coin reach),
// maxHealth (shield hits per life) or haste (dash cooldown).
upgrade("feather", { stat: "amount", step: 1, maxLevel: 1 });
upgrade("sprint", { stat: "speed", step: 0.1, maxLevel: 1 });
upgrade("shield", { stat: "maxHealth", step: 1, maxLevel: 1 });

// A clean climb: reach the flag without a fall.
system("clean_climb", ({ on, emit }) => {
  const falls = new Map<number, number>();
  on("player.fell", (ids) => {
    for (const id of ids) falls.set(id, (falls.get(id) ?? 0) + 1);
  });
  on("player.finished", (ids) => {
    const clean = ids.filter((id) => (falls.get(id) ?? 0) === 0);
    if (clean.length > 0) emit("climb.clean", clean);
  });
  // A player's earning run started over (signed in, or staked): their count does too.
  on("run.started", (ids) => {
    for (const id of ids) falls.delete(id);
  });
});

// Earn (mandatory). Pays the game's coins (1 coin = 1 token), once per round each.
// Seat bots never earn, and winning a field of bots pays nothing extra. Values are PLACEHOLDER.
earn.rule("pocketful", { when: "coin.collected", n: 12, pay: 4, oncePer: "run" });
earn.rule("summit", { when: "player.finished", n: 1, pay: 10, oncePer: "run" });
earn.rule("clean_climb", { when: "climb.clean", n: 1, pay: 12, oncePer: "run" });
earn.rule("first_flag", { when: "race.won", n: 1, pay: 25, oncePer: "run" });
// Buy-in run (the mandatory sink loop): stake coins at run start to earn above free play.
// A staked run also pays up to stake x multiple, by the share of this run's earn the player makes. PLACEHOLDER.
earn.stake({ min: 10, max: 100, multiple: 2 });

// Store (the Kit), priced in coins: three round upgrades and two cosmetic outfits owned for good.
store.sku("feather", { coins: 40 });
store.sku("sprint", { coins: 40 });
store.sku("shield", { coins: 60 });
store.sku("skin_sunset", { coins: 300, grants: { cosmetic: 1 } });
store.sku("skin_frost", { coins: 500, grants: { cosmetic: 2 } });
// Losable gear: one shield into every staked run, lost when that run makes less than loseBelow of its most earn. PLACEHOLDER.
store.sku("shield_charm", { coins: 120, grants: { gear: "shield", loseBelow: 0.25 } });
