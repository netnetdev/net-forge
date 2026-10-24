# Extending BRINEWORKS

BRINEWORKS is the idle template of the Net Forge game engine. The template already has the works, the production chain, buying and levelling, raking, tending, the contract, the shift clock, netcode, rendering, earn and the store. You change the game by changing declarations. Read `llms.txt` for every field, and `llms-full.txt` for the complete worked example.

## The one file to edit

- `src/game.ts` is the whole game. Change declarations in place.
- `src/names.json`, next to it, holds the title and every label. Plants go in `"weapons"` (`{ name, line }`), and `"enemies"` stays empty.
- Everything else (`src/manifest.ts`, `src/store.ts`, `src/autopilot.ts`, `client/`, `test/`, `scripts/`) is template machinery. Do not edit it.

## Imports

`src/game.ts` imports only from `@netforge/engine`. The shipped game uses:

```ts
import { earn, game, plant, saltFlat, store, upgrade } from "@netforge/engine";
```

## Declarations

- `game({ template: "idle", style, places, players: { prefab, max } })`, with `max` at most 8.
- `saltFlat({ shift, tend, start, rake: { salt, cooldown }, brinePerSalt, saltPerCrystal, packEvery, contract: { crystals } })`, exactly one.
- `plant(id, { model, kind: "pump" | "pan" | "kiln", cost, growth, rate })`, 1 to 8 of them. The bar shows plants in declaration order (keys 1 to 8).
- `upgrade(id, { stat, step, maxLevel })` with stat `might` (plant output), `haste` (raking speed) or `amount` (salt a rake) only.
- `earn.rule(id, { when, n, pay, oncePer: "run" })`. Events: `salt.packed`, `crystal.cut`, `crystal.shipped`, `plant.built`, `plant.upgraded` and `contract.filled`.
- `earn.stake({ min, max, multiple })`, exactly one, on one top-level line.
- `store.sku(id, { coins, grants? })`.

## Rules the build enforces (the anti-farm rules)

- Ids are lower_snake_case.
- Every game declares at least one `earn.rule` and exactly one `earn.stake`. `"stake"` is reserved.
- Plants include at least one `pump`, one `pan` and one `kiln`.
- A shift is 600 to 3600 seconds. Every earn rule is `oncePer: "run"`.
- `tend` is at most 300 seconds, so a works nobody tends stops.
- No earn rule may pay sooner than 180 seconds into a fresh works, even with perfect play or raking as fast as the cooldown allows. If a change pays sooner, raise `packEvery` or the rule's `n`, or slow raking.
- No `weapon()` or `prefab()`.
- An earn rule must fire within about 4 minutes of 4-player play.
- Asset ids are library ids such as `"style.lowpoly.barrel"`, never URLs or paths. Keep `game({ style })` as the creator picked it.
- Keep the SKUs the client is wired to at their prices: `bellows`, `long_rake`, `quick_hands`, `skin_saltwhite`, `skin_rust` and `brass_bellows`.

## Validate

- With the MCP server (`npx -y @netforge/mcp`), call `netforge_validate_game` on `src/game.ts`. It returns one actionable line per problem, including the measured first payout when it is too early.
- In this package, run the tests with vitest: `test/harness.test.ts` and `test/store.test.ts`.

## Playtest

- With the MCP server, call `netforge_run_playtest`.
- In code, import the game module and run the headless harness:

```ts
import { engine } from "@netforge/engine";
import "./src/game.js";

const report = await engine.test.run({ ticks: 30 * 240, bots: 4, seed: 1 });
console.log(report.kills, report.earned, report.rules?.checks);
```

The report has crates packed (as kills), earn by rule, softlock, ms per tick and the genre's checks (the farming bounds) under `rules.checks`.

## Play locally

In a folder with `netnet.json` (`{"template":"idle"}`) and `src/game.ts`, with `@netforge/kit-play` and `@netforge/engine` installed, run `npx kit-play`. It opens http://127.0.0.1:4663 with play money. The MCP tool `netforge_play_locally` gives the same steps.

## Do not

- Do not write renderers, netcode, physics or bot logic. The template has them.
- Do not add offline production, wall-clock timers or client-reported numbers.
- Do not reference assets by URL or file path.
- Do not import anything other than `@netforge/engine` in `src/game.ts`.
- Do not edit `client/`, `src/manifest.ts`, `src/store.ts` or `src/autopilot.ts`.
- Do not rename or reprice the SKUs the client is wired to.
