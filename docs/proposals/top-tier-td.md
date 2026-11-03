# Proposal: bring the tower-defense genre to industry-competitive depth

Status: draft / architecture. Target: a sequence of small, back-compatible,
server-authoritative PRs that extend the **declarative** `tower-defense` API so
a game built with it can compete with Kingdom Rush, Bloons TD 6 and PvZ —
without a game ever writing sim, netcode or renderer code.

## 1. Where the genre stands today

The current declarative API (`packages/engine/src/api/tower.ts`) gives a game:

- **One board, one path.** `towerBoard({ size, path, blocked, lives, gold, prep, breather, share, waveGold, refund })` — a single orthogonal road, start/end on edge.
- **8 towers, 4 kinds.** `tower(id, { model, kind: bolt|splash|frost|chain, cost, damage, rate, range, radius, slow, chains, levels[] })` — **linear** upgrades, max 4 levels.
- **Creeps = prefabs.** `model, health, speed, value, damage, boss`.
- **Waves.** `waves({ total, groups[], health })` — per-group `from/until/every/count/grow/gap/delay`.
- **Co-op economy.** shared lives, bounty `share`, `waveGold`, `refund`, earn rules + store.

That is a complete *one-map* TD. The gap to a top-tier title is five systems.

## 2. The gap (what industry leaders have that we don't)

| System | Kingdom Rush / Bloons / PvZ | Today | 
|---|---|---|
| **Maps** | rosters of distinct maps, level select, difficulty modes, star ratings | one board |
| **Paths** | multiple entries, branching / merging lanes | one path |
| **Enemy depth** | flying, armored, magic-resist, camo/stealth, regen, shields, splitting, boss abilities | hp/speed/boss only |
| **Tower depth** | upgrade **trees** (KR 2-branch, Bloons 3-path crosspath), roles: anti-air, detection, support auras, economy/income | linear 4-level, no roles |
| **Abilities** | player "superpowers" on cooldown (airstrike, reinforcements, freeze) + heroes with abilities & leveling | none |

## 3. Design constraints (non-negotiable — this is what keeps the model safe)

Every addition must be:

1. **Pure data.** A new `zod` field or declaration, never executable game code. The build still refuses any import but `@netforge/engine`.
2. **Server-authoritative.** The sim/referee enforces everything; the client only renders and sends *intents* (`build(tile)`, `upgrade(tower, branch)`, `activate(power, target)`). Prices, cooldowns, and effects are validated server-side — the same reason coins are safe.
3. **Deterministic.** Fixed-tick sim runs identically on client and room server; no wall-clock, no `Math.random` outside the seeded RNG.
4. **Back-compatible.** New fields are optional; every existing game compiles byte-identically. We prove this with a golden-manifest test per PR (the pattern `feat/tower-targeting` already set).

## 4. The feature program — each designed as a declarative extension

Designs below are concrete `zod`/API shapes. Sim- and client-hook specifics are
anchored to the real files; exact line insertion points are tracked in §6.

### Feature C — Enemy properties *(highest depth-per-effort; recommend first)*

The single biggest gameplay lever and the most self-contained. Creeps stay
`prefab(...)`s; the TD sim starts honoring optional fields it currently ignores.

```ts
// On a prefab used as a creep (all optional, all ignored by non-TD templates):
flying: true,                       // only towers that can hit air may target it
armor: 4,                           // flat damage removed per hit (floor 1)
resist: { physical: 0.5, magic: 0 },// fractional resist by damage school
camo: true,                         // invisible unless a detector reveals it
regen: 6,                           // hp healed per second while alive
shield: 120,                        // absorbed before hp is touched
split: { into: "panic_seller", count: 2 }, // on death, spawn N at the death point
```

Towers gain matching optional fields:

```ts
air: true,        // may target flying creeps (default false → ground only)
detect: true,     // reveals & may target camo creeps in range
school: "magic",  // damage school for resist (default "physical")
```

