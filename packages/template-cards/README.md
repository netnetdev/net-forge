# INKWRIT (card battler template)

Scribes duel in a lamplit study. Every card is an inked creature or a
spell written on a page. One against one, a person against a person or
against the gauntlet's AI scribes; a run is four duels with a draft of one
of three cards after each.

A board genre (`packages/engine/src/rules/cards.ts`) on the room server's
SimAdapter seam, drawn with `@netnetcapital/tabletop`.

| Path | What |
|---|---|
| `src/game.ts` | The game, as the model writes it (declarations only). |
| `src/manifest.ts` | Loads it; `cardsAdapter()` for the room server and client. Room template `cards` (two seats). |
| `src/store.ts` | Coin prices the client is wired to, the template's own coin (INK). |
| `client/` | The desk, creatures on their cards, piles, quills, the hand, targeting, the draft. |
| `test/` | Playtest bots and the store. |
| `llms.txt` | How to change the game (for agents). |

## How it plays on the server

- Server-authoritative at 30 Hz. Your quill (the cursor) is predicted; a
  play, an attack, an end of turn and a draft pick are actions the room
  validates (whose turn, the card in that slot, ink, guards).
- Hidden information: the room shuffles from its seeded PRNG and keeps
  the deck order to itself; a hand and a draft offer go only to their
  owner (`SimAdapter.infoFor`). Snapshots carry the quills only.
  The room server's tests check it every few ticks of a run.
- A person alone for 3 s gets a seat bot (an AI scribe of the gauntlet's
  tier); it leaves when a second person joins (that duel is called off).
- Earn (the room is the referee): duels won against a person (never a
  forfeit), AI scribes beaten. The AI never earns. Pots stay off.

## Run it

This template runs on your own computer with play money through
`kit play` (`@netnetcapital/kit-play`). From the repository root:

```sh
pnpm install --frozen-lockfile && pnpm build
mkdir -p play-cards/src && cp packages/template-cards/src/game.ts play-cards/src/
echo '{"template":"cards"}' > play-cards/netnet.json
node packages/kit-play/dist/cli.js play-cards       # opens http://127.0.0.1:4663
```

Edit `play-cards/src/game.ts` and run it again to try a change. Real-token
earning, stakes and claims run only on the hosted Net Forge server.
