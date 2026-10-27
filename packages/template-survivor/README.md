# @netforge/template-survivor

A survivor-like co-op game template for Net Forge: 4 players against up to 2,000 enemies at once (EMBERWATCH).

Four keepers hold a field at night against a swarm that grows every wave. Weapons fire by themselves, gems level you up, you pick one of three upgrades, you stand by a downed teammate to revive them, and the team survives ten waves and breaks the Bell Warden.

The room server is authoritative at 30 Hz. Your own keeper is predicted. The spawn director brings every enemy in just off screen on the run's clock, with curves for the pacing.

Earn: waves cleared (2 and 7), the boss killed, and 500 kills, once per run each. Real-token earn and stakes run only on the hosted Net Forge server.

## Install

```sh
npm install @netforge/template-survivor
```

You normally do not import this package yourself. `kit play` runs it on your own computer, and the Net Forge MCP server and studio copy its `src/game.ts` as the starting point for a new game.

## Play it locally

```sh
mkdir -p my-game/src && cd my-game
npm init -y && npm install @netforge/kit-play @netforge/engine @netforge/template-survivor
cp node_modules/@netforge/template-survivor/src/game.ts src/
echo '{"template":"survivor"}' > netnet.json
npx kit-play        # opens http://127.0.0.1:4663
```

Coins are play money and nothing pays out. Real-token earning, stakes and claims run only on the hosted Net Forge server.

## Change the game

The ember nova is the starting weapon. Make it hit harder and reach further:

```ts
weapon("ember_nova", {
  kind: "nova", damage: 16, cooldown: 1.1, range: 4.4, knockback: 2.5,
  // levels and evolve stay as they are
});
```

Save `src/game.ts` and run `npx kit-play` again.

## Files

| Path | What |
|---|---|
| `src/game.ts` | The game, declarations only: the field, the swarm, weapons, upgrades, the director, systems, earn, store. |
| `src/manifest.ts` | Loads and compiles the game; `survivorAdapter()` and `survivorGame()` for the room host and the client. |
| `src/store.ts` | Store hooks on the Kit's names: a revive (50 coins), a cosmetic (300 coins) and the ember charm gear (150 coins). |
| `client/` | The browser client: three.js scene, HUD, input (keys, gamepad, touch), game feel. `client/names.ts` holds display labels. |
| `test/` | Playtest bots through `engine.test.run`, the local host and the store. |
| `llms.txt` | How to change the game, for agents. |

## Controls

Keys: WASD or arrows move, Space dash, 1 2 3 pick a card. Touch: drag on the left half, the DASH button, tap a card. The backquote key shows stats. Open the Invite link in another tab or on a phone on the same network to play together (`?room=<id>`).

## For AI agents

Read `AGENTS.md` and `llms.txt` in this package before changing the game. `llms-full.txt` adds the whole `src/game.ts` as a worked example.

Agents can also drive this template through the Net Forge MCP server: run `npx -y @netforge/mcp` (package `@netforge/mcp`, bin `netforge-mcp`). Its tools are `netforge_list_templates`, `netforge_create_game`, `netforge_explain_api`, `netforge_search_docs`, `netforge_validate_game`, `netforge_run_playtest` and `netforge_play_locally`.

To set up a coding agent in a game project, run `npx netforge setup agent`. It writes AGENTS.md, CLAUDE.md, Cursor rules and `.mcp.json` into the project. In Claude Code you can also add the server directly with `claude mcp add netforge -- npx -y @netforge/mcp`.

## Play the demo

Emberwatch, this template as a free single-player browser demo: https://netnetcap.itch.io/survivors-like-demo

## Docs

- https://forge.netnet.capital/docs/templates/survivor
- `llms.txt` and `llms-full.txt` in this package (also exported as `@netforge/template-survivor/llms.txt` and `@netforge/template-survivor/llms-full.txt`)

## License

MIT. See `LICENSE` and `NOTICE`.
