// netforge_create_game: a new game folder from a template, the same shape as a game
// downloaded from Net Forge (netnet.json, src/game.ts, a package.json that
// lists the engine and kit-play). When the create-netforge package is
// installed and exports scaffold(), it does the work instead, so both stay
// one implementation.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { templateFor } from "@netforge/kit-play";
import { packageRoot, templateRoot } from "./locate.js";

export interface CreateGameInput {
  readonly template: string;
  /** Absolute path of the folder to create. It must not exist or must be empty. */
  readonly directory: string;
  /** npm package name for the game; defaults from the folder name. */
  readonly name?: string | undefined;
}

export interface CreateGameResult {
  readonly directory: string;
  readonly template: string;
  readonly files: readonly string[];
  readonly next: readonly string[];
  readonly via: "create-netforge" | "netforge-mcp";
}

export class ScaffoldError extends Error {}

function versionOf(pkg: string): string {
  const root = packageRoot(pkg);
  if (!root) return "latest";
  const v = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string }).version;
  return v ? `^${v}` : "latest";
}

function slug(s: string): string {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return out || "my-game";
}

type ExternalScaffold = (o: { template: string; directory: string; name?: string }) => Promise<{ files?: string[] } | void> | { files?: string[] } | void;

async function external(): Promise<ExternalScaffold | null> {
  try {
    const mod = (await import("create-netforge" as string)) as { scaffold?: unknown };
    return typeof mod.scaffold === "function" ? (mod.scaffold as ExternalScaffold) : null;
  } catch {
    return null;
  }
}

function agentsDoc(title: string, templateId: string, templateDir: string): string {
  const own = join(templateDir, "AGENTS.md");
  if (existsSync(own)) return readFileSync(own, "utf8");
  return `# ${title}: notes for coding agents

This is a Net Forge game on the ${templateId} template. The whole game is
src/game.ts: declarations against @netforge/engine, and nothing else.

- Edit src/game.ts only. It may import only "@netforge/engine".
- Ids are lower_snake_case. Every game declares at least one earn.rule and
  one earn.stake.
- Never write renderers, netcode or physics, and never use asset URLs or
  paths: use asset library ids such as "style.lowpoly.ghost".
- Check a change with the Net Forge MCP server: netforge_validate_game, then
  netforge_run_playtest, then netforge_play_locally. Without MCP, run \`npm run play\`.
`;
}

export async function createGame(input: CreateGameInput): Promise<CreateGameResult> {
  const t = templateFor(input.template);
  if (!t) throw new ScaffoldError(`Unknown template "${input.template}". Call netforge_list_templates for the ids.`);
  const dir = resolve(input.directory);
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new ScaffoldError(`${dir} already exists and is not empty. Pick a new folder.`);
  const name = slug(input.name ?? basename(dir));
  const next = [
    `cd ${dir} && npm install`,
    "Edit src/game.ts (read AGENTS.md first).",
    `netforge_validate_game { "projectDir": "${dir}" }`,
    `netforge_run_playtest { "projectDir": "${dir}" }`,
    `netforge_play_locally { "projectDir": "${dir}" } (or npm run play)`,
  ];

  const ext = await external();
  if (ext) {
    const r = await ext({ template: t.id, directory: dir, name });
    return { directory: dir, template: t.id, files: (r && r.files) || [], next, via: "create-netforge" };
  }

  const tplDir = templateRoot(t.pkg);
  if (!tplDir) throw new ScaffoldError(`${t.pkg} is not installed next to the MCP server.`);
  const game = readFileSync(join(tplDir, "src", "game.ts"), "utf8");
  const title = (/^#\s+([A-Z0-9 ]+?)\s*(\(|$)/m.exec(existsSync(join(tplDir, "README.md")) ? readFileSync(join(tplDir, "README.md"), "utf8") : "")?.[1] ?? t.label).trim();
  const files: Record<string, string> = {
    "package.json":
      JSON.stringify(
        {
          name,
          private: true,
          version: "0.1.0",
          type: "module",
          scripts: { play: "kit-play", typecheck: "tsc --noEmit" },
          dependencies: { "@netforge/engine": versionOf("@netforge/engine"), "@netforge/kit-play": versionOf("@netforge/kit-play") },
          devDependencies: { typescript: "5.8.3" },
        },
        null,
        2,
      ) + "\n",
    "netnet.json": JSON.stringify({ template: t.id }, null, 2) + "\n",
    "src/game.ts": game,
    "tsconfig.json":
      JSON.stringify(
        { compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler", strict: true, noUncheckedIndexedAccess: true, noEmit: true, skipLibCheck: true }, include: ["src"] },
        null,
        2,
      ) + "\n",
    ".gitignore": "node_modules/\n.netnet/\n",
    "AGENTS.md": agentsDoc(title, t.id, tplDir),
    "CLAUDE.md": "@AGENTS.md\n\nRead AGENTS.md. The game is src/game.ts; it may import only @netforge/engine. Validate with the Net Forge MCP tool netforge_validate_game and playtest with netforge_run_playtest before you call a change done.\n",
    ".mcp.json": JSON.stringify({ mcpServers: { netforge: { command: "npx", args: ["-y", "@netforge/mcp"] } } }, null, 2) + "\n",
    ".vscode/mcp.json": JSON.stringify({ servers: { netforge: { type: "stdio", command: "npx", args: ["-y", "@netforge/mcp"] } } }, null, 2) + "\n",
    ".cursor/rules/netforge.mdc": `---\ndescription: Net Forge game rules\nalwaysApply: true\n---\n\nRead AGENTS.md. The game is src/game.ts and it may import only @netforge/engine. Validate with netforge_validate_game and playtest with netforge_run_playtest before calling a change done.\n`,
    "README.md": `# ${name}

A Net Forge game on the ${t.label} template (${title}).

\`\`\`sh
npm install
npm run play      # opens http://127.0.0.1:4663 with play money
\`\`\`

The game is \`src/game.ts\`. Docs: https://forge.netnet.capital/docs
`,
  };
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return { directory: dir, template: t.id, files: Object.keys(files), next, via: "netforge-mcp" };
}
