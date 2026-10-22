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
| `scripts/measure.ts` | Room server + headless Chrome: frame, network, server numbers and screenshots per art style (`--humans 0` plays the browser alone against the AI). |
| `test/` | Playtest bots and the store. |
| `llms.txt` | How to change the game (for agents). |

## How it plays on the server

- Server-authoritative at 30 Hz. Your quill (the cursor) is predicted; a
  play, an attack, an end of turn and a draft pick are actions the room
  validates (whose turn, the card in that slot, ink, guards).
- Hidden information: the room shuffles from its seeded PRNG and keeps
  the deck order to itself; a hand and a draft offer go only to their
  owner (`SimAdapter.infoFor`). Snapshots carry the quills only.
  `apps/rooms/src/sim/cards.test.ts` checks it every few ticks of a run.
- A person alone for 3 s gets a seat bot (an AI scribe of the gauntlet's
  tier); it leaves when a second person joins (that duel is called off).
- Earn (the room is the referee): duels won against a person (never a
  forfeit), AI scribes beaten. The AI never earns. Pots stay off.

## Run it

```sh
pnpm --filter @netnetcapital/engine-sim build && pnpm --filter @netnetcapital/engine build
ROOMS_STORE_MODE=mock PORT=2941 pnpm --filter @netnet/rooms start
pnpm --filter @netnetcapital/template-cards dev        # http://localhost:6040/?server=http://localhost:2941
```
