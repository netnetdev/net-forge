# @netforge/template-platformer

A multiplayer platformer game template for Net Forge: a side-view race to the flag for up to 8 players over cliffside courses (SKYLEDGE).

Climbers run, jump (hold for height, tap for a hop), dash across gaps, ride moving platforms, bounce off springs and stay off the thorns. Each climber collects their own coins. A round is one course, and the next round runs the next course. Seat bots fill empty places, so one person alone still has a race.

The simulation is the engine's deterministic platform mode: swept box movement on a 1/1024 m grid at 60 Hz, so a predicting client replays its own climber bit for bit. Climbers are ghosts to each other and coins are per climber, so nothing another player does can make your prediction wrong.

Jump feel: coyote time (0.1 s), a jump buffer (0.13 s), variable jump height, a lighter apex while Jump is held, a heavier fall, ceiling corner nudges and an air dash.

The race runner owns rounds (countdown, race, results, next course). It pays `player.finished` for your own finish, and `race.won` and `race.podium` only with another person in the round. Seat bots run routes found by the route planner and never earn. Every course must have a planner route to the flag, or the build fails.

## Install

```sh
npm install @netforge/template-platformer
```

You normally do not import this package yourself. `kit play` runs it on your own computer, and the Net Forge MCP server and studio copy its `src/game.ts` as the starting point for a new game.

## Play it locally

```sh
mkdir -p my-game/src && cd my-game
npm init -y && npm install @netforge/kit-play @netforge/engine @netforge/template-platformer
cp node_modules/@netforge/template-platformer/src/game.ts src/
echo '{"template":"platformer"}' > netnet.json
npx kit-play        # opens http://127.0.0.1:4663
```

Coins are play money and nothing pays out. Real-token earning, stakes and claims run only on the hosted Net Forge server.

## Change the game

Courses run three minutes and three seat bots fill the room. Field more bots and give each course a little longer:

```ts
players: { prefab: "style.lowpoly.rogue", max: 8, bots: 5 },
round: { seconds: 210 },
```

Save `src/game.ts` and run `npx kit-play` again.

## Files

| Path | What |
|---|---|
| `src/game.ts` | The game, declarations only: three courses, three round upgrades, earn rules, stake, store. |
| `src/manifest.ts` | Loads and compiles the game; `platformerAdapter()` and `platformerGame()` for the room host and the client. |
| `src/store.ts` | Store hooks on the Kit's names: three round upgrades (40, 40, 60 coins), two outfits (300, 500) and the shield charm gear (120). |
| `client/` | The browser client: a side-view three.js scene in every art style, HUD, input (keys, gamepad, touch), game feel. |
| `scripts/plan.ts` | The route planner run on every course (how long a good run takes). |
| `test/` | Playtest bots through `engine.test.run`, the race rules, prediction, the local host and the store. |
| `llms.txt` | How to change the game, for agents. |

## Controls

Keys: A D or arrows run, Space W or Up jump, Shift dash, Down plus Jump drops through a ledge, R or Enter readies the next course. The backquote key shows stats.

## For AI agents

Read `AGENTS.md` and `llms.txt` in this package before changing the game. `llms-full.txt` adds the whole `src/game.ts` as a worked example.

Agents can also drive this template through the Net Forge MCP server: run `npx -y @netforge/mcp` (package `@netforge/mcp`, bin `netforge-mcp`). Its tools are `netforge_list_templates`, `netforge_create_game`, `netforge_explain_api`, `netforge_search_docs`, `netforge_validate_game`, `netforge_run_playtest` and `netforge_play_locally`.

To set up a coding agent in a game project, run `npx netforge setup agent`. It writes AGENTS.md, CLAUDE.md, Cursor rules and `.mcp.json` into the project. In Claude Code you can also add the server directly with `claude mcp add netforge -- npx -y @netforge/mcp`.

## Docs

- https://forge.netnet.capital/docs/templates/platformer
- `llms.txt` and `llms-full.txt` in this package (also exported as `@netforge/template-platformer/llms.txt` and `@netforge/template-platformer/llms-full.txt`)

## License

MIT. See `LICENSE` and `NOTICE`.
