# @netforge/template-racer

A kart racer game template for Net Forge: up to 8 players on harbour circuits, with seat bots filling the grid (TORQUEBAY).

Hold the throttle, drift through the bends to charge a mini-turbo (release it for the boost), hit the boost pads, collect coins (each one held adds 1% top speed, up to ten) and keep off the grass. A round is one race, and the next round runs another circuit.

The simulation is the engine's kart mode: arcade vehicle physics on a 1/1024 grid at 60 Hz. A held drift charges a mini-turbo in three tiers. Laps count through four quarter checkpoints in order. A client predicts its own kart, and kart bumps run only on the room host, corrected by the next snapshot.

The client streams the track: it builds road, kerbs, barriers and scenery in chunks of about 40 m within 170 m of the camera and drops chunks behind.

The race runner owns rounds (countdown, race, results). `player.finished` pays your own finish; `race.won` and `race.podium` pay only with another person in the round. Seat bots drive the racing line, pass the kart ahead, hold drifts through long bends and never earn.

## Install

```sh
npm install @netforge/template-racer
```

You normally do not import this package yourself. `kit play` runs it on your own computer, and the Net Forge MCP server and studio copy its `src/game.ts` as the starting point for a new game.

## Play it locally

```sh
mkdir -p my-game/src && cd my-game
npm init -y && npm install @netforge/kit-play @netforge/engine @netforge/template-racer
cp node_modules/@netforge/template-racer/src/game.ts src/
echo '{"template":"racer"}' > netnet.json
npx kit-play        # opens http://127.0.0.1:4663
```

Coins are play money and nothing pays out. Real-token earning, stakes and claims run only on the hosted Net Forge server.

## Change the game

Races are three laps and six seat bots fill the grid. Run a shorter race with a smaller field on the Harbour Loop:

```ts
players: { prefab: "style.lowpoly.kart_a", max: 8, bots: 4 },
// in tracks[0], the Harbour Loop:
laps: 2,
```

Save `src/game.ts` and run `npx kit-play` again.

## Files

| Path | What |
|---|---|
| `src/game.ts` | The game, declarations only: three circuits, round upgrades, earn rules, stake, store. |
| `src/manifest.ts` | Loads and compiles the game; `racerAdapter()` and `racerGame()` for the room host and the client. |
| `src/store.ts` | Store hooks on the Kit's names: three round upgrades (40, 40, 60 coins), two paint jobs (300, 500) and the bumper kit gear (120). |
| `client/` | The browser client: chase camera, a streamed track, HUD with minimap, keyboard, gamepad and touch, game feel. |
| `test/` | Playtest bots through `engine.test.run`, the race rules, prediction, the local host and the store. |
| `llms.txt` | How to change the game, for agents. |

## Controls

Keys: W or Up accelerate, S or Down brake, A D or arrows steer, hold Space or Shift through a bend to drift (release for the boost), R or Enter readies the next race. The backquote key shows stats.

## For AI agents

Read `AGENTS.md` and `llms.txt` in this package before changing the game. `llms-full.txt` adds the whole `src/game.ts` as a worked example.

Agents can also drive this template through the Net Forge MCP server: run `npx -y @netforge/mcp` (package `@netforge/mcp`, bin `netforge-mcp`). Its tools are `netforge_list_templates`, `netforge_create_game`, `netforge_explain_api`, `netforge_search_docs`, `netforge_validate_game`, `netforge_run_playtest` and `netforge_play_locally`.

To set up a coding agent in a game project, run `npx netforge setup agent`. It writes AGENTS.md, CLAUDE.md, Cursor rules and `.mcp.json` into the project. In Claude Code you can also add the server directly with `claude mcp add netforge -- npx -y @netforge/mcp`.

## Docs

- https://forge.netnet.capital/docs/templates/racer
- `llms.txt` and `llms-full.txt` in this package (also exported as `@netforge/template-racer/llms.txt` and `@netforge/template-racer/llms-full.txt`)

## License

MIT. See `LICENSE` and `NOTICE`.
