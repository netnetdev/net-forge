import { describe, expect, it } from "vitest";
import { MeshStandardMaterial, Object3D, Vector3 } from "three/webgpu";
import {
  AnimatedCharacter,
  bakeVertexAnimation,
  buildSegmentRig,
  detectTier,
  DynamicResolution,
  GpuParticles,
  GroundDecals,
  GroundRings,
  LOOK_PRESETS,
  locomotionState,
  ParticleRing,
  PARTICLE_PRESETS,
  QualityManager,
  qualitySettings,
  resolveLook,
  snapToTexel,
} from "../src/runtime/render/index.js";

describe("quality tiers", () => {
  it("detects phones, weak machines and desktops", () => {
    expect(detectTier({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", hardwareConcurrency: 6, backend: "webgpu" })).toBe("medium");
    expect(detectTier({ coarsePointer: true, hardwareConcurrency: 4 })).toBe("low");
    expect(detectTier({ coarsePointer: true, hardwareConcurrency: 8, backend: "webgl2" })).toBe("low");
    expect(detectTier({ hardwareConcurrency: 10, backend: "webgpu" })).toBe("high");
    expect(detectTier({ hardwareConcurrency: 4, backend: "webgpu" })).toBe("medium");
    expect(detectTier({ hardwareConcurrency: 2 })).toBe("low");
    expect(detectTier({})).toBe("medium");
  });

  it("tier settings scale shadows, post and particles", () => {
    expect(qualitySettings("low").shadowMapSize).toBe(0);
    expect(qualitySettings("low").post).toBe(false);
    expect(qualitySettings("high").shadowMapSize).toBeGreaterThan(qualitySettings("medium").shadowMapSize);
    expect(qualitySettings("high").particles).toBeGreaterThan(qualitySettings("low").particles);
  });
});

describe("dynamic resolution", () => {
  it("steps down when p95 is over budget, waits out the hysteresis, then steps up", () => {
    const d = new DynamicResolution(2, { min: 0.75, max: 2 });
    let now = 0;
    for (let i = 0; i < 119; i++) d.push(25);
    expect(d.update((now += 3000))).toBeNull(); // not enough samples
    d.push(25);
    expect(d.update((now += 16))).toBe(1.75);
    for (let i = 0; i < 200; i++) d.push(25);
    expect(d.update(now + 500)).toBeNull(); // hysteresis
    expect(d.update((now += 2500))).toBe(1.5);
    for (let i = 0; i < 200; i++) d.push(10);
    expect(d.update((now += 2500))).toBe(1.75);
  });

  it("never leaves its range", () => {
    const d = new DynamicResolution(1, { min: 0.75, max: 1, minSamples: 1, hysteresisMs: 0, window: 4 });
    for (let k = 0; k < 10; k++) {
      d.push(40);
      d.update(k * 10);
    }
    expect(d.ratio).toBe(0.75);
    for (let k = 0; k < 10; k++) {
      d.push(5);
      d.update(1000 + k * 10);
    }
    expect(d.ratio).toBe(1);
  });

  it("QualityManager applies the ratio and tier caps", () => {
    const set: number[] = [];
    const q = new QualityManager({ setPixelRatio: (r) => set.push(r) }, "high", { devicePixelRatio: 3 });
    expect(q.pixelRatio).toBe(2);
    let tierSeen = "";
    q.onChange((s) => (tierSeen = s.tier));
    q.setTier("low");
    expect(tierSeen).toBe("low");
    expect(q.pixelRatio).toBe(1.25);
    expect(set[set.length - 1]).toBe(1.25);
  });
});

describe("shadow texel snapping", () => {
  it("snaps across the light plane and keeps depth along the light", () => {
    const dir: [number, number, number] = [-0.45, 0.85, 0.3];
    const texel = 0.05;
    const a = snapToTexel([1.012, 0, 3.337], dir, texel);
    const b = snapToTexel([1.013, 0, 3.338], dir, texel);
    const d = new Vector3(...dir).normalize();
    // Tiny moves inside one texel snap to the same light-space column (no shimmer):
    // the two results differ only along the light direction.
    const diff = new Vector3(...a).sub(new Vector3(...b));
    expect(diff.clone().sub(d.clone().multiplyScalar(diff.dot(d))).length()).toBeLessThan(1e-9);
    const orig = new Vector3(1.012, 0, 3.337);
    const snapped = new Vector3(...a);
    expect(snapped.dot(d)).toBeCloseTo(orig.dot(d), 9);
    expect(snapped.distanceTo(orig)).toBeLessThanOrEqual(texel);
    const off = snapToTexel([1, 2, 3], dir, 0);
    expect(off[0]).toBeCloseTo(1, 9);
    expect(off[1]).toBeCloseTo(2, 9);
    expect(off[2]).toBeCloseTo(3, 9);
  });
});

describe("look presets", () => {
  it("every preset resolves and unknown names fall back", () => {
    for (const p of LOOK_PRESETS) {
      const l = resolveLook(p);
      expect(l.lighting.sunIntensity).toBeGreaterThan(0);
      expect(l.atmosphere.far).toBeGreaterThan(l.atmosphere.near);
      expect(l.grade.bloomThreshold).toBeGreaterThan(0);
    }
    expect(resolveLook("nope")).toBe(resolveLook("studio"));
  });
});

describe("particle ring", () => {
  it("allocates in order, wraps, and reports merged dirty ranges", () => {
    const r = new ParticleRing(10);
    expect(r.alloc(4)).toEqual([0, 1, 2, 3]);
    expect(r.alloc(3)).toEqual([4, 5, 6]);
    expect(r.flush()).toEqual([[0, 7]]);
    expect(r.flush()).toEqual([]);
    expect(r.alloc(5)).toEqual([7, 8, 9, 0, 1]);
    expect(r.flush()).toEqual([
      [0, 2],
      [7, 3],
    ]);
    expect(r.alloc(25).length).toBe(10);
    expect(r.flush()).toEqual([[0, 10]]);
  });

  it("GpuParticles writes only burst slots and uploads only those ranges", () => {
    const parent = new Object3D();
    let seed = 1;
    const p = new GpuParticles(parent, { capacity: 64, random: () => ((seed = (seed * 16807) % 2147483647) / 2147483647) });
    expect(parent.children.length).toBe(2);
    p.update(1);
    p.burst("sparks", 1, 2, 3, { count: 5 });
    p.burst("kill", 0, 0, 0);
    p.burst("bigKill", 0, 0, 0);
    p.burst("unknown-preset", 0, 0, 0);
    expect(p.bursts).toBe(4);
    const add = p.meshes[0];
    expect(add).toBeDefined();
    p.update(1.1);
    // Every preset the feel kit uses exists.
    for (const name of ["sparks", "burst", "embers", "smoke", "hitSpark", "dust", "magic", "kill", "bigKill"]) {
      expect(PARTICLE_PRESETS[name as keyof typeof PARTICLE_PRESETS]).toBeDefined();
    }
  });
});

describe("decals and rings", () => {
  it("pool their slots in a ring", () => {
    const parent = new Object3D();
    const d = new GroundDecals(parent, 4, () => 0.5);
    for (let i = 0; i < 6; i++) d.add("scorch", i, 0);
    expect(d.ring.written).toBe(6);
    expect(d.ring.head).toBe(2);
    d.update(0.5);
    const rings = new GroundRings(parent, 3);
    rings.fire(0, 0, 4);
    rings.fire(1, 1, 2, { color: 0xff0000 });
    expect(rings.fired).toBe(2);
    rings.update(0.1);
    expect(parent.children.length).toBe(2);
  });
});

describe("animation", () => {
  it("locomotion state has hysteresis", () => {
    expect(locomotionState(0, "idle")).toBe("idle");
    expect(locomotionState(0.5, "idle")).toBe("idle");
    expect(locomotionState(0.7, "idle")).toBe("walk");
    expect(locomotionState(0.3, "walk")).toBe("walk");
    expect(locomotionState(0.1, "walk")).toBe("idle");
    expect(locomotionState(4.3, "walk")).toBe("run");
    expect(locomotionState(3.9, "run")).toBe("run");
    expect(locomotionState(3.5, "run")).toBe("walk");
    expect(locomotionState(9, "idle")).toBe("run");
  });

  it("AnimatedCharacter blends locomotion and returns from one-shots", () => {
    const rig = buildSegmentRig(new MeshStandardMaterial());
    const c = new AnimatedCharacter(rig.mesh, rig.clips);
    expect(c.playing).toBe("idle");
    c.setSpeed(2);
    expect(c.state).toBe("walk");
    expect(c.playing).toBe("walk");
    c.setSpeed(7);
    expect(c.playing).toBe("run");
    expect(c.oneShot("attack")).toBe(true);
    expect(c.playing).toBe("attack");
    for (let i = 0; i < 40; i++) c.update(1 / 30);
    expect(c.playing).toBe("run");
    expect(c.play("missing")).toBe(false);
  });

  it("bakes a VAT whose rest frame equals the bind pose", () => {
    const rig = buildSegmentRig(new MeshStandardMaterial(), { radialSegments: 6, heightSegments: 3 });
    const rest = rig.clips.find((c) => c.name === "rest");
    const walk = rig.clips.find((c) => c.name === "walk");
    if (!rest || !walk) throw new Error("clips missing");
    const count = rig.mesh.geometry.getAttribute("position").count;
    const vat = bakeVertexAnimation(rig.mesh, [rest, walk], { fps: 30, maxWidth: 16 });
    expect(vat.vertexCount).toBe(count);
    expect(vat.width).toBe(16);
    expect(vat.rowsPerFrame).toBe(Math.ceil(count / 16));
    expect(vat.clips.map((c) => [c.name, c.start, c.frames])).toEqual([
      ["rest", 0, 30],
      ["walk", 30, 24],
    ]);
    expect(vat.totalFrames).toBe(54);
    const img = vat.positions.image as { width: number; height: number; data: Float32Array };
    expect(img.width).toBe(16);
    expect(img.height).toBe(vat.rowsPerFrame * 54);
    const bind = rig.mesh.geometry.getAttribute("position");
    for (let i = 0; i < count; i++) {
      const o = (Math.floor(i / 16) * 16 + (i % 16)) * 4;
      expect(img.data[o]).toBeCloseTo(bind.getX(i), 5);
      expect(img.data[o + 1]).toBeCloseTo(bind.getY(i), 5);
      expect(img.data[o + 2]).toBeCloseTo(bind.getZ(i), 5);
    }
    // The walk clip actually moves vertices (the top swings).
    let moved = 0;
    const f = 30 + 6;
    for (let i = 0; i < count; i++) {
      const o = ((f * vat.rowsPerFrame + Math.floor(i / 16)) * 16 + (i % 16)) * 4;
      moved = Math.max(moved, Math.abs((img.data[o] ?? 0) - bind.getX(i)) + Math.abs((img.data[o + 2] ?? 0) - bind.getZ(i)));
    }
    expect(moved).toBeGreaterThan(0.01);
    expect(vat.normals).not.toBeNull();
  });
});
