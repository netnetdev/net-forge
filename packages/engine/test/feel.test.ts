import { describe, expect, it } from "vitest";
import { Vector3 } from "three/webgpu";
import { CameraRig } from "../src/runtime/camera.js";
import {
  CueGate,
  Ease,
  FeelAudio,
  FeelClock,
  FeelKit,
  Footsteps,
  HitFlash,
  KnockbackOffsets,
  NumberStack,
  RenderClock,
  Rumble,
  Spring,
  Trauma,
  Tweens,
  countUp,
  distanceGain,
  flashColor,
  pop,
  shakeEl,
} from "../src/runtime/feel/index.js";
import type { FeelElement, NavigatorLike, ParticleSink } from "../src/runtime/feel/index.js";

describe("Trauma", () => {
  it("decays to zero, stays bounded and is deterministic for a seed", () => {
    const run = () => {
      const t = new Trauma({ seed: 5, maxOffset: 0.5, maxRoll: 0.03 });
      t.add(0.8);
      t.add(0.8);
      expect(t.value).toBe(1);
      const xs: number[] = [];
      for (let i = 0; i < 120; i++) {
        t.update(1 / 60);
        expect(Math.abs(t.x)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(t.y)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(t.roll)).toBeLessThanOrEqual(0.03);
        xs.push(t.x);
      }
      return { xs, t };
    };
    const a = run();
    const b = run();
    expect(a.xs).toEqual(b.xs);
    expect(a.xs.some((x) => x !== 0)).toBe(true);
    expect(a.t.value).toBe(0);
    expect(a.t.x).toBe(0);
  });

  it("small trauma shakes far less than big (shake is trauma squared)", () => {
    const t = new Trauma();
    t.add(0.2);
    expect(t.shake).toBeCloseTo(0.04);
    t.add(0.8);
    expect(t.shake).toBe(1);
  });
});

describe("CameraRig", () => {
  it("keeps the classic shake(amplitude, seconds) working and settles with no drift", () => {
    const rig = new CameraRig(1, { distance: 10, follow: 8, lead: 0 });
    const target = new Vector3(0, 0, 0);
    for (let i = 0; i < 60; i++) rig.update(target, 1 / 60);
    const rest = rig.camera.position.clone();
    rig.shake(0.35, 0.18);
    let moved = 0;
    for (let i = 0; i < 12; i++) {
      rig.update(target, 1 / 60);
      moved = Math.max(moved, rig.camera.position.distanceTo(rest));
    }
    expect(moved).toBeGreaterThan(0.01);
    expect(moved).toBeLessThan(1);
    for (let i = 0; i < 120; i++) rig.update(target, 1 / 60);
    expect(rig.camera.position.distanceTo(rest)).toBeLessThan(1e-4);
    expect(rig.offset.length()).toBe(0);
  });

  it("clamps the lead and smooths it", () => {
    const rig = new CameraRig(1, { lead: 1, leadMax: 2, leadSmoothing: 0, follow: 1000, height: 0 });
    const target = new Vector3();
    rig.update(target, 1 / 60);
    // A teleport-like jump: 30 m in one frame is 1800 m/s.
    target.set(30, 0, 0);
    rig.update(target, 1 / 60);
    for (let i = 0; i < 10; i++) {
      target.x += 0.5;
      rig.update(target, 1 / 60);
    }
    expect(rig.target.x - target.x).toBeLessThanOrEqual(2.0001);
    expect(rig.target.x - target.x).toBeGreaterThan(1.5);
  });

  it("follow is critically damped: it never overshoots", () => {
    const rig = new CameraRig(1, { lead: 0, follow: 12, height: 0 });
    const target = new Vector3();
    rig.update(target, 1 / 60);
    target.set(5, 0, 0);
    let max = 0;
    for (let i = 0; i < 240; i++) {
      rig.update(target, 1 / 60);
      max = Math.max(max, rig.target.x);
    }
    expect(max).toBeLessThanOrEqual(5 + 1e-6);
    expect(rig.target.x).toBeCloseTo(5, 3);
  });

  it("punch kicks the FOV and springs back", () => {
    const rig = new CameraRig(1, { fov: 50 });
    const target = new Vector3();
    rig.update(target, 1 / 60);
    rig.punch(4);
    rig.update(target, 1 / 60);
    expect(rig.camera.fov).toBeGreaterThan(52);
    for (let i = 0; i < 180; i++) rig.update(target, 1 / 60);
    expect(rig.camera.fov).toBeCloseTo(50, 2);
  });

  it("dead zone holds the camera for small moves", () => {
    const rig = new CameraRig(1, { lead: 0, deadZone: 1, height: 0 });
    const target = new Vector3();
    rig.update(target, 1 / 60);
    target.set(0.8, 0, 0);
    for (let i = 0; i < 60; i++) rig.update(target, 1 / 60);
    expect(rig.target.x).toBeCloseTo(0, 6);
    target.set(3, 0, 0);
    for (let i = 0; i < 240; i++) rig.update(target, 1 / 60);
    expect(rig.target.x).toBeCloseTo(2, 2);
  });
});

