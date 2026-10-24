# @netforge/kit

The Net Forge Cabinet Kit is the optional on-chain add-on for a browser game: it adds a game token, a store, payments in dollars and a mandatory earn mechanism, with a runtime library, a CLI (`add`, `init`, `doctor`) and an MCP server. It works with any engine and is written for AI coding agents first: an agent that reads `llms.txt` can wire a game in one command and one edit.

Games built on the Net Forge engine (`@netforge/engine` and the templates) get the Kit through their template. Install it yourself to add a token and a store to a game on another engine.

## Install

```sh
npm install @netforge/kit
```

Node 20 or later. React bindings are at `@netforge/kit/react` (React 18 or later, optional).

## Example

```sh
npx @netforge/kit add --earn wave_cleared
```

Report the earn event where the player earns it:

```ts
import { earn, kit } from "./netnet"; // the bootstrap that kit add wrote

earn("wave_cleared");
kit.coins.balance();  // whole coins, read every frame if you like
kit.coins.symbol();   // the token's own symbol, never a generic label
```

Then check the integration offline:

```sh
npx @netforge/kit doctor
```

Open the page with `?kit=mock` (or set `VITE_NETNET_KIT_MOCK=1` in Vite) to run on the mock backend: a funded in-memory wallet, the store from the config and a referee that grants one coin per event, with zero network calls.

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

**Rewards need a verified build.** The Net Forge referee pays tokens only for runs it can check. It replays every run of a game built on the Net Forge engine. A Kit game on its own engine or its own server (Phaser, Godot, Unity, a custom backend) is unverified. Games not built through Net Forge earn no reward-pool tokens: once the token is live, `earn()` grants none. The token still trades and the creator fee is unchanged. Net Forge decides this on its server from how the game was built and launched; nothing in the game or its config can change it. Coins before launch, the store, spends, cosmetics and saves all keep working.

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
| `kit play [dir]` | Runs a Net Forge game folder locally with play money (needs `@netforge/kit-play`). |

## For agents

- `llms.txt`: the steps, the API on one screen, and the rules `kit doctor` enforces.
- `llms-full.txt`: every function's contract, the errors, one example per engine (plain HTML, Vite, React, Phaser, three.js, Godot, Unity, Emscripten), the CLI and the MCP server.
- The Kit's own MCP server runs over stdio with `npx @netforge/kit mcp`. Tools: `get_integration_guide`, `add_kit`, `add_store_item`, `add_earn_event`, `run_doctor`.

```json
{ "mcpServers": { "netnet-kit": { "command": "npx", "args": ["-y", "@netforge/kit", "mcp"] } } }
```

- To make or change a game on the Net Forge engine, use the Net Forge MCP server instead: `npx -y @netforge/mcp`.

## Example game

`examples/plain-canvas` in the source repository is a small original canvas game (Comet Sweep) wired with the Kit: earn on every cleared wave and on a flawless wave, a revive paid in tokens, a gold ship sold for $1.00, and cash-out. It runs in mock mode with no chain.

## Status

`src/abi.ts` is generated from the Net Forge game contracts' ABIs. Each game's contracts are found by deriving their CREATE3 addresses from the factory and the slug, then checked against `GameFactory.gameOfToken` in the same call. `gameFactory` and `gameZap` are PLACEHOLDER addresses that throw on use, so live mode refuses to start until they are verified. Mock mode works today.

## Docs

- https://forge.netnet.capital/docs/packages/kit
- `llms.txt` and `llms-full.txt` in this package

## License

MIT. See `LICENSE`.
