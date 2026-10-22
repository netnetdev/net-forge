# Game design playbook

Rules every game on this engine follows. They come from measured play: the
first survivor build killed every player in 12 seconds, and a fun one kept
the same bot alive for minutes. The playtest gate measures most of them, and
a game that breaks them scores low.

## Every genre

1. **A readable opening, with real danger by 0:30.** The first threats
   reach the player by about 0:20, and health moves by 0:30 to 0:45. The
   first elite comes at about 0:45 and a mini-boss by 1:30 to 2:00. Nobody
   dies in the first minute. (The first cut's playtest found no danger for
   three minutes and scored 4/10. A quiet opening is not an empty one.)
2. **Reward fast.** The first reward (a level, a kill, a pickup) comes within
   about 10 seconds, then every 6 to 10 seconds for the first minute.
3. **Never spawn on screen.** Enemies arrive from just off screen:
   `director(...)` or `spawnEdge(prefab, { count })`, never `spawn()` or
   `spawnRing()` at short radii. Pressure follows a moving player, because
   stragglers far behind are recycled ahead of them.
4. **Hits are survivable.** Contact damage gives i-frames
   (`players.hitIframes`, 0.5 s). Twenty enemies touching you means one hit,
   not twenty.
5. **Slower than the player unless telegraphed.** Players run at 7 m/s.
   Fodder moves at 45 to 60% of that, and fast runners up to 85% but fragile.
   Anything faster or harder-hitting shows a telegraph first.
6. **Telegraph every big hit.** Charges, slams, blasts and boss patterns
   show a ground marker for 0.5 to 1 s, using shape and fill and not only
   red. Over half of late deaths should be telegraphed ones, which means the
   player misread the threat rather than the game being unfair.
7. **Death is not a waiting room.** A downed player bleeds for about 10 s
   and can crawl toward help. Each player gets one free self-revive per run.
   A player who is out comes back beside a teammate within seconds
   (`players.downed`), never "out until the next wave".
8. **A run has a timeline.** It plays like a story with moments: new enemy
   roles join one at a time, then elites, a mini-boss, an event, a flood, and
   a final boss. Announce each moment so players always know what just
   happened and where to go.
9. **Bosses are moments.** A boss has a silhouette no mob shares and one or
   two telegraphed attacks to learn. The first fight is short (about 45 s
   solo), and the reward pops: a hoard chest that brings an evolution onto
   the cards (`pickup: { effect: "chest", evolve: true }`).
10. **Tougher, not more.** Past the crowd cap, the director makes new enemies
   tougher instead of adding bodies. A boss alive halves the spawn rate, and
   bosses scale with players present.
11. **Builds have a goal.** Upgrades have numbers players can read ("+1 bolt",
   "-20% cooldown"). Each weapon pairs with a passive toward an evolution.
   Solo cards pause the game. Co-op cards do not pause, but they shove
   enemies back.
12. **Measure fun with bots.** The gate's human-like bot reacts 200 ms late,
    kites, and reads cards for a second. Fix what it reports before
    shipping.

## Horde (survivor-like) targets

| Metric | Target |
|---|---|
| First level | 4-10 s |
| First damage taken | 15-45 s |
| First elite / first mini-boss | ~0:45 / 1:30-2:00 |
| First mini-boss fight, solo | ~45 s |
| Level at 1:00 / 3:00 / 6:00 | ~5 / ~10 / ~15 |
| Deaths before 1:00 | 0 |
| Enemies on screen at 0:30 | 30-50 (wave-3 density in minute 1) |
| Touches taken in minute 1 | 1-3 |
| Spawns on screen | 0% |
| Time spent downed or out | under 10% |
| Solo survival, random picks | 4-7 min |

A good curve is `director({ alive: [[0, 20], [30, 55], [60, 100], [180, 220], [300, 560], [540, 1900]], rate: [[0, 2], [30, 4], [60, 5], [180, 8], [300, 16], [540, 64]], speed: [[0, 1], [240, 1], [600, 1.6]], elites: { from: 45, every: [40, 55] } })`.
Health and damage curves grow roughly ×1.35 per minute early and flatten
later. Early gems are worth a little less (`xp` 0.7 at first), so the dense
first minute does not run the levels hot. Late `speed` keeps endless
kiting from working. The 2,000-enemy crowd is a late-run payoff, not an
opening wall.

## Arena shooter

1. **First kill or pickup within about 20 s.** Spawns should be close enough
   to find a fight, and pickups worth walking to.
2. **Spawn safety.** No damage in the first 2 s after spawning, and under a
   quarter of deaths within 3 s of spawning. Spawn points sit out of sight
   lines, away from the middle.
3. **Contest the map.** Heals, power weapons and high ground make places
   worth fighting over. Put them in the open between spawns.
4. **Readable hits.** Hits flash, kills pop, the feed names who killed whom,
   and your own shot shows instantly on your screen, before the server
   agrees.
5. **Moments.** Announce streaks, put a bounty on the leader, and run a
   late-round event, so the lead changes hands. When one player has 3x the
   average kills, a weapon or a position dominates.
6. **Bots that ramp.** Seat bots fill rooms, play below a new player's level
   at first and get sharper as people win. They never stomp a newcomer.
   They never earn, and they are never a coin source: killing a bot scores
   but pays no earn rule, and "round.top" pays only with another person in
   the round. Earn comes from beating people.

## How a change request maps to the API

