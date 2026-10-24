# netforge

The Net Forge command line for coding agents: one command makes a project
ready for Claude Code, Cursor, VS Code, Codex and Gemini CLI, and the
package ships Agent Skills for building Net Forge games.

## Set up a project for your agent

```sh
npx netforge setup agent
```

It writes, without replacing anything you already have:

| File | For |
|---|---|
| `AGENTS.md` | Every agent: where the game lives, the rules, how to validate and playtest. Added as a section when the file exists. |
| `CLAUDE.md` | Claude Code: imports `AGENTS.md`. |
| `.cursor/rules/netforge.mdc` | Cursor rules. |
| `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json` | The `@netforge/mcp` server, merged next to your other servers. |

Then it prints the install lines for agents that keep MCP config outside
the project, such as `claude mcp add netforge -- npx -y @netforge/mcp`.

## Agent Skills

Four skills, each a folder with a `SKILL.md`:

| Skill | When the agent uses it |
|---|---|
| `netforge-create-game` | Start a game from one of ten genre templates. |
| `netforge-add-content` | Add an enemy, weapon, upgrade, earn rule or store item. |
| `netforge-playtest` | Validate and run bot playtests after every change. |
| `netforge-play-locally` | Play the game in the browser with play money. |

Install them in one line with `npx skills add netnetdev/net-forge`, or copy
them yourself:

```sh
npx netforge skills list
npx netforge skills copy <your agent's skills folder>
```

## Start a new game

```sh
npm create netforge@latest
```

## Docs

https://forge.netnet.capital/docs/agents

## License

MIT
