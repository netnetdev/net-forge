# Extending INKWRIT

INKWRIT is the card battler template of the Net Forge game engine. The template already has the duel, turns and the turn timer, the server-side shuffle, hidden hands, guards, rush, the draft, the AI, netcode, rendering, touch controls, earn and the store. You change the game by changing declarations. Read `llms.txt` for every field, and `llms-full.txt` for the complete worked example.

## The one file to edit

- `src/game.ts` is the whole game. Change declarations in place.
- `src/names.json`, next to it, holds the title and every label players read. Cards go in `"weapons"` (`{ name, line }`), plus upgrades, earn rules and store items.
- Everything else (`src/manifest.ts`, `src/store.ts`, `client/`, `test/`, `scripts/`) is template machinery. Do not edit it.

## Imports

`src/game.ts` imports only from `@netforge/engine`. The shipped game uses:

```ts
import { card, cardTable, earn, game, store, upgrade } from "@netforge/engine";
```

## Declarations

- `game({ template: "cards", style, places, players: { prefab, max } })`, with `players.max` at most 2.
- `cardTable({ health, startHand, handMax, boardMax, manaMax, turnSeconds, draftSeconds, duels, starter, ai })`, exactly one. `ai` is 1 to 12 tiers of `{ health, smart }`; duel n against the AI uses tier n.
- `card(id, { model, kind: "unit" | "spell", cost, attack, health, guard?, rush?, effect? })`, 4 to 40 of them. Effects have kind `"damage"`, `"heal"`, `"draw"` or `"buff"` and target `"enemy"`, `"enemy_hero"`, `"all_enemies"`, `"own_hero"`, `"own_unit"` or `"all_own"`.
- `upgrade(id, { stat, step, maxLevel })` with stat `maxHealth`, `might`, `haste` or `amount` only.
- `earn.rule(id, { when, n, pay, oncePer: "run" })`. Events: `duel.won` (against a person, never a forfeit), `ai.beaten` and `run.won`.
- `earn.stake({ min, max, multiple })`, exactly one, on one top-level line.
- `store.sku(id, { coins, grants? })`.

## Rules the build enforces

- Ids are lower_snake_case.
- Every game declares at least one `earn.rule` and exactly one `earn.stake`. `"stake"` is reserved.
- The starter deck has 8 to 30 cards, names declared cards, and holds at least one unit and cards costing 2 or less.
- A unit has health 1 or more. A spell has an effect.
- No `weapon(...)` in a card game.
- Asset ids are library ids such as `"style.lowpoly.frog"`, never URLs or paths. Keep `game({ style })` as the creator picked it.
- Two playtest players must decide duels and fire an earn rule within 4 minutes.
- Keep the SKUs the client is wired to at their prices: `thick_vellum`, `sharp_nib`, `quick_ink`, `spare_page`, `skin_vermilion`, `skin_gold_leaf` and `bound_folio`.
- Nothing in `src/game.ts` can reveal deck order or another player's hand.

## Validate

- With the MCP server (`npx -y @netforge/mcp`), call `netforge_validate_game` on `src/game.ts`. It returns one actionable line per problem.
- In this package, run the tests with vitest: `test/harness.test.ts` and `test/store.test.ts`.

## Playtest

- With the MCP server, call `netforge_run_playtest`.
- In code, import the game module and run the headless harness:

```ts
import { engine } from "@netforge/engine";
import "./src/game.js";

const report = await engine.test.run({ ticks: 30 * 240, bots: 2, seed: 1 });
console.log(report.kills, report.deaths, report.earned, report.rules?.checks);
```

`bots: 2` plays two people; `bots: 1` plays one person against the AI. The report has duels won (kills) and lost (deaths), earn by rule, softlock, ms per tick and the genre's checks under `rules.checks`.

## Play locally

In a folder with `netnet.json` (`{"template":"cards"}`) and `src/game.ts`, with `@netforge/kit-play` and `@netforge/engine` installed, run `npx kit-play`. It opens http://127.0.0.1:4663 with play money. The MCP tool `netforge_play_locally` gives the same steps.

## Do not

- Do not write renderers, netcode, physics or AI. The template has them.
- Do not reference assets by URL or file path.
- Do not import anything other than `@netforge/engine` in `src/game.ts`.
- Do not edit `client/`, `src/manifest.ts` or `src/store.ts`.
- Do not rename or reprice the SKUs the client is wired to.
