// The guides a new game ships with: README.md for the person, AGENTS.md
// for any coding agent (CLAUDE.md and the Cursor rule point at the same
// text), all written for this game's template and package manager.

import { runScript, type PackageManager } from "./args.js";
import type { Starter } from "./catalog.js";

export interface DocContext {
  readonly name: string;
  readonly starter: Starter;
  readonly gameTs: string;
  readonly pm: PackageManager;
  readonly hasLlms: boolean;
}

export const DOCS_URL = "https://forge.netnet.capital/docs";
/** How every guide names the engine on first mention (two words, never "NetForge"), with where to find it. */
export const IDENTITY = "Net Forge, the open-source multiplayer browser game engine built for AI coding agents";
export const IDENTITY_LINKS = "`@netforge` on npm, https://github.com/netnetdev/net-forge and https://forge.netnet.capital/docs";
export const SOURCE_URL = "https://github.com/netnetdev/net-forge";
const pkgDocs = (dir: string) => `${SOURCE_URL}/tree/main/packages/${dir}#readme`;

/** The declarations the template's game.ts imports from @netforge/engine, in its order. */
export function declarations(gameTs: string): string[] {
  const m = /import\s*\{([^}]*)\}\s*from\s*["']@netforge\/engine["']/.exec(gameTs);
  if (!m?.[1]) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim().split(/\s+as\s+/)[0]?.replace(/^type\s+/, "") ?? "")
    .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));
}

const fence = (lines: readonly string[]) => ["```sh", ...lines, "```"];

function commands(c: DocContext) {
  return {
    install: `${c.pm} install`,
    play: runScript(c.pm, "play"),
    test: runScript(c.pm, "test"),
    typecheck: runScript(c.pm, "typecheck"),
    // npm and bun need "--" before flags meant for the script.
    playFlags: (flags: string) => (c.pm === "npm" || c.pm === "bun" ? `${runScript(c.pm, "play")} -- ${flags}` : `${runScript(c.pm, "play")} ${flags}`),
    testFlags: (flags: string) => (c.pm === "npm" || c.pm === "bun" ? `${runScript(c.pm, "test")} -- ${flags}` : `${runScript(c.pm, "test")} ${flags}`),
  };
}

export function readme(c: DocContext): string {
  const t = c.starter;
  const cmd = commands(c);
  const decl = declarations(c.gameTs);
  return [
    `# ${c.name}`,
    "",
    `A game made with ${IDENTITY} (${IDENTITY_LINKS}). It started from ${t.title}, the ${t.genre} template. ${t.line}`,
    "",
    "Not affiliated with other projects named NetForge.",
    "",
    "It runs on your computer with play money. There is no wallet, no chain and no real money in local play.",
    "",
    "## Play it",
    "",
    "You need Node.js 20 or newer. In this folder:",
    "",
    ...fence([cmd.play]),
    "",
    `This builds the game, starts a local game server and opens your browser at http://127.0.0.1:4663. Open the same link in more tabs or windows for more players (up to ${t.seats}). Press Ctrl+C to stop it.`,
    "",
    `Use \`${cmd.playFlags("--no-open")}\` to print the link without opening a browser, and \`${cmd.playFlags("--port 4700")}\` if the port is taken. \`${cmd.playFlags("--host 0.0.0.0")}\` lets phones and other computers on your network join: it prints a link for them to open.`,
    "",
    "## Change the rules",
    "",
    "The whole game is `src/game.ts`. It declares what is in the game and how it plays, and the template does the rest: the renderer, the netcode, the physics, the controls and the bots.",
    "",
    ...(decl.length > 0 ? [`This template's game uses ${decl.map((d) => `\`${d}()\``).join(", ")} from \`@netforge/engine\`. That is the only import the file may make.`, ""] : []),
    "Change a number, add an enemy, a weapon or an upgrade, then check it and play it:",
    "",
    ...fence([`${cmd.test}        # playtest bots play the game and report what happened`, `${cmd.typecheck}   # the TypeScript check of src/game.ts`, cmd.play]),
    "",
    ...(c.hasLlms ? ["`llms.txt` is the template's guide: the rules the build enforces, the units, and recipes for the common changes. It is written for coding agents and reads fine for people too.", ""] : []),
    "## Use a coding agent",
    "",
    "`AGENTS.md` tells a coding agent how this project works: where the rules live, which API to use, how to run and test, and the errors it will meet. `CLAUDE.md`, `.cursor/rules/netforge.mdc` and `.github/copilot-instructions.md` point at the same guide. `.mcp.json` (and `.vscode/mcp.json`) connects agents that support MCP to the Net Forge MCP server (`npx -y @netforge/mcp`) for the docs and the templates. Ask your agent for a change in plain words, for example: add a fast enemy that appears after two minutes.",
    "",
    "## Files",
    "",
    "| Path | What it is |",
    "|---|---|",
    "| `src/game.ts` | The game's rules. Edit this. |",
    "| `src/names.json` | Optional. The title and the labels players read (see AGENTS.md). |",
    "| `netnet.json` | Names the template this game runs on. |",
    ...(c.hasLlms ? ["| `llms.txt` | The template's guide to changing the game. |"] : []),
    "| `AGENTS.md` | The guide for coding agents. |",
    "| `.netnet/play/` | The local build. Made by the play command, safe to delete. |",
    "",
    "## Learn more",
    "",
    `- Net Forge docs: ${DOCS_URL}`,
    `- Net Forge on GitHub: ${SOURCE_URL}`,
    `- The engine and its typed game API: ${pkgDocs("engine")}`,
    `- This template: ${pkgDocs(t.dir)}`,
    `- Local play and its options: ${pkgDocs("kit-play")}`,
    "",
    "Local play runs the game's own code on this computer with your permissions. Play only games whose code you trust.",
    "",
  ].join("\n");
}

