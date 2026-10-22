# COGSPIRE (tower defense template)

A brass clockwork spire stands at the end of an old rail road across the
moor. Rust swarms crawl the road toward it in waves. Up to four tinkers
share the board: each builds and upgrades brass towers with their own
gold, every kill pays its builder and a share to the rest, and the team
shares the spire's bells. Hold twenty waves to keep the spire.

A board genre (`packages/engine/src/rules`): the rules run on the room
server at 30 Hz behind the same SimAdapter seam as the action templates,
so the netcode, the referee, run verification, the store and the stake
are the ones every template uses. The client kit is `@netnetcapital/tabletop`.

| Path | What |
|---|---|
| `src/game.ts` | The game, as the model writes it (declarations only). |
| `src/manifest.ts` | Loads it; `towerAdapter()` for the room server and client. Room template `tower`. |
| `src/store.ts` | Coin prices the client is wired to, the template's own coin (COG). |
| `client/` | The browser client: the board, towers, creeps, tracers, the build bar and tower panel. |
| `scripts/measure.ts` | Room server + node clients + headless Chrome: frame, network and server numbers, screenshots per art style. |
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
  before their run started (S-2).

## Run it

```sh
pnpm --filter @netnetcapital/engine-sim build && pnpm --filter @netnetcapital/engine build
ROOMS_STORE_MODE=mock PORT=2901 pnpm --filter @netnet/rooms start
pnpm --filter @netnetcapital/template-tower dev        # http://localhost:6010/?server=http://localhost:2901
```

Click a tile to build the tower picked in the bar (1-4), click a tower to
upgrade or sell it, Space calls the next wave. Touch: tap a tile to aim,
tap again to build. ` shows stats.

## Measure

```sh
pnpm --filter @netnetcapital/template-tower build
CHROME_BIN=/path/to/chrome pnpm --filter @netnetcapital/template-tower measure -- --seconds 40 --humans 4 --styles lowpoly,toon,ps1,pixel,voxel,handdrawn
```
