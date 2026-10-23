import {
  AmbientLight,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  GridHelper,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Vector3,
} from "three/webgpu";
import {
  EntityFlag,
  EntityKind,
  FixedStepper,
  addPlayer,
  createWorld,
  destroyWorld,
  initSim,
  renderView,
  step,
} from "@netforge/engine-sim";
import type { RenderView, SimConfig, SimEvent, SimWorld } from "@netforge/engine-sim";
import { CameraRig } from "./camera.js";
import { InstancedCrowd } from "./crowd.js";
import { InputController } from "./input.js";
import { lerp } from "./interpolate.js";
import { createRenderer } from "./renderer.js";
import type { Backend, RendererHandle } from "./renderer.js";
import { FrameStats } from "./stats.js";

export interface ArenaOptions {
  readonly sim?: SimConfig;
  readonly forceWebGL?: boolean;
  /** Called after every rendered frame with the latest numbers. */
  readonly onStats?: (s: ArenaStats) => void;
  /** Keep frame time near this budget by scaling resolution (ms). Default 16.7. */
  readonly frameBudgetMs?: number;
  /** Feed scripted inputs instead of the keyboard (headless measurement). */
  readonly autopilot?: boolean;
}

export interface ArenaStats {
  readonly backend: Backend;
  readonly fps: number;
  /** Interval between frames (what the player feels). */
  readonly frameMs: { readonly mean: number; readonly p50: number; readonly p95: number; readonly p99: number };
  /** Main-thread time spent inside the frame callback (sim + render submission). */
  readonly cpuMs: { readonly mean: number; readonly p95: number };
  readonly simMsPerTick: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly entities: number;
  readonly enemies: number;
  readonly frames: number;
  readonly pixelRatio: number;
  readonly tick: number;
  readonly health: number;
  readonly kills: number;
}

const PLAYER_ID = 1;

/**
 * The week-2 single-player arena: engine-sim on a fixed tick, rendered by
 * three.js with interpolation, one instanced draw for every enemy, a
 * follow camera, keyboard/mouse/touch input. Placeholder primitives only.
 */
export class ArenaClient {
  private constructor(
    private readonly host: HTMLElement,
    private readonly handle: RendererHandle,
    private readonly world: SimWorld,
    private readonly opts: ArenaOptions,
  ) {}

  private scene = new Scene();
  private rig!: CameraRig;
  private input!: InputController;
  private crowd!: InstancedCrowd;
  private playerMesh!: Mesh;
  private pulse!: Mesh;
  private pulseT = 1;
  private stepper!: FixedStepper;
  private readonly frame = new FrameStats();
  private readonly cpu = new FrameStats();
  private readonly sim = new FrameStats(120);
  private last = 0;
  private frames = 0;
  private kills = 0;
  private flash = 0;
  private pixelRatio = 1;
  private resLastChange = 0;
  private readonly target = new Vector3();
  private autoYaw = 0;
  private autoSeq = 0;
  private disposed = false;
  private latest: ArenaStats | null = null;

  static async create(host: HTMLElement, opts: ArenaOptions = {}): Promise<ArenaClient> {
    await initSim();
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none";
    host.append(canvas);
    const handle = await createRenderer(canvas, opts.forceWebGL === undefined ? {} : { forceWebGL: opts.forceWebGL });
    const world = createWorld(opts.sim);
    addPlayer(world, PLAYER_ID);
    const c = new ArenaClient(host, handle, world, opts);
    c.build();
    return c;
  }

