import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initSim } from "@netnetcapital/engine-sim";
import { decodeSnapshot, encodeInputPacket, type InputCommand } from "@netnetcapital/engine/net";
import { profileSpec } from "@netnetcapital/engine/game";
import { cardsAdapter, cardsManifest } from "@netnetcapital/template-cards";
import { survivorAdapter } from "@netnetcapital/template-survivor";
import { LocalCore, resolveHitscan } from "../src/host/core.js";
import { LocalProfiles } from "../src/host/profile.js";
import { allowedRequest, fileUnder } from "../src/host/server.js";
import { namesModule, parseNames } from "../src/names.js";
import { PlayError, readGameFolder } from "../src/play.js";
import { TEMPLATES, templateFor } from "../src/templates.js";

const tmp = () => mkdtempSync(join(tmpdir(), "kit-play-"));

describe("the game folder", () => {
  it("needs netnet.json with a known template and src/game.ts", () => {
    const dir = tmp();
    expect(() => readGameFolder(dir)).toThrow(PlayError);
    writeFileSync(join(dir, "netnet.json"), JSON.stringify({ template: "chess" }));
    expect(() => readGameFolder(dir)).toThrow(/unknown template/);
    writeFileSync(join(dir, "netnet.json"), JSON.stringify({ template: "tower-defense" }));
    expect(() => readGameFolder(dir)).toThrow(/src\/game.ts/);
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "game.ts"), "export {};");
    writeFileSync(join(dir, "src", "names.json"), JSON.stringify({ title: "Gears", weapons: {}, upgrades: {}, enemies: { rat: "Rat" }, rules: {}, skus: {} }));
    const g = readGameFolder(dir);
    expect(g.template.pkg).toBe("@netnetcapital/template-tower");
    expect(g.names?.title).toBe("Gears");
  });

  it("knows every Net Forge template, and the room names as aliases", () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual(["arena", "cards", "collector", "dungeon", "idle", "party", "platformer", "racer", "survivor", "tower-defense"]);
    expect(templateFor("shooter")?.id).toBe("arena");
    expect(templateFor("tower")?.id).toBe("tower-defense");
    expect(templateFor("__proto__")).toBeNull();
  });
});

describe("names.json", () => {
  it("becomes JSON literals over the template's names module, never code", () => {
    const n = parseNames(JSON.stringify({ title: 'x"; process.exit(1); "', weapons: { bolt: { name: "Bolt", line: "Zaps" } }, upgrades: {}, enemies: {}, rules: {}, skus: {} }));
    const mod = namesModule(n, "/t/client/names.ts");
    expect(mod).toContain('export * from "/t/client/names.ts";');
    expect(mod).toContain(`export const TITLE = ${JSON.stringify(n.title)};`);
    expect(() => parseNames("{")).toThrow(/not valid JSON/);
    expect(() => parseNames(JSON.stringify({ title: "T", enemies: { "Bad Id": "x" } }))).toThrow(/ids are lower case/);
  });
});

describe("the static files", () => {
  it("never serve outside their folder", () => {
    const dir = tmp();
    writeFileSync(join(dir, "index.html"), "<p>hi</p>");
    expect(fileUnder(dir, "index.html")).toBe(join(dir, "index.html"));
    expect(fileUnder(dir, "../../etc/passwd")).toBeNull();
    expect(fileUnder(dir, "..%2f..%2fetc%2fpasswd")).toBeNull();
    expect(fileUnder(dir, "%E0%A4%A")).toBeNull();
    expect(fileUnder(dir, "a\0b")).toBeNull();
  });
});

