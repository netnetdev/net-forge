import { beforeAll, describe, expect, it } from "vitest";
import { Button, EntityFlag, FixedStepper, addPlayer, captureState, createWorld, initSim, lastProcessedSeq, removePlayer, step } from "../src/index.js";
import type { EntityState, InputCommand, SimWorld } from "../src/index.js";

const ARENA = { halfExtent: 10, pillars: [{ x: 0, z: -6, radius: 1, height: 3 }], spawn: [0, 1, 0] as const };

function me(w: SimWorld): EntityState {
  const e = captureState(w).entities.find((x) => x.kind === 1);
  if (!e) throw new Error("no player");
  return e;
}
const m = (v: number) => v / 1024;

function drive(w: SimWorld, ticks: number, cmd: Partial<InputCommand>, seq0 = 0): void {
  for (let t = 0; t < ticks; t++) {
    step(w, new Map([[1, { seq: seq0 + t + 1, tick: w.tick, moveX: 0, moveZ: 0, yaw: 0, buttons: 0, ...cmd }]]));
  }
}

describe("character controller", () => {
  beforeAll(async () => {
    await initSim();
  });

  it("settles on the floor and is grounded", () => {
    const w = createWorld({ arena: ARENA });
    addPlayer(w, 1);
    drive(w, 30, {});
    const p = me(w);
    expect(p.flags & EntityFlag.Grounded).toBeTruthy();
    // Capsule centre rests at halfHeight + radius (0.9) above the floor, plus the controller offset.
    expect(m(p.py)).toBeGreaterThan(0.85);
    expect(m(p.py)).toBeLessThan(0.99);
  });

  it("walks forward along -z at yaw 0 at the configured speed", () => {
    const w = createWorld({ arena: { ...ARENA, pillars: [] } });
    addPlayer(w, 1);
    drive(w, 15, {});
    const z0 = m(me(w).pz);
    drive(w, 15, { moveZ: 1 }, 15);
    const p = me(w);
    expect(m(p.pz) - z0).toBeCloseTo(-7 * 0.5, 0);
    expect(Math.abs(m(p.px))).toBeLessThan(0.01);
    expect(lastProcessedSeq(w, 1)).toBe(30);
  });

  it("strafes right along +x at yaw 0, and yaw rotates the frame", () => {
    const w = createWorld({ arena: { ...ARENA, pillars: [] } });
    addPlayer(w, 1);
    drive(w, 10, { moveX: 1 });
    expect(m(me(w).px)).toBeGreaterThan(1);
    const w2 = createWorld({ arena: { ...ARENA, pillars: [] } });
    addPlayer(w2, 1);
    drive(w2, 10, { moveZ: 1, yaw: Math.PI / 2 }); // facing -x
    expect(m(me(w2).px)).toBeLessThan(-1);
  });

  it("is stopped by the arena wall", () => {
    const w = createWorld({ arena: { ...ARENA, pillars: [] } });
    addPlayer(w, 1);
    drive(w, 120, { moveX: 1 });
    const x = m(me(w).px);
    expect(x).toBeLessThanOrEqual(10 - 0.4 + 0.05);
    expect(x).toBeGreaterThan(9);
  });

  it("is stopped by a pillar", () => {
    const w = createWorld({ arena: ARENA });
    addPlayer(w, 1);
    drive(w, 90, { moveZ: 1 });
    const z = m(me(w).pz);
    // Pillar at z=-6, radius 1; player radius 0.4: stops near z = -4.6 (or slides around it).
    const x = m(me(w).px);
    expect(Math.hypot(x, z + 6)).toBeGreaterThanOrEqual(1.4 - 0.05);
  });

  it("jumps on a fresh press, rises, and lands", () => {
    const w = createWorld({ arena: ARENA });
    addPlayer(w, 1);
    drive(w, 30, {});
    const y0 = m(me(w).py);
    drive(w, 1, { buttons: Button.Jump }, 30);
    drive(w, 8, { buttons: Button.Jump }, 31); // held: no second jump
    const peak = m(me(w).py);
    expect(peak).toBeGreaterThan(y0 + 0.8);
    expect(me(w).flags & EntityFlag.Grounded).toBeFalsy();
    drive(w, 40, {}, 39);
    expect(m(me(w).py)).toBeCloseTo(y0, 1);
    expect(me(w).flags & EntityFlag.Grounded).toBeTruthy();
  });

  it("join and leave emit events and remove the character", () => {
    const w = createWorld({ arena: ARENA });
    addPlayer(w, 7);
    expect(() => addPlayer(w, 7)).toThrow(/already/);
    const r1 = step(w, new Map());
    expect(r1.events.some((e) => e.type === "player.joined" && e.playerId === 7)).toBe(true);
    removePlayer(w, 7);
    const r2 = step(w, new Map());
    expect(r2.events.some((e) => e.type === "player.left")).toBe(true);
    expect(captureState(w).entities.length).toBe(0);
  });
});

describe("FixedStepper", () => {
  it("accumulates to whole ticks and reports alpha", () => {
    const s = new FixedStepper(30);
    expect(s.advance(10).ticks).toBe(0);
    const r = s.advance(30);
    expect(r.ticks).toBe(1);
    expect(r.alpha).toBeCloseTo((40 - 1000 / 30) / (1000 / 30), 6);
  });
  it("drops time beyond the catch-up cap", () => {
    const s = new FixedStepper(30, 4);
    const r = s.advance(1001);
    expect(r.ticks).toBe(4);
    expect(r.dropped).toBe(26);
  });
});
