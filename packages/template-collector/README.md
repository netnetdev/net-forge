# @netforge/template-collector

A monster collector game template for Net Forge: a shared marsh for up to 8 keepers who catch creatures, battle turn by turn and bring down one warden together (MOSSBOUND).

Fen spirits live in the tall grass of a flooded marsh. Each keeper picks a starter at camp, walks the reeds, meets wild spirits in the grass and battles them with a team of three, snaring the ones worth keeping in a reed lantern. At the far end of the marsh the Fenwarden waits. Every keeper wears down the same warden, and it must fall before dusk.

## Install

```sh
npm install @netforge/template-collector
```

You rarely import this package directly. kit play (`@netforge/kit-play`) and the Net Forge MCP server use it to build and run a game whose `src/game.ts` you write.

## Play it locally

```sh
mkdir -p my-game/src && cd my-game
npm init -y && npm install @netforge/kit-play @netforge/engine @netforge/template-collector
cp node_modules/@netforge/template-collector/src/game.ts src/
echo '{"template":"collector"}' > netnet.json
npx kit-play        # opens http://127.0.0.1:4663
```

Open the link in more tabs for more keepers. Coins are play money. Real-token earning, stakes and claims run only on the hosted Net Forge server.

## Change the game

Edit `src/game.ts` and run `npx kit-play` again. For example, make the warden tougher and give keepers more time and snares in `marsh({ ... })`:

```ts
warden: { creature: "fenwarden", at: [27, 10], level: 10, hp: 900 },
dusk: 720,
snares: 8,
```

Or add a creature and a move, then put the creature in a grass pool and its label in `src/names.json` under `weapons`:

```ts
creature("thistlehog", { model: "style.lowpoly.fox", element: "root", hp: 50, atk: 52, def: 48, spd: 46, moves: ["leaf_lash", "thorn_curl"], catchRate: 0.7 });
move("thorn_curl", { element: "root", power: 0, effect: "guard" });
```

## How it plays on the server

- A board genre on the engine's rules runtime (`@netforge/engine/rules`) at 30 Hz, drawn with `@netforge/tabletop`.
- Your keeper walks with a stick (WASD, arrows or the left thumb) and is predicted with the same tile collision the room runs. Every roll (encounters, accuracy, damage spread, snares, the foe's move) comes from the room's PRNG, so a run replays exactly from its inputs.
- Battles are private: your team, your foe and the battle log reach only you. Others see the creature beside you.
- The warden's health is one pool for the whole marsh. When it falls, everyone who hurt it is paid. Dusk ends the run.
- Earn: the first catch, three catches, the warden and a creature at level 5. The room server is the referee.

## Files

| Path | What |
|---|---|
| `src/game.ts` | The game, as declarations only. This is the file you edit. |
| `src/manifest.ts` | Loads the game; `collectorAdapter()` for the room host and the client. |
| `src/store.ts` | Coin prices the client is wired to. |
| `client/` | The marsh, keepers, companions, the battle panel and the starter pick. |
| `test/` | Playtest bots through `engine.test.run`, and the store test. |
| `llms.txt`, `llms-full.txt` | How to change the game, for agents. |

## For AI agents

Read `AGENTS.md` and `llms.txt` before editing. The Net Forge MCP server gives a coding agent the templates, the API and a playtest loop:

```sh
npx -y @netforge/mcp
```

The package is `@netforge/mcp` and its bin is `netforge-mcp`. Its tools are `netforge_list_templates`, `netforge_create_game`, `netforge_explain_api`, `netforge_search_docs`, `netforge_validate_game`, `netforge_run_playtest` and `netforge_play_locally`.

To set up a coding agent in a game project, run `npx netforge setup agent`. It writes AGENTS.md, CLAUDE.md, Cursor rules and `.mcp.json` into the project. In Claude Code you can also add the server directly with `claude mcp add netforge -- npx -y @netforge/mcp`.

## Docs

- https://forge.netnet.capital/docs/templates/collector
- `llms.txt` and `llms-full.txt` in this package. The full file includes the complete `src/game.ts` and the validate and playtest steps.

## License

MIT. See LICENSE and NOTICE.
