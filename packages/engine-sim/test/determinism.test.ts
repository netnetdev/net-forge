import { beforeAll, describe, expect, it } from "vitest";
import { addPlayer, captureState, createWorld, destroyWorld, encodeSnapshot, initSim, step } from "../src/index.js";
import type { SimConfig, SimWorld } from "../src/index.js";
import { equalBytes, scriptedInputs } from "./helpers.js";

const CONFIG: SimConfig = { seed: 42, enemies: { target: 600, spawnPerTick: 40 } };

function run(ticks: number, checkpoints: number[]): Uint8Array[] {
  const world: SimWorld = createWorld(CONFIG);
  addPlayer(world, 1);
  addPlayer(world, 2, [5, 1, 5]);
  const input = scriptedInputs([1, 2], 7);
  const out: Uint8Array[] = [];
  for (let t = 0; t < ticks; t++) {
    step(world, input(world.tick));
    if (checkpoints.includes(world.tick)) out.push(encodeSnapshot(captureState(world)));
  }
  destroyWorld(world);
  return out;
}

describe("fixed tick determinism", () => {
  beforeAll(async () => {
    await initSim();
  });

  it("same inputs give the same snapshot bytes over 1,000 ticks", () => {
    const checkpoints = [1, 10, 100, 250, 500, 750, 1000];
    const a = run(1000, checkpoints);
    const b = run(1000, checkpoints);
    expect(a.length).toBe(checkpoints.length);
    for (let i = 0; i < a.length; i++) {
      expect(equalBytes(a[i] ?? new Uint8Array(), b[i] ?? new Uint8Array()), `tick ${checkpoints[i]}`).toBe(true);
    }
  });

  it("the run is not trivially static (enemies spawned, things died, players moved)", () => {
    const world = createWorld(CONFIG);
    addPlayer(world, 1);
    const input = scriptedInputs([1], 3);
    let kills = 0;
    let hits = 0;
    for (let t = 0; t < 1000; t++) {
      const r = step(world, input(world.tick));
      for (const e of r.events) {
        if (e.type === "enemy.killed") kills++;
        if (e.type === "player.hit") hits++;
      }
    }
    const s = captureState(world);
    expect(s.entities.filter((e) => e.kind === 2).length).toBeGreaterThan(500);
    expect(kills).toBeGreaterThan(0);
    expect(hits).toBeGreaterThan(0);
    expect(s.kills).toBe(kills);
    destroyWorld(world);
  });

  it("a different seed gives a different run", () => {
    const w1 = createWorld({ ...CONFIG, seed: 1 });
    const w2 = createWorld({ ...CONFIG, seed: 2 });
    for (const w of [w1, w2]) {
      addPlayer(w, 1);
      for (let t = 0; t < 30; t++) step(w, new Map());
    }
    expect(equalBytes(encodeSnapshot(captureState(w1)), encodeSnapshot(captureState(w2)))).toBe(false);
  });
});
