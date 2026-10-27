# @netforge/template-dungeon

A co-op dungeon crawler game template for Net Forge: up to 4 players descend a procedural crypt, room by room, in permadeath runs (CRYPTWICK).

Four wickbearers go down into a candle-lit crypt. The crypt is grown from a seed with `dungeon(...)`: ten rooms joined by corridors, the start room at the top and the Wax Abbot in the deepest one. Rooms wake as the party nears them and their dead come through the doors. A cleared room leaves a reliquary (pick an upgrade) and brings back anyone who fell. If the whole party is down at once, the descent is over.

## Install

```sh
npm install @netforge/template-dungeon
```

You rarely import this package directly. kit play (`@netforge/kit-play`) and the Net Forge MCP server use it to build and run a game whose `src/game.ts` you write.

## Play it locally

```sh
mkdir -p my-game/src && cd my-game
npm init -y && npm install @netforge/kit-play @netforge/engine @netforge/template-dungeon
cp node_modules/@netforge/template-dungeon/src/game.ts src/
echo '{"template":"dungeon"}' > netnet.json
npx kit-play        # opens http://127.0.0.1:4663
```

Open the Invite link (`?room=<id>`) in another tab to play together, or start with `--host 0.0.0.0` and open it on a phone on the same network. Coins are play money. Real-token earning, stakes and claims run only on the hosted Net Forge server.

## Change the game

Edit `src/game.ts` and run `npx kit-play` again. For example, grow a different and larger crypt by changing the seed and the room count:

```ts
const CRYPT = dungeon({ seed: 7, rooms: 14, cell: 24, size: [12, 18], corridor: 6, loops: 3 });
```

Or make the candle burst, the starting weapon, hit harder:

```ts
weapon("candle_burst", {
  kind: "nova", damage: 16, cooldown: 1.1, range: 3.8, knockback: 2.5,
  // levels and evolve as shipped
});
```

## How it plays on the server

- Server-authoritative at 30 Hz on the survivor machinery: auto-firing weapons, shards and level-up cards, co-op downs and revives, keepers, and bosses with telegraphed attacks. Your own wickbearer is predicted.
- The crypt's walls are boxes in the sim (`field.walls`) and its floors (`field.floors`) are the only ground. Enemies behind a wall walk round through the doors on a flow field, with a wider grid for big bodies.
- The crawl is a system in `src/game.ts` that you can read and change: room wakes, encounters by depth, off-screen spawns inside the woken room, the quiet timer that wakes the nearest room when the party waits, reliquaries and the respawn on clear.
- Earn: rooms cleared (2 and 7), the Abbot, and 60 kills by one wickbearer, once per run each. The room server is the referee.

## Files

| Path | What |
|---|---|
| `src/game.ts` | The game, as declarations only: the crypt's spec, the dead, weapons, the crawl system, earn and the store. This is the file you edit. |
| `src/manifest.ts` | Loads and compiles the game; `dungeonAdapter()` for the room host and the client. |
| `src/store.ts` | Store hooks on the Kit's API names (`kit.coins.*`, `kit.store.*`): a revive, a cosmetic and the wick charm (losable gear). |
| `client/` | The browser client: three.js scene, the crypt's floors and walls with an x-ray cut and fog of war, HUD, input (keys, gamepad, touch), game feel. |
| `test/` | Playtest bots through `engine.test.run`, the host test and the store test. |
| `llms.txt`, `llms-full.txt` | How to change the game, for agents. |

## Controls

WASD or arrows to move, Space to dash, 1 2 3 to pick a card. On touch, drag on the left half, use the DASH button and tap a card. The backtick key shows stats.

## For AI agents

Read `AGENTS.md` and `llms.txt` before editing. The Net Forge MCP server gives a coding agent the templates, the API and a playtest loop:

```sh
npx -y @netforge/mcp
```

The package is `@netforge/mcp` and its bin is `netforge-mcp`. Its tools are `netforge_list_templates`, `netforge_create_game`, `netforge_explain_api`, `netforge_search_docs`, `netforge_validate_game`, `netforge_run_playtest` and `netforge_play_locally`. The engine's `GAME-DESIGN.md` (in `@netforge/engine`) has the design rules the playtest gate scores.

To set up a coding agent in a game project, run `npx netforge setup agent`. It writes AGENTS.md, CLAUDE.md, Cursor rules and `.mcp.json` into the project. In Claude Code you can also add the server directly with `claude mcp add netforge -- npx -y @netforge/mcp`.

## Play the demo

Cryptwick, this template as a free single-player browser demo: https://netnetcap.itch.io/dungeon-crawler-demo

## Docs

- https://forge.netnet.capital/docs/templates/dungeon
- `llms.txt` and `llms-full.txt` in this package. The full file includes the complete `src/game.ts` and the validate and playtest steps.

## License

MIT. See LICENSE and NOTICE.
