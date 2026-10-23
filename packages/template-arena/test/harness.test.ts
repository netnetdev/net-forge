import { describe, expect, it } from "vitest";
import { engine } from "@netforge/engine";
import { arenaGame } from "../src/manifest.js";

const SECONDS = 60;

describe("VOLTYARD playtest bots (engine.test.run)", () => {
  it("compiles: a three-weapon loadout, a heal cell, three store upgrades, four earn rules, 60 Hz", () => {
    const g = arenaGame();
    expect(g.mode).toBe("arena");
    expect(g.weaponIds).toEqual(["arc_rifle", "scatter_coil", "rail_lance"]);
    expect(g.loadout).toEqual([0, 1, 2]);
    expect(g.upgradeIds).toEqual(["plating", "servo", "capacitor"]);
    expect(g.pickupPrefabs).toContain("volt_cell");
    expect(g.manifest.earnRules.size).toBe(4);
    expect(g.tickRate).toBe(60);
    expect(g.bots).toBe(6);
    expect(g.round).toEqual({ seconds: 180, frags: 25 });
  });

  it("4 players and 2 seat bots for 4 minutes: everyone fights, a round ends, earn fires, no softlock", async () => {
    const r = await engine.test.run({
      ticks: SECONDS * 4 * 60,
      bots: 4,
      seed: 3,
      assert: [
        { name: "kills", check: (x) => x.kills >= 40 },
        { name: "a round ended", check: (x) => x.runs.won >= 1 },
        { name: "most players scored", check: (x) => x.scorers >= 5 },
        { name: "earn emitted", check: (x) => x.earnEmitted > 0 },
        { name: "no softlock", check: (x) => !x.softlock },
        { name: "server tick under budget", check: (x) => x.p99MsPerTick < 8 },
      ],
    });
    console.info(`[harness] ${JSON.stringify(r)}`);
    expect(r.failed).toEqual([]);
    expect(r.earned.live_wire ?? 0).toBeGreaterThan(0);
  });

  it("one player alone still gets a fight: bots fill the seats", async () => {
    const r = await engine.test.run({ ticks: SECONDS * 3 * 60, bots: 1, seed: 8 });
    console.info(`[solo] kills ${r.kills}, rounds ${r.runs.won}, earned ${JSON.stringify(r.earned)}`);
    expect(r.kills).toBeGreaterThan(20);
    expect(r.scorers).toBeGreaterThanOrEqual(4);
    expect(r.softlock).toBe(false);
  });
});
