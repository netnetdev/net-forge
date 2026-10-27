# @netforge/template-party

A party game template for Net Forge: 2 to 8 friends in one playroom, five quick minigame rounds a show (ROMPHOUSE).

Each round is a minigame with one goal for the whole team: pop the party poppers before the timer, crash every gift box, catch the runaway pup, hold the floor against a tide, and, as the finale, burst the Big Balloon. Win three and the show is a hit. Weapons fire by themselves, so every round is about where you stand and who you help up.

The room server is authoritative at 30 Hz on the survivor machinery (auto-firing weapons, stars and level-up cards, co-op downs and revives, keepers, a boss with telegraphed attacks). Your own player is predicted. The playroom is one floor and four walls, bigger than the screen, so every crowd arrives off screen.

The show is the `show` system in `src/game.ts`: a list of minigames (start, won, lastsOut), shuffled each show with the finale last, with a breather between rounds that clears the floor and brings back anyone who is out.

Earn: a round won, four rounds won, a clean sweep, and 70 kills by one player, once per show each. Seat stakes and real-token earn run only on the hosted Net Forge server.

## Install

```sh
npm install @netforge/template-party
```

You normally do not import this package yourself. `kit play` runs it on your own computer, and the Net Forge MCP server and studio copy its `src/game.ts` as the starting point for a new game.

## Play it locally

```sh
mkdir -p my-game/src && cd my-game
npm init -y && npm install @netforge/kit-play @netforge/engine @netforge/template-party
cp node_modules/@netforge/template-party/src/game.ts src/
echo '{"template":"party"}' > netnet.json
npx kit-play        # opens http://127.0.0.1:4663
```

Coins are play money and nothing pays out. Real-token earning, stakes and claims run only on the hosted Net Forge server.

## Change the game

Rounds run 40 seconds and three wins make the show a hit. Give each round more time and ask for four wins:

```ts
const ROUND_SECONDS = 50;
const BREATHER = 6;
const HIT_AT = 4;
```

Save `src/game.ts` and run `npx kit-play` again.

## Files

| Path | What |
|---|---|
| `src/game.ts` | The game, declarations only: the playroom, the party crowd, weapons, the `show` system with its rounds, earn, store. |
| `src/manifest.ts` | Loads and compiles the game; `partyAdapter()` and `partyGame()` for the room host and the client. |
| `src/store.ts` | Store hooks on the Kit's names: a revive (50 coins), a cosmetic (300 coins) and the lucky charm gear (150 coins). |
| `client/` | The browser client: three.js scene, the playroom stage, HUD, input (keys, gamepad, touch), game feel. `client/names.ts` holds display labels. |
| `test/` | Playtest bots through `engine.test.run`, the local host and the store. |
| `llms.txt` | How to change the game, for agents. |

## Controls

Keys: WASD or arrows move, Space dash, 1 2 3 pick a card. Touch: drag on the left half, the DASH button, tap a card. The backquote key shows stats. Open the Invite link in another tab or on a phone on the same network to play together (`?room=<id>`).

## For AI agents

Read `AGENTS.md` and `llms.txt` in this package before changing the game. `llms-full.txt` adds the whole `src/game.ts` as a worked example.

Agents can also drive this template through the Net Forge MCP server: run `npx -y @netforge/mcp` (package `@netforge/mcp`, bin `netforge-mcp`). Its tools are `netforge_list_templates`, `netforge_create_game`, `netforge_explain_api`, `netforge_search_docs`, `netforge_validate_game`, `netforge_run_playtest` and `netforge_play_locally`.

To set up a coding agent in a game project, run `npx netforge setup agent`. It writes AGENTS.md, CLAUDE.md, Cursor rules and `.mcp.json` into the project. In Claude Code you can also add the server directly with `claude mcp add netforge -- npx -y @netforge/mcp`.

## Play the demo

Romphouse, this template as a free single-player browser demo: https://netnetcap.itch.io/party-game-demo

## Docs

- https://forge.netnet.capital/docs/templates/party
- `llms.txt` and `llms-full.txt` in this package (also exported as `@netforge/template-party/llms.txt` and `@netforge/template-party/llms-full.txt`)

## License

MIT. See `LICENSE` and `NOTICE`.
