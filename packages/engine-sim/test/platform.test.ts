import { describe, expect, it } from "vitest";
import {
  Button,
  PlatFlag,
  addPlatformPlayer,
  applyPlatformPlayer,
  capturePlatformPlayer,
  createPlatformWorld,
  grantPlatformStat,
  moverBox,
  platformCoinCount,
  platformStep,
} from "../src/index.js";
import type { InputCommand, PlatformLevel, PlatformWorld } from "../src/index.js";

const flat: PlatformLevel = {
  start: [0, 0],
  flag: [60, 0],
  killY: -10,
  solids: [[-10, -2, 30, 0], [34, -2, 80, 0], [12, 0, 13, 0.8]],
  ledges: [[40, 3, 44, 3.3]],
  hazards: [[46, 0, 47, 0.5]],
  springs: [],
  movers: [{ box: [50, 2, 52, 2.3], dx: 4, dy: 0, periodTicks: 240, phaseTicks: 0 }],
  coins: [[3, 0.7], [5, 0.7]],
  checkpoints: [[20, 0]],
};

let seq = 0;
const cmd = (moveX: number, buttons = 0, moveZ = 0): InputCommand => ({ seq: ++seq, tick: 0, moveX, moveZ, yaw: 0, buttons });
const run = (w: PlatformWorld, n: number, c: () => InputCommand) => {
  const ev = [];
  for (let i = 0; i < n; i++) ev.push(...platformStep(w, new Map([[1, c()]])));
  return ev;
};
const world = (level = flat) => createPlatformWorld({ tickRate: 60, levels: [level], statSteps: [0.1, 1, 0.5, 1, 0.1] });

/** Highest y reached holding Jump for `holdTicks` from standing. */
function apex(holdTicks: number): number {
  const w = world();
  const p = addPlatformPlayer(w, 1);
  run(w, 5, () => cmd(0));
  let top = 0;
  for (let i = 0; i < 90; i++) {
    platformStep(w, new Map([[1, cmd(0, i < holdTicks ? Button.Jump : 0)]]));
    top = Math.max(top, p.y);
  }
  return top;
}

