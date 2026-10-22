# @netnetcapital/kit-play

`kit play` runs a game you downloaded from Net Forge on your own computer,
with play money.

```sh
cd my-game          # the folder from the Source download (netnet.json, src/game.ts)
npm install         # its package.json lists the engine and kit-play
npx kit play        # or: npm run play
```

It builds the template's browser client with your `src/game.ts` and
`src/names.json` in place, starts a local room host for the same game
module, and opens `http://127.0.0.1:4663`. Open the link in more tabs or
windows for more players.

| Flag | Default | |
|---|---|---|
| `--port <n>` | 4663 | the page and the room, one port |
| `--host <addr>` | 127.0.0.1 | `0.0.0.0` lets devices on your network join |
| `--players <n>` | 1 | browser tabs to open |
| `--no-open` | | print the link only |
| `--library-url <url>` | the installed library | load models and sounds from a mirror instead |

## What it does not do

- No wallet, no chain, no real tokens. Coins are play money in the page.
- No calls to Net Forge servers. The page is built with no `VITE_*`
  environment and talks only to the local host; sign-in, the referee and
  every money route answer 403.
- No stakes, pots or claims. Earn rules still fire, so you can see them,
  and pay nothing.

The local host is built from the engine's open simulation
(`@netnetcapital/engine`, `@netnetcapital/engine-sim`). The hosted room
server and the referee that decides real payouts are not part of it.
Progress (achievements, looks bought with play money) lives in memory and
is gone when `kit play` stops.

kit play is not a sandbox: it runs the game's code (the room host in Node,
the client in your browser) with your permissions. Play only games whose
code you trust, as with any program you run.

`src/game.ts` may import only `@netnetcapital/engine`, as in the studio, so
a game that plays here plays there. Send changes back with `/agent` in the
studio (see your game's README).

The build lands in `.netnet/play/` inside the game folder.
