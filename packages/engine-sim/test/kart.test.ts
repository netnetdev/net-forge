import { describe, expect, it } from "vitest";
import {
  Button,
  KartFlag,
  addKart,
  applyKart,
  buildKartTrack,
  captureKart,
  createKartWorld,
  grantKartStat,
  kartCoinCount,
  kartProgress,
  kartStep,
  lateralOffset,
  nearestSample,
} from "../src/index.js";
import type { InputCommand, KartTrackDef, KartWorld } from "../src/index.js";

/** A 400 m rounded rectangle. */
const oval: KartTrackDef = {
  points: [[0, 0], [100, 0], [140, 20], [150, 60], [140, 100], [100, 120], [0, 120], [-40, 100], [-50, 60], [-40, 20]],
  width: 14,
  laps: 2,
  boosts: [[0.1, 0]],
  coins: [[0.05, 0], [0.06, 0], [0.07, 0]],
};

let seq = 0;
const cmd = (moveX: number, moveZ: number, buttons = 0): InputCommand => ({ seq: ++seq, tick: 0, moveX, moveZ, yaw: 0, buttons });

/** Drive the centreline: steer toward a point ahead (the bot's own idea, inlined so the sim is tested alone). */
function driver(w: KartWorld, id: number, drift = false): InputCommand {
  const k = w.karts.get(id)!;
  const t = w.track;
  const i = (k.seg + 6) % t.count;
  const want = Math.atan2((t.z[i] ?? 0) - k.z, (t.x[i] ?? 0) - k.x);
  let d = want - k.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const steer = Math.max(-1, Math.min(1, d * 2.5));
  return cmd(steer, 1, drift && Math.abs(steer) > 0.4 ? Button.Sprint : 0);
}

const world = (authority = true) => createKartWorld({ tickRate: 60, tracks: [oval], statSteps: [0.1, 0.3, 0.25, 0.3, 1], authority });

describe("kart track", () => {
  it("samples a closed centreline about every 2 m and measures it", () => {
    const t = buildKartTrack(oval);
    expect(t.count).toBeGreaterThan(150);
    expect(t.length).toBeGreaterThan(380);
    expect(t.length).toBeLessThan(600);
    // A point 3 m to the right of sample 20 reads 3 m off the centreline there.
    const px = (t.x[20] ?? 0) - (t.tz[20] ?? 0) * 3;
    const pz = (t.z[20] ?? 0) + (t.tx[20] ?? 0) * 3;
    const i = nearestSample(t, px, pz);
    expect(lateralOffset(t, i, px, pz)).toBeCloseTo(3, 0);
    expect(t.grid.length).toBe(12);
  });
});

