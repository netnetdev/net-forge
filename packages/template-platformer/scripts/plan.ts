/** Print the route planner's result for every course: `pnpm --filter @netforge/template-platformer exec tsx scripts/plan.ts`. */
import { planCourse } from "@netforge/engine/game";
import { platformerGame } from "../src/manifest.js";

const g = platformerGame();
for (const [i, level] of g.platformer.levels.entries()) {
  const t0 = performance.now();
  const r = planCourse(level, { tickRate: g.tickRate, tuning: g.platformer.tuning, startTick: 3 * g.tickRate });
  console.log(`${g.platformer.names[i]}: ${r.found ? `route ${r.seconds.toFixed(1)} s` : `NO ROUTE (best x ${r.bestX.toFixed(1)} of ${level.flag[0]})`}, ${r.expanded} nodes, ${(performance.now() - t0).toFixed(0)} ms`);
}
