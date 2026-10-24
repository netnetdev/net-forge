#!/usr/bin/env node
// netforge: the Net Forge command line for coding agents.
//
//   netforge setup agent [dir]   write AGENTS.md, CLAUDE.md, Cursor rules and MCP configs
//   netforge skills path         print where the bundled Agent Skills are
//   netforge skills list         list the bundled skills
//   netforge skills copy <dir>   copy the skills into a skills folder
//   netforge help

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { INSTALL_LINES, setupAgent } from "./setup.js";
import { copySkills, listSkills, skillsDir } from "./skills.js";

export const HELP = `netforge: set up a project for coding agents that build Net Forge games.

Usage:
  netforge setup agent [dir]   Write AGENTS.md, CLAUDE.md, .cursor/rules/netforge.mdc,
                               .mcp.json, .cursor/mcp.json and .vscode/mcp.json (merged,
                               never replacing other servers) and print the install lines.
  netforge skills list         List the bundled Agent Skills.
  netforge skills path         Print the folder that holds them.
  netforge skills copy <dir>   Copy every skill folder into <dir> (your agent's skills folder).

Start a new game: npm create netforge@latest
Docs: https://forge.netnet.capital/docs`;

export function run(argv: readonly string[], io: { out(s: string): void; err(s: string): void; cwd: string }): number {
  const [cmd, sub, arg] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    io.out(HELP);
    return 0;
  }
  if (cmd === "setup" && (sub === "agent" || sub === undefined)) {
    const dir = resolve(io.cwd, arg ?? ".");
    const r = setupAgent(dir);
    for (const f of r.written) io.out(`wrote    ${f}`);
    for (const f of r.skipped) io.out(`skipped  ${f}`);
    io.out("");
    io.out(INSTALL_LINES);
    return 0;
  }
  if (cmd === "skills") {
    if (sub === "path") {
      io.out(skillsDir());
      return 0;
    }
    if (sub === "list" || sub === undefined) {
      for (const s of listSkills()) io.out(`${s.name.padEnd(26)} ${s.description}`);
      return 0;
    }
    if (sub === "copy" && arg) {
      for (const f of copySkills(resolve(io.cwd, arg))) io.out(`copied   ${f}`);
      return 0;
    }
  }
  io.err(`Unknown command: ${argv.join(" ")}\n\n${HELP}`);
  return 2;
}

const isMain = (() => {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) process.exitCode = run(process.argv.slice(2), { out: (s) => console.log(s), err: (s) => console.error(s), cwd: process.cwd() });