describe("FeelClock", () => {
  it("hit-stop freezes dt, then catches up without running ahead of real time", () => {
    const c = new FeelClock();
    let t = 1000;
    c.tick(t);
    c.hitStop(50, t);
    let drawnTotal = 0;
    let realTotal = 0;
    for (let i = 0; i < 60; i++) {
      t += 1000 / 60;
      realTotal += 1000 / 60;
      const r = c.tick(t);
      if (i < 2) expect(r.dt).toBe(0);
      expect(r.now).toBeLessThanOrEqual(t);
      drawnTotal += r.dt * 1000;
    }
    expect(c.lagMs).toBe(0);
    expect(drawnTotal).toBeCloseTo(realTotal, 6);
  });

  it("longest stop wins, stops do not stack", () => {
    const c = new FeelClock();
    c.tick(0.001);
    c.hitStop(80, 0);
    c.hitStop(30, 0);
    c.hitStop(80, 0);
    let frozen = 0;
    // Frames ending at 10..70 ms are frozen; the frame ending at 80 is the first to move again.
    for (let t = 10; t <= 200; t += 10) if (c.tick(t).dt === 0) frozen += 10;
    expect(frozen).toBe(70);
    expect(c.stops).toBe(3);
  });

  it("slowMo scales dt then eases back", () => {
    const c = new FeelClock({ maxLagMs: 10_000 });
    c.tick(1);
    c.slowMo(0.25, 100, 100, 1);
    const r = c.tick(17);
    expect(r.timeScale).toBeCloseTo(0.25, 5);
    let t = 17;
    for (let i = 0; i < 100; i++) c.tick((t += 16));
    expect(c.lagMs).toBe(0);
  });

  it("RenderClock is the same clock (template compatibility)", () => {
    const c = new RenderClock();
    c.tick(1);
    c.hitStop(55, 1);
    expect(c.stopped).toBe(true);
  });
});

