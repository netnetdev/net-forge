# create-netforge

Start a game in one command with Net Forge, the open-source multiplayer browser game engine built for AI coding agents
(`@netforge` on npm, https://github.com/netnetdev/net-forge and https://forge.netnet.capital/docs). Pick one of ten multiplayer templates and get a project that
plays in your browser with play money, with a guide for you and one for
your coding agent. Not affiliated with other projects named NetForge.

```sh
npm create netforge@latest my-game
```

With no questions (for scripts and coding agents):

```sh
npm create netforge@latest my-game -- --template survivor --yes
npx create-netforge my-game --template cards --yes
pnpm create netforge my-game --template racer --yes
```

npm needs the `--` before the flags. Then:

```sh
cd my-game
npm run play
```

`npx @netforge/kit-play new my-game --template survivor` does the same.

## Templates

| Id | Genre | Players |
|---|---|---|
| `survivor` | Survivor-like co-op: hold a field against a swarm that grows every wave | 4 |
| `arena` | Arena shooter: rounds of beam combat with loadouts and seat-filling bots | 16 |
| `tower-defense` | Tower defense: build and upgrade towers on a shared board | 4 |
| `dungeon` | Co-op dungeon crawl: procedural rooms, loot and permadeath runs | 4 |
| `idle` | Idle: a shared salt flat where players fill a contract together | 8 |
| `platformer` | Platformer: races to the flag over cliffside courses | 8 |
| `cards` | Card battler: duels against a player or the AI, with a draft between them | 2 |
| `collector` | Monster collector: catch spirits and battle turn by turn with a team of three | 8 |
| `racer` | Kart racer: harbour circuits with drift boosts, boost pads and coins | 8 |
| `party` | Party co-op: five quick minigame rounds for two to eight friends | 8 |

`npx create-netforge --list --json` prints the same list as JSON.

## Options

| Flag | |
|---|---|
| `--dir <folder>` | The folder, if you would rather not give it first. |
| `-t, --template <id>` | The template. Aliases work too, such as `tower`, `td`, `horde`, `kart`. |
| `-y, --yes` | Ask nothing and take the defaults (`my-game`, `survivor`). |
| `--pm <npm\|pnpm\|yarn\|bun>` | The package manager. The default is the one that ran the command. |
| `--no-install` | Write the files only. |
| `--no-git` | Make no git repository. |
| `--agent <list>` | Agent files besides `AGENTS.md` and `.mcp.json`: `claude`, `cursor`, `copilot`, `all` (default) or `none`. |
| `--json` | Print a JSON summary on stdout (files, next commands). Logs go to stderr. |
| `--list` | List the templates. |

Without a terminal (CI, a coding agent) it never asks a question. A
missing folder becomes `my-game` and a missing template becomes
`survivor`. A bad template, a folder that is not empty or a name that
clashes with a dependency stops it with exit code 2 and a message that
says what to do.

## What you get

| Path | |
|---|---|
| `src/game.ts` | The game's rules, copied from the template. The only code file you change. |
| `netnet.json` | Names the template. |
| `package.json` | `play`, `test`, `check` and `typecheck` scripts, and the Net Forge packages at the current release. |
| `llms.txt` | The template's guide to changing the game. |
| `README.md` | How to play, change and test it. |
| `AGENTS.md` | The guide for coding agents: where the rules live, the typed API, how to run and test, the common errors. |
| `CLAUDE.md`, `.cursor/rules/netforge.mdc`, `.github/copilot-instructions.md` | Point the agent at `AGENTS.md`. |
| `.mcp.json`, `.cursor/mcp.json` | The Net Forge MCP server (`npx -y @netforge/mcp`). |
| `tsconfig.json`, `.gitignore` | |

Local play uses play money only. There is no wallet, no chain and no
real money. Docs: https://forge.netnet.capital/docs
