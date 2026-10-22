import { beforeAll, describe, expect, it } from "vitest";
import { EntityKind, addPlayer, captureState, createWorld, destroyWorld, initSim, spawnEnemy, step } from "../src/index.js";
import type { SimConfig, SimWorld } from "../src/index.js";
import { segmentCircle } from "../src/content.js";
import { CONTENT_CONFIG } from "./helpers.js";

const BASE = CONTENT_CONFIG as unknown as SimConfig;
const POS = 1024;

/** A content config whose only weapon is the given one (slot 0 at the start). */
function withWeapon(weapon: Record<string, unknown>, extra: Partial<SimConfig> = {}): SimConfig {
  const content = BASE.content ?? {};
  return {
    ...BASE,
    ...extra,
    arena: { pillars: [], ...(extra.arena ?? {}) },
    content: { ...content, weapons: [weapon as never], progression: { ...content.progression, startWeapon: 0 } },
  };
}

function enemyAt(w: SimWorld, netId: number): { x: number; z: number; timers: number } | undefined {
  const e = captureState(w).entities.find((s) => s.netId === netId);
  return e ? { x: e.px / POS, z: e.pz / POS, timers: e.timers } : undefined;
}

describe("knockback physics (content mode)", () => {
  beforeAll(async () => {
    await initSim();
  });

  it("a nova hit staggers an enemy: it slides away from the player instead of chasing straight back", () => {
    const nova = { kind: "nova", damage: 1, cooldownTicks: 200, range: 4, count: 1, speed: 0, pierce: 0, knockback: 6, maxLevel: 8 };
    const w = createWorld(withWeapon(nova));
    addPlayer(w, 1, [0, 1, 0]);
    // A tough enemy (type 1, 30 hp) just inside the nova.
    const id = spawnEnemy(w, 1, 3, 0);
    step(w, new Map());
    const after = enemyAt(w, id);
    expect(after?.timers ?? 0).toBeGreaterThan(0);
    let maxX = after?.x ?? 0;
    for (let t = 0; t < 10; t++) {
      step(w, new Map());
      maxX = Math.max(maxX, enemyAt(w, id)?.x ?? 0);
    }
    // Pushed out by well over half a metre before it turns back.
    expect(maxX).toBeGreaterThan(3.6);
    // The stagger runs out and the chase resumes.
    for (let t = 0; t < 40; t++) step(w, new Map());
    expect(enemyAt(w, id)?.timers ?? 1).toBe(0);
    expect(enemyAt(w, id)?.x ?? 99).toBeLessThan(maxX);
    destroyWorld(w);
  });

  it("a knocked enemy passes momentum to the enemy it runs into", () => {
    const nova = { kind: "nova", damage: 1, cooldownTicks: 200, range: 2.2, count: 1, speed: 0, pierce: 0, knockback: 10, maxLevel: 8 };
    const w = createWorld(withWeapon(nova));
    addPlayer(w, 1, [0, 1, 0]);
    const front = spawnEnemy(w, 1, 2, 0);
    // Outside the nova, directly behind the front enemy.
    const back = spawnEnemy(w, 1, 3.1, 0);
    const before = enemyAt(w, back)?.x ?? 0;
    let maxBack = before;
    let backStaggered = false;
    for (let t = 0; t < 12; t++) {
      step(w, new Map());
      const b = enemyAt(w, back);
      maxBack = Math.max(maxBack, b?.x ?? 0);
      if ((b?.timers ?? 0) > 0) backStaggered = true;
    }
    expect(enemyAt(w, front)).toBeDefined();
    expect(backStaggered).toBe(true);
    expect(maxBack).toBeGreaterThan(before + 0.3);
    destroyWorld(w);
  });

  it("heavy enemies (mass) barely move and are not staggered by a light hit", () => {
    const nova = { kind: "nova", damage: 1, cooldownTicks: 200, range: 4, count: 1, speed: 0, pierce: 0, knockback: 6, maxLevel: 8 };
    const w = createWorld(withWeapon(nova));
    addPlayer(w, 1, [0, 1, 0]);
    // The boss type has mass 20: 6 / 20 = 0.3 m/s, below the stagger floor.
    const boss = spawnEnemy(w, 2, 3.5, 0);
    step(w, new Map());
    expect(enemyAt(w, boss)?.timers ?? 1).toBe(0);
    destroyWorld(w);
  });

  it("bolts stop at pillars (swept, so they never tunnel) and hit enemies in the open", () => {
    const bolt = { kind: "bolt", damage: 50, cooldownTicks: 10, range: 20, count: 1, speed: 60, pierce: 0, knockback: 0, maxLevel: 8 };
    const pillar = { x: 5, z: 0, radius: 0.5, height: 4 };
    const blocked = createWorld(withWeapon(bolt, { arena: { pillars: [pillar] } }));
    addPlayer(blocked, 1, [0, 1, 0]);
    const hidden = spawnEnemy(blocked, 0, 10, 0);
    for (let t = 0; t < 60; t++) step(blocked, new Map());
    expect(enemyAt(blocked, hidden)).toBeDefined();
    expect(captureState(blocked).entities.find((e) => e.netId === hidden)?.health).toBe(10);
    destroyWorld(blocked);

    const open = createWorld(withWeapon(bolt));
    addPlayer(open, 1, [0, 1, 0]);
    const exposed = spawnEnemy(open, 0, 10, 0);
    let killed = false;
    for (let t = 0; t < 60 && !killed; t++) killed = step(open, new Map()).events.some((e) => e.type === "enemy.killed" && e.netId === exposed);
    expect(killed).toBe(true);
    expect(captureState(open).entities.some((e) => e.kind === EntityKind.Player)).toBe(true);
    destroyWorld(open);
  });

  it("segmentCircle finds the first crossing and ignores starts inside", () => {
    expect(segmentCircle(0, 0, 10, 0, 5, 0, 1)).toBeCloseTo(0.4, 6);
    expect(segmentCircle(0, 0, 10, 0, 5, 3, 1)).toBe(-1);
    expect(segmentCircle(5, 0, 10, 0, 5, 0, 1)).toBe(-1);
    expect(segmentCircle(0, 0, 3, 0, 5, 0, 1)).toBe(-1);
  });
});
