# MOSSBOUND (monster collector template)

Fen spirits live in the tall grass of a flooded marsh. Each keeper picks a
starter at camp, walks the reeds, meets wild spirits in the grass and
battles them turn by turn with a team of three, snaring the ones worth
keeping in a reed lantern. At the far end of the marsh the Fenwarden waits:
every keeper in the marsh wears down the same warden, and it must fall
before dusk.

A board genre (`packages/engine/src/rules/collector.ts`) on the room
server at 30 Hz behind the same SimAdapter seam as every template. The
client kit is `@netnetcapital/tabletop`.

| Path | What |
|---|---|
| `src/game.ts` | The game, as the model writes it (declarations only). |
| `src/manifest.ts` | Loads it; `collectorAdapter()` for the room server and client. Room template `collector`. |
| `src/store.ts` | Coin prices the client is wired to, the template's own coin (MOSS). |
| `client/` | The browser client: the marsh, keepers, companions, the battle panel, the starter pick. |
| `scripts/measure.ts` | Room server + node clients + headless Chrome: frame, network and server numbers, screenshots per art style. |
| `test/` | Playtest bots through `engine.test.run`, and the store. |
| `llms.txt` | How to change the game (for agents). |

## How it plays on the server

- Your keeper walks with a stick (WASD, arrows, or the left thumb) and is
  predicted with the same tile collision the room runs, so walking never
  waits. Every roll (encounters, accuracy, damage spread, snares, the foe's
  move) is the room's PRNG, so a run replays exactly from its inputs.
- Battles are private: your team, your foe and the battle log reach only
  you (SimAdapter.infoFor). Others see the creature beside you.
- The warden's health is one pool for the whole marsh; when it falls,
  everyone who hurt it is paid. Dusk ends the run.
- Earn (the room is the referee): the first catch, three catches, the
  warden, a creature at level 5. All are a player's own acts except the
  warden, which pays only those who hurt it.

## Run it

```sh
pnpm --filter @netnetcapital/engine-sim build && pnpm --filter @netnetcapital/engine build
ROOMS_STORE_MODE=mock PORT=2960 pnpm --filter @netnet/rooms start
pnpm --filter @netnetcapital/template-collector dev        # http://localhost:6060/?server=http://localhost:2960
```

## Measure

```sh
pnpm --filter @netnetcapital/template-collector build
CHROME_BIN=/path/to/chrome pnpm --filter @netnetcapital/template-collector measure -- --seconds 40 --humans 4 --styles lowpoly,toon,ps1,pixel,voxel,handdrawn
```
