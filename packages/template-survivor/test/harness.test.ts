import { describe, expect, it } from "vitest";
import { engine } from "@netnetcapital/engine";
import { survivorGame } from "../src/manifest.js";

describe("EMBERWATCH playtest bots (engine.test.run)", () => {
  it("compiles: a roster of roles, two mini-bosses and the Bell Warden, three gem tiers, 8 weapons and 7 evolutions, 8 passives, four earn rules", () => {
    const g = survivorGame();
    expect(g.enemyPrefabs).toEqual(["shade", "gnat", "husk", "spitter", "ram", "bloat", "aegis", "mender", "brute", "brood", "caller", "ash_matron", "gloam_ram", "bell_warden", "lantern_thief", "ember_urn", "brazier"]);
    expect(g.specialPickups).toEqual(["hearth_meal", "lodestar", "flare", "ember_chest", "hoard_chest"]);
    expect(g.sim.content?.loot).toEqual({ chest: 3, heal: 0, vacuum: 1, bossChest: 4 });
    expect(g.sim.arena?.halfExtent).toBe(75);
    const ai = (id: string) => g.sim.content?.enemyTypes?.[g.enemyType.get(id) ?? -1]?.ai;
    expect([ai("gnat"), ai("spitter"), ai("ram"), ai("bloat"), ai("aegis"), ai("mender"), ai("caller")]).toEqual(["runner", "ranged", "charger", "bomber", "shielder", "healer", "summoner"]);
    expect(g.sim.content?.enemyTypes?.[g.enemyType.get("bell_warden") ?? -1]?.pattern?.attacks).toEqual(["slam", "ring", "dash", "summon"]);
    expect(g.weaponIds.length).toBe(15);
    expect(g.upgradeIds.length).toBe(8);
    const weapons = g.sim.content?.weapons ?? [];
    expect(weapons.filter((w) => w.evolved).length).toBe(7);
    // Every evolution pairs a base weapon with a passive, and every base weapon declares its levels.
    for (const [id, w] of g.manifest.weapons) {
      if (w.evolve) expect(g.upgradeIds, id).toContain(w.evolve.requires);
      const sim = weapons[g.weaponIds.indexOf(id)];
      if (!sim?.evolved) expect(sim?.levels?.length ?? 0, id).toBeGreaterThanOrEqual(5);
    }
    expect(g.manifest.earnRules.size).toBe(4);
    expect(g.pickupPrefabs).toEqual(["ember_small", "ember_mid", "ember_large"]);
  });

  it("4 bots for 3 minutes: waves clear, players level, earn fires, no softlock", async () => {
    const r = await engine.test.run({
      ticks: 30 * 180,
      bots: 4,
      seed: 3,
      assert: [
        { name: "kills", check: (x) => x.kills > 500 },
        { name: "two waves (minutes) cleared", check: (x) => x.wave >= 3 || x.runs.lost > 0 },
        { name: "nobody down in the first minute", check: (x) => (x.fun?.deathsBeforeMinute ?? 0) === 0 },
        { name: "no spawns on screen", check: (x) => (x.fun?.spawnsOnScreen ?? 0) < 0.02 },
        { name: "levels", check: (x) => x.maxLevel >= 5 },
        { name: "earn emitted", check: (x) => x.earnEmitted > 0 },
        { name: "no softlock", check: (x) => !x.softlock },
      ],
    });
    console.info(`[harness] ${JSON.stringify(r)}`);
    expect(r.failed).toEqual([]);
  });

  it("holds 2,000 enemies with 4 bots and reports the server cost per tick", async () => {
    const r = await engine.test.run({ ticks: 30 * 30, bots: 4, seed: 4, enemies: 2000 });
    console.info(`[stress] peak ${r.peakEnemies} enemies, ${r.msPerTick.toFixed(2)} ms/tick mean, p99 ${r.p99MsPerTick.toFixed(2)} ms`);
    expect(r.peakEnemies).toBeGreaterThanOrEqual(2000);
  });
});