describe("HitFlash and KnockbackOffsets", () => {
  it("flashes decay and prune", () => {
    const f = new HitFlash(0.1);
    f.trigger(7);
    expect(f.value(7)).toBe(1);
    f.update(0.05);
    expect(f.value(7)).toBeCloseTo(0.5);
    f.update(0.06);
    expect(f.value(7)).toBe(0);
    expect(f.size).toBe(0);
    const out = new Float32Array(3);
    flashColor(out, 0, 1, [0.2, 0.2, 0.2], [1, 1, 1], 2);
    expect(out[0]).toBeCloseTo(3);
  });

  it("knockback offsets kick along the direction, stay bounded and settle", () => {
    const k = new KnockbackOffsets({ maxOffset: 0.5 });
    k.kick(3, 1, 0, 1);
    let peak = 0;
    for (let i = 0; i < 20; i++) {
      k.update(1 / 60);
      const s = k.get(3);
      peak = Math.max(peak, s.x);
      expect(Math.hypot(s.x, s.z)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
    expect(peak).toBeGreaterThan(0.1);
    for (let i = 0; i < 300; i++) k.update(1 / 60);
    expect(k.size).toBe(0);
    expect(k.get(3).sy).toBe(1);
  });

  it("springs converge (critical) and wobble (under-damped)", () => {
    const s = new Spring(0, { frequency: 3, damping: 1 });
    s.target = 1;
    let over = 0;
    for (let i = 0; i < 240; i++) over = Math.max(over, s.step(1 / 60));
    expect(over).toBeLessThanOrEqual(1 + 1e-9);
    expect(s.settled()).toBe(true);
    const w = new Spring(0, { frequency: 3, damping: 0.3 });
    w.target = 1;
    let peak = 0;
    for (let i = 0; i < 60; i++) peak = Math.max(peak, w.step(1 / 60));
    expect(peak).toBeGreaterThan(1.2);
  });
});

describe("Tweens", () => {
  it("easings start at 0 and end at 1", () => {
    for (const [name, fn] of Object.entries(Ease)) {
      expect(fn(0), name).toBeCloseTo(0, 6);
      expect(fn(1), name).toBeCloseTo(1, 6);
    }
  });

  it("tweens to the end, honours delay, yoyo, repeat and cancel", () => {
    const tw = new Tweens();
    const o = { a: 0, b: 10 };
    let done = 0;
    tw.to(o, { a: 1 }, { duration: 1, delay: 0.5, ease: "linear", onDone: () => done++ });
    tw.tick(0.5);
    expect(o.a).toBe(0);
    tw.tick(0.5);
    expect(o.a).toBeCloseTo(0.5);
    tw.tick(0.6);
    expect(o.a).toBe(1);
    expect(done).toBe(1);

    tw.to(o, { b: 20 }, { duration: 1, yoyo: true, ease: "linear" });
    tw.tick(1);
    expect(o.b).toBeCloseTo(20);
    tw.tick(0.5);
    expect(o.b).toBeCloseTo(15);
    tw.tick(1);
    expect(o.b).toBe(10);
    expect(tw.active).toBe(0);

    const r = { v: 0 };
    let n = 0;
    tw.to(r, { v: 1 }, { duration: 1, repeat: 2, ease: "linear", onDone: () => n++ });
    tw.tick(2.5);
    expect(r.v).toBeCloseTo(0.5);
    tw.tick(1);
    expect(r.v).toBe(1);
    expect(n).toBe(1);

    const c = { v: 0 };
    const h = tw.to(c, { v: 1 }, { duration: 1, ease: "linear" });
    tw.tick(0.25);
    tw.cancel(h);
    tw.tick(1);
    expect(c.v).toBeCloseTo(0.25);
  });

  it("DOM helpers drive style.scale, style.translate and text", () => {
    const tw = new Tweens();
    const el: FeelElement = { style: { scale: "", translate: "" }, textContent: "" };
    pop(el, 1.4, 200, tw);
    expect(el.style.scale).toBe("1.4");
    tw.tick(0.3);
    expect(Number(el.style.scale)).toBeCloseTo(1, 3);
    shakeEl(el, 8, 200, tw);
    tw.tick(0.05);
    expect(el.style.translate).toMatch(/px 0$/);
    tw.tick(0.3);
    expect(el.style.translate).toBe("");
    countUp(el, 0, 250, 300, (n) => `${Math.round(n)}`, tw);
    tw.tick(0.4);
    expect(el.textContent).toBe("250");
  });
});

describe("NumberStack", () => {
  it("merges rapid hits on the same id and caps what is on screen", () => {
    const s = new NumberStack(3, { mergeMs: 120 });
    const a = s.add(0, { id: 1, x: 10, y: 10, amount: 5 });
    const b = s.add(50, { id: 1, x: 12, y: 10, amount: 7 });
    expect(b.merged).toBe(true);
    expect(b.index).toBe(a.index);
    expect(s.slots[a.index]?.amount).toBe(12);
    const c = s.add(500, { id: 1, x: 12, y: 10, amount: 1 });
    expect(c.merged).toBe(false);
    s.add(600, { x: 0, y: 0, amount: 1 });
    s.update(0.1);
    // Full: the oldest is recycled.
    const e = s.add(700, { x: 0, y: 0, amount: 9 });
    expect(e.index).toBe(a.index);
    expect(s.active).toBe(3);
    expect(s.shown).toBe(4);
    expect(s.merged).toBe(1);
  });

  it("draws an arc that rises, pops then fades", () => {
    const s = new NumberStack(1);
    s.add(0, { x: 100, y: 100, amount: 3, big: true });
    const slot = s.slots[0];
    if (!slot) throw new Error("no slot");
    const d0 = s.draw(slot);
    expect(d0.scale).toBeGreaterThan(1.35);
    s.update(0.5);
    const d1 = s.draw(slot);
    expect(d1.y).toBeLessThan(100);
    expect(d1.opacity).toBeLessThan(1);
    s.update(1);
    expect(slot.active).toBe(false);
  });
});

class FakeParam {
  value = 0;
  setValueAtTime(): void {}
  exponentialRampToValueAtTime(): void {}
}
class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  Q = new FakeParam();
  pan = new FakeParam();
  playbackRate = new FakeParam();
  type = "";
  buffer: unknown = null;
  connect<T>(n: T): T {
    return n;
  }
  start(): void {}
  stop(): void {}
}
function fakeContext(): AudioContext {
  const ctx = {
    currentTime: 0,
    sampleRate: 8000,
    state: "running",
    destination: new FakeNode(),
    createGain: () => new FakeNode(),
    createOscillator: () => new FakeNode(),
    createStereoPanner: () => new FakeNode(),
    createBufferSource: () => new FakeNode(),
    createBiquadFilter: () => new FakeNode(),
    createBuffer: (_c: number, len: number) => ({ duration: len / 8000, getChannelData: () => new Float32Array(len) }),
    resume: () => Promise.resolve(),
  };
  return ctx as unknown as AudioContext;
}

describe("FeelAudio", () => {
  it("gates cues by gap, per-cue voices and global voices", () => {
    const g = new CueGate(2);
    expect(g.allow("hit", 0, 100, 40, 2)).toBe(true);
    expect(g.allow("hit", 10, 100, 40, 2)).toBe(false);
    expect(g.allow("hit", 50, 100, 40, 2)).toBe(true);
    expect(g.allow("kill", 60, 100, 0, 2)).toBe(false);
    expect(g.allow("kill", 160, 100, 0, 2)).toBe(true);
  });

  it("is silent until unlocked, then plays, throttles, mutes", () => {
    let now = 0;
    const a = new FeelAudio({ context: fakeContext, now: () => now });
    expect(a.play("hit")).toBe(false);
    a.unlock();
    expect(a.play("hit", { screenX: 100, width: 400 })).toBe(true);
    expect(a.play("hit")).toBe(false);
    now = 100;
    expect(a.play("hit", { distance: 10 })).toBe(true);
    expect(a.play("kill", { distance: 100 })).toBe(false);
    expect(a.impact(500)).toBe(true);
    a.muted = true;
    now = 1000;
    expect(a.play("hit")).toBe(false);
    expect(a.played).toBe(3);
    expect(distanceGain(3)).toBe(1);
    expect(distanceGain(12)).toBeCloseTo(0.5);
  });

  it("footsteps follow speed with alternating pitch", () => {
    const steps: number[] = [];
    const f = new Footsteps((p) => steps.push(p), { stride: 1 });
    for (let i = 0; i < 60; i++) f.update(1 / 60, 3);
    expect(steps.length).toBe(3);
    expect(steps[0]).not.toBe(steps[1]);
    for (let i = 0; i < 60; i++) f.update(1 / 60, 0.1);
    expect(steps.length).toBe(3);
  });
});

describe("Rumble", () => {
  it("rumbles pads, rate-limits, lets a stronger pulse cut in, falls back to vibrate", () => {
    let now = 0;
    const effects: number[] = [];
    const nav: NavigatorLike = {
      getGamepads: () => [{ connected: true, vibrationActuator: { playEffect: (_t, p) => (effects.push(p.strongMagnitude), Promise.resolve()) } }, null],
    };
    const r = new Rumble({ navigator: nav, now: () => now, minGapMs: 70 });
    expect(r.pulse(0.3)).toBe(true);
    now = 10;
    expect(r.pulse(0.3)).toBe(false);
    expect(r.pulse(0.9)).toBe(true);
    now = 100;
    expect(r.pulse(0.3)).toBe(true);
    expect(effects).toEqual([0.3, 0.9, 0.3]);
    r.enabled = false;
    now = 1000;
    expect(r.pulse(1)).toBe(false);

    const vib: number[] = [];
    const phone = new Rumble({ navigator: { vibrate: (p) => (vib.push(Number(p)), true) }, now: () => now });
    expect(phone.pulse(0.6, 0.3, 100)).toBe(true);
    expect(vib.length).toBe(1);
  });
});

describe("FeelKit", () => {
  it("routes one-liners to camera, clock, flash, particles and counters", () => {
    const traumas: number[] = [];
    const punches: number[] = [];
    const bursts: string[] = [];
    const particles: ParticleSink = { burst: (p) => bursts.push(p) };
    const feel = new FeelKit({
      camera: { addTrauma: (a) => traumas.push(a), punch: (d) => punches.push(d) },
      particles,
      project: (x) => ({ x: x * 10, y: 0, onScreen: true }),
      numbers: null,
      audio: null,
      rumble: null,
    });
    feel.tick(1000);
    for (let i = 0; i < 50; i++) feel.hit({ id: i, x: 1, y: 0, z: 0, amount: 5, dirX: 1, dirZ: 0 });
    // Fifty hits in one frame are one capped kick.
    expect(traumas.reduce((a, b) => a + b, 0)).toBeCloseTo(feel.preset.hitTraumaPerFrame, 6);
    expect(feel.flash.value(3)).toBe(1);
    feel.kill({ x: 0, y: 0, z: 0, big: true });
    expect(bursts).toEqual(["bigKill"]);
    expect(punches.length).toBe(1);
    expect(feel.clock.stops).toBe(1);
    feel.hurt(20, 100);
    expect(feel.hurtPulse).toBe(1);
    feel.update(1 / 60);
    expect(feel.hurtPulse).toBeLessThan(1);
    expect(feel.counts).toMatchObject({ hits: 50, kills: 1, bigKills: 1, hurts: 1 });
  });

  it("without a camera it shakes its own Trauma; presets differ", () => {
    const feel = new FeelKit({ preset: "heavy", numbers: null, audio: null, rumble: null });
    feel.hurt(10, 100);
    feel.update(1 / 60);
    expect(feel.trauma.value).toBeGreaterThan(0);
    const custom = new FeelKit({ preset: { base: "subtle", bigKillStopMs: 99 }, numbers: null, audio: null, rumble: null });
    expect(custom.preset.bigKillStopMs).toBe(99);
    expect(custom.preset.hitTrauma).toBe(0.01);
  });
});
