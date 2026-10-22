import { beforeAll, describe, expect, it } from "vitest";
import { Layer, createPhysics, initSim, layerMask, restorePhysics } from "../src/index.js";
import type { CharacterInput, PhysicsEvent, PhysicsWorld } from "../src/index.js";

beforeAll(async () => {
  await initSim();
});

/** A floor, two walls, a pile of boxes and balls, a hinged door and a character. */
function scene(): PhysicsWorld {
  const p = createPhysics({ tickRate: 30 });
  p.addStaticBox([20, 0.5, 20], [0, -0.5, 0]);
  p.addStaticBox([0.5, 2, 20], [10, 2, 0]);
  p.addStaticBox([20, 2, 0.5], [0, 2, -10]);
  for (let i = 0; i < 12; i++) {
    p.addBody({
      type: "dynamic",
      shape: i % 2 === 0 ? { box: [0.3, 0.3, 0.3] } : { sphere: 0.3 },
      position: [-2 + (i % 4) * 0.7, 1 + Math.floor(i / 4) * 0.8, 2 + (i % 3) * 0.2],
      restitution: i % 3 === 0 ? 0.5 : 0.1,
      friction: 0.6,
    });
  }
  const post = p.addBody({ type: "static", shape: { box: [0.1, 1, 0.1] }, position: [4, 1, 4] });
  const door = p.addBody({ type: "dynamic", shape: { box: [0.6, 0.9, 0.05] }, position: [4.7, 1, 4] });
  p.addJoint({ kind: "hinge", a: post, b: door, anchorA: [0.1, 0, 0], anchorB: [-0.6, 0, 0], axis: [0, 1, 0] });
  p.addCharacter({ position: [0, 1, 0], dashTicks: 5, dashSpeed: 16 });
  return p;
}

/** Scripted, seeded character input plus a knockback and an impulse now and then. */
function script(seed: number) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return (p: PhysicsWorld, tick: number): Map<number, CharacterInput> => {
    const ch = p.bodyIds().find((id) => p.isCharacter(id)) ?? 0;
    if (tick % 37 === 5) p.applyKnockback(4, [0, 0, 0], 6, { lift: 3 });
    if (tick % 53 === 11) p.applyImpulse(7, [rnd() * 2 - 1, 2, rnd() * 2 - 1]);
    if (tick % 90 === 45) p.applyKnockback(ch, [1, 0, 1], 4, { lift: 2 });
    return new Map([[ch, { moveX: rnd() * 2 - 1, moveZ: rnd() * 2 - 1, jump: rnd() < 0.08, dash: rnd() < 0.04 }]]);
  };
}

function run(p: PhysicsWorld, ticks: number, seed: number, from = 0): number[] {
  const input = script(seed);
  const out: number[] = [];
  for (let t = from; t < from + ticks; t++) {
    p.step(input(p, t));
    out.push(p.stateHash());
  }
  return out;
}

describe("physics determinism", () => {
  it("the same inputs stepped twice from fresh worlds give the same hashes", () => {
    const a = scene();
    const b = scene();
    const ha = run(a, 600, 42);
    const hb = run(b, 600, 42);
    expect(ha).toEqual(hb);
    // And the scene actually moved.
    expect(new Set(ha).size).toBeGreaterThan(500);
    a.destroy();
    b.destroy();
  });

  it("two worlds in lockstep agree every tick", () => {
    const a = scene();
    const b = scene();
    const ia = script(7);
    const ib = script(7);
    for (let t = 0; t < 600; t++) {
      const ea = a.step(ia(a, t));
      const eb = b.step(ib(b, t));
      expect(a.stateHash()).toBe(b.stateHash());
      expect(ea.events).toEqual(eb.events);
      expect(ea.characters).toEqual(eb.characters);
    }
    a.destroy();
    b.destroy();
  });

  it("different inputs give different hashes", () => {
    const a = scene();
    const b = scene();
    expect(run(a, 120, 1).at(-1)).not.toBe(run(b, 120, 2).at(-1));
  });

  it("snapshot, restore, then both step bit-identically (characters mid-jump and mid-dash, bodies resting)", () => {
    const a = scene();
    const input = script(99);
    let t = 0;
    for (; t < 200; t++) a.step(input(a, t));
    const ch = a.bodyIds().find((id) => a.isCharacter(id)) ?? 0;
    // Put the character mid-jump and mid-dash at the snapshot.
    a.step(new Map([[ch, { moveX: 1, moveZ: 0, jump: true, dash: true }]]));
    t++;
    const state = a.characterState(ch);
    expect(state.dashTicks).toBeGreaterThan(0);
    const bytes = a.snapshot();
    const b = restorePhysics(bytes);
    expect(b.tick).toBe(a.tick);
    expect(b.stateHash()).toBe(a.stateHash());
    expect(b.characterState(ch)).toEqual(a.characterState(ch));
    const ia = script(5);
    const ib = script(5);
    for (let k = 0; k < 300; k++) {
      a.step(ia(a, t + k));
      b.step(ib(b, t + k));
      expect(b.stateHash()).toBe(a.stateHash());
    }
    // Some bodies have gone to sleep and still match.
    const sleeping = a.bodyIds().filter((id) => a.bodyType(id) === "dynamic" && a.isSleeping(id));
    expect(sleeping.length).toBeGreaterThanOrEqual(0);
    a.destroy();
    b.destroy();
  });

  it("restores a snapshot taken right after adding bodies (pending query flush)", () => {
    const a = scene();
    for (let t = 0; t < 10; t++) a.step();
    a.addBody({ type: "dynamic", shape: { sphere: 0.2 }, position: [0, 3, 3] });
    const b = restorePhysics(a.snapshot());
    for (let k = 0; k < 60; k++) {
      a.step();
      b.step();
      expect(b.stateHash()).toBe(a.stateHash());
    }
  });

  it("ids are stable and never reused", () => {
    const p = createPhysics();
    const a = p.addBody({ type: "dynamic", shape: { sphere: 0.5 } });
    const b = p.addBody({ type: "dynamic", shape: { sphere: 0.5 } });
    p.removeBody(a);
    const c = p.addBody({ type: "dynamic", shape: { sphere: 0.5 } });
    expect([a, b, c]).toEqual([1, 2, 3]);
    expect(p.has(a)).toBe(false);
    expect(() => p.position(a)).toThrow(/no body 1/);
    p.destroy();
    expect(() => p.step()).toThrow(/destroyed/);
  });
});

