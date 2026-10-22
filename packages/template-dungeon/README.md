# CRYPTWICK (Template 3: co-op dungeon crawl)

Four wickbearers go down into a candle-lit crypt, room by room. The crypt
is grown from a seed (`dungeon(...)`): ten rooms joined by corridors, the
start room at the top and the Wax Abbot in the deepest one. Rooms wake as
the party nears them and their dead come through the doors; a cleared room
leaves a reliquary (pick an upgrade) and brings back anyone who fell. Runs
are permadeath: if the whole party is down at once, the descent is over.

| Path | What |
|---|---|
| `src/game.ts` | The game, as the model writes it (declarations only): the crypt's spec, the dead, weapons, the crawl system, earn, store. |
| `src/manifest.ts` | Loads and compiles it; `dungeonAdapter()` for the room server and client. Room template `dungeon`. |
| `src/store.ts` | Store hooks on the Kit's API names (`kit.coins.*`, `kit.store.*`): a revive (50 coins), a cosmetic (300 coins) and the wick charm (losable gear, 150 coins), shown under the token's own symbol and logo; mock until the token is live. |
| `client/` | The browser client: three.js scene, the crypt's floors and walls (`client/crypt.ts`, with an x-ray cut so a wall never hides your wickbearer and a fog of war over rooms nobody has entered), HUD, input (keys, gamepad, touch), game feel. |
| `test/` | Playtest bots through `engine.test.run`, and the store. |
| `llms.txt` | How to change the game (for agents). |

## How it plays on the server

- Server-authoritative at 30 Hz on the survivor machinery (auto-firing
  weapons, shards and level-up cards, co-op downs and revives, keepers,
  bosses with telegraphed attacks). Your own wickbearer is predicted.
- The crypt's walls are boxes in the sim (`field.walls`): players meet them
  in Rapier, and enemies, bolts and spawns are resolved against them by hand
  like pillars. Floors (`field.floors`) are the only ground: spawns land on
  them, and enemies behind a wall walk round through the doors on a flow
  field (engine-sim `walls.ts`), with a wider grid for big bodies.
- The crawl is a system in game.ts (the model can read and change it): room
  wakes, encounters by depth, off-screen spawns inside the woken room, the
  quiet timer that wakes the nearest room when the party waits, reliquaries
  and the respawn on clear.
- Earn: room.cleared (2 and 7 rooms), the Abbot, and 60 kills by one wickbearer, once per
  run each, on the same pay structure as EMBERWATCH. The room server is the
  referee; before graduation earn is credited as points, after it the
  game's own coins under its own name.

## Run it

This template runs on your own computer with play money through
`kit play` (`@netnetcapital/kit-play`). From the repository root:

```sh
pnpm install --frozen-lockfile && pnpm build
mkdir -p play-dungeon/src && cp packages/template-dungeon/src/game.ts play-dungeon/src/
echo '{"template":"dungeon"}' > play-dungeon/netnet.json
node packages/kit-play/dist/cli.js play-dungeon       # opens http://127.0.0.1:4663
```

Edit `play-dungeon/src/game.ts` and run it again to try a change. Real-token
earning, stakes and claims run only on the hosted Net Forge server.

Open the Invite link in another tab or on a phone on the same network to
play together (`?room=<id>`). Keys: WASD or arrows, Space dash, 1 2 3 pick.
Touch: drag on the left half, DASH button, tap a card. ` shows stats.
