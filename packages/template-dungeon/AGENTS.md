# Extending CRYPTWICK

CRYPTWICK is the co-op dungeon crawl template of the Net Forge game engine. The template already has the crypt's walls and floors, enemies that path through doors, weapons, XP shards, level-ups, bosses, co-op revive, netcode, rendering, touch controls, earn and the store. You change the game by changing declarations and the crawl system. Read `llms.txt` for every field, `llms-full.txt` for the complete worked example, and `GAME-DESIGN.md` in `@netforge/engine` for the design rules the playtest gate scores.

## The one file to edit

- `src/game.ts` is the whole game, including the `crawl` system (room wakes, `ENCOUNTERS` by depth, `STIR_AFTER`, reliquaries). Change it in place.
- `src/names.json`, next to it, holds the title and every label players read (weapons, upgrades, earn rules, store items). Add a label there for every new id.
- Everything else (`src/manifest.ts`, `src/store.ts`, `client/`, `test/`, `scripts/`) is template machinery. Do not edit it.

## Imports

`src/game.ts` imports only from `@netforge/engine`. The shipped game uses:

```ts
import { achievement, dungeon, earn, game, keeper, mission, prefab, store, system, title, upgrade, weapon } from "@netforge/engine";
```

Also available: `economy` and `metaUpgrade` (opt-in, only when the creator asks for permanent upgrades; the engine caps them at +15% a stat and +30% in all).

## Declarations

- `dungeon({ seed, rooms, cell, size, corridor, loops })` grows the floor plan. Pass its `field` to `game({ field })`. `CRYPT.rooms`, `CRYPT.boss` and `CRYPT.roomAt(x, z)` feed the crawl.
- `game({ template: "dungeon", style, places, field, look?, players: { prefab, max, weapon, xp, magnet, hitIframes, downed, ... } })`.
- `prefab(id, { model, health, speed, radius, damage, ai, drops?, attack?, split?, mass? })` for the dead, bosses and pickups. `ai` is one of the engine's behaviours (`chase`, `runner`, `tank`, `ranged`, `bomber`, `healer`, `summoner`, `charger` and others).
- `weapon(id, { kind, damage, cooldown, range, levels?, evolve? })`, at most 15 including evolutions.
- `upgrade(id, ...)`, at most 8.
- `system(id, (ctx) => { ... })` with `every`, `after`, `onTick`, `spawn`, `spawnPickup`, `spawnEdge`, `spawnRing`, `announce`, `upcoming`, `alive`, `players`, `emit`, `on`, `respawnDead`, `end`, `onScreen`, `random`, `tick`, `time` and more (see llms.txt, Systems API).
- `keeper(id, { name, text, weapon, passive, model?, tint?, unlock? })`, `achievement(...)`, `mission(...)`, `title(...)`.
- `earn.rule(id, { when, n, pay, oncePer: "run" })`. Events: `room.cleared`, `enemy.killed`, `boss.killed`, `player.downed`, `player.revived`, `player.levelup`, `run.won`, `run.lost`, and anything a system emits.
- `earn.stake({ min, max, multiple })`, exactly one, on one top-level line.
- `store.sku(id, { coins, grants? })`.

## Rules the build enforces

- Ids are lower_snake_case.
- Every game declares at least one `earn.rule` and exactly one `earn.stake`. `"stake"` is reserved.
- A dungeon game needs one enemy prefab, one weapon and `players.weapon` (or keepers).
- Drops must be pickup prefabs.
- A keeper is earned (an achievement unlock) or bought (a SKU), never both. The first keeper is free.
- Asset ids are library ids such as `"style.lowpoly.skeleton"`, never URLs or paths, and must exist in the asset library. Keep `game({ style })` as the creator picked it.
- Keep the SKUs the client is wired to exactly: `revive`, `skin_ossuary` and the `wick_charm` gear.

## Validate

- With the MCP server (`npx -y @netforge/mcp`), call `netforge_validate_game` on `src/game.ts`. It returns one actionable line per problem.
- In this package, run the tests with vitest: `test/harness.test.ts`, `test/host.test.ts` and `test/store.test.ts`.

## Playtest

- With the MCP server, call `netforge_run_playtest`.
- In code, import the game module and run the headless harness:

```ts
import { engine } from "@netforge/engine";
import "./src/game.js";

const report = await engine.test.run({ ticks: 30 * 180, bots: 4, seed: 1, bot: "human" });
console.log(report.kills, report.wave, report.maxLevel, report.earned, report.fun);
```

The report has kills, wave (1 + rooms cleared), maxLevel, earn by rule, deaths, runs won and lost, softlock and ms per tick. With `bot: "human"`, `report.fun` has the fun metrics the gate scores.

## Play locally

In a folder with `netnet.json` (`{"template":"dungeon"}`) and `src/game.ts`, with `@netforge/kit-play` and `@netforge/engine` installed, run `npx kit-play`. It opens http://127.0.0.1:4663 with play money. The MCP tool `netforge_play_locally` gives the same steps.

## Do not

- Do not write renderers, netcode, physics or pathing. The template has them.
- Do not reference assets by URL or file path.
- Do not import anything other than `@netforge/engine` in `src/game.ts`.
- Do not edit `client/`, `src/manifest.ts` or `src/store.ts`.
- Do not rename or reprice the SKUs the client is wired to.
