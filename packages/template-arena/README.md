# @netforge/template-arena

An arena shooter game template for Net Forge: a twin-stick shooter for up to 16 players, with bots that fill empty seats (VOLTYARD).

Wirejacks duel at night in a yard of humming transformers. Players move with one hand, aim with the other and hold fire, swapping between an arc rifle, a scatter coil and a rail lance. Every kill drops a heal cell. A round lasts three minutes or ends at 25 kills, and the top of the board takes the round. Bots fill empty seats, so one player alone still gets a fight.

## Install

```sh
npm install @netforge/template-arena
```

You rarely import this package directly. kit play (`@netforge/kit-play`) and the Net Forge MCP server use it to build and run a game whose `src/game.ts` you write.

## Play it locally

```sh
mkdir -p my-game/src && cd my-game
npm init -y && npm install @netforge/kit-play @netforge/engine @netforge/template-arena
cp node_modules/@netforge/template-arena/src/game.ts src/
echo '{"template":"arena"}' > netnet.json
npx kit-play        # opens http://127.0.0.1:4663
```

Open the Invite link (`?room=<id>`) in another tab to play together, or start with `--host 0.0.0.0` and open it on a phone on the same network. Coins are play money. Real-token earning, stakes and claims run only on the hosted Net Forge server.

## Change the game

Edit `src/game.ts` and run `npx kit-play` again. For example, make the arc rifle hit harder and fire a little slower:

```ts
weapon("arc_rifle", { kind: "blaster", damage: 16, cooldown: 0.2, range: 26, speed: 44, knockback: 0 });
```

Or shorten the round and lower the kill target in `game({ ... })`:

```ts
round: { seconds: 120, frags: 15 },
```

## How it plays on the server

- Server-authoritative at 60 Hz. Your own wirejack is predicted (move, aim, weapon, cooldowns), and everyone else is drawn about 100 ms in the past.
- The rail lance is a hitscan resolved with lag compensation: the server rewinds the other players to what you saw, capped at 200 ms. Rifle and scatter shots are server projectiles.
- Seat bots (`players.bots`) join while at least one person is in the room and leave as people join. They adapt to each person's record in the round, ease off when they lead, never earn and never reach the frag limit. Killing a bot scores and shows in the feed but pays no earn rule.
- Spawns are out of every opponent's sight and 12 m clear, with 2 s of protection on joining, respawning and each new round.
- Earn: kills of people (3 and 12 in a round), a five-kill streak, and topping the board with another person in the round. Bot kills and a board of bots pay nothing. The room server is the referee.

## Files

| Path | What |
|---|---|
| `src/game.ts` | The game, as declarations only. This is the file you edit. |
| `src/manifest.ts` | Loads and compiles the game; `arenaAdapter()` for the room host and the client. |
| `src/store.ts` | Store hooks on the Kit's API names (`kit.coins.*`, `kit.store.*`): three round upgrades and two finishes. |
| `client/` | The browser client: three.js scene, HUD, twin-stick input (keys and mouse, gamepad, touch), game feel. |
| `test/` | Playtest bots through `engine.test.run`, the newcomer test and the store test. |
| `llms.txt`, `llms-full.txt` | How to change the game, for agents. |

## Controls

WASD to move, mouse to aim, click to fire, 1 2 3 or Q to change weapon, Space to dash, Tab for the board. On touch, the left stick moves, the right stick aims and fires, and SWAP and DASH are buttons. The backtick key shows stats.

## For AI agents

Read `AGENTS.md` and `llms.txt` before editing. The Net Forge MCP server gives a coding agent the templates, the API and a playtest loop:

```sh
npx -y @netforge/mcp
```

The package is `@netforge/mcp` and its bin is `netforge-mcp`. Its tools are `netforge_list_templates`, `netforge_create_game`, `netforge_explain_api`, `netforge_search_docs`, `netforge_validate_game`, `netforge_run_playtest` and `netforge_play_locally`.

To set up a coding agent in a game project, run `npx netforge setup agent`. It writes AGENTS.md, CLAUDE.md, Cursor rules and `.mcp.json` into the project. In Claude Code you can also add the server directly with `claude mcp add netforge -- npx -y @netforge/mcp`.

## Docs

- https://forge.netnet.capital/docs/templates/arena
- `llms.txt` and `llms-full.txt` in this package. The full file includes the complete `src/game.ts` and the validate and playtest steps.

## License

MIT. See LICENSE and NOTICE.
