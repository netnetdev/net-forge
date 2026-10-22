import { describe, expect, it } from "vitest";
import { engine } from "@netnetcapital/engine";
import { dungeonGame } from "../src/manifest.js";

describe("CRYPTWICK playtest bots (engine.test.run)", () => {
  it("compiles: the crypt's walls and floors, a roster of roles, the Marrow Knight and the Wax Abbot, 8 weapons and 7 evolutions, four earn rules", () => {
    const g = dungeonGame();
    expect(g.enemyPrefabs).toEqual(["bone_rattler", "crypt_bat", "grave_shambler", "bone_archer", "wax_wisp", "tomb_slime", "hex_imp", "candle_mender", "ossuary_brute", "grave_ram", "marrow_knight", "wax_abbot", "crypt_urn", "bone_pile"]);
    expect(g.specialPickups).toEqual(["tallow", "lure_stone", "chapel_bell", "reliquary", "abbey_hoard"]);
    expect(g.sim.arena?.walls?.length).toBeGreaterThan(20);
    expect(g.sim.arena?.floors?.length).toBeGreaterThanOrEqual(10);
    expect(g.mode).toBe("survivor");
    const ai = (id: string) => g.sim.content?.enemyTypes?.[g.enemyType.get(id) ?? -1]?.ai;
    expect([ai("crypt_bat"), ai("bone_archer"), ai("grave_ram"), ai("wax_wisp"), ai("candle_mender"), ai("hex_imp")]).toEqual(["runner", "ranged", "charger", "bomber", "healer", "summoner"]);
    expect(g.sim.content?.enemyTypes?.[g.enemyType.get("wax_abbot") ?? -1]?.pattern?.attacks).toEqual(["slam", "ring", "dash", "summon"]);
    expect(g.weaponIds.length).toBe(15);
    expect(g.upgradeIds.length).toBe(8);
    const weapons = g.sim.content?.weapons ?? [];
    expect(weapons.filter((w) => w.evolved).length).toBe(7);
    for (const [id, w] of g.manifest.weapons) {
      if (w.evolve) expect(g.upgradeIds, id).toContain(w.evolve.requires);
      const sim = weapons[g.weaponIds.indexOf(id)];
      if (!sim?.evolved) expect(sim?.levels?.length ?? 0, id).toBeGreaterThanOrEqual(5);
    }
    expect(g.manifest.earnRules.size).toBe(4);
    expect(g.manifest.stake).toMatchObject({ min: 20, max: 200, multiple: 2 });
    // Permadeath: no free get-up, out until the party clears a room.
    expect(g.sim.content?.coop?.selfRevives).toBe(0);
    expect(g.sim.content?.coop?.respawnTicks).toBe(0);
  });

  it("4 bots for 4 minutes: rooms wake and clear, the Marrow Knight falls, earn fires, nobody falls early, no softlock", async () => {
    const r = await engine.test.run({
      ticks: 30 * 240,
      bots: 4,
      seed: 1,
      assert: [
        { name: "kills", check: (x) => x.kills > 120 },
        { name: "five rooms cleared", check: (x) => x.wave >= 6 },
        { name: "nobody down in the first minute", check: (x) => (x.fun?.deathsBeforeMinute ?? 0) === 0 },
        { name: "no spawns on screen", check: (x) => (x.fun?.spawnsOnScreen ?? 0) < 0.05 },
        { name: "levels", check: (x) => x.maxLevel >= 5 },
        { name: "the mini-boss falls", check: (x) => (x.fun?.bossKills ?? []).some((b) => b.prefab === "marrow_knight") },
        { name: "earn emitted", check: (x) => x.earnEmitted > 0 },
        { name: "no softlock", check: (x) => !x.softlock },
      ],
    });
    console.info(`[harness] ${JSON.stringify(r)}`);
    expect(r.failed).toEqual([]);
  });

  it("bots that never leave the start room still meet the crypt: the rooms come to them, and the descent ends (the Abbot falls or the party wipes)", async () => {
    const r = await engine.test.run({ ticks: 30 * 600, bots: 4, seed: 1 });
    console.info(`[descent] wave ${r.wave}, runs ${JSON.stringify(r.runs)}, bosses ${JSON.stringify(r.fun?.bossKills ?? [])}`);
    expect(r.softlock).toBe(false);
    expect(r.fun?.firstBossSeconds).not.toBeNull();
    expect(r.wave).toBeGreaterThanOrEqual(9);
    expect(r.runs.won + r.runs.lost).toBeGreaterThanOrEqual(1);
  });
});
