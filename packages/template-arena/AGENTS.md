# Extending VOLTYARD

VOLTYARD is the arena shooter template of the Net Forge game engine. The template already has loadouts, aiming, projectiles, lag-compensated beams, death and respawn, heal drops, rounds, a scoreboard, seat bots, netcode, rendering, touch and gamepad controls, earn and the store. You change the game by changing declarations. Read `llms.txt` for every field, and `llms-full.txt` for the complete worked example.

## The one file to edit

- `src/game.ts` is the whole game. Change declarations in place.
- `src/names.json`, next to it, holds the title and every label players read (weapons, upgrades, earn rules, store items). Add a label there for every new id.
- Everything else (`src/manifest.ts`, `src/store.ts`, `client/`, `test/`, `scripts/`) is template machinery. Do not edit it.

## Imports

`src/game.ts` imports only from `@netforge/engine`. The shipped game uses:

```ts
import { earn, game, prefab, store, system, upgrade, weapon } from "@netforge/engine";
```

Also available for this genre: `economy` and `metaUpgrade` (opt-in permanent upgrades, capped by the engine), and `earn.pot` (an optional PvP pot, arena only).

## Declarations

- `game({ template: "arena", style, places, players: { prefab, max, bots, loadout, respawn, drop }, arena: { halfSize, pillars, spawns }, round: { seconds, frags } })`.
- `weapon(id, { kind, damage, cooldown, range, ... })` with kind `"blaster"`, `"beam"` or `"nova"` only.
- `prefab(id, { model, kind: "pickup", value })` for the heal cell and other pickups. A declared enemy prefab spawned by a system chases the nearest player.
- `upgrade(id, { stat, step, maxLevel })` for round upgrades the store sells.
- `system(id, (ctx) => { ... })` with `every`, `after`, `onTick`, `spawn`, `spawnRing`, `alive`, `players`, `emit`, `on`, `end`, `random`, `tick`, `time`.
- `earn.rule(id, { when, n, pay, oncePer: "run" })`. Events: `opponent.killed`, `player.died`, `round.top`, `round.finished`, `run.won`, and anything a system emits.
- `earn.stake({ min, max, multiple })`, exactly one, on one top-level line.
- `store.sku(id, { coins, grants? })`.

## Rules the build enforces

- Ids are lower_snake_case.
- Every game declares at least one `earn.rule` and exactly one `earn.stake`. A game without them does not build. `"stake"` and `"pot"` are reserved and are never a SKU or upgrade id.
- `players.loadout` names 1 to 4 declared weapons. Arena weapons are `blaster`, `beam` or `nova`, never `bolt` or `orbit`. Keep beam cooldowns at 0.8 s or more.
- Pillars fit on the floor. Spawns sit 1 m inside the floor and 1 m clear of pillars.
- Asset ids are library ids such as `"style.lowpoly.mini_male_f"`, never URLs or paths, and must exist in the asset library.
- Keep `game({ style })` as the creator picked it: lowpoly, toon, ps1, pixel, voxel or handdrawn.
- Bots never earn, and killing a bot pays no earn rule.
- In a 4-minute playtest, 4 players plus seat bots must all score kills and an earn rule must fire. A round should end within about 4 minutes.
- Keep the five SKUs the client is wired to at their prices: `plating`, `servo`, `capacitor`, `skin_neon` (cosmetic 1) and `skin_chrome` (cosmetic 2).

## Validate

- With the MCP server (`npx -y @netforge/mcp`), call `netforge_validate_game` on `src/game.ts`. It returns one actionable line per problem.
- In this package, run the tests with vitest: `test/harness.test.ts`, `test/host.test.ts`, `test/newcomer.test.ts` and `test/store.test.ts`.
- A bad declaration throws `GameDefinitionError` with a line that says what to change.

## Playtest

- With the MCP server, call `netforge_run_playtest`.
- In code, import the game module and run the headless harness:

```ts
import { engine } from "@netforge/engine";
import "./src/game.js";

const report = await engine.test.run({ ticks: 60 * 240, bots: 4, seed: 1 });
console.log(report.kills, report.deaths, report.earned, report.softlock);
```

The report has kills, deaths, rounds (`runs.won`), `topScore`, `scorers`, earn by rule, softlock and ms per tick.

## Play locally

In a folder with `netnet.json` (`{"template":"arena"}`) and `src/game.ts`, with `@netforge/kit-play` and `@netforge/engine` installed, run `npx kit-play`. It opens http://127.0.0.1:4663 with play money. The MCP tool `netforge_play_locally` gives the same steps.

## Do not

- Do not write renderers, netcode, physics or bot AI. The template has them.
- Do not reference assets by URL or file path.
- Do not import anything other than `@netforge/engine` in `src/game.ts`.
- Do not edit `client/`, `src/manifest.ts` or `src/store.ts`.
- Do not rename or reprice the SKUs the client is wired to.