/** The body shared by AGENTS.md and the Cursor rule. */
function guideBody(c: DocContext): string[] {
  const t = c.starter;
  const cmd = commands(c);
  const decl = declarations(c.gameTs);
  return [
    `This game is built with ${IDENTITY} (${IDENTITY_LINKS}).`,
    "",
    `It runs on the \`${t.id}\` template (${t.title}, ${t.genre}, up to ${t.seats} players). The template package \`${t.pkg}\` holds the client, the simulation and the bots. This project holds only the rules.`,
    "",
    "## Where things live",
    "",
    "- `src/game.ts` is the whole game and the only code file you change. It is declarations against the typed API in `@netforge/engine`; it does not render, network or simulate anything itself.",
    `- \`src/game.ts\` may import only \`@netforge/engine\`. Any other import (a relative file, \`node:*\`, another package) fails the build. Put helpers and constants in \`src/game.ts\` itself.`,
    ...(decl.length > 0 ? [`- The declarations this template uses: ${decl.map((d) => `\`${d}\``).join(", ")}. Keep the \`game({ template: "${t.id}", ... })\` call and its \`template\` value.`] : []),
    ...(c.hasLlms
      ? [
          "- `llms.txt` is the template's guide. Read it before changing anything: its \"Rules the build enforces\" section lists the limits the build checks, and \"Common changes\" has a recipe for each usual change.",
          `- Where \`llms.txt\` names monorepo paths, read the installed copies instead: \`packages/engine/...\` is \`node_modules/@netforge/engine/...\`, and \`client/...\` is \`node_modules/${t.pkg}/client/...\`. Where it says \`pnpm --filter ${t.pkg} test\`, run \`${cmd.test}\`.`,
        ]
      : []),
    "- The typed API: `node_modules/@netforge/engine/dist/index.d.ts` (exports) and `node_modules/@netforge/engine/dist/api/schemas.d.ts` (every field each declaration accepts). The design rules the playtests score are in `node_modules/@netforge/engine/GAME-DESIGN.md`, and `node_modules/@netforge/engine/llms.txt` covers look and feel.",
    "- `src/names.json` (optional) sets the title and every label players read: `{ \"title\": string, \"weapons\": { <id>: { \"name\", \"line\" } }, \"upgrades\": { <id>: { \"name\", \"line\" } }, \"enemies\": { <boss prefab id>: string }, \"rules\": { <earn rule id>: string }, \"skus\": { <sku id>: string } }`. Labels are 1 to 40 characters and ids are lower_snake_case. When the file exists it replaces the template's labels, so label every weapon, upgrade, earn rule and store item you declare.",
    "- `netnet.json` names the template. Do not change its `template` value: it must match the installed template package.",
    "- Do not edit `node_modules/` or `.netnet/` (build output). Do not add a client, a server or a renderer: the template provides them.",
    "",
    "## Run and test",
    "",
    ...fence([
      `${cmd.install}                     # once`,
      `${cmd.test}                     # compile the rules and run the playtest bots; exits non-zero on a failure`,
      `${runScript(c.pm, "check")}                    # the same, with the full report as JSON on stdout`,
      `${cmd.typecheck}                # the TypeScript check of src/game.ts`,
      `${cmd.playFlags("--no-open")}       # build and serve at http://127.0.0.1:4663 until stopped`,
    ]),
    "",
    `- After every change, run \`${cmd.test}\` first. It compiles \`src/game.ts\` exactly as the play build does (the same validation errors) and then plays it with bots, so it catches broken rules without a browser. \`${cmd.testFlags("--json")}\` prints the full report, and \`${cmd.testFlags("--minutes 4 --bots 2")}\` plays longer.`,
    `- The play command does not exit on its own: it serves the game until Ctrl+C. In an agent session, start it in the background or skip it and rely on the test command. It rebuilds on each start, so stop it and start it again after a change.`,
    "- Never invent asset ids. Model ids look like `style.lowpoly.<name>`; reuse ids that already appear in `src/game.ts` or `llms.txt`.",
    "",
    "## Common errors",
    "",
    "| Message | What to do |",
    "|---|---|",
    '| `src/game.ts may import only "@netforge/engine"` | Remove the other import and inline what it gave you. |',
    "| A declaration and a field, for example `prefab(\"shade\"): - health: Too small: expected number to be >=1` | The value is outside what the schema accepts. Check the field in `schemas.d.ts` and the limits in `llms.txt`. |",
    "| `game module: - every game needs ...` | A required declaration is missing (for example `earn.rule` or `earn.stake`). Put it back. |",
    `| \`${t.pkg} is not installed\` | Run \`${cmd.install}\` in this folder. |`,
    "| `netnet.json names an unknown template` | Restore the `template` value in `netnet.json`. |",
    "| `src/names.json ...` | Fix the file as the message says, or delete it to use the template's labels. |",
    `| \`EADDRINUSE\` or the port is taken | Another game is running. Stop it, or pass \`--port 4700\`. |`,
    "| A playtest check failed, or `softlock` | The bots could not make progress: an enemy too strong, a wave that never ends, a goal that cannot be reached. Undo the last change or tune it, then test again. |",
    "",
    "## The Net Forge MCP server",
    "",
    "`.mcp.json`, `.cursor/mcp.json` and `.vscode/mcp.json` register the Net Forge MCP server (`npx -y @netforge/mcp`). When your client has it, `netforge_validate_game` and `netforge_run_playtest` do what the test command does, and `netforge_search_docs` and `netforge_explain_api` look up the API before you guess. Docs: " + DOCS_URL,
    "",
    "## Money",
    "",
    "Local play is play money only. Earn rules (`earn.rule`) and the store (`store.sku`) still fire so you can see them, and pay nothing. Keep the earn rules, the `earn.stake` line and the store SKUs the template declares: the template's client is wired to them and the build requires them. Real payouts are decided only by Net Forge's hosted servers, never by this code.",
    "",
  ];
}

export function agentGuide(c: DocContext): string {
  return [`# ${c.name}: guide for coding agents`, "", ...guideBody(c)].join("\n");
}

export function copilotInstructions(): string {
  return ["# Project guide", "", "Read AGENTS.md in the project root before changing anything. It has where the rules live (src/game.ts), how to run and test, and the common errors.", ""].join("\n");
}

/** Claude Code reads CLAUDE.md; the @ line imports AGENTS.md so there is one guide to keep. */
export function claudeMd(): string {
  return ["# Project guide", "", "Everything about this project is in AGENTS.md: where the rules live, how to run and test, and the common errors.", "", "@AGENTS.md", ""].join("\n");
}

export function cursorRule(c: DocContext): string {
  return [
    "---",
    `description: How to change this Net Forge game (${c.starter.genre} template)`,
    "globs:",
    "alwaysApply: true",
    "---",
    "",
    ...guideBody(c),
  ].join("\n");
}