- **Sim:** targeting filters candidates by `flying`/`camo` vs tower `air`/`detect`; damage applies `armor` → `resist[school]` → `shield` → hp; `regen` ticks; **`split` finally spawns on death** (long-requested, currently validated-but-ignored).
- **Client:** flying creeps render at altitude; camo creeps dim until a detector's radius covers them; shield shows as an overlay bar.
- **Tests:** flying creep leaks past a ground-only field; armored creep survives N hits a bolt would otherwise kill; camo invisible to non-detectors, killed once a detector is in range; split spawns exactly `count`; regen out-heals low DPS.
- **Safety:** all enforced in the sim; client can't fake a kill.

### Feature A — Multi-path (parallel lanes) *(the headline ask)*

Generalize the single road to 1–4 independent lanes.

```ts
towerBoard({
  size: [18, 12],
  paths: [                                   // 1..4 roads; `path` stays as sugar for one
    [[0, 3], [9, 3], [9, 3], [17, 3]],
    [[0, 9], [9, 9], [17, 9]],
  ],
  lives: 20, gold: 120,
});
// Waves route a group down a lane:
waves({ total: 20, groups: [
  { prefab: "panic_seller", lane: 0, count: 8, grow: 1.5 },
  { prefab: "fud_bot",      lane: 1, from: 5, count: 6 },
]});
```

- **Sim:** the creep-walk loop becomes per-lane; each creep carries `laneIndex` and walks `paths[laneIndex]`. Towers hit any creep in range regardless of lane. Lives/economy stay shared. Leaks counted at each lane's end.
- **Client:** draw every lane; the build grid blocks all lane tiles.
- **Validation:** each lane orthogonal, start & end on edge; `lane` indexes an existing path.
- **Back-compat:** `path: X` normalizes to `paths: [X]`; `lane` defaults to spreading groups across lanes (or lane 0 when one lane).
- **Tests:** two lanes both leak independently; a group with `lane: 1` spawns only on lane 1; single-path games unchanged.
- **Branching/merging lanes** (shared segments that split or join) are a harder v2 on top of this — parallel lanes first.

### Feature E — Tower roles (support auras, economy, + the air/detect from C)

Additive optional tower fields the sim reads.

```ts
tower("war_room", { model, kind:"bolt", cost, damage, rate, range,
  aura: { stat: "rate", amount: 0.2, radius: 2.5 },   // +20% fire rate to towers in radius
});
tower("bank_desk", { model, kind:"bolt", cost, damage:0, rate:0.1, range:1,
  income: { gold: 15, every: 3 },                      // generates gold over time
});
```

- **Sim:** auras recompute a tower's effective stats from overlapping auras each tick (deterministic order by tower id); income ticks gold on the owner.
- **Client:** aura radius ring; income floaties.
- **Tests:** a tower inside an aura fires faster; removing the aura tower reverts it; income accrues at the declared cadence; auras don't stack beyond a documented cap.

### Feature D — Tower upgrade trees (branching paths)

Replace the single `levels[]` with Kingdom-Rush-style branches (then Bloons
crosspath as a follow-on).

```ts
tower("short_seller", { model, kind:"bolt", cost, damage, rate, range,
  branches: [
    { name: "Sniper",  tiers: [ {cost, damage}, {cost, range}, {cost, damage, pierce:2} ] },
    { name: "Gatling", tiers: [ {cost, rate},   {cost, rate},  {cost, rate, damage} ] },
  ],
  crosspath: { maxTotal: 4, maxSecond: 2 },  // Bloons-style cap; omit for strict single-branch
});
```

- **Sim:** per-tower-instance state is the tiers bought per branch; `statsAt` accumulates chosen tiers; crosspath caps enforced on the upgrade intent.
- **Client:** the upgrade panel shows branches and gates tiers by the crosspath rule.
- **Tests:** buying down one branch stacks its tiers; crosspath cap rejects an illegal 3rd-tier second branch; `levels[]` still works (normalize to a single branch).
- Larger (instance state + client UI) → lands after C/A/E.

### Feature F — Activated abilities & heroes ("superpowers")

Two tiers. Board **powers** first (contained), **heroes** later (new entity).