describe("kart physics", () => {
  it("accelerates to about top speed on a straight and coasts down", () => {
    const w = world();
    const k = addKart(w, 1, { slot: 0 });
    k.x = 0;
    k.z = 0;
    k.yaw = 0;
    k.seg = 0;
    for (let i = 0; i < 180; i++) kartStep(w, new Map([[1, cmd(0, 1)]]));
    const v = Math.hypot(k.vx, k.vz);
    expect(v).toBeGreaterThan(20);
    expect(v).toBeLessThanOrEqual(26.01);
    for (let i = 0; i < 120; i++) kartStep(w, new Map([[1, cmd(0, 0)]]));
    expect(Math.hypot(k.vx, k.vz)).toBeLessThan(v);
  });

  it("laps count only in order, and the race finishes after the laps", () => {
    const w = world();
    addKart(w, 1, { slot: 0 });
    const laps: number[] = [];
    let finished = 0;
    for (let i = 0; i < 60 * 70 && !finished; i++) {
      for (const e of kartStep(w, new Map([[1, driver(w, 1)]]))) {
        if (e.type === "lap") laps.push(e.lap);
        if (e.type === "finish") finished = e.tick;
      }
    }
    expect(laps).toEqual([1, 2]);
    expect(finished).toBeGreaterThan(0);
    const k = w.karts.get(1)!;
    expect(k.flags & KartFlag.Finished).toBeTruthy();
    expect(kartProgress(w, k)).toBe(2);
    expect(kartCoinCount(k)).toBe(3);
  });

  it("a held drift through a bend charges a mini-turbo that fires on release", () => {
    for (const [hold, tier] of [[25, 1], [50, 2], [90, 3]] as const) {
      const w = createKartWorld({ tickRate: 60, tracks: [{ ...oval, width: 400 }], authority: true });
      const k = addKart(w, 1, { slot: 0 });
      for (let i = 0; i < 90; i++) kartStep(w, new Map([[1, cmd(0, 1)]]));
      const tiers: number[] = [];
      for (let i = 0; i < hold; i++) for (const e of kartStep(w, new Map([[1, cmd(1, 1, Button.Sprint)]]))) if (e.type === "turbo") tiers.push(e.tier);
      expect(k.flags & KartFlag.Drifting).toBeTruthy();
      for (const e of kartStep(w, new Map([[1, cmd(0, 1)]]))) if (e.type === "turbo") tiers.push(e.tier);
      expect(tiers).toEqual([tier]);
      expect(k.boost).toBeGreaterThan(0);
    }
  });

  it("the boost pad boosts and walls hold the kart on the track", () => {
    const w = world();
    const k = addKart(w, 1, { slot: 0 });
    let pad = false;
    let wall = false;
    for (let i = 0; i < 60 * 12; i++) {
      // Steer hard right for a while: into the wall.
      const c = i < 300 ? driver(w, 1) : cmd(1, 1);
      for (const e of kartStep(w, new Map([[1, c]]))) {
        if (e.type === "pad") pad = true;
        if (e.type === "wall") wall = true;
      }
      expect(Math.abs(lateralOffset(w.track, k.seg, k.x, k.z))).toBeLessThanOrEqual(w.track.wall + 0.01);
    }
    expect(pad).toBe(true);
    expect(wall).toBe(true);
  });

  it("moving karts bump apart on the authority and pass through on a predicting client", () => {
    for (const authority of [true, false]) {
      const w = world(authority);
      const a = addKart(w, 1, { slot: 0 });
      const b = addKart(w, 2, { slot: 1 });
      b.x = a.x + 0.5;
      b.z = a.z;
      a.vx = b.vx = 8;
      kartStep(w, new Map());
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (authority) expect(d).toBeGreaterThanOrEqual(1.79);
      else expect(d).toBeLessThan(1);
    }
  });

  it("every grid slot faces down the first straight: throttle alone off the line stays on the asphalt", () => {
    for (let slot = 0; slot < 12; slot++) {
      const w = world();
      const k = addKart(w, 1, { slot });
      for (let i = 0; i < 60 * 3; i++) {
        kartStep(w, new Map([[1, cmd(0, 1)]]));
        expect(Math.abs(lateralOffset(w.track, k.seg, k.x, k.z)), `slot ${slot} tick ${i}`).toBeLessThanOrEqual(w.track.half);
      }
      expect(w.track.dist[k.seg] ?? 0).toBeGreaterThan(15);
    }
  });

  it("a parked kart is passed through, never launched: the field leaving the grid does not shove someone still on it", () => {
    const w = world();
    const parked = addKart(w, 1, { slot: 0 });
    const x0 = parked.x;
    const z0 = parked.z;
    for (let slot = 1; slot <= 5; slot++) addKart(w, 10 + slot, { slot, bot: true });
    for (let i = 0; i < 60 * 4; i++) {
      const inputs = new Map<number, InputCommand>();
      for (const id of w.karts.keys()) if (id !== 1) inputs.set(id, driver(w, id));
      kartStep(w, inputs);
    }
    expect(Math.hypot(parked.vx, parked.vz)).toBe(0);
    expect(Math.hypot(parked.x - x0, parked.z - z0)).toBeLessThan(0.01);
    // The bots went past it and on round the track.
    for (const [id, k] of w.karts) if (id !== 1) expect(w.track.dist[k.seg] ?? 0).toBeGreaterThan(40);
  });

  it("a shallow scrape slides along the wall instead of grinding to a crawl; a square hit still holds the kart", () => {
    const w = world();
    const k = addKart(w, 1, { slot: 0 });
    // On the first straight (along +x, the right wall at z = wall), just inside the wall and facing a little into it.
    k.x = 20;
    k.z = w.track.wall - 0.6;
    k.yaw = 0.12;
    k.seg = nearestSample(w.track, k.x, k.z);
    for (let i = 0; i < 60 * 4; i++) {
      kartStep(w, new Map([[1, cmd(0, 1)]]));
      expect(Math.abs(lateralOffset(w.track, k.seg, k.x, k.z))).toBeLessThanOrEqual(w.track.wall + 0.01);
    }
    expect(Math.hypot(k.vx, k.vz)).toBeGreaterThan(8);
    expect(k.x).toBeGreaterThan(50);
    // Square on, the wall holds it.
    k.yaw = Math.PI / 2;
    for (let i = 0; i < 60 * 2; i++) kartStep(w, new Map([[1, cmd(0, 1)]]));
    expect(Math.hypot(k.vx, k.vz)).toBeLessThan(3);
  });

  it("upgrades raise top speed", () => {
    const w = world();
    const k = addKart(w, 1, { slot: 0 });
    expect(grantKartStat(w, 1, "speed")).toBe(true);
    k.x = 0;
    k.z = 0;
    k.yaw = 0;
    k.seg = 0;
    for (let i = 0; i < 300; i++) kartStep(w, new Map([[1, cmd(0, 1)]]));
    expect(Math.hypot(k.vx, k.vz)).toBeGreaterThan(26.5);
  });

  it("capture/apply reproduces a kart exactly and both keep stepping identically (prediction replay)", () => {
    const a = world(false);
    const ka = addKart(a, 1, { slot: 0 });
    const inputs: InputCommand[] = [];
    for (let i = 0; i < 600; i++) {
      const c = driver(a, 1, i % 200 > 120);
      inputs.push(c);
      if (i < 300) kartStep(a, new Map([[1, c]]));
    }
    const b = world(false);
    applyKart(b, captureKart(a, ka));
    for (let i = 300; i < 600; i++) {
      kartStep(a, new Map([[1, inputs[i]!]]));
      kartStep(b, new Map([[1, inputs[i]!]]));
    }
    expect(captureKart(b, b.karts.get(1)!)).toEqual(captureKart(a, ka));
  });
});
