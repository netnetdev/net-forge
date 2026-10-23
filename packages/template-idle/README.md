# BRINEWORKS (idle template)

A white salt flat under a hot sky. Up to eight players each run a works:
pumps draw brine, pans boil it into salt, kilns cut crystals, and salt buys
more plants. A barge on the canal takes crystals for a contract everyone
fills together. A shift lasts fifteen minutes; then a new one begins.

A board genre (`packages/engine/src/rules/idle.ts`) on the shared runtime;
client kit `@netforge/tabletop`. Room template `idle` (cap 8).

## Why it cannot be farmed

- Production runs only in the room's sim, on its ticks, for players in the
  room. No wall clock, no offline accrual, no client-reported numbers.
- A works stalls two minutes after its last tend (rake, buy, ship): an idle
  tab makes nothing.
- Raking has a cooldown; mashing adds nothing.
- Earn rules pay once a run. A seat that leaves and rejoins starts a fresh
  works from 20 kg of salt. The genre's gate check simulates a fresh works
  with perfect play and with pure raking: the first payout comes 199 s in
  (the floor is 180 s), and the most one seat can earn is about 550 coins an
  hour even rejoining every time a rule pays, before the per-wallet daily
  cap, the free-play lifetime cap and the stake terms. With full shifts the
  four rules pay at most 80 coins a shift (320 an hour).
- One earning seat per wallet (the room's seat lock), and the run replays
  from its inputs for the referee.

## Run it

This template runs on your own computer with play money through
`kit play` (`@netforge/kit-play`). From the repository root:

```sh
pnpm install --frozen-lockfile && pnpm build
mkdir -p play-idle/src && cp packages/template-idle/src/game.ts play-idle/src/
echo '{"template":"idle"}' > play-idle/netnet.json
node packages/kit-play/dist/cli.js play-idle       # opens http://127.0.0.1:4663
```

Edit `play-idle/src/game.ts` and run it again to try a change. Real-token
earning, stakes and claims run only on the hosted Net Forge server.

Space rakes (or click your plot), 1-5 buy a plant, S ships crystals.