```ts
// Board-level power the player activates on cooldown (airstrike, freeze, reinforce):
power("margin_call_airstrike", { cooldown: 25, target: "point",
  effect: { kind: "burst", damage: 200, radius: 2 } });
power("circuit_halt", { cooldown: 40, target: "none",
  effect: { kind: "slowAll", slow: 0.6, seconds: 4 } });

// Per-tower activated ability (a temporary boost or a nuke):
tower("...", { /* ... */ ability: { cooldown: 18, target: "point",
  effect: { kind: "rateBoost", amount: 1.0, seconds: 5 } } });
```

- **Sim/referee:** an `activate(powerId, target)` intent validated against cooldown and (optional) coin/gold cost; effects applied in-sim.
- **Client:** a power bar with cooldown sweeps; targeting cursor for `target:"point"`.
- **Heroes** (a controllable/auto unit that moves, levels, and has abilities) are a new sim entity + input channel — the largest item, **proposal-issue-first**, after powers prove the ability plumbing.

### Feature B — Map roster, level select, difficulty, stars (campaign meta)

The capstone. Multiple boards + a progression the hosted server tracks per
player (like achievements/titles already do).

```ts
towerBoard("harbour", { size, paths, ..., stars: { two: 15, three: 20 } }); // lives kept at end
towerBoard("crypt",   { size, paths, ... });
levels({ order: ["harbour", "crypt", "exchange"], unlock: "sequential",
  modes: [ { id:"normal" }, { id:"hard", health: 0.18, lives: 12 } ] });
```

- **Sim:** each run loads one board; mostly unchanged per-run. New is the *meta* layer: level select, unlock state, star records.
- **Client:** a level-select screen (lives in `packages/tabletop` boot) + mode picker + star display.
- **Persistence:** reuse the existing per-player server profile (where titles/achievements already persist) — no new trust surface.
- Biggest client/meta surface → lands last, or in parallel by a different contributor since it barely touches the per-run sim.

## 5. Recommended PR sequence (small → large, each shippable & back-compat)

