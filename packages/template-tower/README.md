# COGSPIRE (tower defense template)

A brass clockwork spire stands at the end of an old rail road across the
moor. Rust swarms crawl the road toward it in waves. Up to four tinkers
share the board: each builds and upgrades brass towers with their own
gold, every kill pays its builder and a share to the rest, and the team
shares the spire's bells. Hold twenty waves to keep the spire.

A board genre (`packages/engine/src/rules`): the rules run on the room
server at 30 Hz behind the same SimAdapter seam as the action templates,
so the netcode, the referee, run verification, the store and the stake
are the ones every template uses. The client kit is `@netforge/tabletop`.

| Path | What |
|---|---|
| `src/game.ts` | The game, as the model writes it (declarations only). |
| `src/manifest.ts` | Loads it; `towerAdapter()` for the room server and client. Room template `tower`. |
| `src/store.ts` | Coin prices the client is wired to, the template's own coin (COG). |
| `client/` | The browser client: the board, towers, creeps, tracers, the build bar and tower panel. |
| `test/` | Playtest bots through `engine.test.run`, and the store. |
| `llms.txt` | How to change the game (for agents). |

## How it plays on the server

- Server-authoritative at 30 Hz. Your tinker (the cursor) is predicted, so
  pointing never waits for the server; builds, upgrades, sells and the
  ready vote are actions the room validates (gold, tile, ownership).
- Towers aim at the creep furthest along the road in range. Splash hits a
  radius, frost slows, chain jumps. Kills pay the builder a bounty and the
  rest of the team a share; a cleared wave pays everyone.
- Shared bells: a leak costs the creep's damage; zero bells loses the run.
  The end screen shows what the run paid, then a fresh run starts.
- Earn (the room is the referee): three waves, ten waves, the first boss,
  sixty kills. A player who joins mid-run is not paid for waves cleared
  before their run started.

## Run it

This template runs on your own computer with play money through
`kit play` (`@netforge/kit-play`). From the repository root:

```sh
pnpm install --frozen-lockfile && pnpm build
mkdir -p play-tower/src && cp packages/template-tower/src/game.ts play-tower/src/
echo '{"template":"tower-defense"}' > play-tower/netnet.json
node packages/kit-play/dist/cli.js play-tower       # opens http://127.0.0.1:4663
```

Edit `play-tower/src/game.ts` and run it again to try a change. Real-token
earning, stakes and claims run only on the hosted Net Forge server.

Click a tile to build the tower picked in the bar (1-4), click a tower to
upgrade or sell it, Space calls the next wave. Touch: tap a tile to aim,
tap again to build. ` shows stats.
