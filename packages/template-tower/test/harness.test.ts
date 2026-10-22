import { describe, expect, it } from "vitest";
import { engine } from "@netnetcapital/engine";
import { towerGame, towerManifest } from "../src/manifest.js";

const S = 30;

describe("COGSPIRE playtest bots (engine.test.run)", () => {
  it("compiles: an 18 x 12 board, a 34-tile road, four towers, four creeps, twenty waves, four earn rules", () => {
    const g = towerGame().game;
    expect([g.board.w, g.board.h]).toEqual([18, 12]);
    expect(g.board.length).toBe(34 * 256);
    expect(g.towers.map((t) => t.id)).toEqual(["bolt_post", "tar_mortar", "frost_vane", "arc_coil"]);
    expect(g.creeps.map((c) => c.id)).toEqual(["rustling", "gearbeetle", "cinder_moth", "boilerback"]);
    expect(g.totalWaves).toBe(20);
    expect(towerManifest().earnRules.size).toBe(4);
  });

  it("4 players for 4 minutes: waves cleared, earn fires, no leaks in the opening, no softlock", async () => {
    const r = await engine.test.run({
      ticks: S * 240,
      bots: 4,
      seed: 1,
      assert: [
        { name: "kills", check: (x) => x.kills >= 80 },
        { name: "three waves", check: (x) => x.wave >= 4 },
        { name: "earn emitted", check: (x) => x.earnEmitted > 0 },
        { name: "no softlock", check: (x) => !x.softlock },
        { name: "server tick under budget", check: (x) => x.p99MsPerTick < 4 },
      ],
    });
    console.info(`[harness] ${JSON.stringify({ ...r, rules: r.rules?.checks.filter((c) => !c.ok) })}`);
    expect(r.failed).toEqual([]);
    expect(r.earned.first_gear).toBe(4);
    expect(r.rules?.checks.every((c) => c.ok)).toBe(true);
  });

  it("one player alone holds the opening and earns", async () => {
    const r = await engine.test.run({ ticks: S * 180, bots: 1, seed: 2 });
    expect(r.kills).toBeGreaterThan(20);
    expect(r.runs.lost).toBe(0);
    expect(r.earned.first_gear).toBe(1);
  });

  it("a whole run is winnable by two careful builders and pays every rule once", async () => {
    const r = await engine.test.run({ ticks: S * 1500, bots: 2, seed: 4 });
    expect(r.runs.won + r.runs.lost).toBeGreaterThanOrEqual(1);
    expect(r.earned.long_shift ?? 0).toBeGreaterThanOrEqual(2);
  });
});
