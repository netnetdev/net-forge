import { describe, expect, it } from "vitest";
import { pickTarget } from "../src/rules/tower.js";

// The minimal creep shape pickTarget reads. qx/qy are road positions in Q units.
type C = { id: number; d: number; hp: number; qx: number; qy: number };
const alive = () => true;
const pos = (c: C) => ({ qx: c.qx, qy: c.qy });

// A tower at the origin with a generous range.
const cx = 0;
const cy = 0;
const BIG = 1_000_000_000_000;

describe("tower targeting modes (pickTarget)", () => {
  // A weak creep further along the road, and a tanky boss just behind it; both in range.
  const farWeak: C = { id: 1, d: 900, hp: 20, qx: 100, qy: 0 };
  const nearStrong: C = { id: 2, d: 500, hp: 1800, qx: 50, qy: 0 };
  const creeps = [farWeak, nearStrong];

  it("'first' shoots the creep furthest along (the historical default)", () => {
    expect(pickTarget("first", creeps, alive, pos, cx, cy, BIG)?.id).toBe(1);
  });

  it("'last' shoots the creep least far along", () => {
    expect(pickTarget("last", creeps, alive, pos, cx, cy, BIG)?.id).toBe(2);
  });

  it("'strong' shoots the boss though a weaker creep is further along (new behaviour)", () => {
    // Before this change 'strong' did not exist and the tower shot id 1 (furthest).
    expect(pickTarget("strong", creeps, alive, pos, cx, cy, BIG)?.id).toBe(2);
  });

  it("'close' shoots the creep nearest the tower", () => {
    expect(pickTarget("close", creeps, alive, pos, cx, cy, BIG)?.id).toBe(2);
  });

  it("out-of-range creeps are ignored (returns null when none in range)", () => {
    const far: C = { id: 3, d: 100, hp: 10, qx: 5000, qy: 0 };
    expect(pickTarget("close", [far], alive, pos, cx, cy, 100 * 100)).toBeNull();
  });

  it("last/strong/close break ties to the lower creep id, so a run replays bit-for-bit", () => {
    const high: C = { id: 7, d: 300, hp: 50, qx: 30, qy: 0 };
    const low: C = { id: 3, d: 300, hp: 50, qx: 30, qy: 0 }; // identical metrics, lower id
    for (const mode of ["last", "strong", "close"] as const) {
      expect(pickTarget(mode, [high, low], alive, pos, cx, cy, BIG)?.id).toBe(3);
    }
  });

  it("'first' keeps the historical iteration-order tiebreak (the sim spawns creeps in id order)", () => {
    const a: C = { id: 7, d: 300, hp: 50, qx: 30, qy: 0 };
    const b: C = { id: 3, d: 300, hp: 50, qx: 30, qy: 0 };
    // In id order the lower id is seen first and holds the tie — exactly the old behaviour.
    expect(pickTarget("first", [b, a], alive, pos, cx, cy, BIG)?.id).toBe(3);
  });

  it("dead creeps are skipped", () => {
    const deadFar: C = { id: 1, d: 900, hp: 20, qx: 100, qy: 0 };
    const liveNear: C = { id: 2, d: 100, hp: 10, qx: 20, qy: 0 };
    const isAlive = (c: C) => c.id !== 1;
    expect(pickTarget("first", [deadFar, liveNear], isAlive, pos, cx, cy, BIG)?.id).toBe(2);
  });
});
