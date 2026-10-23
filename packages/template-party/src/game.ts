/**
 * ROMPHOUSE: the party co-op template ("party co-op").
 *
 * Two to eight friends in one big playroom, five quick rounds a show. Each
 * round is a different minigame with one goal for the whole team: pop the
 * party poppers before the timer, crash every gift box, catch the runaway
 * pup, hold the floor against a tide, and as the finale burst the Big
 * Balloon. Win three of five and the show is a hit. Weapons fire by themselves, so every round
 * is about where you stand and who you help up.
 *
 * This file is the whole game as the model writes it: declarations only,
 * against the typed API in @netforge/engine. The rounds are the "show"
 * system below: a list of minigames, each a few lines of start, check and
 * finish. Everything else (sim, netcode, renderer, referee) is the
 * template's machinery. Design rules: packages/engine/GAME-DESIGN.md.
 */
import { achievement, earn, game, keeper, mission, prefab, store, system, title, upgrade, weapon } from "@netforge/engine";

/** The playroom: one 60 m room (its floor and four walls), with party tables to dodge round. */
const ROOM = 30;

export default game({
  template: "party",
  style: "lowpoly",
  places: { playroom: { chunks: "places/playroom", spawn: [0, 1, 0] } },
  field: {
    halfSize: ROOM + 2,
    pillars: [
      [12, 12, 1.6], [-12, 12, 1.6], [12, -12, 1.6], [-12, -12, 1.6],
      [0, 21, 2], [0, -21, 2], [21, 0, 2], [-21, 0, 2],
    ],
    floors: [[0, 0, ROOM, ROOM]],
    walls: [[0, ROOM + 1, ROOM + 2, 1], [0, -ROOM - 1, ROOM + 2, 1], [ROOM + 1, 0, 1, ROOM], [-ROOM - 1, 0, 1, ROOM]],
  },
  look: { preset: "studio", bloom: 1.1, saturation: 1.2, vignette: 0.25 },
  players: {
    prefab: "style.lowpoly.blocky_c",
    max: 8,
    weapon: "confetti_pop",
    xp: { base: 2, growth: 2, exponent: 2 },
    magnet: 4.5,
    hitIframes: 0.8,
    share: "all",
    crit: { chance: 0.1, multiplier: 2 },
    reviveBuff: { seconds: 5, damage: 1.3, speed: 1.2 },
    bossHealthPerPlayer: 0.35,
    // A party forgives: a short down, two free get-ups a show, back in 3 s.
    downed: { seconds: 8, crawl: 0.5, selfRevives: 2, respawn: 3 },
  },
});

// The party crowd. Health in hit points, speed in m/s (players run at 7), damage per touch.
const GIFT = [{ id: "cake_slice", chance: 0.02 }, { id: "party_magnet", chance: 0.01 }];
prefab("popper", { model: "style.lowpoly.slime_pink", appearance: { tint: "#ff7ab8" }, health: 16, speed: 3.6, radius: 0.4, damage: 5, ai: "chase", drops: ["star_small", ...GIFT] });
prefab("fizz", { model: "style.lowpoly.bee", appearance: { tint: "#7affd4" }, health: 8, speed: 5.4, radius: 0.28, damage: 3, ai: "runner", drops: ["star_small", ...GIFT] });
prefab("wobbler", { model: "style.lowpoly.blob_ninja", appearance: { tint: "#c9a7ff" }, health: 50, speed: 2.5, radius: 0.55, damage: 9, ai: "tank", mass: 3, drops: ["star_mid"] });
prefab("spritzer", { model: "style.lowpoly.frog", appearance: { tint: "#5ec8ff", scale: 0.45 }, health: 20, speed: 2.8, radius: 0.4, damage: 4, ai: "ranged", attack: { damage: 7, range: 9, speed: 7 }, drops: ["star_small"] });
prefab("party_pup", { model: "style.lowpoly.pug", appearance: { tint: "#ffd36b" }, health: 70, speed: 6, radius: 0.45, damage: 0, ai: "flee", drops: [{ id: "party_chest", chance: 1 }] });
prefab("gift_box", { model: "style.lowpoly.crate", appearance: { tint: "#ff5a7a", accent: "#ffe066" }, health: 30, speed: 0, radius: 0.55, damage: 0, prop: true, drops: ["star_mid", { id: "cake_slice", chance: 0.2 }] });
// The Big Balloon: the show's boss round. Two telegraphed attacks and a burst of prizes.
prefab("big_balloon", {
  model: "style.lowpoly.jelly_flyer",
  appearance: { tint: "#ff5a7a", accent: "#ffe066", scale: 1.4 },
  health: 650,
  speed: 2.4,
  radius: 1.3,
  damage: 12,
  // It bounces after you: a slam ring around it, and a leap that lands on a circle at you.
  boss: { attacks: ["slam", "leap"], rank: "mini" },
  drops: ["star_large"],
});

