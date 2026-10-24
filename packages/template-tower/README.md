# @netforge/template-tower

A co-op tower defense game template for Net Forge: up to 4 players on one shared board (COGSPIRE).

Rust swarms crawl an old rail road toward a brass clockwork spire in waves. Each tinker builds and upgrades towers with their own gold, every kill pays its builder a bounty and a share to the rest, and the team shares the spire's bells. Hold twenty waves to keep the spire.

It is a board genre: a deterministic rules module runs on the room host at 30 Hz behind the same adapter seam as the action templates. Your tinker (the cursor) is predicted; builds, upgrades, sells and the ready vote are actions the room validates (gold, tile, ownership). The client kit is `@netforge/tabletop`.

Towers aim at the creep furthest along the road in range. Splash hits a radius, frost slows, chain jumps. A leak costs the creep's damage in bells, and zero bells loses the run.

Earn: three waves, ten waves, the first boss and sixty kills. A player who joins mid-run is not paid for waves cleared before their run started.

## Install

```sh
npm install @netforge/template-tower
```

You normally do not import this package yourself. `kit play` runs it on your own computer, and the Net Forge MCP server and studio copy its `src/game.ts` as the starting point for a new game.

## Play it locally

```sh
mkdir -p my-game/src && cd my-game
npm init -y && npm install @netforge/kit-play @netforge/engine @netforge/template-tower
cp node_modules/@netforge/template-tower/src/game.ts src/
echo '{"template":"tower-defense"}' > netnet.json
npx kit-play        # opens http://127.0.0.1:4663
```

Coins are play money and nothing pays out. Real-token earning, stakes and claims run only on the hosted Net Forge server.

## Change the game

The bolt post is the cheap first tower. Make it cheaper and give it more reach:

```ts
tower("bolt_post", {
  model: "style.lowpoly.turret",
  kind: "bolt",
  cost: 35,
  damage: 8,
  rate: 1.5,
  range: 3.5,
  // levels stay as they are
});
```

Save `src/game.ts` and run `npx kit-play` again.

## Files

| Path | What |
|---|---|
| `src/game.ts` | The game, declarations only: the board and road, towers, creeps, waves, upgrades, earn, store. |
| `src/manifest.ts` | Loads the game; `towerAdapter()` and `towerManifest()` for the room host and the client. |
| `src/store.ts` | The coin prices the client is wired to. |
| `client/` | The browser client: the board, towers, creeps, tracers, the build bar and the tower panel. |
| `test/` | Playtest bots through `engine.test.run`, and the store. |
| `llms.txt` | How to change the game, for agents. |

## Controls

Click a tile to build the tower picked in the bar (keys 1 to 4), click a tower to upgrade or sell it, Space calls the next wave. Touch: tap a tile to aim, tap again to build. The backquote key shows stats.

## For AI agents

Read `AGENTS.md` and `llms.txt` in this package before changing the game. `llms-full.txt` adds the whole `src/game.ts` as a worked example.

Agents can also drive this template through the Net Forge MCP server: run `npx -y @netforge/mcp` (package `@netforge/mcp`, bin `netforge-mcp`). Its tools are `netforge_list_templates`, `netforge_create_game`, `netforge_explain_api`, `netforge_search_docs`, `netforge_validate_game`, `netforge_run_playtest` and `netforge_play_locally`.

To set up a coding agent in a game project, run `npx netforge setup agent`. It writes AGENTS.md, CLAUDE.md, Cursor rules and `.mcp.json` into the project. In Claude Code you can also add the server directly with `claude mcp add netforge -- npx -y @netforge/mcp`.

## Docs

- https://forge.netnet.capital/docs/templates/tower
- `llms.txt` and `llms-full.txt` in this package (also exported as `@netforge/template-tower/llms.txt` and `@netforge/template-tower/llms-full.txt`)

## License

MIT. See `LICENSE` and `NOTICE`.
