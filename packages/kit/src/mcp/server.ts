// MCP server (stdio) for AI coding agents integrating the Kit.
//
// Tools:
//   get_integration_guide  the agent guide (llms-full.txt), whole or one section
//   add_kit                wire the Kit into the project (kit add)
//   add_store_item         add or update a store item, returns the call to write
//   add_earn_event         add or update an earn rule, returns the call to write
//   run_doctor             lint the integration, returns every finding with its fix
//
// Every tool works on files only. None touches the chain or spends anything.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { z } from "zod";
import { KIT_VERSION } from "../version.js";
import { addEarnEvent, addKit, addStoreItem, CliError } from "../cli/add.js";
import { formatReport, runDoctor } from "../cli/doctor.js";
import { guideSection } from "../cli/guide.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function guard(fn: () => string): ToolResult {
  try {
    return ok(fn());
  } catch (err) {
    if (err instanceof CliError) return { content: [{ type: "text", text: `[${err.code}] ${err.message}\nfix: ${err.fix}` }], isError: true };
    return { content: [{ type: "text", text: String(err instanceof Error ? err.message : err) }], isError: true };
  }
}

const projectDir = z.string().describe("Absolute path to the game project (the folder with package.json or index.html). Defaults to the server's working directory.").optional();
const dir = (p: string | undefined) => resolve(p ?? process.cwd());

export function createKitMcpServer(): McpServer {
  const server = new McpServer(
    { name: "netnet-kit", version: KIT_VERSION },
    {
      instructions:
        "Adds a game token, a store, payments and a mandatory earn mechanism to a browser game. Start with get_integration_guide, then add_kit, then add_earn_event and write the returned call where the player earns, then run_doctor until it passes. Never put contract addresses or the word wsNET in game code. Never poll: Kit getters are synchronous and free.",
    },
  );

  server.registerTool(
    "get_integration_guide",
    {
      title: "Kit integration guide",
      description: "Returns the Kit's agent guide (llms-full.txt): the API, every function's contract, the earn rule, the RPC rules and one worked example per engine. Pass a topic (e.g. \"Phaser\", \"React\", \"Earn\", \"Store\") for one section.",
      inputSchema: { topic: z.string().optional().describe("Section heading keyword, e.g. Phaser, three.js, React, Plain HTML, Earn, Store, Token, Errors.") },
    },
    async ({ topic }) => ok(guideSection(topic)),
  );

  server.registerTool(
    "add_kit",
    {
      title: "Add the Kit to a game",
      description: "Detects the framework (plain HTML, Vite, React, Phaser, three.js, Godot/Unity/Emscripten exports) and wires the Kit in with minimal diffs: netnet.config.json, a bootstrap module next to the entry, two lines in the entry (or one script tag). Idempotent. Returns the changes and the next steps; the earn call is always a next step you must write.",
      inputSchema: {
        projectDir,
        game: z.string().optional().describe("Game slug: lowercase letters, digits, dashes, 3 to 32 characters. Defaults from package.json name or folder."),
        earnEvent: z.string().optional().describe("First earn rule id, e.g. wave_cleared. Defaults to level_complete."),
        framework: z.enum(["plain-html", "vite", "react", "phaser", "three", "bundler", "godot", "unity", "emscripten"]).optional(),
        entry: z.string().optional().describe("Entry module relative to the project, if detection misses it."),
      },
    },
    async ({ projectDir: p, game, earnEvent, framework, entry }) =>
      guard(() => {
        const r = addKit(dir(p), { ...(game ? { game } : {}), ...(earnEvent ? { earn: earnEvent } : {}), ...(framework ? { framework } : {}), ...(entry ? { entry } : {}) });
        return JSON.stringify(r, null, 2);
      }),
  );

  server.registerTool(
    "add_store_item",
    {
      title: "Add a store item",
      description: "Adds or updates a SKU in netnet.config.json and syncs the bootstrap's typed ids. Prices are in dollars (USDG) and/or the game's token, never anything else. Returns the exact call to write in game code.",
      inputSchema: {
        projectDir,
        id: z.string().describe("SKU id, lowercase snake case, max 31 characters, e.g. skin_gold."),
        label: z.string().describe("What the player sees, e.g. Gold skin."),
        kind: z.enum(["consumable", "permanent", "pass"]).optional().describe("consumable can be bought again (revives); permanent is owned once (skins); pass runs for `duration` seconds. Default consumable."),
        duration: z.number().int().positive().optional().describe("Pass length in seconds (kind pass only)."),
        priceUsdg: z.string().optional().describe("Dollar price as a decimal string, e.g. \"0.50\"."),
        priceToken: z.string().optional().describe("Token price as a decimal string, e.g. \"10\"."),
      },
    },
    async ({ projectDir: p, id, label, kind, duration, priceUsdg, priceToken }) =>
      guard(() => {
        const r = addStoreItem(dir(p), { id, label, ...(kind ? { kind } : {}), ...(duration ? { duration } : {}), ...(priceUsdg ? { priceUsdg } : {}), ...(priceToken ? { priceToken } : {}) });
        return `${JSON.stringify({ item: r.item, changes: r.changes }, null, 2)}\n\nWrite this where the player buys or uses it:\n${r.snippet}`;
      }),
  );

  server.registerTool(
    "add_earn_event",
    {
      title: "Add an earn event",
      description: "Adds or updates an earn rule in netnet.config.json (every game needs at least one) and syncs the bootstrap's typed EarnEvent. Returns the call you must place at the exact moment the player earns it. The referee decides payouts; the browser only reports.",
      inputSchema: {
        projectDir,
        id: z.string().describe("Event id, lowercase snake case, e.g. wave_cleared."),
        label: z.string().describe("Plain-language rule for the store page, e.g. Clear a wave."),
        description: z.string().optional().describe("How the referee verifies it."),
      },
    },
    async ({ projectDir: p, id, label, description }) =>
      guard(() => {
        const r = addEarnEvent(dir(p), { id, label, ...(description ? { description } : {}) });
        return `${JSON.stringify({ rule: r.rule, changes: r.changes }, null, 2)}\n\nPlace this at the moment the player earns it:\n${r.snippet}`;
      }),
  );

  server.registerTool(
    "run_doctor",
    {
      title: "Check the integration",
      description: "Lints the project: config valid, earn rule present AND reported by game code (mandatory), Kit installed and started once, no polling loops, no direct chain reads (one Multicall3 snapshot only), no hardcoded addresses, no wsNET in game code, SKU and event ids match the config. Returns every finding with a one-line fix.",
      inputSchema: { projectDir, json: z.boolean().optional().describe("Return the raw report as JSON.") },
    },
    async ({ projectDir: p, json }) => {
      const r = runDoctor(dir(p));
      return ok(json ? JSON.stringify(r, null, 2) : formatReport(r));
    },
  );

  return server;
}

export async function startStdioServer(): Promise<void> {
  const server = createKitMcpServer();
  await server.connect(new StdioServerTransport());
}
