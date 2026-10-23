import { describe, expect, it } from "vitest";
import { engine } from "@netforge/engine";
import { partyGame } from "../src/manifest.js";

describe("ROMPHOUSE playtest bots (engine.test.run)", () => {
  it("compiles: one playroom (floor and four walls), the party crowd, the pup, the gift boxes and the Big Balloon, 6 weapons and 3 evolutions, four earn rules", () => {
    const g = partyGame();
    expect(g.enemyPrefabs).toEqual(["popper", "fizz", "wobbler", "spritzer", "party_pup", "gift_box", "big_balloon"]);
    expect(g.specialPickups).toEqual(["cake_slice", "party_magnet", "party_chest", "prize_hoard"]);
    expect(g.sim.arena?.floors).toHaveLength(1);
    expect(g.sim.arena?.walls).toHaveLength(4);
    expect(g.mode).toBe("survivor");
    expect(g.manifest.game.players.max).toBe(8);
    const ai = (id: string) => g.sim.content?.enemyTypes?.[g.enemyType.get(id) ?? -1]?.ai;
    expect([ai("fizz"), ai("spritzer"), ai("party_pup")]).toEqual(["runner", "ranged", "flee"]);
    expect(g.sim.content?.enemyTypes?.[g.enemyType.get("big_balloon") ?? -1]?.pattern?.attacks).toEqual(["slam", "leap"]);
    expect(g.weaponIds.length).toBe(9);
    expect((g.sim.content?.weapons ?? []).filter((w) => w.evolved).length).toBe(3);
    expect(g.manifest.earnRules.size).toBe(4);
    expect(g.manifest.stake).toMatchObject({ min: 20, max: 200, multiple: 2 });
  });

  it("4 bots for 4 minutes: a whole show plays (five rounds), rounds are won, earn fires, nobody falls early, no softlock", async () => {
    const r = await engine.test.run({
      ticks: 30 * 240,
      bots: 4,
      seed: 1,
      assert: [
        { name: "kills", check: (x) => x.kills > 200 },
        { name: "five rounds played", check: (x) => x.wave >= 6 },
        { name: "nobody down in the first minute", check: (x) => (x.fun?.deathsBeforeMinute ?? 0) === 0 },
        { name: "no spawns on screen", check: (x) => (x.fun?.spawnsOnScreen ?? 0) < 0.05 },
        { name: "a round won", check: (x) => (x.earned["first_win"] ?? 0) > 0 },
        { name: "no softlock", check: (x) => !x.softlock },
      ],
    });
    console.info(`[harness] ${JSON.stringify(r)}`);
    expect(r.failed).toEqual([]);
  });

  it("a human-like player alone gets a fast, fair opening", async () => {
    const r = await engine.test.run({ ticks: 30 * 120, bots: 1, seed: 3, bot: "human" });
    expect(r.fun?.firstThreatSeconds ?? 99).toBeLessThan(15);
    expect(r.fun?.firstRewardSeconds ?? 99).toBeLessThan(15);
    expect(r.fun?.deathsBeforeMinute ?? 1).toBe(0);
    expect(r.softlock).toBe(false);
  });
});
