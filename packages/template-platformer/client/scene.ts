/**
 * The SKYLEDGE scene: a side-view cliff course in three.js (WebGPU with
 * WebGL2 fallback, through the engine runtime's render stack in every art
 * style). Blocks are two merged draws (earth and their grassy caps), ledges
 * one, thorns one, coins one instanced draw; moving platforms, springs and
 * flags are a few meshes each. Climbers are library characters (sprites in
 * the pixel style) that face their run and play run, idle and jump.
 *
 * Game feel that lives in the world: squash and stretch on jumps and
 * landings, dust on landing, coin sparkles, a spring boing, a poof on a
 * fall, flags that wave when you reach them, a camera that leads your run.
 */
import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from "three/webgpu";
import type { Material, Object3D } from "three/webgpu";
import { CameraRig, createRenderStack, styleKit } from "@netnetcapital/engine/runtime";
import type { FeelKit, RenderStack, RendererHandle, StyleKit } from "@netnetcapital/engine/runtime";
import { PF } from "@netnetcapital/engine/game";
import type { CompiledPlatformer } from "@netnetcapital/engine/game";
import { BOT_PLAYER_BASE, moverBox, PlatFlag, platformCoinTaken } from "@netnetcapital/engine-sim";
import type { PlatformLevel } from "@netnetcapital/engine-sim";
import type { CharacterAnimator, LibraryClient } from "@netnetcapital/asset-library/three";
import { placeStatic } from "@netnetcapital/asset-library/three";
import { BACKDROP, BOT_MODEL, COIN_MODEL, PLAYER_HEIGHT } from "./decor.js";
import { KEEPER_COLORS } from "./names.js";

/** One entity as the scene sees it (netcode values in the platformer wire schema). */
export interface SceneEntity {
  readonly id: number;
  readonly kind: number;
  readonly owner: number;
  readonly values: readonly number[];
}

export interface FrameEvents {
  /** Our climber left the ground with a jump this frame (air: an air jump). */
  jumped: boolean;
  airJump: boolean;
  /** Our climber landed (speed of the fall, m/s). */
  landed: number;
  /** Coins we picked up this frame. */
  coins: number;
  /** We fell (thorns or the drop). */
  fell: boolean;
  /** A shield took a thorn for us. */
  shielded: boolean;
  /** We crossed a checkpoint. */
  checkpoint: boolean;
  /** We touched the flag. */
  finished: boolean;
  dashed: boolean;
  sprung: boolean;
}

const Q = 1024;
const SEAT_COLORS = [0xd9c7a6, 0xa6b8d9, 0xd9a6b8, 0xa6d9b2, 0xc9a6d9];

export function climberColor(owner: number): number {
  if (owner >= BOT_PLAYER_BASE) return SEAT_COLORS[(owner - BOT_PLAYER_BASE) % SEAT_COLORS.length] ?? 0xd9c7a6;
  return KEEPER_COLORS[(owner - 1) % KEEPER_COLORS.length] ?? 0xffffff;
}

/** Outfit tints by cosmetic id (0: the climber's own colour). */
export function outfitOf(cosmetic: number, base: number): { body: number; trim: number } {
  if (cosmetic === 1) return { body: 0xff8a3d, trim: 0xffd23f };
  if (cosmetic === 2) return { body: 0xbfe8ff, trim: 0x5fd0ff };
  return { body: base, trim: base };
}

