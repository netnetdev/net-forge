import { beforeAll, describe, expect, it } from "vitest";
import {
  INPUT_BYTES,
  addPlayer,
  applyState,
  captureState,
  createWorld,
  decodeInput,
  decodeInputs,
  decodeSnapshot,
  encodeInput,
  encodeInputs,
  encodeSnapshot,
  initSim,
  quantizeInput,
  snapshotBaseTick,
  step,
} from "../src/index.js";
import type { SimConfig } from "../src/index.js";
import { equalBytes, scriptedInputs } from "./helpers.js";

const CONFIG: SimConfig = { seed: 9, enemies: { target: 400, spawnPerTick: 40 } };

describe("snapshots", () => {
  beforeAll(async () => {
    await initSim();
  });

  it("full snapshot round-trips: decode(encode(s)) deep-equals s", () => {
    const w = createWorld(CONFIG);
    addPlayer(w, 1);
    const input = scriptedInputs([1], 11);
    for (let t = 0; t < 120; t++) step(w, input(w.tick));
    const s = captureState(w);
    const bytes = encodeSnapshot(s);
    expect(decodeSnapshot(bytes)).toEqual(s);
    expect(snapshotBaseTick(bytes)).toBeNull();
  });

  it("apply → capture is lossless and the restored world steps identically", () => {
    const a = createWorld(CONFIG);
    addPlayer(a, 1);
    addPlayer(a, 2, [-6, 1, 3]);
    const input = scriptedInputs([1, 2], 5);
    for (let t = 0; t < 200; t++) step(a, input(a.tick));
    const snap = encodeSnapshot(captureState(a));

    const b = createWorld(CONFIG);
    applyState(b, decodeSnapshot(snap));
    expect(equalBytes(encodeSnapshot(captureState(b)), snap)).toBe(true);
    expect(b.tick).toBe(a.tick);

    for (let t = 0; t < 300; t++) {
      const i = input(a.tick);
      step(a, i);
      step(b, i);
    }
    expect(equalBytes(encodeSnapshot(captureState(a)), encodeSnapshot(captureState(b)))).toBe(true);
  });

  it("delta snapshots decode against their baseline and are smaller", () => {
    const w = createWorld(CONFIG);
    addPlayer(w, 1);
    const input = scriptedInputs([1], 2);
    for (let t = 0; t < 90; t++) step(w, input(w.tick));
    const base = captureState(w);
    step(w, input(w.tick));
    step(w, input(w.tick));
    const cur = captureState(w);
    const full = encodeSnapshot(cur);
    const delta = encodeSnapshot(cur, base);
    expect(snapshotBaseTick(delta)).toBe(base.tick);
    expect(decodeSnapshot(delta, base)).toEqual(cur);
    expect(delta.length).toBeLessThan(full.length);
    expect(() => decodeSnapshot(delta)).toThrow(/baseline/);
    expect(() => decodeSnapshot(delta, cur)).toThrow(/against tick/);
    // Unchanged state deltas to (nearly) nothing.
    expect(encodeSnapshot(cur, cur).length).toBeLessThanOrEqual(20);
  });

  it("interest filter drops entities and the delta carries their removal", () => {
    const w = createWorld(CONFIG);
    addPlayer(w, 1);
    for (let t = 0; t < 60; t++) step(w, new Map());
    const all = captureState(w);
    const near = captureState(w, (e) => e.kind === 1 || Math.hypot(e.px, e.pz) / 1024 < 28);
    expect(near.entities.length).toBeLessThan(all.entities.length);
    const decoded = decodeSnapshot(encodeSnapshot(near, all), all);
    expect(decoded).toEqual(near);
  });

  it("rejects garbage", () => {
    expect(() => decodeSnapshot(new Uint8Array([1, 2, 3, 4]))).toThrow(/not a snapshot/);
    const good = encodeSnapshot({ tick: 1, rng: 1, nextNetId: 1, kills: 0, entities: [] });
    expect(() => decodeSnapshot(good.subarray(0, good.length - 1))).toThrow();
  });
});

describe("input commands", () => {
  it("encode/decode returns the quantized command", () => {
    const cmd = { seq: 123456, tick: 99, moveX: 0.3333, moveZ: -1.7, yaw: -0.5, buttons: 0x1_0013 };
    const bytes = encodeInput(cmd);
    expect(bytes.length).toBe(INPUT_BYTES);
    expect(decodeInput(bytes)).toEqual(quantizeInput(cmd));
    expect(quantizeInput(quantizeInput(cmd))).toEqual(quantizeInput(cmd));
    expect(decodeInput(bytes).moveZ).toBe(-1);
    expect(decodeInput(bytes).buttons).toBe(0x13);
  });

  it("batches round-trip", () => {
    const cmds = [1, 2, 3].map((n) => quantizeInput({ seq: n, tick: n, moveX: 0, moveZ: 1, yaw: n, buttons: n }));
    expect(decodeInputs(encodeInputs(cmds))).toEqual(cmds);
  });

  it("non-finite input is neutralised", () => {
    const q = quantizeInput({ seq: Number.NaN, tick: 1, moveX: Number.NaN, moveZ: Infinity, yaw: Number.NaN, buttons: 0 });
    expect(q).toEqual({ seq: 0, tick: 1, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 });
  });
});
