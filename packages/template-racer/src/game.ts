/**
 * TORQUEBAY: the racer template (play style "racer").
 * Up to eight karts race laps around harbour circuits: hold the throttle,
 * drift through the bends to charge a mini-turbo (release for the boost),
 * hit the boost pads, collect coins (every coin you hold adds 1% top speed,
 * up to ten) and keep off the grass. A round is one race; the next round runs
 * another circuit. Seat bots fill the grid so a race always has a field.
 *
 * This file is the whole game as the model writes it: declarations only,
 * against the typed API in @netforge/engine. Everything else (the kart
 * physics, netcode, renderer, track streaming, bots, referee) is the
 * template's machinery.
 *
 * Track coordinates are metres on the ground (x right, z down the screen's
 * map). points is the closed centreline in driving order; boosts and coins
 * are [lap fraction 0..1, lateral -1..1 of the half width].
 */
import { earn, game, store, system, upgrade } from "@netforge/engine";

/** Coins in a row: n coins from lap fraction f, `gap` of a lap apart, at one lateral. */
const coinRow = (f: number, lateral: number, n: number, gap = 0.006): [number, number][] => Array.from({ length: n }, (_, i) => [f + i * gap, lateral]);

export default game({
  template: "racer",
  style: "lowpoly",
  tickRate: 60,
  places: { harbour: { chunks: "places/harbour", spawn: [0, 0, 0] } },
  players: { prefab: "style.lowpoly.kart_a", max: 8, bots: 6 },
  round: { seconds: 240 },
  tracks: [
    {
      name: "Harbour Loop",
      laps: 3,
      width: 14,
      points: [[0, 0], [90, 0], [150, 15], [175, 65], [150, 120], [90, 135], [50, 175], [-20, 190], [-85, 160], [-110, 100], [-90, 35]],
      boosts: [[0.12, 0], [0.47, -0.4], [0.78, 0.4]],
      coins: [...coinRow(0.04, 0.5, 5), ...coinRow(0.3, -0.5, 5), ...coinRow(0.6, 0, 5), ...coinRow(0.88, -0.3, 5)],
    },
    {
      name: "Crane Yard",
      laps: 3,
      width: 13,
      points: [[0, 0], [70, -10], [120, 10], [130, 60], [95, 85], [60, 70], [30, 95], [45, 140], [5, 175], [-55, 160], [-75, 105], [-50, 60], [-75, 20]],
      boosts: [[0.08, 0], [0.38, 0.3], [0.7, -0.3]],
      coins: [...coinRow(0.15, 0, 5), ...coinRow(0.45, 0.4, 5), ...coinRow(0.62, -0.4, 5), ...coinRow(0.85, 0, 5)],
    },
    {
      name: "Lighthouse Run",
      laps: 2,
      width: 15,
      points: [[0, 0], [120, -15], [200, 10], [235, 70], [210, 140], [140, 170], [80, 150], [40, 190], [-30, 210], [-95, 175], [-115, 105], [-80, 40]],
      boosts: [[0.05, 0], [0.25, 0.35], [0.5, -0.35], [0.8, 0]],
      coins: [...coinRow(0.1, -0.4, 6), ...coinRow(0.35, 0.4, 6), ...coinRow(0.66, 0, 6), ...coinRow(0.9, 0.3, 6)],
    },
  ],
});

// Round upgrades sold in the store (one level each, for the race). Racer upgrades raise speed
// (top speed), haste (drift charge), might (boost length), armor (grass and wall losses) or magnet (coin reach).
upgrade("turbo", { stat: "might", step: 0.25, maxLevel: 1 });
upgrade("tuned_engine", { stat: "speed", step: 0.05, maxLevel: 1 });
upgrade("soft_tyres", { stat: "haste", step: 0.3, maxLevel: 1 });
upgrade("bumpers", { stat: "armor", step: 0.3, maxLevel: 1 });

// A clean race: finish without scraping a wall hard.
system("clean_line", ({ on, emit }) => {
  const scrapes = new Map<number, number>();
  on("kart.bumped", (ids) => {
    for (const id of ids) scrapes.set(id, (scrapes.get(id) ?? 0) + 1);
  });
  on("player.finished", (ids) => {
    const clean = ids.filter((id) => (scrapes.get(id) ?? 0) === 0);
    if (clean.length > 0) emit("race.clean", clean);
  });
  on("run.started", (ids) => {
    for (const id of ids) scrapes.delete(id);
  });
});

// Earn (mandatory). Pays the game's coins (1 coin = 1 token), once per race each.
// Seat bots never earn, and winning a field of bots pays nothing extra. Values are PLACEHOLDER.
earn.rule("hot_lap", { when: "drift.boosted", n: 3, pay: 4, oncePer: "run" });
earn.rule("chequered", { when: "player.finished", n: 1, pay: 10, oncePer: "run" });
earn.rule("clean_line", { when: "race.clean", n: 1, pay: 12, oncePer: "run" });
earn.rule("pole_to_flag", { when: "race.won", n: 1, pay: 25, oncePer: "run" });
// Buy-in run (the mandatory sink loop). PLACEHOLDER.
earn.stake({ min: 10, max: 100, multiple: 2 });

// Store (the Kit), priced in coins: round upgrades and two paint jobs owned for good.
store.sku("turbo", { coins: 40 });
store.sku("tuned_engine", { coins: 40 });
store.sku("soft_tyres", { coins: 60 });
store.sku("skin_flame", { coins: 300, grants: { cosmetic: 1 } });
store.sku("skin_chrome", { coins: 500, grants: { cosmetic: 2 } });
// Losable gear: bumpers in every staked race, lost when that race makes less than loseBelow of its most earn. PLACEHOLDER.
store.sku("bumper_kit", { coins: 120, grants: { gear: "bumpers", loseBelow: 0.25 } });
