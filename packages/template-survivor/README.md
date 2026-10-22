# EMBERWATCH (Template 1: survivor-like co-op)

Four keepers hold a field at night against a swarm that grows every wave,
up to 2,000 at once. Weapons fire by themselves, gems level you up, pick
one of three upgrades, stand by a downed teammate to revive them, survive
ten waves and break the Bell Warden. `specs/game-runtime.md` §14 week 5.

| Path | What |
|---|---|
| `src/game.ts` | The game, as the model writes it (declarations only). |
| `src/manifest.ts` | Loads and compiles it; `survivorAdapter()` for the room server and client. |
| `src/store.ts` | Store hooks on the Kit's API names (`kit.coins.*`, `kit.store.*`): a revive (50 coins) and a cosmetic (300 coins), shown under the token's own symbol and logo; mock until the token is live. |
| `client/` | The browser client: three.js scene, HUD, input (keys, gamepad, touch), game feel. |
| `scripts/measure.ts` | Room server + node bots + headless Chrome; frame, network and server numbers, screenshots. |
| `test/` | Playtest bots through `engine.test.run`. |
| `llms.txt` | How to change the game (for agents). |

## Why a package here

It is a game, not engine code: Net Forge copies it as the starting repo
for a generated game. It is consumed by the room server (the game module)
and by a browser bundle (the client), so it is its own workspace package
under `packages/*` (no root workspace change), depending on
`@netnetcapital/engine` and `-sim`, with nothing depending back on it but
apps/rooms.

## Run it

```sh
pnpm --filter @netnetcapital/engine-sim build && pnpm --filter @netnetcapital/engine build
ROOMS_STORE_MODE=mock pnpm --filter @netnet/rooms start            # room server on :2567
pnpm --filter @netnetcapital/template-survivor dev                   # http://localhost:5320
```

Open the Invite link in another tab or on a phone on the same network to
play together (`?room=<id>`). Keys: WASD or arrows, Space dash, 1 2 3 pick.
Touch: drag on the left half, DASH button, tap a card. ` shows stats.

## Measure

```sh
pnpm --filter @netnetcapital/template-survivor build
CHROME_BIN=/path/to/chrome pnpm --filter @netnetcapital/template-survivor measure -- --seconds 60 --hold 2000 --backend webgpu
pnpm --filter @netnet/rooms load -- --template survivor --bots 4 --seconds 60 --hold 2000 --god 1
```

`--hold` and `--god` are measurement modes (the crowd is held at 2,000 and
downed bots stand back up), so the numbers are for the worst case, not a
calm early wave.
