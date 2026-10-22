# VOLTYARD (Template 2: arena shooter)

Wirejacks duel at night in a yard of humming transformers. Twin-stick: move
with one hand, aim with the other, hold fire. Swap between an arc rifle, a
scatter coil and a rail lance. Every kill drops a heal cell. Rounds last
three minutes or end at 25 kills; the top of the board takes the round.
Bots fill empty seats, so one player alone still gets a fight.

| Path | What |
|---|---|
| `src/game.ts` | The game, as the model writes it (declarations only). |
| `src/manifest.ts` | Loads and compiles it; `arenaAdapter()` for the room server and client. Room template `shooter`. |
| `src/store.ts` | Store hooks on the Kit's API names (`kit.coins.*`, `kit.store.*`): three round upgrades (40, 40, 60 coins) and two finishes (300, 500 coins), shown under the token's own symbol and logo; mock until the token is live. |
| `client/` | The browser client: three.js scene, HUD, twin-stick input (keys and mouse, gamepad, touch), game feel. |
| `test/` | Playtest bots through `engine.test.run`, and the store. |
| `llms.txt` | How to change the game (for agents). |

## How it plays on the server

- Server-authoritative at 60 Hz. Your own wirejack is predicted (move, aim,
  weapon, cooldowns); everyone else is drawn ~100 ms in the past.
- The rail lance is a hitscan resolved with lag compensation: the server
  rewinds the other players to what you saw (capped at 200 ms). Rifle and
  scatter shots are server projectiles.
- Seat bots (`players.bots`) join while at least one person is in the
  room and leave as people join. Against a person they react late, aim
  loose and fire in bursts by that person's record this round, sharpening
  as the person wins. A bot level with or ahead of the best person eases
  off (looser aim, slower reactions, and it would rather fight other bots),
  but bots never stop shooting and never earn. Killing a bot scores and
  shows in the feed but pays no earn rule. Only a person reaches the frag
  limit.
- Spawns: out of every opponent's sight (physics raycasts) and 12 m clear,
  with 2 s of protection on joining, respawning and each new round.
- `test/newcomer.test.ts` plays a deliberately weak new player alone with
  the seat bots over 10 rounds: first kill within about 20 s, no deaths
  within 3 s of spawning, top half in most rounds without winning every
  one, no bot reaching the frag limit. It also reports what the newcomer
  earns per round, which alone with bots is nothing.
- Earn: kills of people (3 and 12 in a round), a five-kill streak, and
  topping the board with another person in the round. Bot kills and a board
  of bots pay nothing, enforced by the engine's
  `GameRunner` for every arena game. The room server is the referee; before graduation earn is credited
  as points, after it the game's own coins under its own name.

## Run it

This template runs on your own computer with play money through
`kit play` (`@netnetcapital/kit-play`). From the repository root:

```sh
pnpm install --frozen-lockfile && pnpm build
mkdir -p play-arena/src && cp packages/template-arena/src/game.ts play-arena/src/
echo '{"template":"arena"}' > play-arena/netnet.json
node packages/kit-play/dist/cli.js play-arena       # opens http://127.0.0.1:4663
```

Edit `play-arena/src/game.ts` and run it again to try a change. Real-token
earning, stakes and claims run only on the hosted Net Forge server.

Open the Invite link in another tab or on a phone on the same network to
play together (`?room=<id>`). Keys: WASD, mouse aim, click fire, 1 2 3 or Q
weapon, Space dash, Tab board. Touch: left stick moves, right stick aims and
fires, SWAP and DASH buttons. ` shows stats.
