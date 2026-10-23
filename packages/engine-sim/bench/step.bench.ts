/**
 * Sim cost per tick at the week-2 arena size: 1 player, 2,000 enemies.
 * Run: pnpm --filter @netforge/engine-sim bench
 */
import { bench, describe } from "vitest";
import { addPlayer, createWorld, initSim, step } from "../src/index.js";
import { scriptedInputs } from "../test/helpers.js";

await initSim();

for (const target of [2000, 4000]) {
  const world = createWorld({ seed: 1, enemies: { target, spawnPerTick: 4000 } });
  addPlayer(world, 1);
  const input = scriptedInputs([1], 1);
  for (let t = 0; t < 120; t++) step(world, input(world.tick));
  describe(`step, 1 player, ${target} enemies`, () => {
    bench("step", () => {
      step(world, input(world.tick));
    }, { time: 3000 });
  });
}

// Content mode (Template 1 shape): 4 players with three weapons each, 2,000 enemies held on rings.
{
  const { CONTENT_CONFIG, contentInputs } = await import("../test/helpers.js");
  const { enemyCount, spawnEnemy, spawnRingPoint } = await import("../src/index.js");
  const cfg = { ...CONTENT_CONFIG, maxEntities: 4096, content: { ...CONTENT_CONFIG.content, progression: { ...CONTENT_CONFIG.content.progression, startWeapon: 1 } } };
  const world = createWorld(cfg as unknown as Parameters<typeof createWorld>[0]);
  for (let p = 1; p <= 4; p++) addPlayer(world, p, [p * 3 - 7, 1, 0]);
  const input = contentInputs([1, 2, 3, 4], 2);
  const top = () => {
    let n = 0;
    while (enemyCount(world) < 2000 && n++ < 200) {
      const [x, z] = spawnRingPoint(world, 18 + (n % 10));
      spawnEnemy(world, n % 7 === 0 ? 1 : 0, x, z);
    }
  };
  for (let t = 0; t < 300; t++) {
    top();
    step(world, input(world.tick));
  }
  describe("content step, 4 players, 2,000 enemies", () => {
    bench("top up + step", () => {
      top();
      step(world, input(world.tick));
    }, { time: 3000 });
  });
}
