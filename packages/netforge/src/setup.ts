// `netforge setup agent`: makes a project ready for a coding agent. Writes
// AGENTS.md (or adds a Net Forge section to an existing one), a CLAUDE.md
// that imports it, Cursor rules, and the MCP server entry in .mcp.json,
// .cursor/mcp.json and .vscode/mcp.json (merged into existing files, never replacing other
// servers). Prints the install lines for the agents that configure MCP
// outside the project.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const MCP_PACKAGE = "@netforge/mcp";
export const SKILLS_SOURCE = "netnetdev/net-forge";
export const DOCS_URL = "https://forge.netnet.capital/docs";
const MARK = "<!-- netforge:agents -->";

export const AGENTS_SECTION = `${MARK}
## Net Forge

This project builds a game on Net Forge, an MIT TypeScript engine for
multiplayer browser games. One simulation (ECS, Rapier physics, fixed tick,
snapshots) runs in the browser and on the room server, and a template draws,
networks and simulates the game.

- The whole game is \`src/game.ts\`: declarations (game, prefab, weapon,
  upgrade, director, system, earn.rule, earn.stake, store.sku and the genre's
  own). It may import only \`@netforge/engine\`.
- Ids are lower_snake_case. Every game declares at least one \`earn.rule\`
  and one \`earn.stake\`.
- Never write renderers, netcode or physics. Models are asset library ids
  such as \`"style.lowpoly.ghost"\`, never URLs or paths.
- After each change: \`netforge_validate_game\`, then \`netforge_run_playtest\`
  (MCP server \`${MCP_PACKAGE}\`). To try it in a browser:
  \`netforge_play_locally\` or \`npx kit-play\`.
- Look things up with \`netforge_search_docs\` and \`netforge_explain_api\`
  before guessing. Docs: ${DOCS_URL}
`;

export const CLAUDE_MD = "@AGENTS.md\n";

export const CURSOR_RULE = `---
description: Net Forge game rules (src/game.ts, validation, playtests)
alwaysApply: true
---

Read AGENTS.md. The game is src/game.ts and it may import only @netforge/engine.
Validate every change with netforge_validate_game and playtest with
netforge_run_playtest before calling it done.
`;

const server = { command: "npx", args: ["-y", MCP_PACKAGE] };

export interface SetupResult {
  readonly written: string[];
  readonly skipped: string[];
}

function readJson(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return {};
  try {
    const v = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function write(dir: string, rel: string, text: string, r: SetupResult): void {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
  r.written.push(rel);
}

/** Adds the netforge server under `key` in a JSON config, keeping everything else. */
function mergeMcp(dir: string, rel: string, key: "mcpServers" | "servers", entry: Record<string, unknown>, r: SetupResult): void {
  const file = join(dir, rel);
  const cfg = readJson(file);
  if (cfg === null) {
    r.skipped.push(`${rel} (not plain JSON, perhaps comments; left as it is: add the netforge entry by hand)`);
    return;
  }
  const current = cfg[key];
  if (current !== undefined && (current === null || typeof current !== "object" || Array.isArray(current))) {
    r.skipped.push(`${rel} ("${key}" is not an object, left as it is)`);
    return;
  }
  const servers = (current ?? {}) as Record<string, unknown>;
  if (servers.netforge) {
    r.skipped.push(`${rel} (already has netforge)`);
    return;
  }
  cfg[key] = { ...servers, netforge: entry };
  write(dir, rel, JSON.stringify(cfg, null, 2) + "\n", r);
}

export function setupAgent(dir: string): SetupResult {
  const r: SetupResult = { written: [], skipped: [] };
  const agents = join(dir, "AGENTS.md");
  if (!existsSync(agents)) write(dir, "AGENTS.md", `# Notes for coding agents\n\n${AGENTS_SECTION}`, r);
  else if (readFileSync(agents, "utf8").includes(MARK)) r.skipped.push("AGENTS.md (already has the Net Forge section)");
  else write(dir, "AGENTS.md", `${readFileSync(agents, "utf8").trimEnd()}\n\n${AGENTS_SECTION}`, r);

  const claude = join(dir, "CLAUDE.md");
  if (!existsSync(claude)) write(dir, "CLAUDE.md", CLAUDE_MD, r);
  else if (/@AGENTS\.md/.test(readFileSync(claude, "utf8"))) r.skipped.push("CLAUDE.md (already imports AGENTS.md)");
  else write(dir, "CLAUDE.md", `${readFileSync(claude, "utf8").trimEnd()}\n\n${CLAUDE_MD}`, r);

  if (existsSync(join(dir, ".cursor", "rules", "netforge.mdc"))) r.skipped.push(".cursor/rules/netforge.mdc (exists)");
  else write(dir, ".cursor/rules/netforge.mdc", CURSOR_RULE, r);

  mergeMcp(dir, ".mcp.json", "mcpServers", server, r);
  mergeMcp(dir, ".cursor/mcp.json", "mcpServers", server, r);
  mergeMcp(dir, ".vscode/mcp.json", "servers", { type: "stdio", ...server }, r);
  return r;
}

export const INSTALL_LINES = `MCP server (${MCP_PACKAGE}, runs locally, no keys):
  Claude Code   claude mcp add netforge -- npx -y ${MCP_PACKAGE}
  Cursor        written to .cursor/mcp.json (project); or add the same entry to ~/.cursor/mcp.json
  VS Code       code --add-mcp '{"name":"netforge","command":"npx","args":["-y","${MCP_PACKAGE}"]}'
  Codex         codex mcp add netforge -- npx -y ${MCP_PACKAGE}
  Gemini CLI    gemini mcp add netforge npx -y ${MCP_PACKAGE}

Agent Skills (create a game, add content, playtest, play locally):
  npx skills add ${SKILLS_SOURCE}
  or copy them from: npx netforge skills path

Docs: ${DOCS_URL}`;
