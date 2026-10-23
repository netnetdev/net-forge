# ROMPHOUSE (party co-op)

Two to eight friends in one big playroom, five quick rounds a show. Each
round is a minigame with one goal for the whole team: pop the party
poppers before the timer, crash every gift box, catch the runaway pup, hold
the floor against a tide, and as the finale burst the Big Balloon. Win
three and the show is a hit. Weapons fire by themselves, so every round is
about where you stand and who you help up.

| Path | What |
|---|---|
| `src/game.ts` | The game, as the model writes it (declarations only): the playroom, the party crowd, weapons, the show system with its ROUNDS list, earn, store. |
| `src/manifest.ts` | Loads and compiles it; `partyAdapter()` for the room server and client. Room template `party`. |
| `src/store.ts` | Store hooks on the Kit's API names (`kit.coins.*`, `kit.store.*`): a revive (50 coins), a cosmetic (300 coins) and the lucky charm (losable gear, 150 coins), shown under the token's own symbol and logo; mock until the token is live. |
| `client/` | The browser client: three.js scene, the playroom (`client/stage.ts`: a checkered dance floor, candy-striped walls, a ring of party lights, an x-ray cut so a wall never hides you), HUD (ROUND n and the round's clock), input (keys, gamepad, touch), game feel. |
| `test/` | Playtest bots through `engine.test.run`, and the store. |
| `llms.txt` | How to change the game (for agents). |

## How it plays on the server

- Server-authoritative at 30 Hz on the survivor machinery (auto-firing
  weapons, stars and level-up cards, co-op downs and revives, keepers, a
  boss with telegraphed attacks). Your own player is predicted.
- One room: a floor and four walls in the sim (engine `field.floors` and
  `field.walls`), bigger than the screen so every crowd arrives off screen.
- The show is a system in game.ts the model can read and change: a list of
  minigames (start, won, lastsOut), shuffled each show with the finale
  last, a breather between rounds that clears the floor and brings back
  anyone who is out.
- Earn: a round won, four rounds won, a clean sweep, and 70 kills by one player, once
  per show each, on the same pay structure as EMBERWATCH. The room server
  is the referee.

## Run it

This template runs on your own computer with play money through
`kit play` (`@netforge/kit-play`). From the repository root:

```sh
pnpm install --frozen-lockfile && pnpm build
mkdir -p play-party/src && cp packages/template-party/src/game.ts play-party/src/
echo '{"template":"party"}' > play-party/netnet.json
node packages/kit-play/dist/cli.js play-party       # opens http://127.0.0.1:4663
```

Edit `play-party/src/game.ts` and run it again to try a change. Real-token
earning, stakes and claims run only on the hosted Net Forge server.

Open the Invite link in another tab or on a phone on the same network to
play together (`?room=<id>`). Keys: WASD or arrows, Space dash, 1 2 3 pick.
Touch: drag on the left half, DASH button, tap a card. ` shows stats.