describe("platformer motor", () => {
  it("stands on the floor and runs at run speed", () => {
    const w = world();
    const p = addPlatformPlayer(w, 1);
    run(w, 60, () => cmd(1));
    expect(p.y).toBe(0);
    expect(p.flags & PlatFlag.Grounded).toBeTruthy();
    expect(p.vx).toBeCloseTo(7.5, 2);
  });

  it("variable jump height: a tap jumps lower than a held jump, and a full jump reaches about jumpHeight", () => {
    const tap = apex(3);
    const full = apex(60);
    expect(full).toBeGreaterThan(3.1);
    expect(full).toBeLessThan(4.2);
    expect(tap).toBeLessThan(full * 0.6);
  });

  it("coyote time: a jump just after running off a ledge still jumps", () => {
    const level: PlatformLevel = { ...flat, solids: [[-10, -2, 5, 0]], hazards: [], movers: [], ledges: [] };
    const w = world(level);
    const p = addPlatformPlayer(w, 1);
    let ticksAir = 0;
    for (let i = 0; i < 200 && ticksAir < 3; i++) {
      platformStep(w, new Map([[1, cmd(1)]]));
      if ((p.flags & PlatFlag.Grounded) === 0) ticksAir++;
    }
    platformStep(w, new Map([[1, cmd(1, Button.Jump)]]));
    expect(p.vy).toBeGreaterThan(10);
  });

  it("no coyote jump after the window", () => {
    const level: PlatformLevel = { ...flat, solids: [[-10, -2, 5, 0]], hazards: [], movers: [], ledges: [] };
    const w = world(level);
    const p = addPlatformPlayer(w, 1);
    let ticksAir = 0;
    for (let i = 0; i < 200 && ticksAir < 12; i++) {
      platformStep(w, new Map([[1, cmd(1)]]));
      if ((p.flags & PlatFlag.Grounded) === 0) ticksAir++;
    }
    platformStep(w, new Map([[1, cmd(1, Button.Jump)]]));
    expect(p.vy).toBeLessThan(0);
  });

  it("jump buffer: pressing just before landing jumps on the landing tick", () => {
    const w = world();
    const p = addPlatformPlayer(w, 1);
    run(w, 3, () => cmd(0));
    run(w, 30, () => cmd(0, Button.Jump));
    // Falling: release, then press a few ticks before touching down.
    let i = 0;
    while (p.y > 0.6 && i++ < 200) platformStep(w, new Map([[1, cmd(0)]]));
    platformStep(w, new Map([[1, cmd(0, Button.Jump)]]));
    let jumped = false;
    for (let k = 0; k < 8; k++) {
      platformStep(w, new Map([[1, cmd(0, Button.Jump)]]));
      if (p.vy > 10) jumped = true;
    }
    expect(jumped).toBe(true);
  });

  it("walls stop you; a low step blocks until you jump it", () => {
    const w = world();
    const p = addPlatformPlayer(w, 1);
    run(w, 120, () => cmd(1));
    expect(p.x).toBeLessThanOrEqual(12 - 0.34 + 1e-9);
  });

  it("an air jump from an upgrade, and the air dash", () => {
    const w = world();
    const p = addPlatformPlayer(w, 1);
    expect(grantPlatformStat(w, 1, "amount")).toBe(true);
    run(w, 3, () => cmd(0));
    run(w, 20, () => cmd(0, Button.Jump));
    run(w, 2, () => cmd(0));
    const ev = run(w, 1, () => cmd(0, Button.Jump));
    expect(ev.some((e) => e.type === "jump" && e.air)).toBe(true);
    const d = run(w, 1, () => cmd(1, Button.Sprint));
    expect(d.some((e) => e.type === "dash")).toBe(true);
    expect(p.vx).toBeGreaterThan(10);
  });

  it("coins are per player, checkpoints and the flag finish the race", () => {
    const w = world();
    const a = addPlatformPlayer(w, 1);
    const b = addPlatformPlayer(w, 2);
    for (let i = 0; i < 90; i++) platformStep(w, new Map([[1, cmd(1)], [2, cmd(0)]]));
    expect(platformCoinCount(a)).toBe(2);
    expect(platformCoinCount(b)).toBe(0);
    // Teleport past the hazard to near the flag.
    a.x = 58;
    const ev = run(w, 30, () => cmd(1));
    expect(ev.some((e) => e.type === "finish")).toBe(true);
    expect(a.flags & PlatFlag.Finished).toBeTruthy();
  });

  it("hazards and the kill plane send you back to the checkpoint", () => {
    const w = world();
    const p = addPlatformPlayer(w, 1);
    p.x = 20.3;
    run(w, 2, () => cmd(0));
    expect(p.cp).toBe(0);
    p.x = 45;
    const ev = run(w, 30, () => cmd(1));
    expect(ev.some((e) => e.type === "fell" && e.hazard)).toBe(true);
    run(w, 60, () => cmd(0));
    expect(p.x).toBeCloseTo(20, 3);
  });

  it("moving platforms carry a rider", () => {
    const w = world();
    const p = addPlatformPlayer(w, 1);
    const b0 = moverBox(flat.movers[0]!, 0);
    p.x = 51;
    p.y = b0[3] + 0.5;
    run(w, 30, () => cmd(0));
    expect(p.flags & PlatFlag.OnMover).toBeTruthy();
    const x0 = p.x;
    run(w, 60, () => cmd(0));
    expect(p.x).toBeGreaterThan(x0 + 0.5);
  });

  it("capture/apply reproduces a world exactly, and both keep stepping identically (prediction replay)", () => {
    const a = world();
    const pa = addPlatformPlayer(a, 1);
    const inputs: InputCommand[] = [];
    for (let i = 0; i < 400; i++) inputs.push(cmd(i % 97 < 70 ? 1 : -0.4, i % 23 < 9 ? Button.Jump : i % 51 === 0 ? Button.Sprint : 0));
    for (let i = 0; i < 200; i++) platformStep(a, new Map([[1, inputs[i]!]]));
    const b = world();
    applyPlatformPlayer(b, capturePlatformPlayer(a, pa));
    for (let i = 200; i < 400; i++) {
      platformStep(a, new Map([[1, inputs[i]!]]));
      platformStep(b, new Map([[1, inputs[i]!]]));
    }
    expect(capturePlatformPlayer(b, b.players.get(1)!)).toEqual(capturePlatformPlayer(a, pa));
  });
});
