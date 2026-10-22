// The spec's acceptance test, approximated (cabinet-launcher.md §11 step 3):
// from a clean copy of a game without the Kit, `kit add` wires it, the one
// edit llms.txt tells the agent to make (report an earn event) is applied,
// and `kit doctor` passes. Run for every framework the CLI detects.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runCli } from "../src/cli/index.js";
import { runDoctor } from "../src/cli/doctor.js";
import { KIT_VERSION } from "../src/version.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const tmpRoots: string[] = [];

function copyFixture(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `kit-${name}-`));
  tmpRoots.push(dir);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  return dir;
}

async function cli(cwd: string, ...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await runCli(argv, { cwd, out: (s) => void (out += `${s}\n`), err: (s) => void (err += `${s}\n`) });
  return { code, out, err };
}

function edit(dir: string, file: string, from: string | RegExp, to: string): void {
  const path = join(dir, file);
  const src = readFileSync(path, "utf8");
  const next = src.replace(from, to);
  if (next === src) throw new Error(`edit did not apply in ${file}`);
  writeFileSync(path, next);
}

afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true });
});

describe("kit add + kit doctor on a clean game", () => {
  it("Vite + TypeScript canvas game (the example, without the Kit)", async () => {
    const dir = copyFixture("comet-sweep");

    // Before: doctor fails on everything the Kit adds.
    const before = runDoctor(dir);
    expect(before.ok).toBe(false);
    expect(before.findings.map((f) => f.code)).toContain("CONFIG_MISSING");

    const add = await cli(dir, "add", "--earn", "wave_cleared");
    expect(add.code).toBe(0);
    expect(add.out).toContain('Kit added (vite, game "comet-sweep")');

    // Minimal diffs: the entry gains two code lines (and one blank line below its header comment).
    const original = readFileSync(join(FIXTURES, "comet-sweep/src/main.ts"), "utf8");
    const wiredEntry = readFileSync(join(dir, "src/main.ts"), "utf8");
    expect(wiredEntry.split("\n").length).toBe(original.split("\n").length + 3);
    expect(wiredEntry.split("\n").filter((l) => l.includes("// netnet-kit"))).toHaveLength(2);
    expect(wiredEntry.startsWith("// Comet Sweep")).toBe(true);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@netnetcapital/kit"]).toBe(KIT_VERSION);

    // After add alone, the only error left is the mandatory earn call.
    const mid = runDoctor(dir);
    expect(mid.findings.filter((f) => f.severity === "error").map((f) => f.code)).toEqual(["EARN_NOT_WIRED"]);

    // The agent's edit, exactly as llms.txt prescribes it.
    edit(dir, "src/main.ts", 'void startKit(); // netnet-kit\n', 'void startKit(); // netnet-kit\nimport { earn } from "./netnet";\n');
    edit(dir, "src/main.ts", "function onWaveCleared(): void {\n", 'function onWaveCleared(): void {\n  earn("wave_cleared");\n');

    const doc = await cli(dir, "doctor");
    expect(doc.out).toContain("PASS");
    expect(doc.code).toBe(0);

    // Idempotent: a second add changes nothing.
    const again = await cli(dir, "add", "--json");
    const changes = (JSON.parse(again.out) as { changes: Array<{ action: string }> }).changes;
    expect(changes.every((c) => c.action === "unchanged")).toBe(true);
  });

  it("plain HTML with a classic script", async () => {
    const dir = copyFixture("sky-hop");
    const add = await cli(dir, "add", "--game", "sky-hop");
    expect(add.code).toBe(0);
    expect(add.out).toContain("plain-html");
    expect(readFileSync(join(dir, "index.html"), "utf8")).toContain('<script type="module" src="./netnet.js"></script>');
    expect(runDoctor(dir).findings.filter((f) => f.severity === "error").map((f) => f.code)).toEqual(["EARN_NOT_WIRED"]);
    edit(dir, "game.js", "function levelComplete() {\n", 'function levelComplete() {\n  if (window.netnetEarn) window.netnetEarn("level_complete");\n');
    const r = runDoctor(dir);
    expect(r.findings).toEqual([expect.objectContaining({ code: "STORE_EMPTY", severity: "warn" })]);
    expect(r.ok).toBe(true);
  });

  it("Phaser (JavaScript)", async () => {
    const dir = copyFixture("phaser-runner");
    const add = await cli(dir, "add", "--earn", "stage_finished");
    expect(add.out).toContain("phaser");
    expect(readFileSync(join(dir, "src/netnet.js"), "utf8")).toContain("export function earn(event, n = 1)");
    edit(dir, "src/main.js", 'import Phaser from "phaser";\n', 'import Phaser from "phaser";\nimport { earn } from "./netnet";\n');
    edit(dir, "src/main.js", "  finishStage() {\n", '  finishStage() {\n    earn("stage_finished");\n');
    expect(runDoctor(dir).ok).toBe(true);
  });

  it("React + TypeScript, with a store item added through the CLI", async () => {
    const dir = copyFixture("react-clicker");
    await cli(dir, "add", "--earn", "milestone");
    const item = await cli(dir, "add-item", "skin_gold", "--label", "Gold button", "--usdg", "1.00", "--kind", "permanent");
    expect(item.code).toBe(0);
    expect(readFileSync(join(dir, "src/netnet.ts"), "utf8")).toContain('export type SkuId = "skin_gold";');
    edit(dir, "src/App.tsx", 'import { useState } from "react";\n', 'import { useState } from "react";\nimport { earn, kit } from "./netnet";\n');
    edit(dir, "src/App.tsx", "      // milestone reached\n", '      earn("milestone");\n');
    edit(dir, "src/App.tsx", "  return <button", '  const gold = kit.store.owns("skin_gold");\n  return <button className={gold ? "gold" : ""}');
    const r = runDoctor(dir);
    expect(r.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe("kit doctor catches what breaks the rules", () => {
  async function wired(): Promise<string> {
    const dir = copyFixture("comet-sweep");
    await cli(dir, "add", "--earn", "wave_cleared");
    edit(dir, "src/main.ts", 'void startKit(); // netnet-kit\n', 'void startKit(); // netnet-kit\nimport { earn, kit } from "./netnet";\n');
    edit(dir, "src/main.ts", "function onWaveCleared(): void {\n", 'function onWaveCleared(): void {\n  earn("wave_cleared");\n');
    expect(runDoctor(dir).ok).toBe(true);
    return dir;
  }
  const codes = (dir: string) => runDoctor(dir).findings.filter((f) => f.severity === "error").map((f) => f.code);

  it("a polling timer", async () => {
    const dir = await wired();
    edit(dir, "src/main.ts", "spawnWave(wave);\nframe();", "spawnWave(wave);\nframe();\nsetInterval(() => kit.refresh(), 10_000);");
    expect(codes(dir)).toContain("POLLING_LOOP");
  });

  it("a polling setTimeout passed by name", async () => {
    const dir = await wired();
    edit(dir, "src/main.ts", "spawnWave(wave);\nframe();", "function poll() { void kit.refresh(); setTimeout(poll, 30_000); }\nspawnWave(wave);\nframe();");
    expect(codes(dir)).toContain("POLLING_LOOP");
  });

  it("a direct chain read without multicall", async () => {
    const dir = await wired();
    edit(dir, "src/main.ts", "spawnWave(wave);\nframe();", 'const client = createPublicClient({ transport: http("https://rpc.example") });\nawait client.readContract({});\nspawnWave(wave);\nframe();');
    const c = codes(dir);
    expect(c).toContain("DIRECT_CHAIN_READ");
    expect(c).toContain("MULTICALL_MISSING");
  });

  it("a hardcoded address", async () => {
    const dir = await wired();
    edit(dir, "src/main.ts", "let wave = 1;", 'let wave = 1;\nconst VAULT = "0x1111111111111111111111111111111111111111";');
    expect(codes(dir)).toContain("HARDCODED_ADDRESS");
  });

  it("wsNET in a UI string", async () => {
    const dir = await wired();
    edit(dir, "src/main.ts", "`WAVE ${wave}   SCORE ${score}`", "`WAVE ${wave}   wsNET ${score}`");
    expect(codes(dir)).toContain("WSNET_IN_UI");
  });

  it("no earn rule in the config", async () => {
    const dir = await wired();
    const cfgPath = join(dir, "netnet.config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as { earn: unknown[] };
    cfg.earn = [];
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const c = codes(dir);
    expect(c).toContain("EARN_RULE_MISSING");
    expect(c).toContain("EARN_EVENT_UNKNOWN");
  });

  it("a store item the config does not define", async () => {
    const dir = await wired();
    edit(dir, "src/main.ts", "function restart(): void {\n", 'function restart(): void {\n  void kit.store.buy("revive_pack");\n');
    expect(codes(dir)).toContain("STORE_SKU_UNKNOWN");
  });

  it("an init for the wrong slug", async () => {
    const dir = await wired();
    edit(dir, "src/netnet.ts", 'export const GAME = "comet-sweep";', 'export const GAME = "other-game";');
    expect(codes(dir)).toContain("INIT_GAME_MISMATCH");
    // kit sync restores it from the config.
    await cli(dir, "sync");
    expect(codes(dir)).toEqual([]);
  });
});

describe("the docs carry exactly what the tests above apply", () => {
  const root = join(import.meta.dirname, "..");
  const llms = readFileSync(join(root, "llms.txt"), "utf8");
  const full = readFileSync(join(root, "llms-full.txt"), "utf8");

  it("llms.txt alone has the command and the earn edit an agent needs", () => {
    expect(llms).toContain("npx @netnetcapital/kit add --earn <event_id>");
    expect(llms).toContain('import { earn } from "./netnet";');
    expect(llms).toContain('earn("wave_cleared");');
    expect(llms).toContain('window.netnetEarn("wave_cleared");');
    expect(llms).toContain("npx @netnetcapital/kit doctor");
  });

  it("every doctor code is documented in llms-full.txt", () => {
    const codes = ["CONFIG_MISSING", "EARN_RULE_MISSING", "EARN_NOT_WIRED", "EARN_EVENT_UNKNOWN", "KIT_NOT_INSTALLED", "INIT_MISSING", "INIT_GAME_MISMATCH", "STORE_SKU_UNKNOWN", "POLLING_LOOP", "DIRECT_CHAIN_READ", "MULTICALL_MISSING", "HARDCODED_ADDRESS", "WSNET_IN_UI"];
    for (const c of codes) expect(full).toContain(c);
  });

  it("copy has no em-dashes", () => {
    for (const f of ["llms.txt", "llms-full.txt", "README.md"]) expect(readFileSync(join(root, f), "utf8")).not.toContain("—");
  });

  it("the shipped example passes doctor", () => {
    const r = runDoctor(join(root, "examples/plain-canvas"));
    expect(r.findings).toEqual([]);
    expect(r.ok).toBe(true);
  });
});