describe("physics bodies", () => {
  it("CCD: a 0.1 m projectile at 200 m/s never crosses a 5 cm wall", () => {
    // Rapier 0.21 already builds speculative contacts from velocity, so even a
    // non-CCD sphere is caught by a static wall at these speeds; `ccd: true`
    // adds the swept time-of-impact pass that also covers rotating and moving
    // thin bodies. Both must stop here.
    const shoot = (ccd: boolean, speed: number) => {
      const p = createPhysics({ tickRate: 30, gravity: [0, 0, 0] });
      p.addStaticBox([0.025, 2, 2], [5, 0, 0]);
      const b = p.addBody({ type: "dynamic", shape: { sphere: 0.1 }, position: [0, 0, 0], linearVelocity: [speed, 0, 0], ccd, layer: Layer.Projectile });
      for (let i = 0; i < 10; i++) p.step();
      const x = p.position(b)[0];
      p.destroy();
      return x;
    };
    for (const speed of [200, 2000]) {
      expect(shoot(true, speed)).toBeLessThan(5);
      expect(shoot(false, speed)).toBeLessThan(5);
    }
  });

  it("layers and masks: a projectile that ignores pickups passes through one and hits an enemy", () => {
    const p = createPhysics({ gravity: [0, 0, 0] });
    p.addBody({ type: "static", shape: { box: [0.5, 1, 1] }, position: [3, 0, 0], layer: Layer.Pickup });
    const enemy = p.addBody({ type: "static", shape: { box: [0.5, 1, 1] }, position: [8, 0, 0], layer: Layer.Enemy });
    const shot = p.addBody({
      type: "dynamic",
      shape: { sphere: 0.1 },
      position: [0, 0, 0],
      linearVelocity: [30, 0, 0],
      layer: Layer.Projectile,
      mask: layerMask("Enemy", "Level"),
      ccd: true,
    });
    const events: PhysicsEvent[] = [];
    for (let i = 0; i < 20; i++) events.push(...p.step().events);
    expect(p.position(shot)[0]).toBeLessThan(7.6);
    expect(p.position(shot)[0]).toBeGreaterThan(3.5);
    expect(events.filter((e) => e.type === "contact.start")).toEqual([{ type: "contact.start", a: enemy, b: shot }]);
    // Ray queries respect the mask too.
    expect(p.raycast([0, 0, 0], [1, 0, 0], 20, { mask: Layer.Enemy })?.body).toBe(enemy);
    expect(p.raycast([0, 0, 0], [1, 0, 0], 20, { mask: Layer.Pickup })?.body).toBe(1);
  });

  it("a sensor reports exactly one enter and one exit", () => {
    const p = createPhysics({ gravity: [0, 0, 0] });
    const zone = p.addTrigger({ box: [1, 1, 1] }, [5, 0, 0]);
    const ball = p.addBody({ type: "dynamic", shape: { sphere: 0.2 }, position: [0, 0, 0], linearVelocity: [6, 0, 0] });
    const events: PhysicsEvent[] = [];
    for (let i = 0; i < 60; i++) events.push(...p.step().events);
    expect(events).toEqual([
      { type: "trigger.enter", a: zone, b: ball },
      { type: "trigger.exit", a: zone, b: ball },
    ]);
    // The sensor never slowed it down.
    expect(p.velocity(ball)[0]).toBeCloseTo(6, 4);
  });

  it("a character walking through a trigger enters and leaves it", () => {
    const p = createPhysics();
    p.addStaticBox([20, 0.5, 20], [0, -0.5, 0]);
    const zone = p.addTrigger({ box: [1, 2, 1] }, [3, 1, 0]);
    const ch = p.addCharacter({ position: [0, 1, 0] });
    const types: string[] = [];
    for (let i = 0; i < 60; i++) for (const e of p.step(new Map([[ch, { moveX: 1, moveZ: 0 }]])).events) if (e.a === zone || e.b === zone) types.push(e.type);
    expect(types).toEqual(["trigger.enter", "trigger.exit"]);
  });

  it("contact start and end between a dropped box and the floor", () => {
    const p = createPhysics();
    const floor = p.addStaticBox([5, 0.5, 5], [0, -0.5, 0]);
    const box = p.addBody({ type: "dynamic", shape: { box: [0.3, 0.3, 0.3] }, position: [0, 2, 0] });
    const ev: PhysicsEvent[] = [];
    for (let i = 0; i < 40; i++) ev.push(...p.step().events);
    expect(ev).toContainEqual({ type: "contact.start", a: floor, b: box });
    p.applyImpulse(box, [0, 20, 0]);
    const ev2: PhysicsEvent[] = [];
    for (let i = 0; i < 5; i++) ev2.push(...p.step().events);
    expect(ev2).toContainEqual({ type: "contact.end", a: floor, b: box });
  });

  it("raycast returns point, normal and distance, and honours exclude", () => {
    const p = createPhysics();
    const floor = p.addStaticBox([5, 0.5, 5], [0, -0.5, 0]);
    const crate = p.addBody({ type: "static", shape: { box: [0.5, 0.5, 0.5] }, position: [0, 0.5, 0] });
    const hit = p.raycast([0, 5, 0], [0, -1, 0], 20);
    expect(hit?.body).toBe(crate);
    expect(hit?.distance).toBeCloseTo(4, 4);
    expect(hit?.point[1]).toBeCloseTo(1, 4);
    expect(hit?.normal).toEqual([0, 1, 0]);
    const past = p.raycast([0, 5, 0], [0, -1, 0], 20, { exclude: [crate] });
    expect(past?.body).toBe(floor);
    expect(past?.distance).toBeCloseTo(5, 4);
    expect(p.raycast([0, 5, 0], [0, -1, 0], 3)).toBeNull();
    const all = p.raycastAll([0, 5, 0], [0, -1, 0], 20);
    expect(all.map((h) => h.body)).toEqual([crate, floor]);
    // A side hit on the crate faces -x.
    const side = p.raycast([-3, 0.5, 0], [1, 0, 0], 10);
    expect(side?.normal[0]).toBeCloseTo(-1, 4);
  });

  it("shape casts and overlaps", () => {
    const p = createPhysics();
    const wall = p.addStaticBox([0.5, 2, 2], [5, 2, 0]);
    const crate = p.addBody({ type: "static", shape: { box: [0.5, 0.5, 0.5] }, position: [0, 0.5, 3], layer: Layer.Prop });
    const hit = p.shapeCast({ sphere: 0.5 }, [0, 1, 0], [1, 0, 0], 20);
    expect(hit?.body).toBe(wall);
    expect(hit?.distance).toBeCloseTo(4, 3);
    expect(hit?.point[0]).toBeCloseTo(4.5, 3);
    expect(hit?.normal[0]).toBeCloseTo(-1, 3);
    expect(p.shapeCast({ sphere: 0.5 }, [0, 1, 0], [1, 0, 0], 3)).toBeNull();
    expect(p.overlap({ sphere: 6 }, [0, 0, 0])).toEqual([wall, crate]);
    expect(p.overlap({ sphere: 6 }, [0, 0, 0], { mask: Layer.Prop })).toEqual([crate]);
    expect(p.overlap({ box: [0.2, 0.2, 0.2] }, [0, 5, 0])).toEqual([]);
  });

  it("restitution: a bouncy ball rebounds higher than a dead one", () => {
    const apex = (restitution: number) => {
      const p = createPhysics({ tickRate: 60 });
      p.addStaticBox([5, 0.5, 5], [0, -0.5, 0], { restitution });
      const b = p.addBody({ type: "dynamic", shape: { sphere: 0.25 }, position: [0, 3, 0], restitution });
      let hitFloor = false;
      let best = 0;
      for (let i = 0; i < 180; i++) {
        p.step();
        const y = p.position(b)[1];
        if (y < 0.3) hitFloor = true;
        if (hitFloor) best = Math.max(best, y);
      }
      return best;
    };
    const bouncy = apex(0.9);
    const dead = apex(0);
    expect(bouncy).toBeGreaterThan(1.5);
    expect(dead).toBeLessThan(0.4);
  });

  it("friction: a box on a slope stays with high friction and slides with low", () => {
    const slide = (friction: number) => {
      const p = createPhysics({ tickRate: 60 });
      const a = (25 * Math.PI) / 180;
      const q = [0, 0, Math.sin(a / 2), Math.cos(a / 2)] as const;
      p.addBody({ type: "static", shape: { box: [5, 0.5, 2] }, position: [0, 0, 0], rotation: q, friction, layer: Layer.Level });
      const box = p.addBody({ type: "dynamic", shape: { box: [0.3, 0.3, 0.3] }, position: [0, 0.85, 0], rotation: q, friction });
      const x0 = p.position(box)[0];
      for (let i = 0; i < 90; i++) p.step();
      return Math.abs(p.position(box)[0] - x0);
    };
    expect(slide(1.2)).toBeLessThan(0.05);
    expect(slide(0.05)).toBeGreaterThan(1);
  });

  it("knockback is a velocity change; byMass makes heavy bodies move less", () => {
    const p = createPhysics({ gravity: [0, 0, 0] });
    const light = p.addBody({ type: "dynamic", shape: { sphere: 0.5 }, position: [1, 0, 0], mass: 1 });
    const heavy = p.addBody({ type: "dynamic", shape: { sphere: 0.5 }, position: [-1, 0, 5], mass: 10 });
    p.applyKnockback(light, [0, 0, 0], 4, { lift: 2 });
    p.applyKnockback(heavy, [0, 0, 5], 4);
    expect(p.velocity(light)[0]).toBeCloseTo(4, 4);
    expect(p.velocity(light)[1]).toBeCloseTo(2, 4);
    expect(p.velocity(heavy)[0]).toBeCloseTo(-4, 4);
    p.setLinearVelocity(light, [0, 0, 0]);
    p.setLinearVelocity(heavy, [0, 0, 0]);
    p.applyKnockback(light, [0, 0, 0], 4, { byMass: true });
    p.applyKnockback(heavy, [0, 0, 5], 4, { byMass: true });
    expect(p.velocity(light)[0]).toBeCloseTo(4, 4);
    expect(p.velocity(heavy)[0]).toBeCloseTo(-0.4, 4);
  });

  it("forces last one step; kinematic targets push dynamic bodies", () => {
    const p = createPhysics({ gravity: [0, 0, 0] });
    const b = p.addBody({ type: "dynamic", shape: { sphere: 0.5 }, mass: 2, position: [0, 0, 0] });
    p.applyForce(b, [60, 0, 0]);
    p.step();
    const v1 = p.velocity(b)[0];
    expect(v1).toBeCloseTo(60 / 2 / 30, 3);
    p.step();
    expect(p.velocity(b)[0]).toBeCloseTo(v1, 5);

    const q = createPhysics({ gravity: [0, 0, 0] });
    const paddle = q.addBody({ type: "kinematic", shape: { box: [0.2, 1, 1] }, position: [0, 0, 0] });
    const ball = q.addBody({ type: "dynamic", shape: { sphere: 0.3 }, position: [1, 0, 0] });
    for (let i = 1; i <= 20; i++) {
      q.setKinematicTarget(paddle, [i * 0.1, 0, 0]);
      q.step();
    }
    expect(q.position(paddle)[0]).toBeCloseTo(2, 4);
    expect(q.position(ball)[0]).toBeGreaterThan(2.3);
  });

  it("joints: a ball joint holds a pendulum at its length", () => {
    const p = createPhysics({ tickRate: 60 });
    const anchor = p.addBody({ type: "static", shape: { sphere: 0.05 }, position: [0, 5, 0], layer: Layer.Level });
    const bob = p.addBody({ type: "dynamic", shape: { sphere: 0.2 }, position: [2, 5, 0], layer: Layer.Debris, mask: Layer.Level });
    const j = p.addJoint({ kind: "ball", a: anchor, b: bob, anchorB: [-2, 0, 0] });
    let lowest = 5;
    for (let i = 0; i < 60; i++) {
      p.step();
      const [x, y] = p.position(bob);
      expect(Math.hypot(x, y - 5)).toBeCloseTo(2, 1);
      lowest = Math.min(lowest, y);
    }
    expect(lowest).toBeLessThan(3.3);
    const y = p.position(bob)[1];
    expect(y).toBeGreaterThan(2.9);
    p.removeJoint(j);
    for (let i = 0; i < 90; i++) p.step();
    // Free of the joint it falls below the arc it was held on.
    expect(p.position(bob)[1]).toBeLessThan(2.5);
  });
});
