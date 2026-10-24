---
name: netforge-playtest
description: Validate a Net Forge game and run headless bot playtests that report kills, waves, deaths, softlocks, earn awards and server milliseconds per tick. Use after every change to a Net Forge game's src/game.ts, or when the user asks whether the game works, is fun or is balanced.
---

# Validate and playtest a Net Forge game

## With the MCP server (@netforge/mcp)

1. `netforge_validate_game { "projectDir": "/abs/path/my-game" }`
   returns `ok` and, for each problem, the stage, the engine's message, the
   likely line in `src/game.ts` and a hint. Fix and repeat until `ok` is true.
2. `netforge_run_playtest { "projectDir": "/abs/path/my-game", "bots": 4, "seconds": 120 }`
   runs bots on the same simulation the room server uses and returns the
   report plus plain findings. Pass `"bot": "human"` for players who react
   like people (the fun metrics), and `"response_format": "detailed"` for
   every metric.
3. Read `findings` first. Fix softlocks, failed checks, missing earn and a
   high p99 tick cost before anything else.

## Without MCP

The playtest is `engine.test.run` from `@netforge/engine`:

```ts
import { engine } from "@netforge/engine";
const r = await engine.test.run({ ticks: 30 * 120, bots: 4, seed: 1 });
console.log(r.kills, r.wave, r.softlock, r.msPerTick, r.failed);
```

Run it from a test file in the template package after importing the
template's `src/manifest.ts`, the way each template's `test/harness.test.ts`
does.

Docs: https://forge.netnet.capital/docs
