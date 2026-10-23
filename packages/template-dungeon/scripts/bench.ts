// Server cost at the 2,000-enemy hold: 4 bots, the
// game's own director plus a held crowd, several repeats. Prints mean and
// p99 ms per tick for each repeat.
//
//   pnpm --filter @netforge/template-dungeon bench -- --repeats 3 --seconds 30
import { engine } from "@netforge/engine";
import "../src/manifest.js";

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? dflt) : dflt;
}
const REPEATS = Number(arg("repeats", "3"));
const SECONDS = Number(arg("seconds", "30"));
/** --mix 1: the held crowd cycles every non-boss enemy type (all behaviours on). */
const MIX = arg("mix", "0") === "1";

async function main(): Promise<void> {
  for (let i = 0; i < REPEATS; i++) {
    const r = await engine.test.run({ ticks: SECONDS * 30, bots: 4, seed: 4 + i, enemies: 2000, enemyMix: MIX });
    console.log(`hold 2000${MIX ? " (every role)" : ""}, 4 bots, seed ${4 + i}: peak ${r.peakEnemies}, ${r.msPerTick.toFixed(2)} ms/tick mean, p99 ${r.p99MsPerTick.toFixed(2)} ms`);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
