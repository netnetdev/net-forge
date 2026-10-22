import { describe, expect, it } from "vitest";
import { engine } from "@netnetcapital/engine";
import { planCourse } from "@netnetcapital/engine/game";
import { platformerGame } from "../src/manifest.js";

describe("SKYLEDGE playtest", () => {
  it("compiles: three courses, 60 Hz, seat bots, a round limit, upgrades on platform stats", () => {
    const g = platformerGame();
    expect(g.mode).toBe("platformer");
    expect(g.tickRate).toBe(60);
    expect(g.platformer.levels.length).toBe(3);
    expect(g.platformer.upgradeStat).toEqual(["amount", "speed", "maxHealth"]);
    expect(g.bots).toBe(3);
    expect(g.round?.seconds).toBe(180);
    expect(g.manifest.earnRules.size).toBe(4);
  });

  it("every course has a route to the flag (the planner's softlock check)", () => {
    const g = platformerGame();
    for (const level of g.platformer.levels) {
      const r = planCourse(level, { tickRate: g.tickRate, tuning: g.platformer.tuning, startTick: 3 * g.tickRate });
      expect(r.found).toBe(true);
      expect(r.seconds).toBeLessThan(60);
    }
  });

  it("four playtest climbers finish every course, earn fires, no softlock, ticks are cheap", async () => {
    const r = await engine.test.run({
      ticks: 60 * 60 * 4,
      bots: 4,
      seed: 3,
      assert: [
        { name: "earn fired", check: (x) => x.earnEmitted > 0 },
        { name: "no softlock", check: (x) => !x.softlock },
      ],
    });
    console.log("[harness]", JSON.stringify({ rounds: r.wave, runs: r.runs, scorers: r.scorers, falls: r.deaths, earned: r.earned, p99: r.p99MsPerTick.toFixed(3), fun: r.fun }));
    expect(r.failed).toEqual([]);
    expect(r.scorers).toBe(4);
    expect(r.wave).toBeGreaterThanOrEqual(3);
    expect(r.fun?.routes?.every((x) => x.found)).toBe(true);
    expect(r.p99MsPerTick).toBeLessThan(4);
  });
});
