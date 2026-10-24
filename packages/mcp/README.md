# @netforge/mcp

An MCP server that lets your coding agent build multiplayer browser games
with Net Forge: pick a template, scaffold the game, look up the API,
validate the game module, playtest it with bots and play it locally. It runs
on your computer and needs no chain, no wallet, no keys and no network.

## Install

Claude Code:

```sh
claude mcp add netforge -- npx -y @netforge/mcp
```

Cursor (`.cursor/mcp.json` in the project, or `~/.cursor/mcp.json`):

```json
{ "mcpServers": { "netforge": { "command": "npx", "args": ["-y", "@netforge/mcp"] } } }
```

VS Code (`.vscode/mcp.json`, or `code --add-mcp '{"name":"netforge","command":"npx","args":["-y","@netforge/mcp"]}'`):

```json
{ "servers": { "netforge": { "type": "stdio", "command": "npx", "args": ["-y", "@netforge/mcp"] } } }
```

Codex: `codex mcp add netforge -- npx -y @netforge/mcp`. Gemini CLI:
`gemini mcp add netforge npx -y @netforge/mcp`. Any other client: run the
`netforge-mcp` command over stdio.

`npx netforge setup agent` writes all of these configs, plus `AGENTS.md`,
`CLAUDE.md` and Cursor rules, into the current project.

## Tools

| Tool | What it does |
|---|---|
| `netforge_list_templates` | The ten genre templates: id, title, genre, players per room, pitch, package and the declarations each uses. |
| `netforge_create_game` | A new game folder from a template: `netnet.json`, `src/game.ts`, `package.json`, `AGENTS.md`, `CLAUDE.md` and MCP configs. |
| `netforge_search_docs` | Ranked sections from every package's `llms.txt`, `llms-full.txt`, README, `AGENTS.md` and the game design rules. |
| `netforge_explain_api` | One API name (`weapon`, `director`, `earn.rule`, `createPhysics`): its typed declaration, doc comment and the docs that use it. |
| `netforge_validate_game` | Bundles `src/game.ts` with its template, runs the engine's declaration validators and the template compile, and returns each error with its stage, line and a hint. |
| `netforge_run_playtest` | Runs bots on the server simulation (`engine.test.run`): kills, deaths, waves, softlocks, earn awards, ms per tick, fun metrics, genre checks and plain findings. |
| `netforge_play_locally` | Starts `kit play` for the folder and returns the local URL (play money, more tabs are more players); `stop: true` stops it. |

Search, explain and playtest take `response_format: "concise" | "detailed"`.
Every tool returns structured content with an output schema.

## Example session

```text
netforge_list_templates {}
netforge_create_game { "template": "survivor", "directory": "/path/to/night-watch" }
  (npm install in that folder)
netforge_explain_api { "name": "weapon" }
  (edit src/game.ts)
netforge_validate_game { "projectDir": "/path/to/night-watch" }
netforge_run_playtest { "projectDir": "/path/to/night-watch", "bots": 4, "seconds": 120 }
netforge_play_locally { "projectDir": "/path/to/night-watch" }
```

## Use it from code

```ts
import { createNetForgeMcpServer } from "@netforge/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

await createNetForgeMcpServer().connect(new StdioServerTransport());
```

Validation and playtests run the game's code in a child Node process with a
time limit and your permissions, the same as `kit play` and the template
tests. Run only game code you trust.

## Docs

https://forge.netnet.capital/docs/agents

## License

MIT
