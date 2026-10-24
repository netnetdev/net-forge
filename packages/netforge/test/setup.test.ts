import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listSkills, run, setupAgent } from "../src/index.js";

const tmp = () => mkdtempSync(join(tmpdir(), "netforge-cli-"));

describe("netforge setup agent", () => {
  it("writes the agent files into an empty project", () => {
    const dir = tmp();
    const r = setupAgent(dir);
    expect(r.written.sort()).toEqual([".cursor/mcp.json", ".cursor/rules/netforge.mdc", ".mcp.json", ".vscode/mcp.json", "AGENTS.md", "CLAUDE.md"]);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain("netforge_validate_game");
    expect(JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8")).mcpServers.netforge).toEqual({ command: "npx", args: ["-y", "@netforge/mcp"] });
    expect(JSON.parse(readFileSync(join(dir, ".vscode/mcp.json"), "utf8")).servers.netforge.type).toBe("stdio");
  });

  it("merges into existing files and is idempotent", () => {
    const dir = tmp();
    writeFileSync(join(dir, "AGENTS.md"), "# My rules\n\nUse tabs.\n");
    writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    mkdirSync(join(dir, ".vscode"));
    writeFileSync(join(dir, ".vscode/mcp.json"), "{ not json");
    setupAgent(dir);
    const agents = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(agents.startsWith("# My rules")).toBe(true);
    expect(agents).toContain("## Net Forge");
    const mcp = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8"));
    expect(Object.keys(mcp.mcpServers).sort()).toEqual(["netforge", "other"]);
    expect(readFileSync(join(dir, ".vscode/mcp.json"), "utf8")).toBe("{ not json");
    const again = setupAgent(dir);
    expect(again.written).toEqual([]);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe(agents);
  });

  it("never replaces a server map it cannot merge into", () => {
    const dir = tmp();
    mkdirSync(join(dir, ".cursor"));
    writeFileSync(join(dir, ".cursor/mcp.json"), JSON.stringify({ mcpServers: ["kept"] }));
    const r = setupAgent(dir);
    expect(JSON.parse(readFileSync(join(dir, ".cursor/mcp.json"), "utf8"))).toEqual({ mcpServers: ["kept"] });
    expect(r.skipped.join("\n")).toMatch(/\.cursor\/mcp\.json/);
  });

  it("prints the install lines and lists the skills", () => {
    const out: string[] = [];
    const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s), cwd: tmp() };
    expect(run(["setup", "agent"], io)).toBe(0);
    expect(out.join("\n")).toContain("claude mcp add netforge -- npx -y @netforge/mcp");
    expect(run(["nope"], io)).toBe(2);
    const skills = listSkills();
    expect(skills.map((s) => s.name)).toEqual(["netforge-add-content", "netforge-create-game", "netforge-play-locally", "netforge-playtest"]);
    for (const s of skills) expect(s.description.length).toBeGreaterThan(60);
  });
});
