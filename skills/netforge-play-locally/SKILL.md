---
name: netforge-play-locally
description: Run a Net Forge game on this computer in the browser with play money, for one or more players, with no wallet, chain or servers. Use when the user wants to try, see or play their Net Forge game, or test multiplayer with several browser tabs.
---

# Play a Net Forge game locally

1. In the game folder (it has `netnet.json` and `src/game.ts`), run
   `npm install` once.
2. Start it:
   - MCP: `netforge_play_locally { "projectDir": "/abs/path/my-game" }` returns the URL.
   - CLI: `npm run play` or `npx kit-play` in the folder, which opens
     `http://127.0.0.1:4663`.
3. Open the URL in more tabs or windows for more players. `--host 0.0.0.0`
   lets phones on the same network join.
4. Stop it with `netforge_play_locally { "projectDir": "...", "stop": true }`
   or Ctrl+C.

kit play builds the template's browser client with `src/game.ts` and runs a
local room host. Coins are play money and nothing pays out. It runs the
game's code with your permissions, so play only code you trust.

Docs: https://forge.netnet.capital/docs
