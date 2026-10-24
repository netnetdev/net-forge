---
name: netforge-create-game
description: Start a new multiplayer browser game with Net Forge from one of ten finished genre templates (survivor-like, arena shooter, tower defense, dungeon crawl, idle, platformer, card battler, monster collector, kart racer, party). Use when the user asks to make, scaffold or start a browser game, a multiplayer game, a co-op game or an .io-style game.
---

# Create a Net Forge game

Net Forge games are one declarative file, `src/game.ts`, on top of a
template that already has rendering (three.js, WebGPU with a WebGL2
fallback), multiplayer netcode, physics, input, HUD and bots.

## Steps

1. Pick the template that matches the request. With the MCP server, call
   `netforge_list_templates`; without it, use one of these ids: `survivor`,
   `arena`, `tower-defense`, `dungeon`, `idle`, `platformer`, `cards`,
   `collector`, `racer`, `party`.
2. Create the folder:
   - MCP: `netforge_create_game { "template": "survivor", "directory": "/abs/path/my-game" }`
   - CLI: `npm create netforge@latest my-game -- --template survivor --yes`
3. `cd my-game && npm install`
4. Read `AGENTS.md` in the new folder, then make the user's changes in
   `src/game.ts` (see the netforge-add-content skill).
5. Validate and playtest (see the netforge-playtest skill), then let the
   user play it (see the netforge-play-locally skill).

## Rules

- `src/game.ts` may import only `@netforge/engine`.
- Ids are lower_snake_case.
- Every game keeps at least one `earn.rule(...)` and one `earn.stake(...)`.
- Keep `game({ style })`: the art style the template draws in.
- Do not write renderers, netcode or physics, and never use asset URLs.

Docs: https://forge.netnet.capital/docs
