# Net Forge

The open parts of Net Forge, the NetNet game studio: the game engine, the
shared simulation, the asset library, the game templates and `kit play`,
which runs a game downloaded from Net Forge on your own computer with play
money.

| Package | What it is |
|---|---|
| [`@netforge/asset-library-files`](packages/asset-library-files) | The built NetNet game asset library (optimized models, sprites, textures and sounds, all third-party CC0 art) that kit play serves to a game running on your own computer. |
| [`@netforge/asset-library`](packages/asset-library) | The per-style asset library of the Net Forge game engine: a manifest of CC0 models and sprites addressed by library id, shared rigs and clip sets, the look composer, the example gallery, and the three.js loader the templates draw with. |
| [`@netforge/engine-sim`](packages/engine-sim) | NetNet game runtime shared simulation: ECS, Rapier physics, fixed tick and snapshots. Runs identically in the browser and on the room server. |
| [`@netforge/engine`](packages/engine) | NetNet game runtime client: the typed game API the model writes against, and the three.js runtime (WebGPU with WebGL2 fallback) that plays it. |
| [`@netforge/kit-play`](packages/kit-play) | kit play: run a game downloaded from Net Forge on your own computer with play money. Builds the template client with your game module and runs a local room host from the engine's open simulation. No wallet, no chain, no Net Forge servers. |
| [`@netforge/kit`](packages/kit) | The NetNet Cabinet Kit: add a game token, a store, payments and a mandatory earn mechanism to any browser game on Robinhood Chain. Runtime library, CLI (add, init, doctor) and an MCP server, written for AI coding agents first. |
| [`@netforge/tabletop`](packages/tabletop) | The client kit the board-style templates share (tower defense, idle, card battler, monster collector): the room connection and input clock for rules genres, the styled 3D stage, the Kit store, stake and gear wiring, and the HUD shell. |
| [`@netforge/template-arena`](packages/template-arena) | VOLTYARD: Template 2 of the NetNet game runtime, an arena shooter with lag-compensated beams, loadouts, rounds and seat-filling bots. The game module, its browser client and its playtest bots. |
| [`@netforge/template-cards`](packages/template-cards) | INKWRIT: the card battler template of the NetNet game runtime, one against one or against the AI, a gauntlet of duels with a draft between them, server-side shuffle and hidden hands. The game module, its browser client and its playtest bots. |
| [`@netforge/template-collector`](packages/template-collector) | MOSSBOUND: the monster collector template of the NetNet game runtime, a shared marsh where keepers catch fen spirits, battle turn by turn with a team of three and bring down the warden before dusk. The game module, its browser client and its playtest bots. |
| [`@netforge/template-dungeon`](packages/template-dungeon) | CRYPTWICK: Template 3 of the NetNet game runtime, a co-op dungeon crawl for 4 players: procedural rooms, loot and permadeath runs. The game module, its browser client and its playtest bots. |
| [`@netforge/template-idle`](packages/template-idle) | BRINEWORKS: the idle template of the NetNet game runtime, a shared salt flat for up to eight: pump brine, boil salt, cut crystals, fill the contract together. The game module, its browser client and its playtest bots. |
| [`@netforge/template-party`](packages/template-party) | ROMPHOUSE: a party co-op template on the NetNet game runtime: 2 to 8 friends in one playroom, five quick minigame rounds a show. The game module, its browser client and its playtest bots. |
| [`@netforge/template-platformer`](packages/template-platformer) | SKYLEDGE: a platformer template of the NetNet game runtime, a race to the flag over cliffside courses with coyote time, jump buffering, variable jumps, dashes, springs and moving platforms. The game module, its browser client and its playtest bots. |
| [`@netforge/template-racer`](packages/template-racer) | TORQUEBAY: a racer template of the NetNet game runtime, kart races on harbour circuits with drift mini-turbos, boost pads, coins and laps at 60 Hz, a streamed track and seat-filling bots. The game module, its browser client and its playtest bots. |
| [`@netforge/template-survivor`](packages/template-survivor) | EMBERWATCH: Template 1 of the NetNet game runtime, a survivor-like co-op for 4 players and 2,000 enemies. The game module, its browser client and its playtest bots. |
| [`@netforge/template-tower`](packages/template-tower) | COGSPIRE: the tower defense template of the NetNet game runtime, a co-op board for up to four with waves, build and upgrade, shared lives. The game module, its browser client and its playtest bots. |

## Run a downloaded game

```sh
cd my-game          # the folder from the studio's Source download
npm install
npx kit play
```

`kit play` builds the template's browser client with your `src/game.ts`,
starts a local room host and opens `http://127.0.0.1:4663`. There is no
wallet, no chain and no real money; see
[packages/kit-play](packages/kit-play) for the details.

## Work on the packages

Needs Node 22 and pnpm 10.

```sh
pnpm install --frozen-lockfile
pnpm build        # engine-sim, engine, kit-play, kit
pnpm typecheck
pnpm test
```

## Play a template from this repository

After `pnpm build`, any template plays locally the same way a downloaded
game does. This plays EMBERWATCH, the survivor-like template:

```sh
mkdir -p play-survivor/src && cp packages/template-survivor/src/game.ts play-survivor/src/
echo '{"template":"survivor"}' > play-survivor/netnet.json
node packages/kit-play/dist/cli.js play-survivor
```

Each template's README has the same steps with its own template name.

## What is not here

The hosted room server, the referee that decides real payouts, the studio
and its generator, the asset pipeline that builds the library, and the
on-chain contracts are not part of this repository. Games built here run
with play money only. Real-token earning, stakes and claims run only on
the hosted Net Forge server.

## Source and releases

This repository is exported from NetNet's internal repository, which stays
the source of truth; each export is one commit. Issues and pull requests
are welcome here and are applied upstream, then come back with the next
export.

Packages are published to npm by `.github/workflows/publish.yml` when a tag
named `engine-v*` is pushed, dependencies first, with npm provenance.

## License

Every package is MIT licensed. The library assets are CC0 (see `NOTICE`).
