import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { STARTERS } from "create-netforge";
import { runKitPlayCli, type PlayCliIo } from "../src/cli.js";
import { TEMPLATES } from "../src/templates.js";
import { lanLinks, playLink } from "../src/play.js";

const io = (cwd: string) => {
  const out: string[] = [];
  const err: string[] = [];
  const v: PlayCliIo & { o: string[]; e: string[] } = { o: out, e: err, cwd, out: (s) => out.push(s), err: (s) => err.push(s) };
  return v;
};
const tmp = () => mkdtempSync(join(tmpdir(), "kit-play-cmd-"));

/** A game folder made from a template's own game module. */
function gameFolder(id: string, pkg: string): string {
  const dir = tmp();
  const tplDir = dirname(dirname(createRequire(import.meta.url).resolve(pkg)));
  mkdirSync(join(dir, "src"));
  cpSync(join(tplDir, "src", "game.ts"), join(dir, "src", "game.ts"));
  writeFileSync(join(dir, "netnet.json"), JSON.stringify({ template: id }));
  return dir;
}

describe("kit-play's commands", () => {
  it("templates lists create-netforge's catalog, which matches the templates kit play runs", async () => {
    for (const s of STARTERS) expect(TEMPLATES[s.id]?.pkg, s.id).toBe(s.pkg);
    expect(STARTERS.map((s) => s.id).sort()).toEqual(Object.keys(TEMPLATES).sort());
    for (const s of STARTERS) expect(s.seats, s.id).toBe(TEMPLATES[s.id].seats);
    const x = io(tmp());
    expect(await runKitPlayCli(["templates", "--json"], x)).toBe(0);
    expect((JSON.parse(x.o[0]!) as { id: string }[]).map((t) => t.id)).toEqual(STARTERS.map((s) => s.id));
  });

  it("new makes a game, the same as create-netforge", async () => {
    const d = tmp();
    const x = io(d);
    expect(await runKitPlayCli(["new", "duel", "--template", "cards", "--no-install", "--no-git"], x)).toBe(0);
    expect(JSON.parse(readFileSync(join(d, "duel", "netnet.json"), "utf8")).template).toBe("cards");
    expect(x.o.join("\n")).toContain("cd duel");
  });

  // Through the built CLI in its own process: the test bundle is imported natively, as a user's node does.
  it("test compiles the game and runs the playtest bots; a broken game fails with the reason", () => {
    const cli = join(__dirname, "..", "dist", "cli.js");
    expect(existsSync(cli), "build kit-play first (pnpm build)").toBe(true);
    const run = (dir: string, args: string[]) => spawnSync(process.execPath, [cli, "test", dir, ...args], { encoding: "utf8", timeout: 120_000 });
    const dir = gameFolder("cards", "@netforge/template-cards");
    const ok = run(dir, ["--minutes", "0.5", "--json"]);
    expect(ok.status, ok.stderr).toBe(0);
    expect(JSON.parse(ok.stdout)).toMatchObject({ ok: true, template: "cards" });
    const game = join(dir, "src", "game.ts");
    writeFileSync(game, `import { readFileSync } from "node:fs";\nconsole.log(readFileSync);\n${readFileSync(game, "utf8")}`);
    const bad = run(dir, []);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/may import only "@netforge\/engine", not "node:fs"/);
    const flags = run(dir, ["--bogus"]);
    expect(flags.status).toBe(1);
    expect(flags.stderr).toMatch(/unknown flag --bogus/);
  });

  it("check is test with JSON, and minutes follow the template's tick rate (60 Hz arena)", () => {
    const cli = join(__dirname, "..", "dist", "cli.js");
    const dir = gameFolder("arena", "@netforge/template-arena");
    const r = spawnSync(process.execPath, [cli, "check", dir, "--minutes", "0.2"], { encoding: "utf8", timeout: 120_000 });
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { ok: boolean; tickRate: number; report: { ticks: number } };
    expect(out.tickRate).toBe(60);
    expect(out.report.ticks).toBe(Math.round(0.2 * 60 * 60));
    const cards = spawnSync(process.execPath, [cli, "check", gameFolder("cards", "@netforge/template-cards"), "--minutes", "0.2"], { encoding: "utf8", timeout: 120_000 });
    expect((JSON.parse(cards.stdout) as { tickRate: number }).tickRate).toBe(30);
  });

  it("help lists the commands; a bare folder still plays as before", async () => {
    const x = io(tmp());
    expect(await runKitPlayCli(["help"], x)).toBe(0);
    expect(x.o[0]).toMatch(/kit-play new \[folder\]/);
    const y = io(tmp());
    expect(await runKitPlayCli(["no-such-folder"], y)).toBe(1);
    expect(y.e.join("\n")).toMatch(/No netnet.json/);
  });
});

describe("the links kit play prints", () => {
  const ifaces = {
    lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true, netmask: "255.0.0.0", mac: "00:00:00:00:00:00", cidr: "127.0.0.1/8" }],
    en0: [
      { address: "192.168.1.20", family: "IPv4", internal: false, netmask: "255.255.255.0", mac: "aa:bb:cc:dd:ee:ff", cidr: "192.168.1.20/24" },
      { address: "fe80::1", family: "IPv6", internal: false, netmask: "ffff:ffff:ffff:ffff::", mac: "aa:bb:cc:dd:ee:ff", cidr: "fe80::1/64", scopeid: 4 },
    ],
  } as unknown as Parameters<typeof lanLinks>[2];

  it("carry ?server= so the client joins this host, not its dev port", () => {
    expect(playLink("http://127.0.0.1:4663", null)).toBe("http://127.0.0.1:4663/?server=http%3A%2F%2F127.0.0.1%3A4663");
    expect(playLink("http://127.0.0.1:4663", "https://lib.example")).toContain("&library=https%3A%2F%2Flib.example");
  });

  it("give other devices a LAN link with its own ?server= when listening on every interface", () => {
    expect(lanLinks("0.0.0.0", 4663, ifaces, null)).toEqual(["http://192.168.1.20:4663/?server=http%3A%2F%2F192.168.1.20%3A4663"]);
    expect(lanLinks("192.168.1.20", 5000, ifaces, null)).toEqual(["http://192.168.1.20:5000/?server=http%3A%2F%2F192.168.1.20%3A5000"]);
    expect(lanLinks("127.0.0.1", 4663, ifaces, null)).toEqual([]);
  });
});
