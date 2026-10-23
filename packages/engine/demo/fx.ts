/**
 * The arena demo dressed with the render module (?fx=1): lighting with a
 * following shadow, sky and fog, bloom and grade, GPU particles on kills,
 * decals and shockwave rings on pulses, a skinned player (AnimatedCharacter
 * on the procedural rig) and an animated crowd: procedural vertex motion by
 * default, a baked VAT crowd with ?crowd=vat. ?outline=1 adds the toon edge.
 */
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from "three/webgpu";
import { EntityFlag, EntityKind, FixedStepper, addPlayer, createWorld, initSim, renderView, step } from "@netforge/engine-sim";
import type { SimEvent } from "@netforge/engine-sim";
import { CameraRig } from "../src/runtime/camera.js";
import { InputController } from "../src/runtime/input.js";
import { lerp, lerpAngle } from "../src/runtime/interpolate.js";
import { createRenderer } from "../src/runtime/renderer.js";
import { FrameStats } from "../src/runtime/stats.js";
import type { ArenaStats } from "../src/runtime/arena.js";
import {
  AnimatedCharacter,
  AnimatedCrowd,
  bakeVertexAnimation,
  buildSegmentRig,
  createRenderStack,
  VatCrowd,
} from "../src/runtime/render/index.js";
import type { LookPreset, QualityTier } from "../src/runtime/render/index.js";

export interface FxDemoOptions {
  readonly enemies: number;
  readonly seed: number;
  readonly forceWebGL: boolean;
  readonly autopilot: boolean;
  readonly outline: boolean;
  readonly crowd: "motion" | "vat";
  readonly preset: LookPreset;
  readonly quality: QualityTier | "auto";
  readonly onStats: (s: ArenaStats & { fx: Record<string, number | string> }) => void;
}