/** A tileable canvas texture: earth with stones (blocks), or planks (ledges). */
function canvasTexture(kind: "earth" | "plank" | "sky"): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = kind === "sky" ? 256 : 128;
  const g = c.getContext("2d");
  if (!g) throw new Error("no 2d canvas");
  let s = kind === "earth" ? 7 : 19;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  if (kind === "sky") {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#4f8fd6");
    grad.addColorStop(0.6, "#9fd2f0");
    grad.addColorStop(1, "#ffe2b8");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
  } else if (kind === "earth") {
    g.fillStyle = "#8a5a3b";
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) {
      const v = Math.floor(rnd() * 30);
      g.fillStyle = `rgb(${120 + v},${78 + v},${52 + v})`;
      g.fillRect(Math.floor(rnd() * 128), Math.floor(rnd() * 128), 2, 2);
    }
    for (let i = 0; i < 9; i++) {
      g.fillStyle = `rgba(${170 + Math.floor(rnd() * 40)},${160 + Math.floor(rnd() * 30)},${150},0.85)`;
      g.beginPath();
      g.ellipse(rnd() * 128, rnd() * 128, 5 + rnd() * 7, 3 + rnd() * 5, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    g.fillStyle = "#b07b46";
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = "rgba(60,30,10,0.45)";
    g.lineWidth = 3;
    for (let x = 0; x <= 128; x += 32) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 128);
      g.stroke();
    }
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Box geometry whose UVs tile once per metre (so a long block's texture never stretches). */
function boxTiled(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number): BufferGeometry {
  const w = x1 - x0;
  const h = y1 - y0;
  const d = z1 - z0;
  const g = new BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  if (uv && pos && nrm) {
    for (let i = 0; i < uv.count; i++) {
      const px = (pos.getX(i) + w / 2 + x0) / 2;
      const py = (pos.getY(i) + h / 2 + y0) / 2;
      const pz = (pos.getZ(i) + d / 2) / 2;
      const nx = Math.abs(nrm.getX(i));
      const ny = Math.abs(nrm.getY(i));
      uv.setXY(i, nx > 0.5 ? pz : px, ny > 0.5 ? pz : py);
    }
  }
  g.translate(x0 + w / 2, y0 + h / 2, z0 + d / 2);
  return g;
}

/** Merge box-like geometries into one draw (positions, normals and UVs). */
function mergeGeometries(parts: readonly BufferGeometry[]): BufferGeometry {
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  let n = 0;
  for (const p of flat) n += p.getAttribute("position").count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  let o = 0;
  for (const p of flat) {
    const a = p.getAttribute("position");
    if (!p.getAttribute("normal")) p.computeVertexNormals();
    const b = p.getAttribute("normal");
    const u = p.getAttribute("uv");
    for (let i = 0; i < a.count; i++) {
      pos.set([a.getX(i), a.getY(i), a.getZ(i)], (o + i) * 3);
      nor.set([b.getX(i), b.getY(i), b.getZ(i)], (o + i) * 3);
      if (u) uvs.set([u.getX(i), u.getY(i)], (o + i) * 2);
    }
    o += a.count;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("normal", new BufferAttribute(nor, 3));
  g.setAttribute("uv", new BufferAttribute(uvs, 2));
  g.computeBoundingSphere();
  return g;
}

interface Climber {
  root: Group;
  body: Group;
  model: Object3D | null;
  animator: CharacterAnimator | null;
  mats: MeshStandardMaterial[];
  tag: Mesh;
  lastFlags: number;
  lastY: number;
  lastVy: number;
  squash: number;
  facing: number;
  outfit: number;
  color: number;
  shadow: Mesh;
  loading: boolean;
  alpha: number;
}

export class PlatformScene {
  readonly scene = new Scene();
  readonly rig: CameraRig;
  readonly stack: RenderStack;
  readonly style: string;
  private readonly kit: StyleKit | null;
  private course = -1;
  private level: PlatformLevel | null = null;
  private levelGroup = new Group();
  private movers: Mesh[] = [];
  private checkpoints: { flag: Mesh; pole: Mesh; reached: boolean }[] = [];
  private flagCloth: Mesh | null = null;
  private springs: Mesh[] = [];
  private coins: InstancedMesh | null = null;
  private coinSpin = 0;
  private readonly climbers = new Map<number, Climber>();
  private time = 0;
  private readonly focus = new Vector3();
  private lastCoins = -1;
  private lastCp = -2;
  private coinModel: { geometry: BufferGeometry; material: Material } | null = null;
  /** Effects fired so far (playtest checks read these). */
  readonly counts = { jumps: 0, lands: 0, coins: 0, falls: 0, springs: 0, dashes: 0 };
  private readonly backdrop = new Group();

  constructor(
    private readonly handle: RendererHandle,
    private readonly compiled: CompiledPlatformer,
    private readonly library: LibraryClient | null,
    private readonly feel: FeelKit | null,
    private readonly playerModel: string,
    opts: { style: string; quality?: "low" | "medium" | "high" },
  ) {
    this.style = opts.style;
    this.kit = styleKit(this.style);
    this.rig = new CameraRig(1, { distance: 17, height: 1.6, follow: 6, lead: 0.32, leadMax: 4.5, fov: 40, minPitch: -0.2, maxPitch: 0.6, shake: { maxOffset: 0.35 } });
    this.rig.yaw = 0;
    this.rig.pitch = 0.1;
    const s = this.scene;
    this.stack = createRenderStack(handle, s, this.rig.camera, {
      preset: "day",
      style: this.style,
      quality: opts.quality ?? "auto",
      shadowExtent: 24,
      atmosphere: { heightFog: 0, near: 70, far: 220 },
      resolve: (id) => {
        try {
          return library?.url(id) ?? null;
        } catch {
          return null;
        }
      },
    });
    if (this.kit?.stack?.("day").shadows !== true) this.stack.lighting.setShadowMapSize(0);
    if (feel) feel.particles = this.stack.particles;
    if (!this.kit) {
      // The template's own daylight for the low-poly look (the stack's day preset carries the rest).
      s.add(new HemisphereLight(0xcfe8ff, 0x5a4630, 0.6));
      s.add(new AmbientLight(0xffffff, 0.15));
      const sun = new DirectionalLight(0xfff0d6, 0.6);
      sun.position.set(-10, 30, 20);
      s.add(sun);
    }
    // A painted sky far behind the course, so every style has a backdrop to read against.
    const sky = new Mesh(new PlaneGeometry(900, 260), new MeshBasicMaterial({ map: canvasTexture("sky"), fog: false }));
    sky.position.set(300, 60, -120);
    sky.userData.surface = "sky";
    s.add(sky);
    s.add(this.levelGroup, this.backdrop);
    if (library) {
      void library
        .crowd(COIN_MODEL, undefined, { height: 0.7 })
        .then((m) => {
          const p = m.parts[0];
          if (p) this.coinModel = { geometry: p.geometry, material: p.material };
          if (this.level) this.buildCoins(this.level);
        })
        .catch(() => undefined);
    }
  }

  /** Build (or rebuild) the course `index`. */
  setCourse(index: number): void {
    if (index === this.course) return;
    const level = this.compiled.levels[index];
    if (!level) return;
    this.course = index;
    this.level = level;
    this.scene.remove(this.levelGroup);
    this.levelGroup = new Group();
    this.scene.add(this.levelGroup);
    const g = this.levelGroup;
    const session = this.stack.session;
    const earthMap = session?.surface?.("ground", { tile: 2, mood: "cliff earth" }) ?? canvasTexture("earth");
    const earth = new MeshStandardMaterial({ map: earthMap, roughness: 0.95, metalness: 0 });
    const grass = new MeshStandardMaterial({ color: 0x6ccf5a, roughness: 0.85, metalness: 0, flatShading: true });
    const plank = new MeshStandardMaterial({ map: canvasTexture("plank"), roughness: 0.8 });
    const bodies: BufferGeometry[] = [];
    const caps: BufferGeometry[] = [];
    for (const b of level.solids) {
      // Deep slabs: the course is the front edge of the cliffs, with room behind it for trees.
      bodies.push(boxTiled(b[0], b[1], b[2], b[3] - 0.18, -5.5, 1.6));
      caps.push(boxTiled(b[0] - 0.06, b[3] - 0.22, b[2] + 0.06, b[3] + 0.04, -5.6, 1.7));
    }
    const blockMesh = new Mesh(mergeGeometries(bodies), earth);
    blockMesh.userData.surface = "dirt";
    blockMesh.receiveShadow = true;
    const capMesh = new Mesh(mergeGeometries(caps), grass);
    capMesh.userData.surface = "grass";
    capMesh.receiveShadow = true;
    g.add(blockMesh, capMesh);
    if (level.ledges.length > 0) {
      const ledge = new Mesh(mergeGeometries(level.ledges.map((b) => boxTiled(b[0], b[1], b[2], b[3], -1.2, 1.2))), plank);
      ledge.userData.surface = "wood";
      g.add(ledge);
    }
    // Thorns: rows of cones, one draw.
    const thorns: BufferGeometry[] = [];
    for (const b of level.hazards) {
      const n = Math.max(1, Math.round((b[2] - b[0]) / 0.42));
      for (let i = 0; i < n; i++) {
        for (const z of [-0.9, 0, 0.9]) {
          const c = new ConeGeometry(0.2, b[3] - b[1] + 0.25, 5);
          c.translate(b[0] + ((i + 0.5) * (b[2] - b[0])) / n, b[1] + (b[3] - b[1] + 0.25) / 2, z);
          thorns.push(c);
        }
      }
    }
    if (thorns.length > 0) {
      const t = new Mesh(mergeGeometries(thorns), new MeshStandardMaterial({ color: 0xc23a4a, emissive: new Color(0x3a0610), roughness: 0.5, flatShading: true }));
      t.userData.surface = "metal";
      g.add(t);
    }
    // Springs.
    this.springs = level.springs.map((sp) => {
      const base = new Mesh(new CylinderGeometry(0.45, 0.5, 0.25, 12), new MeshStandardMaterial({ color: 0x3a3f52, roughness: 0.6, metalness: 0.4 }));
      base.position.set(sp.x, sp.y + 0.12, 0);
      const pad = new Mesh(new CylinderGeometry(0.55, 0.55, 0.12, 14), new MeshStandardMaterial({ color: 0xff5fa2, emissive: new Color(0x401020), roughness: 0.4 }));
      pad.position.set(sp.x, sp.y + 0.36, 0);
      const coil = new Mesh(new TorusGeometry(0.32, 0.06, 6, 14), new MeshStandardMaterial({ color: 0xd8dde8, metalness: 0.8, roughness: 0.3 }));
      coil.rotation.x = Math.PI / 2;
      coil.position.set(sp.x, sp.y + 0.24, 0);
      g.add(base, coil, pad);
      pad.userData.restY = pad.position.y;
      return pad;
    });
    // Moving platforms.
    const moverMat = new MeshStandardMaterial({ color: 0x8fd3ff, emissive: new Color(0x0a2a3a), roughness: 0.5, metalness: 0.2 });
    this.movers = level.movers.map((m) => {
      const b = m.box;
      const mesh = new Mesh(new BoxGeometry(b[2] - b[0], 0.45, 2.4), moverMat);
      mesh.userData.surface = "metal";
      g.add(mesh);
      return mesh;
    });
    // Checkpoints and the flag.
    const poleMat = new MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.5 });
    this.checkpoints = level.checkpoints.map(([x, y]) => {
      const pole = new Mesh(new CylinderGeometry(0.06, 0.06, 2.4, 6), poleMat);
      pole.position.set(x, y + 1.2, -0.8);
      const flag = new Mesh(new PlaneGeometry(0.9, 0.55, 6, 1), new MeshStandardMaterial({ color: 0x9aa3b4, side: 2, roughness: 0.8 }));
      flag.position.set(x + 0.46, y + 2.1, -0.8);
      g.add(pole, flag);
      return { flag, pole, reached: false };
    });
    const [fx, fy] = level.flag;
    const pole = new Mesh(new CylinderGeometry(0.1, 0.1, 5, 8), new MeshStandardMaterial({ color: 0xe8e2d0, metalness: 0.3, roughness: 0.4 }));
    pole.position.set(fx, fy + 2.5, -0.4);
    const knob = new Mesh(new SphereGeometry(0.22, 12, 8), new MeshStandardMaterial({ color: 0xffd23f, emissive: new Color(0x5a4000) }));
    knob.position.set(fx, fy + 5.1, -0.4);
    this.flagCloth = new Mesh(new PlaneGeometry(1.8, 1.1, 10, 2), new MeshStandardMaterial({ color: 0xffd23f, emissive: new Color(0x3a2a00), side: 2, roughness: 0.7 }));
    this.flagCloth.position.set(fx + 0.92, fy + 4.3, -0.4);
    this.flagCloth.userData.base = (this.flagCloth.geometry.attributes.position?.array as Float32Array).slice();
    g.add(pole, knob, this.flagCloth);
    this.buildCoins(level);
    this.buildBackdrop(level);
    this.lastCoins = -1;
    this.lastCp = -2;
  }

  private buildCoins(level: PlatformLevel): void {
    if (this.coins) this.levelGroup.remove(this.coins);
    const geo = this.coinModel?.geometry ?? new CylinderGeometry(0.32, 0.32, 0.08, 16).rotateX(Math.PI / 2);
    const mat = this.coinModel?.material ?? new MeshStandardMaterial({ color: 0xffd23f, emissive: new Color(0x6a4a00), metalness: 0.7, roughness: 0.3 });
    const mesh = new InstancedMesh(geo, mat, Math.max(1, level.coins.length));
    mesh.count = level.coins.length;
    mesh.frustumCulled = false;
    this.coins = mesh;
    this.levelGroup.add(mesh);
  }

  /** Library trees and rocks behind the course, and far hills: one instanced draw per model. */
  private buildBackdrop(level: PlatformLevel): void {
    this.scene.remove(this.backdrop);
    this.backdrop.clear();
    this.scene.add(this.backdrop);
    // Far hills: big flat-shaded cones in two hazy colours.
    const hills: BufferGeometry[] = [];
    let s = 31 + this.course;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let x = level.start[0] - 40; x < level.flag[0] + 60; x += 14 + rnd() * 10) {
      const h = 14 + rnd() * 18;
      const c = new ConeGeometry(10 + rnd() * 8, h, 7);
      c.translate(x, -6 + h / 2, -55 - rnd() * 20);
      hills.push(c);
    }
    const hill = new Mesh(mergeGeometries(hills), new MeshStandardMaterial({ color: 0x7aa7a0, roughness: 1, flatShading: true }));
    hill.userData.surface = "grass";
    this.backdrop.add(hill);
    if (!this.library) return;
    const lib = this.library;
    for (const [id, height, depth] of BACKDROP) {
      const places: { x: number; y: number; z: number; yaw: number }[] = [];
      for (const b of level.solids) {
        if (b[2] - b[0] < 10) continue;
        for (let x = b[0] + 1.2; x < b[2] - 1; x += 3 + rnd() * 6) if (rnd() < 0.5) places.push({ x, y: b[3], z: -2.6 - depth * rnd(), yaw: rnd() * 6.28 });
      }
      if (places.length === 0) continue;
      void lib
        .crowd(id, undefined, { height })
        .then((m) => {
          for (const o of placeStatic(m, places)) this.backdrop.add(o);
        })
        .catch(() => undefined);
    }
  }

  private climber(owner: number): Climber {
    let c = this.climbers.get(owner);
    if (c) return c;
    const root = new Group();
    const body = new Group();
    root.add(body);
    const color = climberColor(owner);
    const mat = new MeshStandardMaterial({ color, roughness: 0.6, flatShading: true });
    // Fallback figure until the library character loads.
    const torso = new Mesh(new CylinderGeometry(0.28, 0.32, 0.8, 8), mat);
    torso.position.y = 0.6;
    const head = new Mesh(new SphereGeometry(0.26, 12, 8), mat);
    head.position.y = 1.2;
    body.add(torso, head);
    const tag = new Mesh(new ConeGeometry(0.14, 0.24, 4), new MeshBasicMaterial({ color }));
    tag.rotation.x = Math.PI;
    tag.position.y = PLAYER_HEIGHT + 0.45;
    root.add(tag);
    const shadow = new Mesh(new CylinderGeometry(0.42, 0.42, 0.02, 16), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
    this.scene.add(root, shadow);
    c = { root, body, model: null, animator: null, mats: [mat], tag, lastFlags: 0, lastY: 0, lastVy: 0, squash: 0, facing: 1, outfit: -1, color, shadow, loading: false, alpha: 1 };
    this.climbers.set(owner, c);
    if (this.library && !c.loading) {
      c.loading = true;
      const id = owner >= BOT_PLAYER_BASE ? BOT_MODEL : this.playerModel;
      const cl = c;
      void this.library
        .character(id, undefined, { height: PLAYER_HEIGHT })
        .then((ch) => {
          if (!this.climbers.has(owner)) return;
          cl.body.clear();
          // Sprites (the pixel style) come in whole-pixel multiples sized for a far camera: fit them to the climber's height.
          if (ch.height > PLAYER_HEIGHT * 1.25) ch.root.scale.setScalar((PLAYER_HEIGHT * 1.15) / ch.height);
          cl.body.add(ch.root);
          cl.model = ch.root;
          cl.animator = ch.animator;
          cl.mats = [];
          ch.root.traverse((o) => {
            const m = (o as Mesh).material as MeshStandardMaterial | undefined;
            if (m && (m as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial) cl.mats.push(m);
            (o as Mesh).castShadow = true;
          });
          cl.outfit = -1;
        })
        .catch(() => undefined);
    }
    return c;
  }

  /** Draw one frame. `self` is our predicted climber, `others` everyone else ~100 ms back. Returns what happened to us. */
  frame(o: { dt: number; realDt: number; self: SceneEntity | undefined; others: readonly SceneEntity[]; selfPlayer: number; course: number; preview?: boolean }): FrameEvents {
    const ev: FrameEvents = { jumped: false, airJump: false, landed: 0, coins: 0, fell: false, shielded: false, checkpoint: false, finished: false, dashed: false, sprung: false };
    this.setCourse(o.course);
    const level = this.level;
    this.time += o.dt;
    const all = [...(o.self ? [o.self] : []), ...o.others];
    const seen = new Set<number>();
    const clock = o.self ? (o.self.values[PF.clock] ?? 0) : (o.others[0]?.values[PF.clock] ?? 0);
    for (const e of all) {
      seen.add(e.owner);
      const c = this.climber(e.owner);
      const v = e.values;
      const x = (v[PF.x] ?? 0) / Q;
      const y = (v[PF.y] ?? 0) / Q;
      const vx = (v[PF.vx] ?? 0) / Q;
      const vy = (v[PF.vy] ?? 0) / Q;
      const flags = v[PF.flags] ?? 0;
      const mine = e === o.self;
      const grounded = (flags & PlatFlag.Grounded) !== 0;
      const dead = (flags & PlatFlag.Dead) !== 0;
      // Ghost racers: everyone else sits a little behind on z and fades a touch, so you always read your own climber.
      const z = mine ? 0.35 : -0.25 - ((e.owner % 4) * 0.12);
      c.root.position.set(x, y, z);
      c.root.visible = !dead;
      c.shadow.visible = !dead && grounded;
      c.shadow.position.set(x, y + 0.02, z);
      const want = vx < -0.3 ? -1 : vx > 0.3 ? 1 : c.facing;
      c.facing = want;
      // Face the run (slightly toward the camera, so a face reads).
      const target = want > 0 ? Math.PI / 2 - 0.35 : -Math.PI / 2 + 0.35;
      c.body.rotation.y += (target - c.body.rotation.y) * Math.min(1, o.realDt * 18);
      const was = c.lastFlags;
      const wasGrounded = (was & PlatFlag.Grounded) !== 0;
      if (wasGrounded && !grounded && vy > 4) {
        c.squash = -0.22;
        if (mine) {
          ev.jumped = true;
          this.counts.jumps++;
        }
      } else if (!wasGrounded && !grounded && vy > c.lastVy + 6 && mine) {
        ev.jumped = true;
        ev.airJump = true;
        c.squash = -0.18;
      }
      if (!wasGrounded && grounded) {
        const fall = Math.max(0, -c.lastVy);
        c.squash = Math.min(0.3, 0.06 + fall * 0.012);
        if (fall > 6) this.stack.particles.burst("dust", x, y + 0.05, z, { count: Math.round(6 + fall * 0.5), color: 0xd8c6a0 });
        if (mine) {
          ev.landed = fall;
          this.counts.lands++;
        }
      }
      if ((flags & PlatFlag.Dead) !== 0 && (was & PlatFlag.Dead) === 0) {
        this.stack.particles.burst("burst", x, y + 0.7, z, { count: 24, color: c.color });
        if (mine) {
          ev.fell = true;
          this.counts.falls++;
        }
      }
      if (mine && (flags & PlatFlag.Finished) !== 0 && (was & PlatFlag.Finished) === 0) {
        ev.finished = true;
        this.stack.particles.burst("magic", x, y + 1.5, z, { count: 40, color: 0xffd23f });
      }
      if (mine && Math.abs(vx) > 13 && (flags & PlatFlag.Grounded) === 0 && Math.abs(vy) < 0.01) {
        if (Math.abs(c.lastVy) > 0.01 || (was & PlatFlag.Grounded) !== 0) {
          ev.dashed = true;
          this.counts.dashes++;
        }
      }
      if (mine && vy > 19 && c.lastVy <= 0) {
        ev.sprung = true;
        this.counts.springs++;
      }
      // Squash and stretch: a spring back to 1.
      c.squash *= Math.exp(-o.realDt * 12);
      const stretch = grounded ? 0 : Math.max(-0.12, Math.min(0.14, vy * 0.008));
      const sy = 1 - c.squash + stretch;
      c.body.scale.set(1 + (1 - sy) * 0.6, sy, 1 + (1 - sy) * 0.6);
      c.tag.position.y = PLAYER_HEIGHT + 0.45 + Math.sin(this.time * 4 + e.owner) * 0.06;
      c.tag.visible = mine || e.owner < BOT_PLAYER_BASE;
      // Outfit: the cosmetic tints the climber.
      const outfit = (v[PF.cosmetic] ?? 0) & 0xff;
      if (outfit !== c.outfit) {
        c.outfit = outfit;
        const look = outfitOf(outfit, c.color);
        // Every climber glows faintly in their own colour (people apart at a glance); an outfit glows stronger in its own.
        for (const m of c.mats) m.emissive?.setHex(outfit === 0 ? c.color : look.body).multiplyScalar(outfit === 0 ? (c.model ? 0.07 : 0.25) : 0.35);
      }
      if (c.animator) {
        if (!grounded && !dead) {
          if ((was & PlatFlag.Grounded) !== 0 || c.animator.playing === null) c.animator.play("jump", { hold: true });
        } else {
          if ((was & PlatFlag.Grounded) === 0) c.animator.play("run");
          c.animator.setSpeed(Math.abs(vx));
        }
        c.animator.update(o.dt);
      }
      c.lastFlags = flags;
      c.lastY = y;
      c.lastVy = vy;
      if (mine && level) {
        // Coins: the ones we hold vanish (each climber collects their own).
        const n = countBits(v[PF.coinsLo] ?? 0) + countBits(v[PF.coinsHi] ?? 0);
        if (this.lastCoins >= 0 && n > this.lastCoins) {
          ev.coins = n - this.lastCoins;
          this.counts.coins += ev.coins;
          this.stack.particles.burst("sparks", x, y + 1, z, { count: 10, color: 0xffd23f });
        }
        this.lastCoins = n;
        this.updateCoins(level, v[PF.coinsLo] ?? 0, v[PF.coinsHi] ?? 0);
        const cp = (v[PF.cp] ?? 0) - 1;
        if (this.lastCp > -2 && cp > this.lastCp) ev.checkpoint = true;
        if (cp !== this.lastCp) this.checkpoints.forEach((k, i) => this.markCheckpoint(k, i <= cp));
        this.lastCp = cp;
        if (((v[PF.timers] ?? 0) >>> 28) < ((c as unknown as { lastShield?: number }).lastShield ?? 0)) ev.shielded = true;
        (c as unknown as { lastShield?: number }).lastShield = (v[PF.timers] ?? 0) >>> 28;
        // Hold the camera while a fall plays out (never chase a climber into the drop).
        if (!dead) this.focus.set(x, Math.max(y + 1.2, level.killY + 9), 0);
      }
    }
    for (const [owner, c] of this.climbers) {
      if (seen.has(owner)) continue;
      this.scene.remove(c.root, c.shadow);
      c.animator?.dispose();
      this.climbers.delete(owner);
    }
    // Moving platforms on the course clock.
    if (level) {
      level.movers.forEach((m, i) => {
        const b = moverBox(m, clock);
        const mesh = this.movers[i];
        if (mesh) mesh.position.set((b[0] + b[2]) / 2, b[3] - 0.22, 0);
      });
      this.springs.forEach((pad) => {
        pad.position.y = (pad.userData.restY as number) + Math.abs(Math.sin(this.time * 3)) * 0.04;
      });
      this.waveFlag();
    }
    if (!o.self && o.others.length > 0) {
      // Watching (preview): follow the leader.
      let lead = o.others[0];
      for (const e of o.others) if ((e.values[PF.x] ?? 0) > (lead?.values[PF.x] ?? 0)) lead = e;
      if (lead) this.focus.set((lead.values[PF.x] ?? 0) / Q, (lead.values[PF.y] ?? 0) / Q + 1.2, 0);
    }
    this.rig.update(this.focus, o.dt, o.realDt);
    this.stack.frame(o.dt, this.focus);
    return ev;
  }

  private updateCoins(level: PlatformLevel, lo: number, hi: number): void {
    const mesh = this.coins;
    if (!mesh) return;
    this.coinSpin += 0.05;
    const arr = mesh.instanceMatrix.array as Float32Array;
    const p = { coinsLo: lo, coinsHi: hi };
    for (let i = 0; i < level.coins.length; i++) {
      const c = level.coins[i] as readonly [number, number];
      const taken = platformCoinTaken(p, i);
      const sc = taken ? 0 : 1;
      const a = this.coinSpin + i * 0.4;
      const cs = Math.cos(a) * sc;
      const sn = Math.sin(a) * sc;
      const o = i * 16;
      arr[o] = cs;
      arr[o + 1] = 0;
      arr[o + 2] = -sn;
      arr[o + 3] = 0;
      arr[o + 4] = 0;
      arr[o + 5] = sc;
      arr[o + 6] = 0;
      arr[o + 7] = 0;
      arr[o + 8] = sn;
      arr[o + 9] = 0;
      arr[o + 10] = cs;
      arr[o + 11] = 0;
      arr[o + 12] = c[0];
      arr[o + 13] = c[1] - (this.coinModel ? 0.35 : 0) + Math.sin(this.time * 2.4 + i) * 0.08;
      arr[o + 14] = 0;
      arr[o + 15] = 1;
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  private markCheckpoint(k: { flag: Mesh; reached: boolean }, on: boolean): void {
    if (k.reached === on) return;
    k.reached = on;
    (k.flag.material as MeshStandardMaterial).color.setHex(on ? 0x7ee08a : 0x9aa3b4);
    if (on) this.stack.particles.burst("magic", k.flag.position.x, k.flag.position.y, k.flag.position.z, { count: 16, color: 0x7ee08a });
  }

  private waveFlag(): void {
    const f = this.flagCloth;
    if (!f) return;
    const pos = f.geometry.attributes.position;
    const base = f.userData.base as Float32Array | undefined;
    if (!pos || !base) return;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3] ?? 0;
      const k = (bx + 0.9) / 1.8;
      arr[i * 3 + 2] = (base[i * 3 + 2] ?? 0) + Math.sin(this.time * 5 - bx * 3) * 0.14 * k;
    }
    pos.needsUpdate = true;
  }

  /** Screen position (CSS px) of a world point. */
  project(x: number, y: number, z: number, w: number, h: number): { x: number; y: number; visible: boolean } {
    const v = new Vector3(x, y, z).project(this.rig.camera);
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, visible: v.z < 1 };
  }

  resize(w: number, h: number): void {
    this.rig.resize(w / h);
    // Portrait phones see more height: pull back a little.
    this.rig.setDistance(w / h < 1 ? 24 : 17);
    this.stack.resize(w, h);
  }
}

function countBits(v: number): number {
  let n = 0;
  for (let x = v >>> 0; x; x &= x - 1) n++;
  return n;
}
