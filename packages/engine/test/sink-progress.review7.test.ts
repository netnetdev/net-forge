// The rule: "a staked run starts from
// zero progress". The fix resets the player's earn
// COUNTS at a run start and keeps "round.top" from paying a run that started
// mid-round (runner.ts lateStart), but "boss.killed" credits every present
// player, so a run started moments before a boss dies (a guest who signs in
// with a stake waiting, or a late joiner) is paid the boss rule, and its
// stake share, for a fight it never took part in. The test asserts the safe
// property; it FAILS while the finding stands.

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initSim } from "@netforge/engine-sim";
import { earn, game, prefab, system, weapon } from "../src/index.js";
import { GameRunner, collectManifest, compileGame, resetRegistry } from "../src/game/index.js";

beforeAll(async () => {
  await initSim();
});
beforeEach(() => resetRegistry());

function declareBossGame(): void {
  game({
    template: "survivor",
    style: "lowpoly",
    places: { a: { chunks: "places/a", spawn: [0, 1, 0] } },
    players: { prefab: "style.lowpoly.hero", max: 4, weapon: "pulse" },
  });
  prefab("king", { model: "style.lowpoly.king", health: 400, speed: 0, radius: 1, boss: true });
  weapon("pulse", { kind: "nova", damage: 20, cooldown: 0.5, range: 6 });
  system("boss", ({ after, spawnRing, on, end }) => {
    after(0.2, () => spawnRing("king", { count: 1, radius: 2 }));
    on("boss.killed", () => end("won"));
  });
  earn.rule("slayer", { when: "boss.killed", n: 1, pay: 50, oncePer: "run" });
  earn.stake({ min: 1, max: 10, multiple: 2 });
}

async function play(startRunAt: number | null): Promise<{ killTick: number; awards: string[] }> {
  declareBossGame();
  const g = compileGame(collectManifest());
  const { createWorld, addPlayer, step } = await import("@netforge/engine-sim");
  const w = createWorld({ ...g.sim, seed: 3 });
  addPlayer(w, 1);
  const r = new GameRunner(g, w, { godMode: true });
  const awards: string[] = [];
  let killTick = -1;
  for (let t = 0; t < 30 * 60 && killTick < 0; t++) {
    if (t === startRunAt) r.startRun(1);
    r.beforeStep();
    const res = step(w, new Map([[1, { seq: t + 1, tick: t, moveX: 0, moveZ: 0, yaw: 0, buttons: t % 2 === 0 ? 1 << 5 : 0 }]]));
    const out = r.afterStep(res.events);
    if (out.events.some((e) => e.name === "boss.killed")) killTick = t;
    for (const a of out.awards) awards.push(`${a.player}:${a.rule}`);
  }
  resetRegistry();
  return { killTick, awards };
}

describe("the late-start rule: a run that starts as the boss dies is paid for the whole fight", () => {
  it("a referee run started one tick before the boss falls is not paid the boss rule", async () => {
    const base = await play(null);
    expect(base.killTick).toBeGreaterThan(30); // the fight took real time
    expect(base.awards).toContain("1:slayer"); // a run present for the whole fight is paid
    const late = await play(base.killTick - 1);
    expect(late.killTick).toBe(base.killTick);
    // SECURE PROPERTY: progress the world made before the run started never pays the run.
    expect(late.awards).not.toContain("1:slayer");
  }, 60_000);
});
