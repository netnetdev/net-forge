# @netforge/kit-play

Part of Net Forge, the open-source multiplayer browser game engine built for AI coding agents (`@netforge` on npm, https://github.com/netnetdev/net-forge and https://forge.netnet.capital/docs). Not affiliated with other projects named NetForge.

`kit play` runs a Net Forge game on your own computer with play money: it builds the template's browser client with your `src/game.ts` and starts a local room host for the same game module, with no wallet, no chain and no Net Forge servers.
It also starts new games from a template and tests them with playtest bots.

| Command | What it does |
|---|---|
| `kit-play play [dir]` | Build the game in `dir` (default: here) and play it. `kit-play [dir]` does the same. |
| `kit-play test [dir]` | Compile `src/game.ts` as the play build does and run the playtest bots. No browser. Exits 1 on a failure; `--json` prints the report. |
| `kit-play check [dir]` | `kit-play test` with the report as JSON on stdout. |
| `kit-play new [folder] --template <id>` | Start a new game. The same as `npm create netforge@latest`; see [create-netforge](../create-netforge). |
| `kit-play templates [--json]` | List the ten templates. |

`kit-play test` takes `--minutes <n>` (minutes of game time at the
template's own tick rate, default 1), `--bots <n>` and `--seed <n>`.

With `--host 0.0.0.0`, `kit-play play` also prints a link for each network
address of this computer. Open that link on a phone or another computer:
it carries `?server=`, which tells the page which room to join.

## Install

```sh
npm install @netforge/kit-play
```

Node 20 or later. The package brings the engine, the asset library files and every template with it. The bin is `kit-play`; `kit play` through `@netforge/kit` runs the same command.

## Example

A game folder needs `netnet.json` (which template) and `src/game.ts` (the game). `src/names.json` (the title and labels) is optional. To start from a template:

```sh
mkdir -p my-game/src && cd my-game
npm init -y && npm install @netforge/kit-play @netforge/engine
cp node_modules/@netforge/template-survivor/src/game.ts src/
echo '{"template":"survivor"}' > netnet.json
npx kit-play                 # opens http://127.0.0.1:4663
npx kit-play --players 2     # two tabs, two local players
```

Edit `src/game.ts` and run it again to try a change. Open the link in more tabs or windows for more players. The build lands in `.netnet/play/` inside the game folder.

Template ids for `netnet.json`: `survivor`, `arena`, `tower-defense`, `dungeon`, `idle`, `platformer`, `cards`, `collector`, `racer`, `party`.

## Flags

| Flag | Default | |
|---|---|---|
| `--port <n>` | 4663 | the page and the room, one port |
| `--host <addr>` | 127.0.0.1 | `0.0.0.0` lets devices on your network join |
| `--players <n>` | 1 | browser tabs to open (1 to 16) |
| `--no-open` | | print the link only |
| `--library-url <url>` | the installed library | load models and sounds from a mirror instead |

From code: `import { play } from "@netforge/kit-play"` takes `{ dir, port, host, open, players, libraryUrl, log }` and resolves to `{ url, close() }`. `readGameFolder(dir)` checks a folder without running it, and `TEMPLATES` lists the templates it can run.

## A solo demo for the web

`kit-play build-demo` builds a single-player copy that plays entirely in the browser: a static folder with `index.html` at its root, relative paths and no server. The same room host `kit play` runs in Node runs in a Web Worker in the page (or in the page itself when a worker cannot start), so the game and the client are the ones you play locally. Seat bots fill empty places in the templates that have them.

```sh
npx kit-play build-demo --out demo                      # the game in this folder
npx kit-play build-demo --template arena --out demo     # a template as it ships
```

`--library <dir>` points at the built asset library (default: `ASSET_LIBRARY_DIR`, else the installed `@netforge/asset-library-files`); only the models and sounds the game uses are copied. Zip the folder's contents for an itch.io HTML5 upload, or put it on any static host. The page makes no request outside its own files, needs no SharedArrayBuffer, and works in a sandboxed iframe and from a subpath. Coins are play money, progress lasts for the visit, and the start screen links to Net Forge.

## What it does not do

- No wallet, no chain, no real tokens. Coins are play money in the page.
- No calls to Net Forge servers. The page is built with no `VITE_*` environment and talks only to the local host; sign-in, the referee and every money route answer 403.
- No stakes, pots or claims. Earn rules still fire, so you can see them, and pay nothing.
- No saved progress. Achievements and looks bought with play money live in memory and are gone when `kit play` stops.

The local host is built from the engine's open simulation (`@netforge/engine`, `@netforge/engine-sim`). The hosted room server and the referee that decides real payouts are not part of it.

kit play is not a sandbox: it runs the game's code (the room host in Node, the client in your browser) with your permissions. Play only games whose code you trust, as with any program you run.

`src/game.ts` may import only `@netforge/engine`, as in the Net Forge studio, so a game that plays here plays there.

## For AI agents

- Read `llms.txt` in this package, and the template's own `AGENTS.md` and `llms.txt`.
- The Net Forge MCP server runs local play for an agent with the `netforge_play_locally` tool, next to `netforge_validate_game` and `netforge_run_playtest`: `npx -y @netforge/mcp` (package `@netforge/mcp`, bin `netforge-mcp`).
- `npx netforge setup agent` writes AGENTS.md, CLAUDE.md, Cursor rules and `.mcp.json` into a game project. In Claude Code: `claude mcp add netforge -- npx -y @netforge/mcp`.

## Docs

- https://forge.netnet.capital/docs/packages/kit-play
- `llms.txt` in this package

## License

MIT. See `LICENSE` and `NOTICE`.
