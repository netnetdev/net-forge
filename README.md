# Net Forge

Net Forge, the open-source multiplayer browser game engine built for AI coding agents: `@netforge` on npm, https://github.com/netnetdev/net-forge and
https://forge.netnet.capital/docs. Not affiliated with other projects named NetForge.

Net Forge is an open-source (MIT) TypeScript engine for multiplayer browser
games. One simulation (ECS, Rapier physics, a fixed tick and snapshots) runs
in the browser and on an authoritative room server, a three.js renderer
(WebGPU with a WebGL2 fallback) draws it, and ten finished multiplayer games
ship as templates you can change. The game API is typed and declarative, and
an MCP server lets your own coding agent build, validate, playtest and run a
game.

<!-- MEDIA: replace each line with a GIF or screenshot (8 seconds, 1200 px wide) -->
<!-- 1. Survivor-like co-op: four players and 2,000 enemies on one field -->
<!-- 2. Arena shooter: a 16-player round with bots filling seats -->
<!-- 3. Tower defense and card battler: the board templates side by side -->
<!-- 4. A coding agent calling netforge_run_playtest and opening the local URL -->

## Start in 30 seconds

```sh
npm create netforge@latest my-game -- --template survivor --yes
cd my-game
npm run play       # opens http://127.0.0.1:4663, more tabs are more players
```

The whole game is `my-game/src/game.ts`. Edit it, run `npm test` (it
compiles the rules and plays them with bots), then `npm run play` again and
open the link in a second tab to play together. Everything runs on your
computer with play money: no wallet, no chain and no hosted servers.

Leave out `--template` and `--yes` to pick from the ten templates. Each new
game carries `AGENTS.md` (with `CLAUDE.md`, Cursor and Copilot pointers) and
the MCP entry for `@netforge/mcp` in `.mcp.json`, `.cursor/mcp.json` and
`.vscode/mcp.json`, so a coding agent knows how to change, test and run it.
[packages/create-netforge](packages/create-netforge) lists every option.

## What it does for you

- **One simulation on both sides.** `@netforge/engine-sim` runs the same
  deterministic ECS and Rapier world in the browser and on the room server,
  with input commands, delta snapshots and bit-exact restore.
- **Finished games, not empty projects.** Every template is a complete
  multiplayer game with rendering, input (keys, gamepad, touch), HUD, game
  feel, bots and a headless playtest.
