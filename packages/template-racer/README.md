# TORQUEBAY (racer template)

Up to eight karts race laps round harbour circuits: hold the throttle, drift
through the bends to charge a mini-turbo (release it for the boost), hit the
boost pads, collect coins (each one held adds 1% top speed, up to ten) and
keep off the grass. A round is one race; the next round runs another
circuit. Seat bots fill the grid, so one person alone still has a field.
Play style "racer" in `specs/cabinet-launcher.md` §2.

| Path | What |
|---|---|
| `src/game.ts` | The game, as the model writes it (declarations only): three circuits, round upgrades, earn rules, stake, store. |
| `src/manifest.ts` | Loads and compiles it; `racerAdapter()` for the room server and the client. Room template `racer`. |
| `src/store.ts` | Store hooks on the Kit's API names: three round upgrades (40, 40, 60 coins), two paint jobs (300, 500), bumper kit gear (120); mock until the token is live. |
| `client/` | The browser client: chase camera, a streamed track, HUD with minimap, keyboard/gamepad/touch, game feel. |
| `scripts/measure.ts` | Room server + node drivers + headless Chrome; frame, network and server numbers, screenshots. |
| `test/` | Playtest bots through `engine.test.run`, the race rules, prediction, the store. |
| `llms.txt` | How to change the game (for agents). |

## How it plays on the server

- The sim is `@netnetcapital/engine-sim`'s kart mode (`src/kart.ts`): arcade
  vehicle physics on a 1/1024 grid at 60 Hz. Velocity splits into forward
  and sideways parts each tick: the engine pushes the forward part toward
  top speed, grip bleeds the sideways part (much less while drifting), and
  steering turns with speed. A held drift charges a mini-turbo in three
  tiers. Laps count through four quarter checkpoints in order. A client
  predicts its own kart alone; kart bumps run only on the room server and
  the next snapshot corrects them.
- The track streams (game-runtime.md §8): the client builds the road,
  kerbs, barriers and scenery in chunks of about 40 m within 170 m of the
  camera, two chunks a frame, nearest first, and drops chunks behind.
- The race runner (`@netnetcapital/engine/game` `RaceRunner`, shared with
  SKYLEDGE) owns rounds: countdown, race, results. `player.finished` pays
  your own finish; `race.won` and `race.podium` pay only with another
  person in the round. Seat bots never earn.
- Seat bots drive the racing line, pass the kart ahead, hold drifts through
  long bends, and are shaded by skill (top speed and line).

## Run it

```sh
pnpm --filter @netnetcapital/engine-sim build && pnpm --filter @netnetcapital/engine build
ROOMS_STORE_MODE=mock pnpm --filter @netnet/rooms start          # room server on :2567
pnpm --filter @netnetcapital/template-racer dev                  # http://localhost:5370
```

Keys: W or Up accelerate, S or Down brake, A D or arrows steer, hold Space or
Shift through a bend to drift (release for the boost), R or Enter readies
the next race. ` shows stats.

## Measure

```sh
pnpm --filter @netnetcapital/template-racer build
CHROME_BIN=/path/to/chrome pnpm --filter @netnetcapital/template-racer measure -- --seconds 40 --backend webgpu
```
