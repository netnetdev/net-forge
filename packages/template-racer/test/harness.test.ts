import { describe, expect, it } from "vitest";
import { engine } from "@netnetcapital/engine";
import { racerGame } from "../src/manifest.js";

describe("TORQUEBAY playtest", () => {
  it("compiles: three circuits, 60 Hz, a full grid of seat bots, upgrades on kart stats", () => {
    const g = racerGame();
    expect(g.mode).toBe("racer");
    expect(g.tickRate).toBe(60);
    expect(g.racer.tracks.length).toBe(3);
    expect(g.racer.upgradeStat).toEqual(["might", "speed", "haste", "armor"]);
    expect(g.bots).toBe(6);
    expect(g.manifest.earnRules.size).toBe(4);
  });

  it("four playtest drivers finish races, earn fires, no softlock, ticks are cheap", async () => {
    const r = await engine.test.run({
      ticks: 60 * 60 * 4,
      bots: 4,
      seed: 3,
      assert: [
        { name: "earn fired", check: (x) => x.earnEmitted > 0 },
        { name: "no softlock", check: (x) => !x.softlock },
      ],
    });
    console.log("[harness]", JSON.stringify({ rounds: r.wave, runs: r.runs, scorers: r.scorers, walls: r.deaths, earned: r.earned, p99: r.p99MsPerTick.toFixed(3), finish: r.fun?.finishSeconds, rate: r.fun?.finishRate }));
    expect(r.failed).toEqual([]);
    expect(r.scorers).toBe(4);
    expect(r.wave).toBeGreaterThanOrEqual(2);
    expect(r.p99MsPerTick).toBeLessThan(4);
  });
});
