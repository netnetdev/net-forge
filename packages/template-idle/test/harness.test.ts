import { describe, expect, it } from "vitest";
import { engine } from "@netforge/engine";
import { IDLE_MIN_FIRST_EARN, IdleAct } from "@netforge/engine/rules";
import { idleAdapter, idleGame, idleManifest } from "../src/manifest.js";

const S = 30;

describe("BRINEWORKS playtest bots and the farming defense", () => {
  it("compiles: a 15-minute shift, a two-minute tending window, five plants, four earn rules", () => {
    const g = idleGame().game;
    expect(g.shiftTicks).toBe(900 * S);
    expect(g.tendTicks).toBe(120 * S);
    expect(g.plants.map((p) => p.id)).toEqual(["hand_pump", "boil_pan", "steam_pump", "sun_pan", "crystal_kiln"]);
    expect(idleManifest().earnRules.size).toBe(4);
  });

  it("4 players for 4 minutes: crates packed, the first rule fires, every genre check passes", async () => {
    const r = await engine.test.run({ ticks: S * 240, bots: 4, seed: 1 });
    expect(r.kills).toBeGreaterThan(40);
    expect(r.earned.first_crate).toBe(4);
    expect(r.softlock).toBe(false);
    for (const c of r.rules?.checks ?? []) expect(c.ok, c.line).toBe(true);
  });

  it("a full shift ends, fills the contract together and pays every rule once a player", async () => {
    const r = await engine.test.run({ ticks: S * 960, bots: 2, seed: 3 });
    expect(r.runs.won).toBe(1);
    expect(r.earned).toEqual({ first_crate: 2, long_haul: 2, cutter: 2, full_hold: 2 });
  });

  it("farming: nothing pays sooner than the floor, an idle seat makes nothing, a clicker cannot beat the bound", async () => {
    const r = await engine.test.run({ ticks: S * 60, bots: 1, seed: 4 });
    const bound = r.rules?.checks.find((c) => c.line.startsWith("bound:"))?.line ?? "";
    const first = Number(/after (\d+) s/.exec(bound)?.[1]);
    const perHour = Number(/at most (\d+) coins/.exec(bound)?.[1]);
    expect(first).toBeGreaterThanOrEqual(IDLE_MIN_FIRST_EARN);
    expect(perHour).toBeLessThan(600);
    // Mashing rake every tick earns exactly what one rake a cooldown earns.
    const sim = idleAdapter();
    const w = sim.createWorld(9, "server");
    sim.addPlayer(w, 1);
    const rake = { mx: 0, mz: 0, cx: 0, cz: 0, act: IdleAct.Rake, a: 0, b: 0, c: 0 };
    for (let t = 0; t < S * 10; t++) sim.step(w, new Map([[1, [rake]]]));
    const g = idleGame().game;
    expect(w.state?.players.get(1)?.rakes).toBe(Math.ceil((S * 10) / g.rakeTicks));
  });
});