// Prizes: stars are XP; cake heals, the magnet pulls every star, the chest is a pick.
prefab("cake_slice", { model: "style.lowpoly.cell_heal", appearance: { tint: "#ffd1e8" }, health: 1, speed: 0, kind: "pickup", pickup: { effect: "heal", amount: 0.3 } });
prefab("party_magnet", { model: "style.lowpoly.crystal", appearance: { tint: "#7ad7ff" }, health: 1, speed: 0, kind: "pickup", pickup: { effect: "vacuum" } });
prefab("party_chest", { model: "style.lowpoly.chest", appearance: { tint: "#ffcf5a" }, health: 1, speed: 0, kind: "pickup", pickup: { effect: "chest", amount: 1 } });
prefab("prize_hoard", { model: "style.lowpoly.chest", appearance: { tint: "#ff7ab8", scale: 1.5 }, health: 1, speed: 0, kind: "pickup", pickup: { effect: "chest", amount: 2, evolve: true } });
prefab("star_small", { model: "style.lowpoly.gem_small", appearance: { tint: "#ffe066" }, health: 1, speed: 0, kind: "pickup", value: 1 });
prefab("star_mid", { model: "style.lowpoly.gem_mid", appearance: { tint: "#ffb347" }, health: 1, speed: 0, kind: "pickup", value: 6 });
prefab("star_large", { model: "style.lowpoly.gem_large", appearance: { tint: "#ff7ab8" }, health: 1, speed: 0, kind: "pickup", value: 40 });

// Weapons fire by themselves. Cooldowns in seconds, ranges in metres.
weapon("confetti_pop", {
  kind: "nova", damage: 12, cooldown: 1, range: 3.6, knockback: 3,
  levels: [{ damage: "+30%" }, { range: "+15%" }, { cooldown: "-15%" }, { damage: "+30%" }, { range: "+15%" }],
  evolve: { into: "confetti_cannon", requires: "sugar_rush" },
});
weapon("streamer", {
  kind: "bolt", damage: 13, cooldown: 0.6, range: 13, speed: 24, pierce: 1, knockback: 2,
  levels: [{ count: 1 }, { damage: "+40%" }, { cooldown: "-20%" }, { pierce: 1 }, { count: 1 }],
  evolve: { into: "streamer_storm", requires: "party_hat" },
});
weapon("spinning_plates", {
  kind: "orbit", damage: 8, cooldown: 0.1, range: 2.4, count: 2, speed: 3.8, knockback: 3,
  levels: [{ count: 1 }, { damage: "+30%" }, { range: "+20%" }, { count: 1 }, { damage: "+40%" }],
  evolve: { into: "plate_carousel", requires: "disco_ball" },
});
weapon("pie_toss", {
  kind: "meteor", damage: 34, cooldown: 2, range: 11, count: 1, blast: 1.8, knockback: 6,
  levels: [{ count: 1 }, { damage: "+40%" }, { cooldown: "-20%" }, { count: 1 }, { damage: "+40%" }],
});
weapon("limbo_bar", {
  kind: "cone", damage: 16, cooldown: 1.1, range: 4, spread: 110, knockback: 6,
  levels: [{ damage: "+30%" }, { spread: 40 }, { range: "+20%" }, { cooldown: "-20%" }, { damage: "+40%" }],
});
weapon("kazoo_chain", {
  kind: "chain", damage: 15, cooldown: 1.3, range: 9, count: 2, speed: 4, knockback: 1,
  levels: [{ count: 1 }, { damage: "+35%" }, { count: 1 }, { cooldown: "-20%" }, { count: 2 }],
});

// Evolutions: about x1.7 damage and a new shape. Never offered on their own.
weapon("confetti_cannon", { kind: "nova", damage: 36, cooldown: 0.8, range: 8, knockback: 9 });
weapon("streamer_storm", { kind: "bolt", damage: 30, cooldown: 0.4, range: 15, speed: 28, count: 6, pierce: 3, knockback: 3 });
weapon("plate_carousel", { kind: "orbit", damage: 18, cooldown: 0.1, range: 3.6, count: 6, speed: 4.6, knockback: 4 });

// Passive upgrades offered at level-up. Each evolution pairs with one.
upgrade("dance_shoes", { stat: "speed", step: 0.07, maxLevel: 5 });
upgrade("second_helping", { stat: "maxHealth", step: 20, maxLevel: 5 });
upgrade("party_hat", { stat: "amount", step: 1, maxLevel: 2 });
upgrade("sugar_rush", { stat: "haste", step: 0.06, maxLevel: 5 });
upgrade("disco_ball", { stat: "area", step: 0.1, maxLevel: 5 });
upgrade("lucky_sock", { stat: "might", step: 0.1, maxLevel: 5 });
upgrade("goodie_bag", { stat: "magnet", step: 0.8, maxLevel: 4 });

