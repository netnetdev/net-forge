import { describe, expect, it } from "vitest";
import { engine } from "@netforge/engine";
import { cardsGame, cardsManifest } from "../src/manifest.js";

const S = 30;

describe("INKWRIT playtest bots (engine.test.run)", () => {
  it("compiles: sixteen cards, a twelve-card starter, four duels, four AI tiers, four earn rules", () => {
    const g = cardsGame().game;
    expect(g.cards.length).toBe(16);
    expect(g.starter.length).toBe(12);
    expect(g.table.duels).toBe(4);
    expect(g.table.ai.length).toBe(4);
    expect(cardsManifest().earnRules.size).toBe(4);
  });

  it("two people for 4 minutes: duels are decided, a PvP win pays, no softlock", async () => {
    const r = await engine.test.run({
      ticks: S * 240,
      bots: 2,
      seed: 1,
      assert: [
        { name: "duels decided", check: (x) => x.kills >= 4 },
        { name: "earn emitted", check: (x) => x.earnEmitted > 0 },
        { name: "no softlock", check: (x) => !x.softlock },
        { name: "server tick under budget", check: (x) => x.p99MsPerTick < 4 },
      ],
    });
    expect(r.failed).toEqual([]);
    expect(r.earned.inked_duel ?? 0).toBeGreaterThan(0);
    // Against a person, the gauntlet's AI rules never pay.
    expect(r.earned.first_ink).toBeUndefined();
    expect(r.rules?.checks.every((c) => c.ok)).toBe(true);
  });

  it("one person alone gets an AI scribe and earns the gauntlet rules, never the PvP ones", async () => {
    const r = await engine.test.run({ ticks: S * 180, bots: 1, seed: 2 });
    expect(r.kills + r.deaths).toBeGreaterThan(2);
    expect(r.earned.first_ink ?? 0).toBeGreaterThan(0);
    expect(r.earned.inked_duel).toBeUndefined();
  });

  it("a whole run ends and starts over", async () => {
    const r = await engine.test.run({ ticks: S * 600, bots: 1, seed: 4 });
    expect(r.runs.won + r.runs.lost).toBeGreaterThanOrEqual(1);
  });
});
