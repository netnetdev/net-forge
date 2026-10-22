// The MCP server end to end over an in-memory transport: an agent lists the
// tools, wires a game, adds an earn event and a store item, and runs doctor.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { createKitMcpServer } from "../src/mcp/server.js";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function text(r: unknown): string {
  const content = (r as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}

it("an agent integrates a game through the MCP tools", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kit-mcp-"));
  dirs.push(dir);
  cpSync(join(import.meta.dirname, "fixtures/comet-sweep"), dir, { recursive: true });

  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createKitMcpServer();
  await server.connect(serverT);
  const client = new Client({ name: "test-agent", version: "0.0.0" });
  await client.connect(clientT);

  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual(["add_earn_event", "add_kit", "add_store_item", "get_integration_guide", "run_doctor"]);

  const guide = text(await client.callTool({ name: "get_integration_guide", arguments: {} }));
  expect(guide).toContain("kit.init");

  const added = JSON.parse(text(await client.callTool({ name: "add_kit", arguments: { projectDir: dir, earnEvent: "wave_cleared" } }))) as { framework: string };
  expect(added.framework).toBe("vite");

  const earn = text(await client.callTool({ name: "add_earn_event", arguments: { projectDir: dir, id: "boss_down", label: "Defeat a boss" } }));
  expect(earn).toContain('earn("boss_down")');

  const item = text(await client.callTool({ name: "add_store_item", arguments: { projectDir: dir, id: "skin_gold", label: "Gold ship", kind: "permanent", priceUsdg: "1.00" } }));
  expect(item).toContain('kit.store.owns("skin_gold")');

  const bad = await client.callTool({ name: "add_store_item", arguments: { projectDir: dir, id: "Bad Id", label: "x", priceUsdg: "1" } });
  expect(bad.isError).toBe(true);
  expect(text(bad)).toContain("fix:");

  let report = text(await client.callTool({ name: "run_doctor", arguments: { projectDir: dir } }));
  expect(report).toContain("EARN_NOT_WIRED");

  // The agent writes the calls it was handed.
  const main = join(dir, "src/main.ts");
  writeFileSync(main, readFileSync(main, "utf8")
    .replace('void startKit(); // netnet-kit\n', 'void startKit(); // netnet-kit\nimport { earn } from "./netnet";\n')
    .replace("function onWaveCleared(): void {\n", 'function onWaveCleared(): void {\n  earn("wave_cleared");\n  if (wave % 5 === 0) earn("boss_down");\n'));
  report = text(await client.callTool({ name: "run_doctor", arguments: { projectDir: dir } }));
  expect(report).toContain("PASS");

  await client.close();
});