/** Seconds a round runs, the breather between rounds, and the rounds won that make the show a hit. */
const ROUND_SECONDS = 40;
const BREATHER = 6;
const HIT_AT = 3;
const SIDES = ["north", "south", "east", "west"] as const;
/** Everything a round brings in: cleared off the floor between rounds. */
const SWEEP = ["popper", "fizz", "wobbler", "spritzer", "party_pup", "gift_box", "big_balloon"];

system("show", ({ every, after, onTick, tick, players, spawnEdge, scatter, alive, clear, emit, announce, upcoming, respawnDead, random, on, end }) => {
  // The five minigames, shuffled each show. start() runs as the round opens; won() is checked every half second
  // (true ends it early), and at the bell the round is won if won() holds or `lastsOut` (nobody fell).
  let kills = 0;
  let downs = 0;
  let pupCaught = false;
  let balloonBurst = false;
  const party = () => Math.max(1, players().length);
  const poppers = () => 40 + 12 * (party() - 1);
  interface Round {
    readonly name: string;
    readonly seconds: number;
    start(): void;
    won(): boolean;
    readonly lastsOut?: boolean;
  }
  const ROUNDS: Round[] = [
    {
      name: "POP THE PARTY",
      seconds: ROUND_SECONDS,
      start: () => {
        spawnEdge("popper", { count: 10 });
        every(2, () => {
          if (current === 0) spawnEdge(random() < 0.25 ? "fizz" : "popper", { count: 4 + party() });
        });
      },
      won: () => kills >= poppers(),
    },
    {
      name: "CRATE CRASH",
      seconds: 40,
      start: () => {
        scatter("gift_box", 14 + 3 * party());
        spawnEdge("popper", { count: 6 });
        every(5, () => {
          if (current === 1) spawnEdge("popper", { count: 3 + party() });
        });
      },
      won: () => alive("gift_box") === 0,
    },
    {
      name: "CATCH THE PUP",
      seconds: 30,
      start: () => {
        spawnEdge("party_pup", { count: 1, side: "ahead", spread: 90 });
        spawnEdge("wobbler", { count: 2 + Math.floor(party() / 2) });
        // The pup's friends keep getting in the way.
        every(5, () => {
          if (current === 2) spawnEdge("fizz", { count: 2 + Math.floor(party() / 2) });
        });
      },
      won: () => pupCaught,
    },
    {
      name: "HOLD THE FLOOR",
      seconds: 35,
      lastsOut: true,
      start: () => {
        const tide = () => {
          if (current !== 3) return;
          const side = SIDES[Math.floor(random() * SIDES.length)] ?? "north";
          spawnEdge("popper", { count: 18 + 4 * party(), side, spread: 80 });
          spawnEdge("spritzer", { count: 2, side, spread: 60 });
        };
        tide();
        every(9, tide);
      },
      won: () => false,
    },
    {
      name: "BURST THE BIG BALLOON",
      seconds: 60,
      start: () => {
        spawnEdge("big_balloon", { count: 1 });
        spawnEdge("fizz", { count: 6 });
        // Its fizz keep coming while it floats.
        every(6, () => {
          if (current === 4) spawnEdge("fizz", { count: 2 + Math.floor(party() / 2) });
        });
      },
      won: () => balloonBurst,
    },
  ];
  // The show's order: the first four shuffled on the sim's random, so every show plays differently;
  // the Big Balloon is always the finale.
  const order = ROUNDS.map((_, i) => i);
  for (let i = order.length - 2; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j] ?? 0, order[i] ?? 0];
  }
  let step = -1;
  let current = -1;
  let endsAt = 0;
  let wins = 0;
  const sweep = () => {
    for (const id of SWEEP) clear(id);
  };
  const next = () => {
    step++;
    if (step >= order.length) {
      const score = wins + " OF " + order.length;
      announce(wins >= HIT_AT ? "A HIT · " + score : "THE SHOW IS OVER · " + score, { tone: wins >= HIT_AT ? "reward" : "info" });
      if (wins === order.length) emit("show.perfect");
      after(3, () => end(wins >= HIT_AT ? "won" : "lost"));
      return;
    }
    const r = ROUNDS[order[step] ?? 0] as Round;
    current = order[step] ?? 0;
    kills = 0;
    downs = 0;
    pupCaught = false;
    balloonBurst = false;
    announce("ROUND " + (step + 1) + " · " + r.name, { tone: "info" });
    upcoming(r.name, r.seconds);
    endsAt = tick() + r.seconds * 30;
    r.start();
  };
  const finish = (won: boolean) => {
    const r = ROUNDS[current];
    current = -1;
    if (won) {
      wins++;
      emit("round.won");
      announce((r?.name ?? "ROUND") + " · WON", { tone: "reward" });
    } else announce((r?.name ?? "ROUND") + " · MISSED", { tone: "danger" });
    emit("wave.cleared");
    // The round's clock gives way to the breather's (the last round has none: the show ends).
    if (step + 1 < order.length) upcoming("NEXT ROUND", BREATHER);
    after(1.5, sweep);
    after(2, () => respawnDead());
    after(BREATHER, next);
  };
  on("enemy.killed", (ids) => {
    if (current >= 0) kills += Math.max(1, ids.length);
  });
  on("player.downed", () => {
    if (current >= 0) downs++;
  });
  on("party_pup.killed", () => {
    pupCaught = true;
  });
  on("miniboss.killed", () => {
    balloonBurst = true;
  });
  onTick(() => {
    if (current < 0 || tick() % 15 !== 0) return;
    const r = ROUNDS[current] as Round;
    if (r.won()) finish(true);
    else if (tick() >= endsAt) finish(r.lastsOut === true && downs === 0);
  });
  // Doors open: a few poppers wander in while the first round is announced.
  after(0.5, () => spawnEdge("popper", { count: 4 + party() }));
  after(2, next);
});