- **Declarative games.** A game is declarations (`game`, `prefab`, `weapon`,
  `upgrade`, `director`, `system`, `earn.rule` and each genre's own), checked
  by schema validators with messages that say what to fix.
- **Built for coding agents.** `@netforge/mcp` gives an agent tools to pick
  a template, scaffold, search the docs, validate, playtest with bots and
  play locally. Every template ships `AGENTS.md`, `CLAUDE.md`, `llms.txt`
  and `llms-full.txt`.
- **Playtests with numbers.** `engine.test.run` plays the game with bots on
  the server simulation and reports kills, waves, deaths, softlocks, earn and
  milliseconds per tick.
- **Free assets.** A library of CC0 models, sprites and sounds in six art
  styles, addressed by id.

## Templates

| Template | Genre | Players | What it shows |
|---|---|---|---|
| `survivor` | Survivor-like co-op (EMBERWATCH) | 1 to 4 | 2,000 enemies on one field, auto-firing weapons, level-ups, bosses |
| `arena` | Arena shooter (VOLTYARD) | up to 16 | Twin-stick rounds, bots fill empty seats |
| `tower-defense` | Tower defense (COGSPIRE) | 1 to 4 | Shared board, twenty waves, tower upgrades |
| `dungeon` | Co-op dungeon crawl (CRYPTWICK) | 1 to 4 | Seeded rooms and corridors, permadeath runs |
| `idle` | Idle (BRINEWORKS) | up to 8 | Plants, products and a shared contract per shift |
| `platformer` | Platformer race (SKYLEDGE) | up to 8 | Jump, dash, moving platforms, coins |
| `cards` | Card battler (INKWRIT) | 2 | One against one, drafts between duels, AI opponents |
| `collector` | Monster collector (MOSSBOUND) | up to 8 | Turn-based battles, a team of three, a shared final boss |
| `racer` | Kart racer (TORQUEBAY) | up to 8 | Drift turbo, boost pads, bots fill the grid |
| `party` | Party co-op (ROMPHOUSE) | 2 to 8 | Five minigame rounds a show |

Each template's README in `packages/template-*` has its own run steps.

## Use with your coding agent

```sh
claude mcp add netforge -- npx -y @netforge/mcp     # Claude Code
npx netforge setup agent                            # AGENTS.md, CLAUDE.md, Cursor rules, .mcp.json in this project
npx skills add netnetdev/net-forge                  # Agent Skills: create, add content, playtest, play locally
```

Cursor and VS Code read the MCP entry that `npx netforge setup agent`
writes (`.cursor/mcp.json`, `.vscode/mcp.json`). The tools are
`netforge_list_templates`, `netforge_create_game`, `netforge_search_docs`,
`netforge_explain_api`, `netforge_validate_game`, `netforge_run_playtest`
and `netforge_play_locally`; see [packages/mcp](packages/mcp).

## Packages

| Package | What it is |
|---|---|
| [`@netforge/asset-library-files`](packages/asset-library-files) | Built CC0 game asset files for Net Forge (optimized models, sprites, textures and sounds) that kit play serves to a game running locally. |
| [`@netforge/asset-library`](packages/asset-library) | CC0 game asset library for Net Forge: a manifest of models, sprites and sounds addressed by library id, shared rigs, the look composer and a three.js loader. |
| [`create-netforge`](packages/create-netforge) | Start a game with Net Forge, the open-source multiplayer browser game engine built for AI coding agents: npm create netforge@latest my-game. Ten templates, play money, AGENTS.md and MCP config included. |
| [`@netforge/engine-sim`](packages/engine-sim) | Deterministic game simulation shared by browser client and server for Net Forge: ECS, Rapier physics, a fixed tick, input commands and delta snapshots. |
| [`@netforge/engine`](packages/engine) | Net Forge game engine client: a typed declarative game API and a three.js WebGPU/WebGL2 renderer for multiplayer browser games. |
| [`@netforge/kit-play`](packages/kit-play) | Make, test and run Net Forge games on your own computer with play money: start a game from a template, run playtest bots, and play it in the browser with a local room host, with no wallet, chain or servers. |
| [`@netforge/mcp`](packages/mcp) | MCP server for Net Forge: lets AI coding agents list templates, scaffold a game, search the engine docs, validate a game module, run headless bot playtests and play the game locally. No chain, no keys. |
| [`netforge`](packages/netforge) | Net Forge command line for coding agents: `npx netforge setup agent` writes AGENTS.md, CLAUDE.md, Cursor rules and MCP configs into a game project, and ships Agent Skills for building Net Forge games. |
| [`@netforge/tabletop`](packages/tabletop) | Shared client kit for Net Forge board-style game templates (tower defense, idle, card battler, monster collector): room connection, input clock, 3D stage, store and HUD. |
| [`@netforge/template-arena`](packages/template-arena) | Arena shooter game template for Net Forge: up to 16 players, lag-compensated beams, loadouts, rounds and seat-filling bots (VOLTYARD). |
| [`@netforge/template-cards`](packages/template-cards) | Card battler game template for Net Forge: one against one or against the AI, a gauntlet of duels with drafts, server-side shuffle and hidden hands (INKWRIT). |
| [`@netforge/template-collector`](packages/template-collector) | Monster collector game template for Net Forge: a shared marsh where players catch creatures and battle turn by turn with a team of three (MOSSBOUND). |
| [`@netforge/template-dungeon`](packages/template-dungeon) | Co-op dungeon crawler game template for Net Forge: 4 players, procedural rooms, loot and permadeath runs (CRYPTWICK). |
| [`@netforge/template-idle`](packages/template-idle) | Shared idle game template for Net Forge: up to 8 players pump, boil and cut salt to fill a contract together (BRINEWORKS). |
| [`@netforge/template-party`](packages/template-party) | Party game template for Net Forge: 2 to 8 friends in one playroom, five quick minigame rounds a show (ROMPHOUSE). |
| [`@netforge/template-platformer`](packages/template-platformer) | Multiplayer platformer game template for Net Forge: races to the flag with coyote time, jump buffering, dashes, springs and moving platforms (SKYLEDGE). |
| [`@netforge/template-racer`](packages/template-racer) | Kart racer game template for Net Forge: harbour circuits with drift mini-turbos, boost pads, coins and laps at 60 Hz, with seat-filling bots (TORQUEBAY). |
| [`@netforge/template-survivor`](packages/template-survivor) | Survivor-like co-op game template for Net Forge: 4 players, 2,000 enemies, authoritative multiplayer (EMBERWATCH). |
| [`@netforge/template-tower`](packages/template-tower) | Co-op tower defense game template for Net Forge: up to 4 players, waves, building and upgrades, shared lives (COGSPIRE). |
| [`@netforge/kit`](packages/kit) | Optional on-chain add-on for browser games: a game token, a store, payments and a mandatory earn mechanism, with a runtime library, a CLI and an MCP server (Net Forge Cabinet Kit). |

`@netforge/kit` is the optional on-chain add-on (a game token, a store and
payments). Nothing else depends on it, and it is published separately.

## Work on the packages

Needs Node 22 and pnpm 10.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
```

## What is not here

The hosted room server, the referee that decides real payouts, the studio
and its generator, the asset pipeline that builds the library, and the
on-chain contracts are not part of this repository. Games built here run
with play money only.

## Links

- Docs: https://forge.netnet.capital/docs (every page also as markdown; full corpus at https://forge.netnet.capital/llms-full.txt)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md). Issues are welcome; pull requests are applied upstream and come back with the next export.
- Security: [SECURITY.md](SECURITY.md)
- Releases: packages are published to npm by `.github/workflows/publish.yml` when a tag named `engine-v*` is pushed, dependencies first, with npm provenance.

## License

Every package is MIT licensed ([LICENSE](LICENSE)). The library assets are
CC0 1.0 (see `NOTICE`).
