/**
 * COGSPIRE: the tower defense template (play style: tower defense).
 *
 * A brass clockwork spire stands at the end of an old rail road across the
 * moor. Rust swarms crawl the road toward it in waves. Up to four tinkers
 * share the board: each builds and upgrades brass towers with their own
 * gold, every kill pays its builder and a share to the rest, and the team
 * shares the spire's bells (lives). Hold twenty waves to keep the spire.
 *
 * This file is the whole game as the model writes it: declarations only,
 * against the typed API in @netforge/engine. The board, the waves,
 * targeting, co-op, netcode, renderer and referee are the template's
 * machinery.
 */
import { earn, game, prefab, store, tower, towerBoard, upgrade, waves } from "@netforge/engine";

export default game({
  template: "tower-defense",
  style: "lowpoly",
  places: { moor: { chunks: "places/moor", spawn: [0, 0, 0] } },
  players: { prefab: "style.lowpoly.worker", max: 4 },
});

// The board: 18 x 12 tiles of 2 m. The road enters at the west edge and winds to the spire on the east edge.
towerBoard({
  size: [18, 12],
  path: [
    [0, 2],
    [5, 2],
    [5, 8],
    [10, 8],
    [10, 3],
    [15, 3],
    [15, 9],
    [17, 9],
  ],
  blocked: [
    [2, 6],
    [3, 9],
    [8, 1],
    [12, 10],
    [13, 6],
  ],
  lives: 20,
  gold: 100,
  prep: 15,
  breather: 10,
  share: 0.25,
});

// Creeps. Health in hit points, speed in metres a second (a tile is 2 m), value is the gold bounty, damage the bells a leak costs.
prefab("rustling", { model: "style.lowpoly.slime_green", health: 26, speed: 1.6, value: 4 });
prefab("gearbeetle", { model: "style.lowpoly.crab", health: 90, speed: 1, value: 9, damage: 2 });
prefab("cinder_moth", { model: "style.lowpoly.bee", health: 20, speed: 3, value: 4 });
prefab("boilerback", { model: "style.lowpoly.robot_large", health: 1800, speed: 0.7, value: 80, damage: 5, boss: true });

// Towers. Damage a hit, rate in shots a second, range and radius in tiles. Each level is an upgrade: its cost and what it changes.
tower("bolt_post", {
  model: "style.lowpoly.turret",
  kind: "bolt",
  cost: 40,
  damage: 8,
  rate: 1.5,
  range: 3,
  levels: [
    { cost: 45, damage: 14 },
    { cost: 80, damage: 24, range: 3.5 },
    { cost: 140, damage: 40, rate: 2 },
  ],
});
tower("tar_mortar", {
  model: "style.lowpoly.turret_double",
  kind: "splash",
  cost: 70,
  damage: 12,
  rate: 0.6,
  range: 3.5,
  radius: 1.1,
  levels: [
    { cost: 70, damage: 20 },
    { cost: 120, damage: 34, radius: 1.4 },
  ],
});
tower("frost_vane", {
  model: "style.lowpoly.satellite_dish",
  kind: "frost",
  cost: 55,
  damage: 3,
  rate: 1,
  range: 2.6,
  slow: 0.45,
  slowSeconds: 1.6,
  levels: [
    { cost: 60, slow: 0.55, range: 3 },
    { cost: 100, damage: 8, slow: 0.65 },
  ],
});
tower("arc_coil", {
  model: "style.lowpoly.generator",
  kind: "chain",
  cost: 90,
  damage: 14,
  rate: 0.8,
  range: 3,
  chains: 3,
  levels: [
    { cost: 90, damage: 22, chains: 4 },
    { cost: 150, damage: 36, chains: 5 },
  ],
});

// Twenty waves. Each group joins at wave `from`, starts with `count` and adds `grow` a wave; a boss every tenth wave.
waves({
  total: 20,
  health: 0.3,
  groups: [
    { prefab: "rustling", count: 6, grow: 1.6, gap: 0.8 },
    { prefab: "gearbeetle", from: 3, count: 2, grow: 0.8, gap: 1.4, delay: 3 },
    { prefab: "cinder_moth", from: 5, count: 4, grow: 1.2, gap: 0.45, delay: 6 },
    { prefab: "boilerback", from: 10, every: 10, count: 1, delay: 8 },
  ],
});

// Store upgrades: one level each, for the rest of the run, on the buyer's own towers (spare_bell adds bells for the team).
upgrade("overclock", { stat: "haste", step: 0.15, maxLevel: 1 });
upgrade("tempered_brass", { stat: "might", step: 0.15, maxLevel: 1 });
upgrade("spyglass", { stat: "area", step: 0.12, maxLevel: 1 });
upgrade("spare_bell", { stat: "maxHealth", step: 5, maxLevel: 1 });

// Earn (mandatory). Pays the game's coins (1 coin = 1 token), once per run each. Values are PLACEHOLDER.
earn.rule("first_gear", { when: "wave.cleared", n: 3, pay: 5, oncePer: "run" });
earn.rule("long_shift", { when: "wave.cleared", n: 10, pay: 20, oncePer: "run" });
earn.rule("boiler_breaker", { when: "boss.killed", n: 1, pay: 50, oncePer: "run" });
earn.rule("scrap_heap", { when: "enemy.killed", n: 60, pay: 5, oncePer: "run" });
// Buy-in run (the mandatory sink loop): stake coins at run start to earn above free play.
// A staked run also pays up to stake x multiple, by the share of this run's earn the player makes. Values are PLACEHOLDER.
earn.stake({ min: 20, max: 200, multiple: 2 });

// Store (the Kit), priced in coins: four run upgrades and two cosmetic finishes owned for good (kept in the profile).
store.sku("overclock", { coins: 40 });
store.sku("tempered_brass", { coins: 40 });
store.sku("spyglass", { coins: 60 });
store.sku("spare_bell", { coins: 50 });
store.sku("skin_verdigris", { coins: 300, grants: { cosmetic: 1 } });
store.sku("skin_gilt", { coins: 500, grants: { cosmetic: 2 } });
// Losable gear: owned for good until lost. It brings one level of its upgrade into every staked run,
// and is lost when that run makes less than loseBelow of its most earn. Values are PLACEHOLDER.
store.sku("brass_gear", { coins: 150, grants: { gear: "tempered_brass", loseBelow: 0.25 } });
