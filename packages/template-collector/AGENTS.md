# Extending MOSSBOUND

MOSSBOUND is the monster collector template of the Net Forge game engine. The template already has walking and collision, encounters, turn order, damage, the element cycle, snaring, team swaps, XP and levels, the camp, the warden fight, dusk, netcode, rendering, touch controls, earn and the store. You change the game by changing declarations. Read `llms.txt` for every field, and `llms-full.txt` for the complete worked example.

## The one file to edit

- `src/game.ts` is the whole game. Change declarations in place.
- `src/names.json`, next to it, holds the title and every label players read. Creatures go in `"weapons"` (`{ name, line }`), the warden in `"enemies"`, plus upgrades, earn rules and store items. Moves are shown from their ids (`leaf_lash` reads "Leaf Lash").
- Everything else (`src/manifest.ts`, `src/store.ts`, `client/`, `test/`, `scripts/`) is template machinery. Do not edit it.

## Imports

`src/game.ts` imports only from `@netforge/engine`. The shipped game uses:

```ts
import { creature, earn, game, marsh, move, store, upgrade } from "@netforge/engine";
```

## Declarations

- `game({ template: "collector", style, places, players: { prefab, max } })`.
- `marsh({ size, camp, starters, starterLevel, water, blocked, grass, warden, dusk, snares })`, exactly one. Rects are `[x, y, width, height]` in 2 m tiles.
- `creature(id, { model, element, hp, atk, def, spd, moves, catchRate?, boss?, size? })`, 1 to 24 of them. Base stats are at level 1 and grow 12% a level.
- `move(id, { element, power, accuracy?, effect?, amount? })`, at most 48. Effects are `"drain"`, `"heal"` and `"guard"`.
- `upgrade(id, { stat, step, maxLevel })` with stat `might`, `maxHealth`, `armor`, `amount` or `regen` only.
- `earn.rule(id, { when, n, pay, oncePer: "run" })`. Events: `creature.caught`, `creature.defeated`, `creature.levelup`, `level.five`, `level.ten`, `warden.defeated` and `run.won`.
- `earn.stake({ min, max, multiple })`, exactly one, on one top-level line.
- `store.sku(id, { coins, grants? })`.

## Rules the build enforces

- Ids are lower_snake_case.
- Every game declares at least one `earn.rule` and exactly one `earn.stake`. `"stake"` is reserved.
- Every creature's moves are declared moves, 1 to 4 each.
- Starters and grass pools name declared creatures that are not bosses. The warden names a creature with `boss: true`.
- The camp and the warden stand inside the marsh on tiles that are not blocked. Grass and blocked rects stay inside the marsh. Leave a walkable way from camp to every grass zone and to the warden.
- Elements are `root`, `tide`, `spark` and `stone`, a cycle where each beats the next.
- No `weapon(...)` in a collector game.
- Asset ids are library ids such as `"style.lowpoly.frog"`, never URLs or paths, and must exist in the asset library. Keep `game({ style })` as the creator picked it.
- Four playtest keepers must win battles, catch creatures and fire an earn rule in 4 minutes, and must not lose their whole team more than twice each.
- Keep the SKUs the client is wired to at their prices: `thornbark`, `mossmail`, `spare_snares`, `fen_tonic`, `skin_lichen`, `skin_amber` and `lucky_reed`.

## Validate

- With the MCP server (`npx -y @netforge/mcp`), call `netforge_validate_game` on `src/game.ts`. It returns one actionable line per problem.
- In this package, run the tests with vitest: `test/harness.test.ts` and `test/store.test.ts`.

## Playtest

- With the MCP server, call `netforge_run_playtest`.
- In code, import the game module and run the headless harness:

```ts
import { engine } from "@netforge/engine";
import "./src/game.js";

const report = await engine.test.run({ ticks: 30 * 240, bots: 4, seed: 1 });
console.log(report.kills, report.deaths, report.earned, report.rules?.checks);
```

The report has battles won plus catches (kills), team wipes (deaths), earn by rule, softlock, ms per tick and the genre's checks under `rules.checks`.

## Play locally

In a folder with `netnet.json` (`{"template":"collector"}`) and `src/game.ts`, with `@netforge/kit-play` and `@netforge/engine` installed, run `npx kit-play`. It opens http://127.0.0.1:4663 with play money. The MCP tool `netforge_play_locally` gives the same steps.

## Do not

- Do not write renderers, netcode, physics or battle AI. The template has them.
- Do not reference assets by URL or file path.
- Do not import anything other than `@netforge/engine` in `src/game.ts`.
- Do not edit `client/`, `src/manifest.ts` or `src/store.ts`.
- Do not rename or reprice the SKUs the client is wired to.
