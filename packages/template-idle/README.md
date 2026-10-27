# @netforge/template-idle

A shared idle game template for Net Forge: a salt flat where up to eight players each run a works and fill one contract together (BRINEWORKS).

A white salt flat under a hot sky. Pumps draw brine, pans boil it into salt, kilns cut crystals, and salt buys more plants. A barge on the canal takes crystals for a contract everyone fills together. A shift lasts fifteen minutes, and then a new one begins from nothing.

## Install

```sh
npm install @netforge/template-idle
```

You rarely import this package directly. kit play (`@netforge/kit-play`) and the Net Forge MCP server use it to build and run a game whose `src/game.ts` you write.

## Play it locally

```sh
mkdir -p my-game/src && cd my-game
npm init -y && npm install @netforge/kit-play @netforge/engine @netforge/template-idle
cp node_modules/@netforge/template-idle/src/game.ts src/
echo '{"template":"idle"}' > netnet.json
npx kit-play        # opens http://127.0.0.1:4663
```

Open the link in more tabs for more players. Coins are play money. Real-token earning, stakes and claims run only on the hosted Net Forge server.

## Change the game

Edit `src/game.ts` and run `npx kit-play` again. For example, make the hand pump cheaper to level for longer:

```ts
plant("hand_pump", { model: "style.lowpoly.barrel", kind: "pump", cost: 15, growth: 1.1, rate: 3 });
```

Or lengthen the shift and enlarge the contract in `saltFlat({ ... })`:

```ts
shift: 1200,
contract: { crystals: 120 },
```

Keep the first payout at least 180 s into a fresh works. The build measures it and fails with the number if a change pays sooner.

## Why it cannot be farmed

- Production runs only in the room's sim, on its ticks, for players in the room. There is no wall clock, no offline accrual and no client-reported number.
- A works stalls two minutes after its last tend (rake, buy, ship), so an idle tab makes nothing.
- Raking has a cooldown, so mashing adds nothing.
- Earn rules pay once a run. A seat that leaves and rejoins starts a fresh works from 20 kg of salt. The genre's gate check simulates a fresh works with perfect play and with pure raking: the first payout comes 199 s in (the floor is 180 s). With full shifts the four rules pay at most 80 coins a shift.
- One earning seat per wallet, and the run replays from its inputs for the referee.

## Files

| Path | What |
|---|---|
| `src/game.ts` | The game, as declarations only. This is the file you edit. |
| `src/manifest.ts` | Loads the game; `idleAdapter()` for the room host and the client (up to 8 seats). |
| `src/store.ts` | Coin prices the client is wired to. |
| `src/autopilot.ts` | The autopilot the browser's `?autopilot=1` and the measure script use. |
| `client/` | The browser client, drawn with `@netforge/tabletop`. |
| `test/` | Playtest bots through `engine.test.run`, and the store test. |
| `llms.txt`, `llms-full.txt` | How to change the game, for agents. |

## Controls

Space rakes (or click your plot), 1 to 5 buy a plant, S ships crystals.

## For AI agents

Read `AGENTS.md` and `llms.txt` before editing. The Net Forge MCP server gives a coding agent the templates, the API and a playtest loop:

```sh
npx -y @netforge/mcp
```

The package is `@netforge/mcp` and its bin is `netforge-mcp`. Its tools are `netforge_list_templates`, `netforge_create_game`, `netforge_explain_api`, `netforge_search_docs`, `netforge_validate_game`, `netforge_run_playtest` and `netforge_play_locally`.

To set up a coding agent in a game project, run `npx netforge setup agent`. It writes AGENTS.md, CLAUDE.md, Cursor rules and `.mcp.json` into the project. In Claude Code you can also add the server directly with `claude mcp add netforge -- npx -y @netforge/mcp`.

## Play the demo

Brineworks, this template as a free single-player browser demo: https://netnetcap.itch.io/idle-game-demo

## Docs

- https://forge.netnet.capital/docs/templates/idle
- `llms.txt` and `llms-full.txt` in this package. The full file includes the complete `src/game.ts` and the validate and playtest steps.

## License

MIT. See LICENSE and NOTICE.