describe("who the host answers", () => {
  it("on a loopback bind: this computer by name only, and same-origin POSTs", () => {
    expect(allowedRequest("127.0.0.1", 4663, "127.0.0.1:4663", undefined, "GET")).toBe(true);
    expect(allowedRequest("127.0.0.1", 4663, "localhost:4663", "http://localhost:4663", "POST")).toBe(true);
    expect(allowedRequest("127.0.0.1", 4663, "evil.example:4663", undefined, "GET")).toBe(false);
    expect(allowedRequest("127.0.0.1", 4663, "127.0.0.1:4663", "https://evil.example", "POST")).toBe(false);
    expect(allowedRequest("127.0.0.1", 4663, "127.0.0.1:4663", "http://127.0.0.1:9999", "POST")).toBe(false);
    expect(allowedRequest("0.0.0.0", 4663, "192.168.1.5:4663", "http://192.168.1.5:4663", "POST")).toBe(true);
  });
});

describe("the local core", () => {
  it("steps a template sim and sends each player a snapshot that decodes", async () => {
    await initSim();
    const sim = survivorAdapter();
    const core = new LocalCore(sim, TEMPLATES.survivor.aoi, 7);
    const a = core.addPlayer();
    const b = core.addPlayer();
    expect(a.player).not.toBe(b.player);
    const cmds: InputCommand<unknown>[] = [1, 2, 3].map((seq) => ({ seq, viewTick16: 0, input: sim.input.idle }));
    core.receiveInput(a.player, encodeInputPacket(sim.input, { ackTick: 0, commands: cmds }));
    let snap: Uint8Array | undefined;
    for (let i = 0; i < 10 && !snap; i++) snap = core.step().snapshots.get(a.player);
    expect(snap).toBeDefined();
    const decoded = decodeSnapshot(sim.schema, snap as Uint8Array, () => undefined);
    expect(decoded.header.self).toBe(a.entity);
    expect(decoded.entities.has(a.entity)).toBe(true);
    const fresh = core.rebase(9);
    expect(fresh.size).toBe(2);
    core.removePlayer(b.player);
    expect(core.players).toEqual([a.player]);
    core.dispose();
  });

  it("resolves a hitscan to the nearest box the shooter does not own", () => {
    const boxes = [
      { entity: 1, owner: 1, x: 1, y: 0, r: 0.5 },
      { entity: 2, owner: 2, x: 5, y: 0, r: 0.5 },
      { entity: 3, owner: 3, x: 3, y: 0, r: 0.5 },
    ];
    expect(resolveHitscan(boxes, { shooter: 1, ox: 0, oy: 0, dx: 1, dy: 0, range: 10 })?.entity).toBe(3);
    expect(resolveHitscan(boxes, { shooter: 1, ox: 0, oy: 0, dx: 1, dy: 0, range: 2 })).toBeNull();
    expect(resolveHitscan(boxes, { shooter: 1, ox: 0, oy: 0, dx: 0, dy: 0, range: 10 })).toBeNull();
  });
});

describe("local profiles", () => {
  it("hold play-money looks and sim progress in memory, and nothing else", () => {
    const spec = profileSpec(cardsManifest());
    const p = new LocalProfiles("inkwrit", spec, () => Date.parse("2026-10-21T12:00:00Z"));
    const look = [...spec.skus.values()].find((s) => s.kind === "cosmetic");
    expect(look).toBeDefined();
    expect(p.redeem("g:abcdefghijklmnop", "nope").ok).toBe(false);
    expect(p.redeem("g:abcdefghijklmnop", look!.id).ok).toBe(true);
    p.record("g:abcdefghijklmnop", "title", "t");
    const v = p.view("g:abcdefghijklmnop");
    expect(v.owned).toContain(look!.id);
    expect(v.wallet).toBeNull();
    expect(v.credit).toBe(0);
    expect(v.titles).toEqual({ t: 1 });
    expect(p.view(null).kind).toBeNull();
    expect(cardsAdapter().name).toBeTruthy();
  });
});

describe("the published package", () => {
  it("is not publishable while its license is pending", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as { license: string; scripts: Record<string, string> };
    expect(pkg.license).toBe("SEE LICENSE IN LICENSE");
    expect(pkg.scripts.prepublishOnly).toContain("license-gate");
  });
});
