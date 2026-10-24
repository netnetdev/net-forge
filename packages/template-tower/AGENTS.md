# Extending COGSPIRE

COGSPIRE is the tower defense template of the Net Forge game engine. This file tells a coding agent how to change the game safely. `llms.txt` in this package has the full recipe book for this genre, and `llms-full.txt` adds the whole `src/game.ts` as a worked example.

## The one file to edit

Change the game by editing `src/game.ts` only. It holds declarations, not engine code. src/names.json holds the title and every label players read. Towers go in "weapons" ({ name, line }), creeps in "enemies", plus upgrades, earn rules and store items. Everything else (the client, the manifest, the store hooks, the simulation, the netcode) is template machinery.

## Import only @netforge/engine

`src/game.ts` imports from `@netforge/engine` and nothing else. The template's game imports:

```ts
import { earn, game, prefab, store, tower, towerBoard, upgrade, waves } from "@netforge/engine";
```

Also available for this genre: `economy`. `earn` has `earn.rule(...)` and `earn.stake(...)`; `store` has `store.sku(...)`. `system(id, ctx => ...)` gets the systems API described in `llms.txt`. The renderer, input, netcode and physics live elsewhere and are not reachable from game code.

## Rules the build enforces

- Ids are lower_snake_case.
- Every game declares at least one `earn.rule(...)` (mandatory earn) and one `earn.stake(...)` (the buy-in run), on one top-level line. A game without either does not build.
- Asset ids are library ids such as `style.lowpoly.turret`, never URLs or file paths, and must exist in the asset library.
- `game({ template: "tower-defense", style, places, players: { prefab, max } })` with `players.max` at most 4.
- Exactly one `towerBoard(...)` and one `waves(...)`; 1 to 8 `tower(...)`s.
- The road is tile waypoints in `towerBoard({ path })`: each step changes x or y, never both, and it starts and ends on the board's edge. `blocked` tiles are rocks nobody builds on.
- Every waves group names a declared creep prefab, not a pickup.
- Tower kinds are "bolt", "splash", "frost" or "chain". Upgrades read four stats only: might, haste, area and maxHealth.
- No `weapon(...)`: a tower defense game declares `tower(...)`.
- `game({ style })` is the art style the creator picked (lowpoly, toon, ps1, pixel, voxel or handdrawn). Keep it.
- Keep the store SKUs the client is wired to, at their prices: overclock, tempered_brass, spyglass, spare_bell, skin_verdigris, skin_gilt and the brass_gear gear. "stake" is reserved and is never a SKU id.

## Validate

- With the MCP server (`npx -y @netforge/mcp`, bin `netforge-mcp`): call `netforge_validate_game` on the game. It returns one line per problem.
- In this package: `npx vitest run` runs `test/harness.test.ts`, `test/store.test.ts`. A bad declaration throws `GameDefinitionError` with a line you can act on.

## Playtest

- With the MCP server: call `netforge_run_playtest`.
- In code: `import { engine } from "@netforge/engine"` and run `engine.test.run({ ticks: 30 * 240, bots: 4 })`. It reports kills, wave reached, runs won and lost, leaks (as deaths), earned by rule, softlock, ms per tick, and the genre's own checks under rules.checks.

## Play locally

```sh
mkdir -p my-game/src && cd my-game
npm init -y && npm install @netforge/kit-play @netforge/engine @netforge/template-tower
cp node_modules/@netforge/template-tower/src/game.ts src/
echo '{"template":"tower-defense"}' > netnet.json
npx kit-play        # opens http://127.0.0.1:4663
```

The MCP tool `netforge_play_locally` does the same. Coins are play money; nothing pays out and no chain or wallet is involved. Edit `src/game.ts` and run it again to try a change.

## What not to do

- Do not write renderers, netcode, physics or bot AI. The template already has them.
- Do not use asset URLs or file paths. Use library ids.
- Do not import anything other than `@netforge/engine` in `src/game.ts`.
- Do not edit `client/`, `src/manifest.ts` or `src/store.ts`.
- Do not rename or reprice the store SKUs the client is wired to.
- Do not write targeting or pathing code; towers and creeps are declared and the rules module runs them.

## Docs

https://forge.netnet.capital/docs/templates/tower
