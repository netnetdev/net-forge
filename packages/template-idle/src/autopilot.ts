/**
 * The autopilot over a player's own run state (no DOM): the browser's
 * ?autopilot=1 and the measure script's node clients play the works the
 * way the genre's bot does, from what the room sends them.
 */
import { IdleAct, plotCenter } from "@netnetcapital/engine/rules";
import type { RulesInput } from "@netnetcapital/engine/rules";
import { idleGame } from "./manifest.js";

/** What the room sends one player (adapter infoFor over the genre's view). */
export interface IdleView {
  readonly phase?: "playing" | "ended";
  readonly outcome?: "won" | "lost" | null;
  readonly endsIn?: number | null;
  readonly earn?: readonly { id: string; when: string; n: number; have: number; paid: boolean }[];
  readonly left: number;
  readonly shift: number;
  readonly contract: number;
  readonly contractTarget: number;
  readonly filled: boolean;
  readonly players: readonly { id: number; slot: number; made: number; shipped: number; tended: boolean }[];
  readonly slot?: number;
  readonly brine?: number;
  readonly salt?: number;
  readonly crystals?: number;
  readonly made?: number;
  readonly nextPack?: number;
  readonly levels?: readonly number[];
  readonly costs?: readonly number[];
  readonly stall?: number;
  readonly rake?: number;
  readonly rates?: { pump: number; pan: number; kiln: number };
}

const g = idleGame().game;

/** The browser's autopilot: rake when ready, buy what the chain lacks, ship crystals. */
export function idleAutopilot(v: IdleView | null, tick: number): RulesInput | null {
  if (!v || v.salt === undefined || !v.levels || !v.costs || !v.rates || tick % 3 !== 0) return null;
  const c = plotCenter(v.slot ?? 0);
  const base = { mx: 0, mz: 0, cx: Math.round(c.x * 16), cz: Math.round((c.z + 2) * 16), b: 0, c: 0 };
  const saltRate = Math.min(v.rates.pan, v.rates.pump / g.brinePerSalt);
  const kind = v.left < v.shift * 0.65 && saltRate > v.rates.kiln * g.saltPerCrystal * 2 ? "kiln" : v.rates.pump / g.brinePerSalt <= v.rates.pan ? "pump" : "pan";
  let best = -1;
  let score = Infinity;
  g.plants.forEach((p, i) => {
    if (p.def.kind !== kind) return;
    const sc = (v.costs?.[i] ?? Infinity) / p.def.rate;
    if (sc < score) {
      score = sc;
      best = i;
    }
  });
  if (best >= 0 && v.salt >= (v.costs[best] ?? Infinity)) return { ...base, act: IdleAct.Buy, a: best };
  if ((v.rake ?? 1) === 0) return { ...base, act: IdleAct.Rake, a: 0 };
  if ((v.crystals ?? 0) >= 1 && !v.filled) return { ...base, act: IdleAct.Ship, a: v.crystals ?? 1 };
  return null;
}