  private build(): void {
    const { renderer } = this.handle;
    const cfg = this.world.config;
    const half = cfg.arena.halfExtent;
    this.pixelRatio = renderer.getPixelRatio();

    const bg = new Color(0x0b0d12);
    this.scene.background = bg;
    this.scene.fog = new Fog(bg, 40, 140);
    this.scene.add(new HemisphereLight(0xbfd4ff, 0x1a1408, 1.1));
    this.scene.add(new AmbientLight(0xffffff, 0.15));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(20, 40, 10);
    this.scene.add(sun);

    const floor = new Mesh(new PlaneGeometry(half * 2, half * 2), new MeshStandardMaterial({ color: 0x1b2230, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    const grid = new GridHelper(half * 2, Math.round(half), 0x2f3a50, 0x232b3b);
    grid.position.y = 0.01;
    this.scene.add(grid);

    const wallMat = new MeshStandardMaterial({ color: 0x3a4660, roughness: 0.8 });
    const h = cfg.arena.wallHeight;
    for (const [x, z, w, d] of [
      [0, half + 0.5, half * 2 + 2, 1],
      [0, -half - 0.5, half * 2 + 2, 1],
      [half + 0.5, 0, 1, half * 2 + 2],
      [-half - 0.5, 0, 1, half * 2 + 2],
    ] as const) {
      const m = new Mesh(new BoxGeometry(w, h, d), wallMat);
      m.position.set(x, h / 2, z);
      this.scene.add(m);
    }
    const pillarMat = new MeshStandardMaterial({ color: 0x55627d, roughness: 0.7 });
    for (const p of cfg.arena.pillars) {
      const m = new Mesh(new CylinderGeometry(p.radius, p.radius, p.height, 24), pillarMat);
      m.position.set(p.x, p.height / 2, p.z);
      this.scene.add(m);
    }

    const pr = cfg.player;
    this.playerMesh = new Mesh(
      new CapsuleGeometry(pr.radius, pr.halfHeight * 2, 4, 12),
      new MeshStandardMaterial({ color: 0x4fd1c5, roughness: 0.4, emissive: new Color(0x0b3b38) }),
    );
    const nose = new Mesh(new BoxGeometry(0.18, 0.18, 0.4), new MeshStandardMaterial({ color: 0xffffff }));
    nose.position.set(0, 0.35, -pr.radius);
    this.playerMesh.add(nose);
    this.scene.add(this.playerMesh);

    // Enemies: a 6-sided cone pointing along -z (its facing), one draw call.
    const er = cfg.enemies.radius;
    const cone = new ConeGeometry(er, er * 2.4, 6);
    cone.rotateX(-Math.PI / 2);
    const cap = Math.max(16, cfg.enemies.target + cfg.enemies.spawnPerTick);
    this.crowd = new InstancedCrowd(cone, new MeshStandardMaterial({ color: 0xf06449, roughness: 0.6 }), cap, EntityKind.Enemy);
    this.scene.add(this.crowd.mesh);

    this.pulse = new Mesh(
      new RingGeometry(0.85, 1, 48),
      new MeshBasicMaterial({ color: 0x9ae6ff, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.pulse.rotation.x = -Math.PI / 2;
    this.scene.add(this.pulse);

    this.rig = new CameraRig(1);
    this.input = new InputController(this.host, this.rig);
    this.stepper = new FixedStepper(this.world.tickRate, 4);
    this.resize();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.host);
    // Nothing runs while the tab is hidden; on return, drop the backlog.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        this.stepper.reset();
        this.last = 0;
      }
    });
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.handle.renderer.setSize(w, h, false);
    this.rig.resize(w / h);
  }

  start(): void {
    this.handle.renderer.setAnimationLoop((t: number) => this.loop(t));
  }

  /** Latest numbers (also passed to `onStats`). */
  stats(): ArenaStats | null {
    return this.latest;
  }

  private autopilotInput(tick: number) {
    // Circle-strafe and pulse: exercises movement, the crowd and combat.
    this.autoYaw += 0.01;
    return { seq: ++this.autoSeq, tick, moveX: 0.6, moveZ: 0.8, yaw: this.autoYaw, buttons: tick % 20 < 2 ? 2 : 0 };
  }

  private loop(now: number): void {
    if (this.disposed || document.hidden) return;
    const t0 = performance.now();
    const dtMs = this.last === 0 ? 1000 / 60 : now - this.last;
    if (this.last !== 0) this.frame.push(dtMs);
    this.last = now;

    const adv = this.stepper.advance(dtMs);
    const events: SimEvent[] = [];
    for (let i = 0; i < adv.ticks; i++) {
      const cmd = this.opts.autopilot ? this.autopilotInput(this.world.tick) : this.input.sample(this.world.tick);
      if (this.opts.autopilot) this.rig.yaw = cmd.yaw;
      const s0 = performance.now();
      const r = step(this.world, new Map([[PLAYER_ID, cmd]]));
      this.sim.push(performance.now() - s0);
      for (const e of r.events) events.push(e);
    }
    this.onEvents(events);

    const view = renderView(this.world);
    const enemies = this.crowd.update(view, adv.alpha);
    const me = this.drawPlayer(view, adv.alpha);

    const dt = dtMs / 1000;
    this.rig.update(this.target, dt);
    this.animateFx(dt);
    this.handle.renderer.render(this.scene, this.rig.camera);
    this.cpu.push(performance.now() - t0);
    this.frames++;
    this.adaptResolution(now);

    const info = this.handle.renderer.info.render;
    const mean = this.frame.mean();
    this.latest = {
      backend: this.handle.backend,
      fps: mean > 0 ? 1000 / mean : 0,
      frameMs: { mean, p50: this.frame.percentile(0.5), p95: this.frame.percentile(0.95), p99: this.frame.percentile(0.99) },
      cpuMs: { mean: this.cpu.mean(), p95: this.cpu.percentile(0.95) },
      simMsPerTick: this.sim.mean(),
      drawCalls: info.drawCalls,
      triangles: info.triangles,
      entities: view.count,
      enemies,
      frames: this.frames,
      pixelRatio: this.pixelRatio,
      tick: this.world.tick,
      health: me?.health ?? 0,
      kills: this.kills,
    };
    this.opts.onStats?.(this.latest);
  }

  private drawPlayer(view: RenderView, alpha: number): { health: number } | null {
    for (let i = 0; i < view.count; i++) {
      if (view.kind[i] !== EntityKind.Player || view.owner[i] !== PLAYER_ID) continue;
      const x = lerp(view.prevX[i] ?? 0, view.x[i] ?? 0, alpha);
      const y = lerp(view.prevY[i] ?? 0, view.y[i] ?? 0, alpha);
      const z = lerp(view.prevZ[i] ?? 0, view.z[i] ?? 0, alpha);
      this.playerMesh.position.set(x, y, z);
      this.playerMesh.rotation.y = view.yaw[i] ?? 0;
      this.playerMesh.visible = ((view.flags[i] ?? 0) & EntityFlag.Dead) === 0;
      this.target.set(x, y, z);
      return { health: view.health[i] ?? 0 };
    }
    return null;
  }

  private onEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === "enemy.killed") this.kills++;
      else if (e.type === "player.pulse") {
        this.pulseT = 0;
        this.rig.shake(0.15, 0.12);
      } else if (e.type === "player.hit") {
        this.flash = 1;
        this.rig.shake(0.25, 0.15);
      }
    }
  }

  private animateFx(dt: number): void {
    const mat = this.pulse.material as MeshBasicMaterial;
    if (this.pulseT < 1) {
      this.pulseT = Math.min(1, this.pulseT + dt * 4);
      const r = this.world.config.player.pulseRadius * (0.3 + 0.7 * this.pulseT);
      this.pulse.scale.setScalar(r);
      this.pulse.position.set(this.target.x, 0.05, this.target.z);
      mat.opacity = 0.8 * (1 - this.pulseT);
    } else {
      mat.opacity = 0;
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 5);
      (this.playerMesh.material as MeshStandardMaterial).emissive.setRGB(0.05 + this.flash, 0.23 * (1 - this.flash), 0.22 * (1 - this.flash));
    }
  }

  /** Dynamic resolution: hold the frame budget by trading pixels (spec §5 quality tiers). */
  private adaptResolution(now: number): void {
    if (this.frame.count < 120 || now - this.resLastChange < 2000) return;
    const budget = this.opts.frameBudgetMs ?? 1000 / 60;
    const p95 = this.frame.percentile(0.95);
    const cap = Math.min(globalThis.devicePixelRatio || 1, 2);
    let next = this.pixelRatio;
    if (p95 > budget * 1.25 && this.pixelRatio > 0.75) next = Math.max(0.75, this.pixelRatio - 0.25);
    else if (p95 < budget * 1.05 && this.pixelRatio < cap) next = Math.min(cap, this.pixelRatio + 0.25);
    if (next !== this.pixelRatio) {
      this.pixelRatio = next;
      this.handle.renderer.setPixelRatio(next);
      this.resize();
      this.resLastChange = now;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.handle.renderer.setAnimationLoop(null);
    this.input.dispose();
    this.crowd.dispose();
    this.handle.renderer.dispose();
    destroyWorld(this.world);
  }
}
