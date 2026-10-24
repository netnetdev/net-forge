# @netforge/engine

The Net Forge game engine client: a typed, declarative game API and a three.js renderer (WebGPU with a WebGL2 fallback) for multiplayer browser games.

One simulation is shared by client and server (an ECS with Rapier physics, a fixed tick and snapshots, in `@netforge/engine-sim`), ten finished multiplayer games ship as templates (`@netforge/template-*`), and the whole API is built to be written by your own coding agent.

## Install

```sh
npm install @netforge/engine
```

Node 20 or later. The package ships ES modules with TypeScript types.

## Example

A game is one file, `src/game.ts`, that declares what the game is. It imports only `@netforge/engine` and never touches the renderer, the netcode or the physics. This is a cut-down version of the arena shooter template:

```ts
import { earn, game, prefab, store, weapon } from "@netforge/engine";

export default game({
  template: "arena",
  style: "lowpoly",
  places: { yard: { chunks: "places/yard", spawn: [0, 1, 0] } },
  players: { prefab: "style.lowpoly.mini_male_f", max: 16, loadout: ["arc_rifle"], bots: 6, respawn: 3, drop: "volt_cell" },
  arena: { halfSize: 26, pillars: [[0, 0, 2.6]], spawns: [[22, 22], [-22, -22], [22, -22], [-22, 22]] },
  round: { seconds: 180, frags: 25 },
});
prefab("volt_cell", { model: "style.lowpoly.cell_heal", health: 1, speed: 0, kind: "pickup", value: 35 });
weapon("arc_rifle", { kind: "blaster", damage: 12, cooldown: 0.15, range: 26, speed: 44 });
earn.rule("live_wire", { when: "opponent.killed", n: 3, pay: 4, oncePer: "run" });
earn.stake({ min: 10, max: 100, multiple: 2 });
store.sku("skin_neon", { coins: 300, grants: { cosmetic: 1 } });
```

Then play it headless with bots and check it:

```ts
import { engine } from "@netforge/engine";

const report = await engine.test.run({
  ticks: 60 * 240,
  bots: 4,
  assert: [{ name: "someone scores", check: (r) => r.kills > 0 }],
});
console.log(report.kills, report.earned, report.softlock, report.msPerTick);
```

Bad declarations throw `GameDefinitionError` with one actionable line per issue, for example `model: reference assets by library id (e.g. "style.lowpoly.bat"), never by URL or path`.

## Entry points

| Import | Who uses it | What it holds |
|---|---|---|
| `@netforge/engine` | game code (`src/game.ts`) | `game`, `prefab`, `weapon`, `upgrade`, `system`, `director`, `earn`, `store`, `keeper`, `achievement`, `mission`, `title`, `economy`, `metaUpgrade`, `dungeon`, the board genre declarations (`towerBoard`, `tower`, `waves`, `saltFlat`, `plant`, `marsh`, `creature`, `move`, `card`, `cardTable`), and `engine.test.run`. Declarative, Zod-validated, no DOM. |
| `@netforge/engine/runtime` | template clients | the three.js renderer (`createRenderer`), `createRenderStack`, `CameraRig`, `InputController` (keyboard, mouse, gamepad, touch), `AssetLoader` (glTF, meshopt, KTX2), `FeelKit` and its parts, `SoundPlayer`, `ArenaClient`, `SystemScheduler`, `collectManifest`. |
| `@netforge/engine/game` | templates, room hosts, tests | `compileGame`, `collectManifest`, `GameRunner`, `EarnTracker`, `engineSimAdapter` (the SimAdapter on `@netforge/engine-sim`). |
| `@netforge/engine/net` | template clients | the client half of the netcode: prediction and reconciliation, interpolation, delta snapshots, input packets, clock adjustment and the room client. |
| `@netforge/engine/rules` | board genres | `rulesAdapter`, `playRules` and the genre modules: deterministic rules (tower defense, idle, cards, collector) behind the same SimAdapter seam. |
| `@netforge/engine/voxel` | template clients | the voxel style's core. |
| `@netforge/engine/earn-source` | tools | reads and rewrites the `earn.rule(...)` lines of a `src/game.ts` as source text. |

Game code imports only the root. Everything else is template machinery.

## What the root API covers

- **Templates**: `TEMPLATES` lists them: `survivor`, `arena`, `dungeon`, `racer`, `platformer`, `tower-defense`, `party`, `idle`, `cards` and `collector`.
- **Art**: `game({ style })` picks one of `STYLES`: `pixel`, `lowpoly`, `toon`, `voxel`, `ps1` or `handdrawn`. Models are asset library ids such as `"style.lowpoly.ghost"`, never URLs or file paths.
- **Look and feel**: `game({ look })`, `prefab({ feel })` and `weapon({ feel })` are presentation only and never change the simulation.
- **Earn**: every game declares at least one `earn.rule(...)` and exactly one `earn.stake({ min, max, multiple })`. The build fails without them. Ids are lower_snake_case.
- **Coins and the store**: `store.sku(...)` sells in-run consumables, cosmetics and unlocks by default. Permanent stat upgrades are opt-in through `economy({ metaUpgrades: true })` and `metaUpgrade(...)`, capped by the engine (`META_MAX_PER_STAT`, `META_MAX_TOTAL`).
- **Systems**: `system(id, ctx => ...)` gets `every`, `after`, `on`, `emit`, `spawn`, `spawnEdge`, `players`, `end` and a seeded `random`, on a tick clock.
- **Playtest**: `engine.test.run({ ticks, bots, seed?, enemies?, bot?, assert? })` plays the game on the server sim and reports kills, deaths, waves, runs, earn by rule, softlocks, ms per tick and fun metrics.

`GAME-DESIGN.md` holds the design rules the playtest gate measures (a readable opening, fast rewards, no on-screen spawns) and the recommended coin model.

## For AI agents

- Read `llms.txt` (look, feel, physics and rendering) and `llms-full.txt` (`llms.txt`, `GAME-DESIGN.md` and the API reference in one file).
- Each template package (`@netforge/template-*`) ships its own `llms.txt`, `llms-full.txt` and `AGENTS.md` for its genre.
- The Net Forge MCP server gives an agent the same tools over stdio: `npx -y @netforge/mcp` (package `@netforge/mcp`, bin `netforge-mcp`). Tools: `netforge_list_templates`, `netforge_create_game`, `netforge_explain_api`, `netforge_search_docs`, `netforge_validate_game`, `netforge_run_playtest`, `netforge_play_locally`.

To set up a coding agent in a game project, run `npx netforge setup agent`. It writes AGENTS.md, CLAUDE.md, Cursor rules and `.mcp.json` into the project. In Claude Code you can add the server with `claude mcp add netforge -- npx -y @netforge/mcp`. Any other MCP client takes this config:

```json
{ "mcpServers": { "netforge": { "command": "npx", "args": ["-y", "@netforge/mcp"] } } }
```

## Play a game locally

`@netforge/kit-play` runs a game folder (`netnet.json` plus `src/game.ts`) on your own computer with play money. See its README.

## Docs

- https://forge.netnet.capital/docs/packages/engine
- `llms.txt`, `llms-full.txt` and `GAME-DESIGN.md` in this package

## License

MIT. See `LICENSE` and `NOTICE`.