const hash01 = (n: number) => {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export async function startFxDemo(host: HTMLElement, o: FxDemoOptions): Promise<void> {
  await initSim();
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none";
  host.append(canvas);
  const handle = await createRenderer(canvas, { forceWebGL: o.forceWebGL, antialias: false });
  const world = createWorld({ seed: o.seed, enemies: { target: o.enemies, spawnPerTick: 128 } });
  addPlayer(world, 1);
  const cfg = world.config;
  const half = cfg.arena.halfExtent;

  const scene = new Scene();
  const rig = new CameraRig(1, { distance: 20, height: 0.5, follow: 7, lead: 0.25, fov: 50, minPitch: 0.8, maxPitch: 1.1 });
  rig.pitch = 0.95;
  const stack = createRenderStack(handle, scene, rig.camera, { preset: o.preset, quality: o.quality, outline: o.outline });
  // Debug handles for headless checks (measure scripts tweak the camera and effects).
  Object.assign(window as unknown as Record<string, unknown>, { __fxStack: stack, __fxRig: rig });

  const floor = new Mesh(new PlaneGeometry(half * 2, half * 2), new MeshStandardMaterial({ color: 0x2c3529, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const wallMat = new MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.9, flatShading: true });
  const h = cfg.arena.wallHeight;
  for (const [x, z, w, d] of [
    [0, half + 0.5, half * 2 + 2, 1],
    [0, -half - 0.5, half * 2 + 2, 1],
    [half + 0.5, 0, 1, half * 2 + 2],
    [-half - 0.5, 0, 1, half * 2 + 2],
  ] as const) {
    const m = new Mesh(new BoxGeometry(w, h, d), wallMat);
    m.position.set(x, h / 2, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
  const stone = new MeshStandardMaterial({ color: 0x3b3f4a, roughness: 0.85, flatShading: true });
  const flameMat = new MeshStandardMaterial({ color: 0xffa040, emissive: 0xff8a20, emissiveIntensity: 4 });
  for (const p of cfg.arena.pillars) {
    const m = new Mesh(new CylinderGeometry(p.radius * 0.9, p.radius, p.height, 9), stone);
    m.position.set(p.x, p.height / 2, p.z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    const flame = new Mesh(new SphereGeometry(0.4, 10, 8), flameMat);
    flame.position.set(p.x, p.height + 0.45, p.z);
    scene.add(flame);
  }

  // Player: a skinned procedural rig with locomotion blending.
  const playerRig = buildSegmentRig(new MeshStandardNodeMaterial({ color: 0x4fd1c5, roughness: 0.45, emissive: 0x0b3b38 }), { height: 1.4, radius: 0.4 });
  playerRig.mesh.castShadow = true;
  scene.add(playerRig.mesh);
  const hero = new AnimatedCharacter(playerRig.mesh, playerRig.clips, { walkSpeed: 3, runSpeed: 7, thresholds: { run: 6 } });
  const lantern = new Mesh(new SphereGeometry(0.14, 8, 6), new MeshStandardMaterial({ color: 0xffd080, emissive: 0xffb347, emissiveIntensity: 6 }));
  lantern.position.set(0.4, 1.0, -0.2);
  playerRig.mesh.add(lantern);

  // Crowd.
  const er = cfg.enemies.radius;
  const cap = Math.max(16, cfg.enemies.target + cfg.enemies.spawnPerTick);
  let pushEnemy: (x: number, z: number, yaw: number, id: number, speed: number) => void;
  let beginCrowd: () => void;
  let endCrowd: (t: number) => number;
  if (o.crowd === "vat") {
    const shadeRig = buildSegmentRig(new MeshStandardMaterial(), { height: er * 3.2, radius: er * 1.05, topRadius: er * 0.2, radialSegments: 6, heightSegments: 4 });
    const clips = shadeRig.clips.filter((c) => c.name === "walk" || c.name === "run");
    const vat = bakeVertexAnimation(shadeRig.mesh, clips, { fps: 24 });
    const crowd = new VatCrowd(vat, new MeshStandardNodeMaterial({ color: 0x8a6bff, emissive: 0x3b1fa8, emissiveIntensity: 0.9, roughness: 0.55, flatShading: true }), cap).addTo(scene);
    beginCrowd = () => crowd.begin();
    pushEnemy = (x, z, yaw, id, speed) => crowd.push(x, 0, z, yaw, { clip: speed > 3 ? "run" : "walk", phase: hash01(id) * 2, rate: 0.6 + speed * 0.15 });
    endCrowd = (t) => {
      crowd.end(t);
      return crowd.count;
    };
  } else {
    const cone = new ConeGeometry(er * 1.05, er * 3, 6);
    cone.translate(0, er * 1.5, 0);
    const crowd = new AnimatedCrowd(cone, new MeshStandardMaterial({ color: 0x8a6bff, emissive: 0x3b1fa8, emissiveIntensity: 0.9, roughness: 0.55, flatShading: true }), cap).addTo(scene);
    beginCrowd = () => crowd.begin();
    pushEnemy = (x, z, yaw, id, speed) => crowd.push(x, 0, z, yaw, hash01(id), speed, 0, 0);
    endCrowd = (t) => {
      crowd.end(t);
      return crowd.count;
    };
  }

  const input = new InputController(host, rig);
  const stepper = new FixedStepper(world.tickRate, 4);
  const frame = new FrameStats();
  const cpu = new FrameStats();
  const sim = new FrameStats(120);
  const focus = new Vector3();
  let w = 1;
  let hgt = 1;
  const resize = () => {
    w = Math.max(1, host.clientWidth);
    hgt = Math.max(1, host.clientHeight);
    stack.resize(w, hgt);
    rig.resize(w / hgt);
  };
  resize();
  new ResizeObserver(resize).observe(host);
  let last = 0;
  let frames = 0;
  let kills = 0;
  let autoYaw = 0;
  let autoSeq = 0;
  let hurt = 0;
  let health = 0;
  const prevPos = new Map<number, [number, number]>();

  handle.renderer.setAnimationLoop((now: number) => {
    const t0 = performance.now();
    const dtMs = last === 0 ? 1000 / 60 : now - last;
    if (last !== 0) frame.push(dtMs);
    last = now;
    const adv = stepper.advance(dtMs);
    const events: SimEvent[] = [];
    for (let i = 0; i < adv.ticks; i++) {
      let cmd;
      if (o.autopilot) {
        autoYaw += 0.01;
        cmd = { seq: ++autoSeq, tick: world.tick, moveX: 0.6, moveZ: 0.8, yaw: autoYaw, buttons: world.tick % 20 < 2 ? 2 : 0 };
        rig.yaw = autoYaw;
      } else cmd = input.sample(world.tick);
      const s0 = performance.now();
      const r = step(world, new Map([[1, cmd]]));
      sim.push(performance.now() - s0);
      for (const e of r.events) events.push(e);
    }
    const view = renderView(world);
    const dt = dtMs / 1000;
    // Player first (its position is the focus for effects).
    let px = 0;
    let pz = 0;
    for (let i = 0; i < view.count; i++) {
      if (view.kind[i] !== EntityKind.Player) continue;
      const x = lerp(view.prevX[i] ?? 0, view.x[i] ?? 0, adv.alpha);
      const y = lerp(view.prevY[i] ?? 0, view.y[i] ?? 0, adv.alpha);
      const z = lerp(view.prevZ[i] ?? 0, view.z[i] ?? 0, adv.alpha);
      const speed = Math.hypot((view.x[i] ?? 0) - (view.prevX[i] ?? 0), (view.z[i] ?? 0) - (view.prevZ[i] ?? 0)) * world.tickRate;
      playerRig.mesh.position.set(x, y - cfg.player.halfHeight - cfg.player.radius, z);
      playerRig.mesh.rotation.y = lerpAngle(view.prevYaw[i] ?? 0, view.yaw[i] ?? 0, adv.alpha);
      playerRig.mesh.visible = ((view.flags[i] ?? 0) & EntityFlag.Dead) === 0;
      hero.setSpeed(speed);
      focus.set(x, y, z);
      px = x;
      pz = z;
      health = view.health[i] ?? 0;
    }
    for (const e of events) {
      if (e.type === "enemy.killed") {
        kills++;
        const p = prevPos.get(e.netId);
        if (p) {
          stack.particles.burst(kills % 15 === 0 ? "bigKill" : "kill", p[0], 0.4, p[1], { dirX: p[0] - px, dirZ: p[1] - pz });
          if (kills % 3 === 0) stack.decals.add("splat", p[0], p[1], { color: 0x5a3cc0, size: 1.1, life: 5, glow: 1.4 });
        }
      } else if (e.type === "player.pulse") {
        stack.rings.fire(px, pz, cfg.player.pulseRadius, { color: 0x9ae6ff });
        stack.decals.add("scorch", px, pz, { size: cfg.player.pulseRadius * 1.4, life: 4, opacity: 0.55 });
        stack.particles.burst("sparks", px, 0.3, pz, { count: 10 });
        hero.oneShot("attack");
      } else if (e.type === "player.hit") {
        hurt = 1;
        hero.oneShot("hit");
      }
    }
    hurt = Math.max(0, hurt - dt * 2.5);
    stack.post.hurt.value = hurt;
    beginCrowd();
    const seen = new Set<number>();
    for (let i = 0; i < view.count; i++) {
      if (view.kind[i] !== EntityKind.Enemy) continue;
      const id = view.netId[i] ?? 0;
      const x = lerp(view.prevX[i] ?? 0, view.x[i] ?? 0, adv.alpha);
      const z = lerp(view.prevZ[i] ?? 0, view.z[i] ?? 0, adv.alpha);
      const yaw = lerpAngle(view.prevYaw[i] ?? 0, view.yaw[i] ?? 0, adv.alpha);
      const speed = Math.hypot((view.x[i] ?? 0) - (view.prevX[i] ?? 0), (view.z[i] ?? 0) - (view.prevZ[i] ?? 0)) * world.tickRate;
      pushEnemy(x, z, yaw, id, speed);
      prevPos.set(id, [x, z]);
      seen.add(id);
    }
    if (prevPos.size > cap * 2) for (const id of prevPos.keys()) if (!seen.has(id)) prevPos.delete(id);
    const enemies = endCrowd(stack.time + dt);
    // Ambient embers off the pillar flames.
    for (const p of cfg.arena.pillars) stack.particles.emit("embers", p.x, p.height + 0.5, p.z, 1.5, dt);
    hero.update(dt);
    rig.update(focus, dt);
    stack.frame(dt, focus, now);
    cpu.push(performance.now() - t0);
    frames++;
    const info = handle.renderer.info.render;
    const mean = frame.mean();
    o.onStats({
      backend: handle.backend,
      fps: mean > 0 ? 1000 / mean : 0,
      frameMs: { mean, p50: frame.percentile(0.5), p95: frame.percentile(0.95), p99: frame.percentile(0.99) },
      cpuMs: { mean: cpu.mean(), p95: cpu.percentile(0.95) },
      simMsPerTick: sim.mean(),
      drawCalls: info.drawCalls,
      triangles: info.triangles,
      entities: view.count,
      enemies,
      frames,
      pixelRatio: stack.quality.pixelRatio,
      tick: world.tick,
      health,
      kills,
      fx: {
        tier: stack.quality.tier,
        crowd: o.crowd,
        post: stack.post.stages.enabled ? 1 : 0,
        shadows: stack.lighting.shadowsOn ? 1 : 0,
        bursts: stack.particles.bursts,
        rings: stack.rings.fired,
        decals: stack.decals.ring.written,
        anim: hero.playing ?? "",
      },
    });
  });
}
