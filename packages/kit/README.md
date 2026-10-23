# @netforge/kit

The NetNet Cabinet Kit adds a game token, a store, payments in dollars and a mandatory earn mechanism to an existing browser game on Robinhood Chain. It is written for AI coding agents first: an agent that reads `llms.txt` can wire a game in one command and one edit.

```sh
npx @netforge/kit add --earn wave_cleared
```

Then report the earn event where the player earns it, and check the integration:

```ts
import { earn } from "./netnet";
earn("wave_cleared");
```

```sh
npx @netforge/kit doctor
```

## For agents

- `llms.txt`: the five steps, the API on one screen, and the rules `kit doctor` enforces.
- `llms-full.txt`: every function's contract, the errors, one example per engine (plain HTML, Vite, React, Phaser, three.js, Godot, Unity, Emscripten), the CLI and the MCP server.
- MCP server over stdio: `npx @netforge/kit mcp`. Tools: `get_integration_guide`, `add_kit`, `add_store_item`, `add_earn_event`, `run_doctor`.

```json
{ "mcpServers": { "netnet-kit": { "command": "npx", "args": ["-y", "@netforge/kit", "mcp"] } } }
```

## What it does

| Surface | What the player gets | Chain cost |
|---|---|---|
| `kit.init({ game })` | balances, owned items, price in dollars, the coin ledger | 1 call when the game opens (plus 1 referee request, not RPC) |
| `kit.coins.*`, `kit.token.*`, `kit.store.owns/count/list`, quotes | instant reads, every frame if needed | 0 |
| `kit.coins.spend` covered by earned coins | no wallet prompt | 0 (1 referee request) |
| `kit.store.buy`, `kit.coins.buy/claim/cashOut`, a spend's chain remainder | one wallet prompt (plus an approval when needed) | the player's own transaction, then 1 call |
| `earn("event")` | the referee decides the reward from what happened | 0 chain calls (one POST to the referee) |

The Kit never polls. A game that never opens makes no calls at all. Players see dollars and the game's token, nothing else.

Every game must have at least one earn rule. `kit doctor` fails an integration without one.

**Rewards need a verified build.** NetNet's referee pays tokens only for runs it can check. It replays every run of a game built on the NetNet engine. A Kit game on its own engine or its own server (Phaser, Godot, Unity, a custom backend) is unverified. Games not built through Net Forge earn no reward-pool tokens: once the token is live, `earn()` grants none. The token still trades and the creator fee is unchanged. NetNet decides this on its server from how the game was built and launched; nothing in the game or its config can change it. Coins before launch, the store, spends, cosmetics and saves all keep working.

## Commands

| Command | Does |
|---|---|
| `kit add [dir]` | Detects the framework and writes `netnet.config.json`, a `netnet.ts`/`netnet.js` bootstrap, and two lines in the entry (or one script tag). Idempotent. |
| `kit init [dir]` | Writes `netnet.config.json` only. |
| `kit doctor [dir]` | Lints the integration offline. Exit 1 on any error. `--json` for tools. |
| `kit sync [dir]` | Rewrites the bootstrap's generated block (slug, typed ids) from the config. |
| `kit add-item <id>` | Adds a store item: `--label`, `--usdg`, `--token`, `--kind` (consumable, permanent or pass), `--duration`. |
| `kit add-earn <id>` | Adds an earn rule: `--label`, `--description`. |
| `kit guide [topic]` | Prints `llms-full.txt` or one section. |
| `kit mcp` | Runs the MCP server on stdio. |

## Example

`examples/plain-canvas` is a small original canvas game (Comet Sweep) wired with the Kit: earn on every cleared wave and on a flawless wave, a revive paid in tokens, a gold ship sold for $1.00, and cash-out. Run it with no chain from this package:

```sh
pnpm example
```

That sets `VITE_NETNET_KIT_MOCK=1`, so the game runs on the Kit's mock backend: a funded in-memory wallet, the store from the config and a referee that grants one token per event. Any page wired by `kit add` also runs in mock mode with `?kit=mock` in the URL.

## Status

`src/abi.ts` is generated from the NetNet game contracts' ABIs, and NetNet regenerates it when the contracts change. Each game's contracts are found by deriving their CREATE3 addresses from the factory and the slug, then checked against `GameFactory.gameOfToken` in the same call. `src/registry.generated.ts` holds the addresses the Kit uses, copied from NetNet's address registry. `gameFactory` and `gameZap` are not in the registry yet, so they are PLACEHOLDER and throw on use, and live mode refuses to start until NetNet verifies them. Mock mode works today.

## Development

```sh
pnpm build       # tsc to dist/
pnpm test        # vitest: one-call init, mock mode, add + doctor on fixture games, MCP
pnpm example     # the example game in mock mode
```

MIT licensed.
