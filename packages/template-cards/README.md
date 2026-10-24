# @netforge/template-cards

A card battler game template for Net Forge: one against one, a person against a person or against a gauntlet of AI scribes (INKWRIT).

Scribes duel in a lamplit study. Every card is an inked creature or a spell written on a page. A run is four duels, and after each one every player drafts one of three new cards into their deck. The room shuffles on the server and keeps hands hidden.

## Install

```sh
npm install @netforge/template-cards
```

You rarely import this package directly. kit play (`@netforge/kit-play`) and the Net Forge MCP server use it to build and run a game whose `src/game.ts` you write.

## Play it locally

```sh
mkdir -p my-game/src && cd my-game
npm init -y && npm install @netforge/kit-play @netforge/engine @netforge/template-cards
cp node_modules/@netforge/template-cards/src/game.ts src/
echo '{"template":"cards"}' > netnet.json
npx kit-play        # opens http://127.0.0.1:4663
```

Open the link in a second tab to duel yourself, or play alone against the AI. Coins are play money. Real-token earning, stakes and claims run only on the hosted Net Forge server.

## Change the game

Edit `src/game.ts` and run `npx kit-play` again. For example, give the heroes more health and add a fifth duel to the gauntlet:

```ts
cardTable({
  health: 25,
  duels: 5,
  // ...the rest of the table as shipped, with a fifth ai tier
});
```

Or add a card and put its label in `src/names.json` under `weapons`:

```ts
card("mirror_moth", { model: "style.lowpoly.jelly_flyer", kind: "unit", cost: 3, attack: 2, health: 2, effect: { kind: "damage", amount: 1, target: "all_enemies" } });
```

## How it plays on the server

- A board genre on the engine's rules runtime (`@netforge/engine/rules`), drawn with `@netforge/tabletop`, at 30 Hz.
- Your quill (the cursor) is predicted. A play, an attack, an end of turn and a draft pick are actions the room validates: whose turn it is, the card in that slot, ink and guards.
- Hidden information: the room shuffles from its seeded PRNG and keeps the deck order to itself. A hand and a draft offer go only to their owner.
- A person alone for 3 s gets a seat bot (an AI scribe of the gauntlet's tier), which leaves when a second person joins.
- Earn: duels won against a person (never a forfeit) and AI scribes beaten. The AI never earns. The room server is the referee.

## Files

| Path | What |
|---|---|
| `src/game.ts` | The game, as declarations only. This is the file you edit. |
| `src/manifest.ts` | Loads the game; `cardsAdapter()` for the room host and the client (two seats). |
| `src/store.ts` | Coin prices the client is wired to. |
| `client/` | The desk, creatures on their cards, piles, quills, the hand, targeting and the draft. |
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

- https://forge.netnet.capital/docs/templates/cards
- `llms.txt` and `llms-full.txt` in this package. The full file includes the complete `src/game.ts` and the validate and playtest steps.

## License

MIT. See LICENSE and NOTICE.