// Keepers: pick one before your first level. New keepers unlock with achievements, never with coins.
keeper("host", { name: "Host", text: "Confetti all round and quick on the feet.", weapon: "confetti_pop", passive: "dance_shoes" });
keeper("juggler", { name: "Juggler", text: "Spinning plates and a wider spin.", model: "style.lowpoly.blocky_k", tint: "#7ad7ff", weapon: "spinning_plates", passive: "disco_ball", unlock: "first_hit" });
keeper("pie_chef", { name: "Pie Chef", text: "Pies from on high, and seconds.", model: "style.lowpoly.blocky_f", tint: "#ffb347", weapon: "pie_toss", passive: "second_helping", unlock: "balloon_popper" });

// Achievements (counted in a show; they unlock keepers and pay nothing).
achievement("first_hit", { title: "Crowd Pleaser", text: "Win three rounds in one show.", when: "round.won", n: 3 });
achievement("balloon_popper", { title: "Pop Goes", text: "Burst the Big Balloon.", when: "miniboss.killed" });
achievement("perfect_show", { title: "Standing Ovation", text: "Win every round of a show.", when: "show.perfect" });

// Daily goals: the HUD shows three a day. They pay nothing.
mission("rounds", { text: "Win 3 rounds", when: "round.won", n: 3 });
mission("pup", { text: "Catch the pup", when: "party_pup.killed" });
mission("revive", { text: "Help a friend up", when: "player.revived" });
mission("chest", { text: "Open 2 chests", when: "chest.collected", n: 2 });
mission("balloon", { text: "Burst the Big Balloon", when: "miniboss.killed" });

// End-screen titles: who stole the show at what.
title("life_of_party", { text: "Life of the Party", most: "kills" });
title("showstopper", { text: "Showstopper", most: "damage" });
title("good_friend", { text: "Good Friend", most: "revives" });
title("on_their_feet", { text: "On Their Feet", least: "downs" });
title("snacker", { text: "Snacker", most: "pickups" });

// Earn (mandatory). Pays the game's coins (1 coin = 1 token), once per show each.
// Pay amounts copy EMBERWATCH's (5, 20, 50, 5) until ROMPHOUSE's own are set: PLACEHOLDER.
earn.rule("first_win", { when: "round.won", n: 1, pay: 5, oncePer: "run" });
earn.rule("crowd_favourite", { when: "round.won", n: 4, pay: 20, oncePer: "run" });
earn.rule("full_house", { when: "show.perfect", n: 1, pay: 50, oncePer: "run" });
earn.rule("confetti_storm", { when: "enemy.killed", n: 70, pay: 5, oncePer: "run" });
// Buy-in run (the mandatory sink loop): stake coins at the start of a show to earn above free play.
// Values are PLACEHOLDER.
earn.stake({ min: 20, max: 200, multiple: 2 });

// Store (the Kit), priced in coins (the default coin model). Prices copy EMBERWATCH's: PLACEHOLDER.
store.sku("revive", { coins: 50 });
store.sku("skin_disco", { coins: 300, grants: { cosmetic: 1 } });
// Losable gear: owned for good until lost in a staked show that makes less than loseBelow of its most earn.
store.sku("lucky_charm", { coins: 150, grants: { gear: "lucky_sock", loseBelow: 0.25 } });
