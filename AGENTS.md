# Net Forge: notes for coding agents

Net Forge is an MIT TypeScript engine for multiplayer browser games. One
simulation (ECS, Rapier physics, fixed tick, snapshots) runs in the browser
and on the room server, a three.js renderer (WebGPU with a WebGL2 fallback)
draws it, and ten finished genre games ship as templates.

## Building a game (most tasks)

- Start one with `npm create netforge@latest`, or the MCP tool
  `netforge_create_game` (`npx -y @netforge/mcp`).
- The whole game is `src/game.ts`: declarations against `@netforge/engine`,
  and nothing else may be imported.
- Ids are lower_snake_case. Every game keeps one `earn.rule` and one
  `earn.stake` at least.
- Never write renderers, netcode or physics; never use asset URLs (use
  library ids like `"style.lowpoly.ghost"`).
- Check every change: `netforge_validate_game`, then `netforge_run_playtest`.
  Play it with `netforge_play_locally` or `npm run play`.

## Working on this repository

- `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test`
- Packages: `packages/engine-sim` (simulation), `packages/engine` (game API
  and runtime), `packages/template-*` (the ten games), `packages/kit-play`
  (local play), `packages/mcp` (MCP server), `packages/netforge` (agent
  setup CLI and skills), `packages/asset-library*` (CC0 assets),
  `packages/tabletop` (board template client kit), `packages/kit` (optional
  on-chain add-on).
- Each package has a README and most have `llms.txt`; read those first.
- Pull requests are applied upstream and return with the next export (see
  CONTRIBUTING.md).
