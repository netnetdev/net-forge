import { beforeAll, describe, expect, it } from "vitest";
import { Layer, createPhysics, initSim, restorePhysics } from "../src/index.js";
import type { BodyId, CharacterDesc, CharacterInput, CharacterReport, PhysicsWorld, Quat } from "../src/index.js";

beforeAll(async () => {
  await initSim();
});

const TICK = 30;
const zRot = (deg: number): Quat => {
  const a = (deg * Math.PI) / 180;
  return [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
};

function world(): PhysicsWorld {
  const p = createPhysics({ tickRate: TICK, gravity: [0, -20, 0] });
  p.addStaticBox([50, 0.5, 50], [0, -0.5, 0]);
  return p;
}

/** Character standing on the floor at x (capsule centre at radius + halfHeight + skin). */
function character(p: PhysicsWorld, x = 0, extra: Partial<CharacterDesc> = {}, y = 0.95): BodyId {
  return p.addCharacter({ position: [x, y, 0], ...extra });
}

function drive(p: PhysicsWorld, id: BodyId, input: CharacterInput, ticks: number): CharacterReport[] {
  const out: CharacterReport[] = [];
  for (let i = 0; i < ticks; i++) {
    const r = p.step(new Map([[id, input]])).characters.find((c) => c.id === id);
    if (r) out.push(r);
  }
  return out;
}

/** A slope rising toward +x from x = 2, `deg` steep, thick enough to stand on. */
function ramp(p: PhysicsWorld, deg: number): void {
  const a = (deg * Math.PI) / 180;
  const half = 6;
  // Box centre so the top face's low edge sits at (2, 0).
  const cx = 2 + half * Math.cos(a) + 0.5 * Math.sin(a);
  const cy = half * Math.sin(a) - 0.5 * Math.cos(a);
  p.addBody({ type: "static", shape: { box: [half, 0.5, 3] }, position: [cx, cy, 0], rotation: zRot(deg), layer: Layer.Level, friction: 1 });
}

describe("character motor", () => {
  it("settles onto the floor and reports grounded with an up normal", () => {
    const p = world();
    const ch = character(p, 0, {}, 2);
    const r = drive(p, ch, { moveX: 0, moveZ: 0 }, 40);
    expect(r.at(-1)?.grounded).toBe(true);
    expect(r.some((x) => x.landed)).toBe(true);
    expect(r.at(-1)?.groundNormal[1]).toBeCloseTo(1, 3);
    expect(p.position(ch)[1]).toBeGreaterThan(0.89);
    expect(p.position(ch)[1]).toBeLessThan(0.97);
  });

  it("walks up a 30 degree slope but not a 60 degree one", () => {
    const climb = (deg: number) => {
      const p = world();
      ramp(p, deg);
      const ch = character(p);
      drive(p, ch, { moveX: 1, moveZ: 0 }, 75);
      return p.position(ch)[1];
    };
    expect(climb(30)).toBeGreaterThan(3);
    expect(climb(60)).toBeLessThan(1.3);
  });

  it("slides down a slope steeper than minSlopeSlide", () => {
    const p = world();
    ramp(p, 60);
    // Drop it onto the steep face, well up.
    const ch = p.addCharacter({ position: [5, 6.5, 0] });
    drive(p, ch, { moveX: 0, moveZ: 0 }, 5);
    const startY = p.position(ch)[1];
    const r = drive(p, ch, { moveX: 0, moveZ: 0 }, 30);
    // Sliding is not standing: no grounded ticks on the steep face until the bottom.
    expect(r.slice(0, 5).every((x) => !x.grounded)).toBe(true);
    expect(p.position(ch)[1]).toBeLessThan(startY - 2);
    expect(p.position(ch)[0]).toBeLessThan(5);
  });

  it("climbs a 0.3 m step but not a 0.6 m one", () => {
    const step = (h: number) => {
      const p = world();
      p.addStaticBox([2, h / 2, 3], [4, h / 2, 0]);
      const ch = character(p);
      drive(p, ch, { moveX: 1, moveZ: 0 }, 16);
      return p.position(ch);
    };
    const low = step(0.3);
    expect(low[0]).toBeGreaterThan(2.2);
    expect(low[1]).toBeGreaterThan(1.15);
    const high = step(0.6);
    expect(high[0]).toBeLessThan(2);
  });

  it("snaps to the ground down a small drop, and floats off it without snapping", () => {
    const off = (snap: number) => {
      const p = world();
      p.addStaticBox([2, 0.1, 3], [0, 0.1, 0]);
      const ch = character(p, 0, { snapToGround: snap, maxSpeed: 6 }, 1.15);
      drive(p, ch, { moveX: 0, moveZ: 0 }, 10);
      const r = drive(p, ch, { moveX: 1, moveZ: 0 }, 30);
      return r.filter((x) => !x.grounded).length;
    };
    expect(off(0.3)).toBe(0);
    expect(off(0)).toBeGreaterThan(0);
  });

  it("coyote time: a jump still works a few ticks after walking off a ledge, not after", () => {
    const coyote = 5;
    // Ticks after the first airborne tick at which jump is pressed.
    const tryJump = (late: number) => {
      const p = world();
      p.addStaticBox([2, 1, 3], [0, 1, 0]);
      const ch = character(p, 1.5, { coyoteTicks: coyote, snapToGround: 0, maxSpeed: 3, groundAccel: 1000 }, 2.95);
      drive(p, ch, { moveX: 0, moveZ: 0 }, 5);
      let airborne = -1;
      for (let t = 0; t < 60; t++) {
        const press = airborne >= 0 && t === airborne + late;
        const [r] = drive(p, ch, { moveX: 1, moveZ: 0, jump: press }, 1);
        if (r?.jumped) return true;
        if (airborne < 0 && r && !r.grounded) airborne = t;
      }
      return false;
    };
    expect(tryJump(1)).toBe(true);
    expect(tryJump(coyote - 1)).toBe(true);
    expect(tryJump(coyote + 2)).toBe(false);
  });

  it("jump buffering: a press shortly before landing jumps on landing", () => {
    const land = (early: number) => {
      const p = world();
      const ch = character(p, 0, { jumpBufferTicks: 5 }, 4);
      // Fall, pressing jump `early` ticks before the landing tick.
      const probe = restorePhysics(p.snapshot());
      const r = drive(probe, ch, { moveX: 0, moveZ: 0 }, 40);
      const landing = r.findIndex((x) => x.landed);
      probe.destroy();
      let jumped = false;
      for (let t = 0; t < 40; t++) {
        const [x] = drive(p, ch, { moveX: 0, moveZ: 0, jump: t === landing - early }, 1);
        if (x?.jumped) jumped = true;
      }
      return jumped;
    };
    expect(land(3)).toBe(true);
    expect(land(12)).toBe(false);
  });

  it("variable jump height: a tap jumps lower than a hold", () => {
    const apex = (holdTicks: number) => {
      const p = world();
      const ch = character(p);
      drive(p, ch, { moveX: 0, moveZ: 0 }, 5);
      let best = 0;
      for (let t = 0; t < 40; t++) {
        drive(p, ch, { moveX: 0, moveZ: 0, jump: t < holdTicks }, 1);
        best = Math.max(best, p.position(ch)[1]);
      }
      return best;
    };
    const tap = apex(2);
    const hold = apex(30);
    expect(hold).toBeGreaterThan(tap + 0.4);
    // v² / 2g = 49 / 40 = 1.2 m above the start.
    expect(hold).toBeGreaterThan(0.95 + 1.0);
  });

  it("air control accelerates slower than the ground", () => {
    const speedAfter = (air: boolean) => {
      const p = world();
      const ch = character(p, 0, { groundAccel: 60, airAccel: 15, maxSpeed: 8 }, air ? 10 : 0.95);
      drive(p, ch, { moveX: 0, moveZ: 0 }, air ? 1 : 5);
      drive(p, ch, { moveX: 1, moveZ: 0 }, 3);
      return p.velocity(ch)[0];
    };
    const ground = speedAfter(false);
    const air = speedAfter(true);
    expect(ground).toBeCloseTo(6, 1);
    expect(air).toBeCloseTo(1.5, 1);
  });

  it("dash moves dashSpeed x ticks, then cools down; a buffered press dashes when ready", () => {
    const p = world();
    const ch = character(p, 0, { dashTicks: 6, dashSpeed: 15, dashCooldownTicks: 20, dashBufferTicks: 5, maxSpeed: 0.0001 });
    drive(p, ch, { moveX: 0, moveZ: 0 }, 5);
    const x0 = p.position(ch)[0];
    const r = drive(p, ch, { moveX: 1, moveZ: 0, dash: true }, 1);
    expect(r[0]?.dashed).toBe(true);
    expect(p.characterState(ch).invulnerable).toBe(true);
    drive(p, ch, { moveX: 1, moveZ: 0, dash: true }, 5);
    expect(p.position(ch)[0] - x0).toBeCloseTo((15 * 6) / TICK, 1);
    expect(p.characterState(ch).invulnerable).toBe(false);
    // Pressing again during cooldown does nothing...
    const again = drive(p, ch, { moveX: 1, moveZ: 0, dash: false }, 1).concat(drive(p, ch, { moveX: 1, moveZ: 0, dash: true }, 1));
    expect(again.some((x) => x.dashed)).toBe(false);
    // ...but a press within the buffer of the cooldown ending dashes when it ends.
    const s = p.characterState(ch);
    expect(s.dashCooldown).toBeGreaterThan(5);
    drive(p, ch, { moveX: 1, moveZ: 0 }, s.dashCooldown - 3);
    const later = drive(p, ch, { moveX: 1, moveZ: 0, dash: true }, 1).concat(drive(p, ch, { moveX: 1, moveZ: 0 }, 6));
    expect(later.some((x) => x.dashed)).toBe(true);
    expect(later[0]?.dashed).toBe(false);
  });

  it("dash with no stick goes the way the character last moved; facing starts -z", () => {
    const p = world();
    const ch = character(p, 0, { dashTicks: 4, dashSpeed: 12 });
    drive(p, ch, { moveX: 0, moveZ: 0 }, 5);
    const z0 = p.position(ch)[2];
    drive(p, ch, { moveX: 0, moveZ: 0, dash: true }, 4);
    expect(p.position(ch)[2]).toBeLessThan(z0 - 1);
  });

  it("knockback and impulses move a character; walls stop it", () => {
    const p = world();
    p.addStaticBox([0.5, 2, 5], [3, 2, 0]);
    const ch = character(p);
    drive(p, ch, { moveX: 0, moveZ: 0 }, 5);
    p.applyKnockback(ch, [-1, 0, 0], 12, { lift: 3 });
    const r = drive(p, ch, { moveX: 0, moveZ: 0 }, 20);
    expect(r[0]?.grounded).toBe(false);
    expect(p.position(ch)[0]).toBeGreaterThan(1.5);
    expect(p.position(ch)[0]).toBeLessThan(2.5 - 0.39);
    expect(r.at(-1)?.grounded).toBe(true);
  });

  it("pushes dynamic props it walks into", () => {
    const p = world();
    const crate = p.addBody({ type: "dynamic", shape: { box: [0.3, 0.3, 0.3] }, position: [1.5, 0.3, 0], mass: 5, friction: 0.2 });
    const ch = character(p);
    drive(p, ch, { moveX: 1, moveZ: 0 }, 45);
    expect(p.position(crate)[0]).toBeGreaterThan(2);
  });

  it("hits its head on a ceiling and stops rising", () => {
    const p = world();
    p.addStaticBox([3, 0.2, 3], [0, 2.4, 0]);
    const ch = character(p);
    drive(p, ch, { moveX: 0, moveZ: 0 }, 5);
    const r = drive(p, ch, { moveX: 0, moveZ: 0, jump: true }, 20);
    expect(r.some((x) => x.hitCeiling)).toBe(true);
    expect(Math.max(...r.map(() => p.position(ch)[1]))).toBeLessThan(2.2);
  });

  it("state round-trips through setCharacterState (reconcile)", () => {
    const p = world();
    const ch = character(p, 0, { dashTicks: 5 });
    drive(p, ch, { moveX: 1, moveZ: 0, jump: true }, 6);
    const saved = p.characterState(ch);
    const snap = p.snapshot();
    drive(p, ch, { moveX: -1, moveZ: 1 }, 15);
    const q = restorePhysics(snap);
    p.setCharacterState(ch, saved);
    expect(p.characterState(ch)).toEqual(q.characterState(ch));
  });
});
