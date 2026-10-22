# SKYLEDGE (platformer template)

Up to eight climbers race along cliffside courses to the flag: run, jump
(hold for height, tap for a hop), dash across gaps, ride moving platforms,
bounce off springs and stay off the thorns. Each climber collects their own
coins. A round is one course; the next round runs the next course. Seat bots
fill empty places, so one person alone still has a race. Play style
"platformer" in `specs/cabinet-launcher.md` §2.

| Path | What |
|---|---|
| `src/game.ts` | The game, as the model writes it (declarations only): three courses, three round upgrades, earn rules, stake, store. |
| `src/manifest.ts` | Loads and compiles it; `platformerAdapter()` for the room server and the client. Room template `platformer`. |
| `src/store.ts` | Store hooks on the Kit's API names: three round upgrades (40, 40, 60 coins), two outfits (300, 500), shield charm gear (120); mock until the token is live. |
| `client/` | The browser client: side-view three.js scene in every art style, HUD, input (keys, gamepad, touch), game feel. |
| `scripts/measure.ts` | Room server + headless Chrome on autopilot; frame, network and server numbers, screenshots. |
| `scripts/plan.ts` | The route planner on every course (how long a good run takes). |
| `test/` | Playtest bots through `engine.test.run`, the race rules, prediction, the store. |
| `llms.txt` | How to change the game (for agents). |

## How it plays on the server

- The sim is `@netnetcapital/engine-sim`'s platform mode (`src/platform.ts`):
  pure TypeScript swept AABB movement on a 1/1024 m grid at 60 Hz, so a
  predicting client replays its own climber bit for bit. Climbers are
  ghosts to each other and coins are per climber, so nothing another player
  does can make your prediction wrong.
- Jump feel: coyote time (0.1 s), a jump buffer (0.13 s), variable jump
  height (releasing Jump while rising cuts the rise), a lighter apex while
  Jump is held, a heavier fall, ceiling corner nudges, an air dash.
- The race runner (`@netnetcapital/engine/game` `RaceRunner`) owns rounds:
  countdown, race, results, the next course. It pays `player.finished` (your
  own act), and `race.won` and `race.podium` only with another person in the
  round. Seat bots never earn.
- Seat bots run routes found by the route planner (`planCourse`, cached per
  course and start tick), each starting a little after the signal by its
  skill. A bot stuck for 5 s skips to its next checkpoint.
- The gate's softlock check: the planner must find a route to the flag on
  every course.

## Run it

```sh
pnpm --filter @netnetcapital/engine-sim build && pnpm --filter @netnetcapital/engine build
ROOMS_STORE_MODE=mock pnpm --filter @netnet/rooms start          # room server on :2567
pnpm --filter @netnetcapital/template-platformer dev             # http://localhost:5360
```

Keys: A D or arrows run, Space W or Up jump, Shift dash, Down + Jump drops
through a ledge, R or Enter readies the next course. ` shows stats.

## Measure

```sh
pnpm --filter @netnetcapital/template-platformer build
CHROME_BIN=/path/to/chrome pnpm --filter @netnetcapital/template-platformer measure -- --seconds 40 --backend webgpu
```