1. **PR-C Enemy properties** (flying/armor/resist/camo/regen/shield/**split**) + tower `air`/`detect`/`school`. Self-contained, massive depth, fixes the ignored `split`.
2. **PR-A Multi-path parallel lanes** + `waves` `lane`. The headline map feature.
3. **PR-E Tower roles** (aura/income). Additive.
4. **PR-D Tower upgrade trees** (+ crosspath). Sim instance state + client UI.
5. **PR-F1 Board powers / abilities.** The activated "superpowers."
6. **PR-B Map roster + level select + stars + difficulty.** Campaign meta.
7. **PR-F2 Heroes.** Largest; proposal-issue-first.

Each PR = `zod` schema (`api/tower.ts`) + sim (`rules/tower.ts`) + client (`template-tower/client`) + validation messages + `vitest` unit tests + a golden back-compat test + a playtest on an updated template. Per `CONTRIBUTING.md`, PRs 4–7 open a proposal issue first.

## 6. Sim / client insertion points (ground-truthed against the source)

Genre sim: `packages/engine/src/rules/tower.ts`. Fixed-point: `Q=256`/tile,
`TILE_M=2`, `TICK=30`. A creep stores progress `d` (Q units) and **no x/y** —
position is derived from `d` via `roadPoint`.

- **Multi-path / maps.** Schema `path` api/tower.ts:24 + validator api/tower.ts:158-173. `CompiledBoard` (one `path/cum/length/road`) tower.ts:124-134; `compileBoard` tower.ts:151-170; `roadPoint(b,d)` tower.ts:173-186. `Creep` has no path index (tower.ts:30-49); the walk/leak loop tower.ts:617-636 and `creepQ` tower.ts:382 use the single `b.length`; spawn sets `d:0` tower.ts:590-614. → add `paths[]` to the schema, make `compileBoard` emit per-road `cum/length` + a merged `road` set, give `Creep` a `path` index, thread it through `roadPoint`/walk/`creepQ`, and assign it at spawn from a wave-group `lane`. Client draws from `b.path` (main.ts:142-182, 722-733) — generalize to `b.paths`. A *map roster* additionally needs `compileTowerGame`/`towerGame()` (tower.ts:220, manifest.ts:33) to hold multiple boards + a pre-boot picker.
- **Per-creep properties.** `compileTowerGame` reads only `model,health,speed,value,damage,boss` from each prefab (tower.ts:222-227); **everything else, including `split` and the rich `boss` object, is dropped** (`split` confirmed never spawned — `kill()` tower.ts:357-374). → carry new fields into `CompiledTowerGame.creeps` (tower.ts:207,222-227) + the `Creep` struct (tower.ts:30-49, spawn tower.ts:597-612); apply armor/shield in `hit` tower.ts:376-380, flying/camo as target predicates in `fire`/`pickTarget` tower.ts:394-402, regen in the walk loop tower.ts:617-636, `split` in `kill` tower.ts:357-374; add `CreepFlag`s (tower.ts:28) + `entities()` fields (tower.ts:683-694) for the renderer (main.ts:501-528).
- **Tower upgrade trees.** `levels` schema api/tower.ts:47-81; `CompiledTower.levels/upgradeCost` tower.ts:118-121,230-235; `statsAt` tower.ts:188-201; `Tower.level` (single int) tower.ts:57; the `Upgrade` act ignores its `i.a` arg today tower.ts:546-554; client panel main.ts:627-661. → branches in the schema, a tree in `CompiledTower`, per-branch tiers in `Tower`, branch-aware `statsAt`, `Upgrade` reads the branch choice.
- **Activated abilities / powers.** New `TowerAct` code tower.ts:25 + an `act` branch tower.ts:523-562; cooldown/energy on `Tower` tower.ts:51-66; effects beside `fire` tower.ts:384-451; `entities()` tower.ts:691-693 + a client button mirroring sell/upgrade main.ts:643-658. No ability schema exists yet — add to `towerSchema` api/tower.ts:66-81 (and a top-level `power(...)` declaration).

**Test harness.** Vitest; engine unit tests in `packages/engine/test/*.test.ts`
(the targeting PR added `tower-targeting.test.ts` as pure unit tests of the
exported `pickTarget`). Headless playtest = `engine.test.run(...)` →
`playRules` in `rules/harness.ts` (builds the real adapter, runs bots, applies
the referee `genre.checks`). Run engine tests: `pnpm --filter @netforge/engine test`
(narrow with `exec vitest run <name>`). Node 22 + pnpm 10.33.2 (corepack).

## 7. Build status — all five prototyped & green

Each feature is a branch off `main`, back-compatible (the existing single-path
COGSPIRE game plays byte-identically, proven by the template playtest on every
branch). Headless gameplay is fully tested; the three client UIs noted below are
the only work left, and they need visual QA rather than new sim logic.

| Branch | Feature | New tests | Client work remaining |
|---|---|---|---|
| `feat/tower-multipath` | **A** Multi-path (parallel lanes) + `lane` | 19 (17 unit + 2 play) | **none — client done** (rails/spires/gates/leaks per road) |
| `feat/tower-enemy-traits` | **C** flying/armor/resist/camo/regen/shield + `split` | 14 (9 unit + 5 play) | flying altitude, camo dimming, shield bars (wire flags emitted) |
| `feat/tower-upgrade-trees` | **D** Kingdom-Rush branches | 11 (8 unit + 3) | the branch-picker upgrade panel |
| `feat/tower-powers` | **F1** activated powers (burst/slow) | 3 (compile + sim-drive) | the power bar + aim cursor |
| `feat/tower-map-roster` | **B** named boards + `campaign` | 4 (compile/order/modes/validation) | level-select screen + mode picker + stars |

- **Pure helpers unit-tested** (the targeting-PR pattern): `roadPoint`,
  `creepDefense`, `regenHeal`, `applyTiers`, `branchAllowed`, `boardGeometryIssues`.
- **Behavioural playtests** prove flying/camo need anti-air/detection, `split`
  multiplies kills, a branching tower and a two-lane board play to completion,
  and a burst power kills then respects its cooldown.
- **Regression:** on every branch the full engine suite and the template-tower
  playtest (8/8) stay green, and `typecheck` is clean.

**Not yet built (future PRs):** Bloons-style crosspath on top of D; branching /
merging lanes on top of A; heroes (F2, proposal-issue-first); the shared
client-UI and room-profile work the table above lists.