- **"Harder"**: raise the director's `alive`, `rate`, `health` or `damage`
  keyframes late in the run, never at 0 s.
- **"Easier"**: lower them, raise `players.hitIframes` or `magnet`, or give
  the starting weapon more range.
- **"More enemy types"**: add a prefab and a pool entry with `from: <seconds>`,
  one new idea at a time. Use `group: [8, 12]` for streams.
- **"Add a boss"**: add a prefab with `boss: { attacks: [...], rank }` and
  spawn it with `spawnEdge(id, { count: 1 })` from `after(seconds, ...)`.
  Give mini-bosses 3 attacks and the final boss 4. Its health scales with
  players present.
- **"Smarter" or "trickier enemies"**: give prefabs roles (`ai: "charger"`,
  `"ranged"`, `"bomber"`, `"shielder"`, `"summoner"`), or add elites.
- **"Add events" or "waves"**: use `every` or `after` in a system, with
  `spawnEdge(id, { count, side: "north" })` for a tide from one side,
  `xpBoost`, `surge` or a fleeing carrier with a chest. `announce` each one,
  never repeat the same event twice in a row, and skip events while
  `bossAlive()`.
- **"More loot" or "a map worth exploring"**: special pickups (heal,
  vacuum, bomb, chest) as rare drops, props to `scatter`, and a bigger `field`.
- **"Longer or shorter run"**: move the boss's `after(...)` and stretch the
  curves' keyframe times.
- **"More weapons" or "better builds"**: declare 5-8 `levels` per weapon
  (each a readable change), pair weapons with passives through `evolve`, and
  give evolutions a new shape. Keep weapons + evolutions within 15.
- **"Add a character" or "more heroes"**: `keeper(id, { weapon, passive,
  unlock })`, unlocked by an `achievement`, or declared without an unlock
  and sold (`store.sku(id, { coins, grants: { keeper: id } })`): earned or
  bought, never both. A keeper is a different way to play, never a stronger
  one, and the first keeper is always free.
- **"Reasons to come back"**: `achievement`s that unlock keepers,
  `mission`s for daily goals, `title`s for the end screen. None pay coins;
  coin rewards are earn rules, which are an economy decision. The room
  server grants them from the run and saves them per player, so they follow
  the player to every device.
- **"Sell character unlocks"**: a SKU per keeper with `grants: { keeper }`,
  on keepers declared without an `unlock`.
- **"Cosmetics only" or "no pay to win"**: `economy({ store: "cosmetics" })`
  and only SKUs with `grants: { cosmetic: n }`.
- **"Let players buy permanent upgrades with coins"**:
  `economy({ metaUpgrades: true })` and a few `metaUpgrade(...)`s (below).
- **"Better co-op"**: `players.share` ("nearby" is the default), a
  `reviveBuff`, `lateJoinBehind`, and `upcoming(...)` countdowns everyone
  sees.

## The recommended coin model, and why

Every game has coins (1 coin = 1 of the game's own token). How they are
spent decides whether the game stays fair to the player who never pays, and
whether a token holder can buy a win. The engine ships one recommended
model (ruled 2026-10-16) and makes the alternatives declarations, so a
change request is a one-line change, never new code.

**The default (no declaration; every template uses it).** Coins buy:

- **Cosmetics**: a look owned for good,
  `store.sku("skin_aurora", { coins: 300, grants: { cosmetic: 1 } })`.
- **Unlocks**: a keeper (a character, a starting loadout, a sidegrade)
  declared without an `unlock`,
  `store.sku("unlock_tinker", { coins: 400, grants: { keeper: "tinker" } })`.
  An unlock is a different way to play at the same power as the keepers
  anyone can earn by playing. A keeper is earned (by an achievement) or
  bought, never both, so a sold keeper cannot be opened another way.
- **In-run consumables**: used once, inside one run,
  `store.sku("revive", { coins: 50 })` (no `grants`).

Coins never buy permanent stat power by default. A run is decided by how it
was played, and a newcomer next to a long-time holder plays the same game.

**Cosmetics only (opt-in):** `economy({ store: "cosmetics" })`. The build
refuses any SKU that is not a look.

**Meta upgrades (opt-in, never the default):** permanent stat upgrades
bought with coins, the way many survivor-likes do between runs.

```ts
economy({ metaUpgrades: true });
metaUpgrade("hearth", { stat: "maxHealth", step: 0.05, levels: 3, cost: 120, growth: 2 });  // +5% a level: 120, 240, 480
metaUpgrade("stride", { stat: "speed", step: 0.03, levels: 3, cost: 100, growth: 1.8 });
```

The engine enforces hard caps that no game can raise: +15% to any one stat
from meta upgrades, +30% across all of them, at most 5 levels each and 8 per
game, and geometric costs (each level at least 1.5 times the last). The
room server applies a player's levels at the start of every run, capped
again, and the store shows each level's bonus and price. Use them only when
the creator asks for permanent upgrades, and keep steps small (3-5%).

**Before launch** coins are play money, and play money buys only in-run
items. Looks, unlocks and meta levels need real coins, so they open at
launch; nothing bought with play money persists or carries over.

**Where it is enforced.** Prices come from the manifest, never the client.
A purchase is a coin spend (earned coins first, then the wallet) that the
room server checks against that price before the item is owned, and the
item is saved in the player's profile on the server. Spent coins recycle
to the reward pool for other players, as every coin spend does.
