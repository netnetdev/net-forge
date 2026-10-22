# EMBERWATCH (Template 1: survivor-like co-op)

Four keepers hold a field at night against a swarm that grows every wave,
up to 2,000 at once. Weapons fire by themselves, gems level you up, pick
one of three upgrades, stand by a downed teammate to revive them, survive
ten waves and break the Bell Warden.

| Path | What |
|---|---|
| `src/game.ts` | The game, as the model writes it (declarations only). |
| `src/manifest.ts` | Loads and compiles it; `survivorAdapter()` for the room server and client. |
| `src/store.ts` | Store hooks on the Kit's API names (`kit.coins.*`, `kit.store.*`): a revive (50 coins) and a cosmetic (300 coins), shown under the token's own symbol and logo; mock until the token is live. |
| `client/` | The browser client: three.js scene, HUD, input (keys, gamepad, touch), game feel. |
| `test/` | Playtest bots through `engine.test.run`. |
| `llms.txt` | How to change the game (for agents). |

## Why a package here

It is a game, not engine code: Net Forge copies it as the starting repo
for a generated game. The room server loads its game module and a browser
bundle is its client, so it is its own package, depending on
`@netnetcapital/engine` and `-sim`.

## Run it

This template runs on your own computer with play money through
`kit play` (`@netnetcapital/kit-play`). From the repository root:

```sh
pnpm install --frozen-lockfile && pnpm build
mkdir -p play-survivor/src && cp packages/template-survivor/src/game.ts play-survivor/src/
echo '{"template":"survivor"}' > play-survivor/netnet.json
node packages/kit-play/dist/cli.js play-survivor       # opens http://127.0.0.1:4663
```

Edit `play-survivor/src/game.ts` and run it again to try a change. Real-token
earning, stakes and claims run only on the hosted Net Forge server.

Open the Invite link in another tab or on a phone on the same network to
play together (`?room=<id>`). Keys: WASD or arrows, Space dash, 1 2 3 pick.
Touch: drag on the left half, DASH button, tap a card. ` shows stats.
