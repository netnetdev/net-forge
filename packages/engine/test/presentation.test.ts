// The shared presentation helpers: SoundPlayer (samples and music), the
// camera's ground clamp, and HeroHighlight (outline and rim on one character).
import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera } from "three/webgpu";
import { boundsShift, CameraRig, fieldBounds, groundFootprint } from "../src/runtime/camera.js";
import { FeelAudio } from "../src/runtime/feel/audio.js";
import { SoundPlayer } from "../src/runtime/feel/sound.js";
import type { MusicElement } from "../src/runtime/feel/sound.js";
import { HeroHighlight } from "../src/runtime/render/highlight.js";

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
    decodeAudioData: async (b: ArrayBuffer) => {
      if (b.byteLength === 0) throw new Error("cannot decode");
      return { duration: 0.2 } as AudioBuffer;
    },
    resume: () => Promise.resolve(),
  };
  return ctx as unknown as AudioContext;
}
class FakeMusic implements MusicElement {
  src = "";
  loop = false;
  volume = 1;
  muted = false;
  preload = "";
  paused = true;
  plays = 0;
  play(): void {
    this.paused = false;
    this.plays++;
  }
  pause(): void {
    this.paused = true;
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("SoundPlayer", () => {
  it("loads samples once audio unlocks, keeps the synth for any that fail, and starts the music loop", async () => {
    const audio = new FeelAudio({ context: fakeContext });
    const music = new FakeMusic();
    const p = new SoundPlayer(audio, { key: null, fadeIn: 0, createMusic: () => music, fetchBytes: async (u) => new ArrayBuffer(u.includes("bad") ? 0 : 8) });
    p.load({ cues: { hit: { url: "lib/hit.ogg", gain: 0.5 }, kill: { url: "lib/bad.ogg" } }, music: { url: "lib/loop.mp3", gain: 0.5 } });
    expect(p.loaded.cues).toBe(0);
    expect(music.plays).toBe(0);
    audio.unlock();
    await flush();
    await flush();
    expect(p.loaded).toEqual({ cues: 1, failed: 1, music: true });
    expect(music.src).toBe("lib/loop.mp3");
    expect(music.loop).toBe(true);
    expect(music.volume).toBeCloseTo(0.4 * 0.5);
    expect(p.musicPlaying).toBe(true);
    expect(audio.play("hit")).toBe(true);
    expect(audio.play("kill")).toBe(true);
  });

  it("the mute silences effects and music, flips back, and reports its state", async () => {
    const audio = new FeelAudio({ context: fakeContext });
    const music = new FakeMusic();
    const p = new SoundPlayer(audio, { key: null, fadeIn: 0, createMusic: () => music, fetchBytes: async () => new ArrayBuffer(8) });
    p.load({ cues: {}, music: { url: "m.mp3" } });
    audio.unlock();
    expect(p.muted).toBe(false);
    expect(p.toggle()).toBe(true);
    expect(audio.muted).toBe(true);
    expect(music.muted).toBe(true);
    expect(music.paused).toBe(true);
    expect(audio.play("hit")).toBe(false);
    expect(p.toggle()).toBe(false);
    expect(music.paused).toBe(false);
    expect(audio.play("hit")).toBe(true);
    p.musicEnabled = false;
    expect(music.paused).toBe(true);
    expect(audio.play("kill")).toBe(true);
  });

  it("fades the music in", async () => {
    const audio = new FeelAudio({ context: fakeContext });
    const music = new FakeMusic();
    const p = new SoundPlayer(audio, { key: null, fadeIn: 0.2, createMusic: () => music });
    p.load({ cues: {}, music: { url: "m.mp3", gain: 1 } });
    audio.unlock();
    expect(music.volume).toBe(0);
    await new Promise((r) => setTimeout(r, 450));
    expect(music.volume).toBeCloseTo(0.4);
    p.dispose();
  });
});

describe("camera ground clamp", () => {
  it("measures the ground a tilted camera sees", () => {
    const cam = new PerspectiveCamera(50, 16 / 10, 0.1, 500);
    cam.position.set(0, 20, 12);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const fp = groundFootprint(cam);
    expect(fp.minX).toBeLessThan(-5);
    expect(fp.maxX).toBeGreaterThan(5);
    // Looking down -z from +z: the far edge is further out than the near edge.
    expect(-fp.minZ).toBeGreaterThan(fp.maxZ - 12);
    expect(fp.maxZ).toBeGreaterThan(0);
  });

  it("shifts only by the overshoot, and centres a view wider than the bounds", () => {
    const b = fieldBounds(10);
    expect(boundsShift({ minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, b)).toEqual({ x: 0, z: 0 });
    expect(boundsShift({ minX: 2, maxX: 14, minZ: -12, maxZ: 0 }, b)).toEqual({ x: -4, z: 2 });
    expect(boundsShift({ minX: -30, maxX: 10, minZ: 0, maxZ: 1 }, b).x).toBe(10);
  });

  it("a rig with bounds never shows ground past them, and follows freely in the middle", () => {
    const rig = new CameraRig(16 / 10, { distance: 21, height: 0.5, fov: 50, follow: 1000, lead: 0, bounds: fieldBounds(75, 6) });
    rig.pitch = 0.98;
    const at = (x: number, z: number) => {
      const t = { x, y: 0, z } as never;
      for (let i = 0; i < 30; i++) rig.update(t, 1 / 30);
      rig.camera.updateMatrixWorld();
      return groundFootprint(rig.camera);
    };
    const mid = at(0, 0);
    expect(rig.clampShift).toEqual({ x: 0, z: 0 });
    expect(mid.maxX).toBeLessThan(81);
    const corner = at(74, 74);
    expect(corner.maxX).toBeLessThanOrEqual(81 + 1e-6);
    expect(corner.maxZ).toBeLessThanOrEqual(81 + 1e-6);
    expect(rig.clampShift.x).toBeLessThan(0);
    const far = at(-74, -74);
    expect(far.minX).toBeGreaterThanOrEqual(-81 - 1e-6);
    expect(far.minZ).toBeGreaterThanOrEqual(-81 - 1e-6);
    rig.setBounds(null);
    at(74, 74);
    expect(rig.clampShift).toEqual({ x: 0, z: 0 });
  });
});

describe("HeroHighlight", () => {
  it("adds an outline hull and a rim shell per mesh, leaves the body's material alone, fades and disposes", () => {
    const root = new Group();
    root.scale.setScalar(0.5);
    const mat = new MeshStandardMaterial({ color: 0x336699 });
    const body = new Mesh(new BoxGeometry(1, 2, 1), mat);
    const hat = new Mesh(new BoxGeometry(1, 0.3, 1), mat);
    root.add(body, hat);
    const hl = new HeroHighlight(root, { outlineWidth: 0.04 });
    expect(hl.parts.length).toBe(4);
    expect(body.material).toBe(mat);
    expect(body.children.map((c) => c.name).sort()).toEqual(["HeroOutline", "HeroRim"]);
    hl.strength = 0;
    expect(hl.parts.filter((p) => p.name === "HeroOutline").every((p) => !p.visible)).toBe(true);
    hl.strength = 1;
    expect(hl.parts.every((p) => p.visible)).toBe(true);
    const onlyRim = new HeroHighlight(new Group().add(new Mesh(new BoxGeometry(), mat)), { outline: null });
    expect(onlyRim.parts.map((p) => p.name)).toEqual(["HeroRim"]);
    hl.dispose();
    expect(body.children.length).toBe(0);
  });
});
