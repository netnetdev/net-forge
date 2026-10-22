import { describe, expect, it } from "vitest";
import { engine } from "@netnetcapital/engine";
import { CollectorAct, effectiveness, rulesAdapter } from "@netnetcapital/engine/rules";
import { collectorGame, collectorManifest } from "../src/manifest.js";

const S = 30;

describe("MOSSBOUND playtest bots (engine.test.run)", () => {
  it("compiles: a 30 x 20 marsh, nine creatures, ten moves, three starters, four grass zones", () => {
    const g = collectorGame().game;
    expect([g.map.w, g.map.h]).toEqual([30, 20]);
    expect(g.creatures.map((c) => c.id)).toEqual(["mossling", "cindertail", "puddlewump", "sporecap", "voltmoth", "reedcrab", "pebblewing", "bogling", "fenwarden"]);
    expect(g.moves).toHaveLength(10);
    expect(g.starters).toHaveLength(3);
    expect(g.pools).toHaveLength(4);
    expect(collectorManifest().earnRules.size).toBe(4);
  });

  it("the elements are a cycle: root beats tide beats spark beats stone beats root", () => {
    expect(effectiveness(0, 1)).toBe(1);
    expect(effectiveness(1, 2)).toBe(1);
    expect(effectiveness(2, 3)).toBe(1);
    expect(effectiveness(3, 0)).toBe(1);
    expect(effectiveness(1, 0)).toBe(-1);
    expect(effectiveness(0, 2)).toBe(0);
  });

  it("4 keepers for 4 minutes: battles won, creatures caught, earn fires, no softlock", async () => {
    const r = await engine.test.run({
      ticks: S * 240,
      bots: 4,
      seed: 1,
      assert: [
        { name: "battles", check: (x) => x.kills >= 8 },
        { name: "catches", check: (x) => x.wave >= 4 },
        { name: "earn", check: (x) => x.earnEmitted > 0 },
        { name: "no softlock", check: (x) => !x.softlock },
        { name: "tick budget", check: (x) => x.p99MsPerTick < 4 },
      ],
    });
    expect(r.failed).toEqual([]);
    expect(r.rules?.checks.every((c) => c.ok)).toBe(true);
    expect(r.earned.first_snare).toBe(4);
  });

  it("a keeper alone catches a creature and earns", async () => {
    const r = await engine.test.run({ ticks: S * 180, bots: 1, seed: 2 });
    expect(r.earned.first_snare).toBe(1);
    expect(r.deaths).toBeLessThanOrEqual(2);
  });

  it("battles are private: another keeper's team and foe never reach your state", () => {
    const sim = rulesAdapter(collectorGame(), collectorManifest(), { name: "t", version: "t" });
    const w = sim.createWorld(9, "server");
    sim.addPlayer(w, 1);
    sim.addPlayer(w, 2);
    const pick = { mx: 0, mz: 0, cx: 0, cz: 0, act: CollectorAct.Pick, a: 1, b: 0, c: 0 };
    sim.step(w, new Map([[1, [pick]]]));
    const mine = sim.infoFor?.(w, 1) as { team: unknown[] };
    const theirs = sim.infoFor?.(w, 2) as { team: unknown[] };
    expect(mine.team).toHaveLength(1);
    expect(theirs.team).toHaveLength(0);
  });

  it("the warden falls to a crowd before dusk", async () => {
    const r = await engine.test.run({ ticks: S * 900, bots: 4, seed: 6 });
    expect(r.earned.warden_breaker ?? 0).toBeGreaterThanOrEqual(1);
    expect(r.runs.won).toBeGreaterThanOrEqual(1);
  });
});
