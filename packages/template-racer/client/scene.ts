/**
 * The TORQUEBAY scene: a chase camera over a harbour circuit in three.js
 * (WebGPU with WebGL2 fallback, the engine render stack in every art style).
 *
 * The track streams: it is cut into chunks of about
 * 40 m of road, and only the chunks near the camera are built (road ribbon,
 * grass verges, kerbs, barriers and the scenery past them); chunks behind
 * the camera are dropped. At most two chunks build a frame, nearest first,
 * so a long track never stalls a frame and memory holds only the road you
 * can see. Karts are library models (sprites in the pixel style) that lean
 * into drifts, spit sparks in the drift tier's colour and flame on boosts.
 */
import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
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
  SRGBColorSpace,
  Vector3,
} from "three/webgpu";
import type { Material, Object3D } from "three/webgpu";
import { CameraRig, createRenderStack, styleKit } from "@netforge/engine/runtime";
import type { FeelKit, RenderStack, RendererHandle, StyleKit } from "@netforge/engine/runtime";
import { KF } from "@netforge/engine/game";
import type { CompiledRacer } from "@netforge/engine/game";
import { BOT_PLAYER_BASE, buildKartTrack, KartFlag, kartCoinTaken } from "@netforge/engine-sim";
import type { KartTrack } from "@netforge/engine-sim";
import type { CharacterAnimator, LibraryClient } from "@netforge/asset-library/three";
import { placeStatic } from "@netforge/asset-library/three";
import { BOT_MODELS, COIN_MODEL, KART_HEIGHT, MODEL_YAW, PIXEL_BOTS, SCENERY } from "./decor.js";
import { KEEPER_COLORS } from "./names.js";

export interface SceneEntity {
  readonly id: number;
  readonly kind: number;
  readonly owner: number;
  readonly values: readonly number[];
}

export interface FrameEvents {
  coins: number;
  turbo: number;
  boostStart: boolean;
  wall: boolean;
  lap: number;
  finished: boolean;
  driftStart: boolean;
}

const Q = 1024;
const TAU = Math.PI * 2;
/** Samples per streamed chunk (~2 m a sample). */
const CHUNK = 20;
/** Chunks within this distance of the camera's focus are built, m. */
const STREAM_RADIUS = 170;
const MAX_BUILDS_PER_FRAME = 2;

export function kartColor(owner: number): number {
  const bots = [0xd94141, 0x3f7fe0, 0x40b860, 0xe0a030, 0x9050d0, 0x30b0b0, 0xe06090];
  if (owner >= BOT_PLAYER_BASE) return bots[(owner - BOT_PLAYER_BASE) % bots.length] ?? 0xd94141;
  return KEEPER_COLORS[(owner - 1) % KEEPER_COLORS.length] ?? 0xffffff;
}

export function paintOf(cosmetic: number, base: number): { body: number; trim: number } {
  if (cosmetic === 1) return { body: 0xff5a1f, trim: 0xffd23f };
  if (cosmetic === 2) return { body: 0xd8dee8, trim: 0x8fd3ff };
  return { body: base, trim: base };
}

function tex(kind: "asphalt" | "grass" | "kerb" | "water" | "check" | "arrow"): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = kind === "kerb" || kind === "check" ? 64 : 128;
  const g = c.getContext("2d");
  if (!g) throw new Error("no 2d canvas");
  let s = 17;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const W = c.width;
  if (kind === "asphalt") {
    g.fillStyle = "#3b3f47";
    g.fillRect(0, 0, W, W);
    for (let i = 0; i < 1400; i++) {
      const v = 50 + Math.floor(rnd() * 26);
      g.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
      g.fillRect(rnd() * W, rnd() * W, 2, 2);
    }
    // Centre dashes run along v.
    g.fillStyle = "rgba(240,240,230,0.75)";
    g.fillRect(W / 2 - 2, 0, 4, W * 0.45);
  } else if (kind === "grass") {
    g.fillStyle = "#4f9a43";
    g.fillRect(0, 0, W, W);
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = `rgba(${40 + rnd() * 40},${120 + rnd() * 50},${40 + rnd() * 30},0.8)`;
      g.fillRect(rnd() * W, rnd() * W, 2, 3);
    }
  } else if (kind === "water") {
    g.fillStyle = "#2c6f9e";
    g.fillRect(0, 0, W, W);
    for (let i = 0; i < 90; i++) {
      g.strokeStyle = `rgba(200,235,255,${0.15 + rnd() * 0.2})`;
      g.beginPath();
      const x = rnd() * W;
      const y = rnd() * W;
      g.moveTo(x, y);
      g.lineTo(x + 10 + rnd() * 14, y);
      g.stroke();
    }
  } else if (kind === "kerb") {
    g.fillStyle = "#e8e8e8";
    g.fillRect(0, 0, W, W);
    g.fillStyle = "#d63b3b";
    g.fillRect(0, 0, W, W / 2);
  } else if (kind === "check") {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? "#111" : "#f4f4f4";
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  } else {
    g.fillStyle = "#1f6fff";
    g.fillRect(0, 0, W, W);
    g.fillStyle = "#9fe8ff";
    for (const y0 of [8, 56]) {
      g.beginPath();
      g.moveTo(W / 2, y0);
      g.lineTo(W - 16, y0 + 40);
      g.lineTo(16, y0 + 40);
      g.fill();
    }
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A ribbon between two lateral offsets of the centreline over samples [a, b] (wrapping), y lifted by `lift`. */
function ribbon(t: KartTrack, a: number, b: number, from: number, to: number, lift: number, vScale: number): BufferGeometry {
  const n = b - a + 1;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const nor = new Float32Array(n * 2 * 3);
  for (let k = 0; k < n; k++) {
    const i = (a + k) % t.count;
    const nx = -(t.tz[i] ?? 0);
    const nz = t.tx[i] ?? 0;
    const cx = t.x[i] ?? 0;
    const cz = t.z[i] ?? 0;
    const d = (t.dist[i] ?? 0) + (a + k >= t.count ? t.length : 0);
    pos.set([cx + nx * from, lift, cz + nz * from, cx + nx * to, lift, cz + nz * to], k * 6);
    uv.set([0, d * vScale, 1, d * vScale], k * 4);
    nor.set([0, 1, 0, 0, 1, 0], k * 6);
  }
  const idx: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    const o = k * 2;
    // Wound to face up whichever side of the centreline the strip lies (from < to or not).
    if (to < from) idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
    else idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("normal", new BufferAttribute(nor, 3));
  g.setAttribute("uv", new BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

interface Chunk {
  readonly group: Group;
  readonly cx: number;
  readonly cz: number;
}

interface KartView {
  root: Group;
  body: Group;
  model: Object3D | null;
  animator: CharacterAnimator | null;
  mats: MeshStandardMaterial[];
  tag: Mesh;
  flame: Mesh;
  color: number;
  paint: number;
  lastFlags: number;
  lastLap: number;
  lastCoins: number;
  lastBoost: number;
  lean: number;
  loading: boolean;
}

export class KartScene {
  readonly scene = new Scene();
  readonly rig: CameraRig;
  readonly stack: RenderStack;
  readonly style: string;
  private readonly kit: StyleKit | null;
  private readonly tracks: KartTrack[];
  private course = -1;
  private track: KartTrack | null = null;
  private trackGroup = new Group();
  private chunks = new Map<number, Chunk>();
  private readonly mats: Record<string, Material>;
  private coins: InstancedMesh | null = null;
  private coinModel: { geometry: BufferGeometry; material: Material } | null = null;
  private readonly karts = new Map<number, KartView>();
  private readonly focus = new Vector3();
  private camYaw = 0;
  private time = 0;
  /** Chunks built and dropped so far (the streaming numbers measure reads). */
  readonly streaming = { built: 0, dropped: 0, live: 0 };
  readonly counts = { coins: 0, turbos: 0, laps: 0, walls: 0 };

  constructor(
    handle: RendererHandle,
    private readonly compiled: CompiledRacer,
    private readonly library: LibraryClient | null,
    private readonly feel: FeelKit | null,
    private readonly playerModel: string,
    opts: { style: string; quality?: "low" | "medium" | "high" },
  ) {
    this.style = opts.style;
    this.kit = styleKit(this.style);
    this.tracks = compiled.tracks.map(buildKartTrack);
    this.rig = new CameraRig(1, { distance: 9.5, height: 1.4, follow: 10, lead: 0.05, leadMax: 2, fov: 62, minPitch: 0.05, maxPitch: 0.9, shake: { maxOffset: 0.25 } });
    this.rig.pitch = 0.3;
    const s = this.scene;
    this.stack = createRenderStack(handle, s, this.rig.camera, {
      preset: "day",
      style: this.style,
      quality: opts.quality ?? "auto",
      shadowExtent: 30,
      atmosphere: { heightFog: 0, near: 90, far: 260 },
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
      s.add(new HemisphereLight(0xd8ecff, 0x40502c, 0.7));
      s.add(new AmbientLight(0xffffff, 0.15));
      const sun = new DirectionalLight(0xfff2dc, 0.6);
      sun.position.set(-30, 60, 20);
      s.add(sun);
    }
    const session = this.stack.session;
    const asphalt = session?.surface?.("floor", { tile: 4, mood: "asphalt road" }) ?? tex("asphalt");
    this.mats = {
      asphalt: new MeshStandardMaterial({ map: asphalt, roughness: 0.9 }),
      grass: new MeshStandardMaterial({ map: session?.surface?.("ground", { tile: 6, mood: "harbour grass" }) ?? tex("grass"), roughness: 1 }),
      kerb: new MeshStandardMaterial({ map: tex("kerb"), roughness: 0.6 }),
      barrier: new MeshStandardMaterial({ color: 0xe6e9ef, roughness: 0.5, metalness: 0.2 }),
      barrierTop: new MeshStandardMaterial({ color: 0x2f62d6, roughness: 0.5 }),
      check: new MeshStandardMaterial({ map: tex("check"), roughness: 0.7 }),
      pad: new MeshBasicMaterial({ map: tex("arrow") }),
    };
    // The bay: water to the horizon, under everything.
    const waterMap = tex("water");
    waterMap.repeat.set(80, 80);
    const water = new Mesh(new PlaneGeometry(2000, 2000), new MeshStandardMaterial({ map: waterMap, roughness: 0.3, metalness: 0.1 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.6;
    water.userData.surface = "water";
    s.add(water, this.trackGroup);
    if (library) {
      void library
        .crowd(COIN_MODEL, undefined, { height: 1 })
        .then((m) => {
          const p = m.parts[0];
          if (p) this.coinModel = { geometry: p.geometry, material: p.material };
          if (this.track) this.buildCoins(this.track);
        })
        .catch(() => undefined);
    }
  }

  setCourse(index: number): void {
    if (index === this.course) return;
    const t = this.tracks[index];
    if (!t) return;
    this.course = index;
    this.track = t;
    this.scene.remove(this.trackGroup);
    this.trackGroup = new Group();
    this.scene.add(this.trackGroup);
    this.chunks.clear();
    this.streaming.live = 0;
    // An island under the circuit: grass far enough round the track (the chunks lay their own verges).
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < t.count; i++) {
      minX = Math.min(minX, t.x[i] ?? 0);
      maxX = Math.max(maxX, t.x[i] ?? 0);
      minZ = Math.min(minZ, t.z[i] ?? 0);
      maxZ = Math.max(maxZ, t.z[i] ?? 0);
    }
    const pad = t.wall + 30;
    const isl = new Mesh(new BoxGeometry(maxX - minX + pad * 2, 1, maxZ - minZ + pad * 2), this.mats.grass as Material);
    const gm = (this.mats.grass as MeshStandardMaterial).map;
    if (gm) gm.repeat.set((maxX - minX + pad * 2) / 6, (maxZ - minZ + pad * 2) / 6);
    isl.position.set((minX + maxX) / 2, -0.55, (minZ + maxZ) / 2);
    isl.userData.surface = "grass";
    this.trackGroup.add(isl);
    // Start line and boost pads.
    const line = new Mesh(ribbon(t, 0, 1, -t.half, t.half, 0.03, 1), this.mats.check as Material);
    this.trackGroup.add(line);
    for (const p of t.pads) {
      const m = new Mesh(new PlaneGeometry(2.6, 3.6), this.mats.pad as Material);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = -Math.atan2(p.tz, p.tx) + Math.PI / 2;
      m.position.set(p.x, 0.04, p.z);
      this.trackGroup.add(m);
    }
    this.buildCoins(t);
  }

  private buildCoins(t: KartTrack): void {
    if (this.coins) this.trackGroup.remove(this.coins);
    const geo = this.coinModel?.geometry ?? new CylinderGeometry(0.45, 0.45, 0.1, 16).rotateX(Math.PI / 2);
    const mat = this.coinModel?.material ?? new MeshStandardMaterial({ color: 0xffd23f, emissive: new Color(0x6a4a00), metalness: 0.7, roughness: 0.3 });
    const m = new InstancedMesh(geo, mat, Math.max(1, t.coinAt.length));
    m.count = t.coinAt.length;
    m.frustumCulled = false;
    this.coins = m;
    this.trackGroup.add(m);
  }

  /** Build a chunk: road, verges, kerbs, barriers and the scenery past them. */
  private buildChunk(t: KartTrack, c: number): Chunk {
    const a = c * CHUNK;
    const b = Math.min(a + CHUNK, t.count);
    const g = new Group();
    const road = new Mesh(ribbon(t, a, b, -t.half, t.half, 0.02, 0.25), this.mats.asphalt as Material);
    road.userData.surface = "floor";
    road.receiveShadow = true;
    g.add(road);
    for (const side of [-1, 1]) {
      const kerb = new Mesh(ribbon(t, a, b, side * t.half, side * (t.half + 0.9), 0.03, 0.5), this.mats.kerb as Material);
      g.add(kerb);
    }
    // Barriers: low rails along the wall line, one instanced draw a chunk.
    const n = Math.ceil((b - a) / 2);
    const rails = new InstancedMesh(new BoxGeometry(4.2, 0.9, 0.5), this.mats.barrier as Material, n * 2);
    let k = 0;
    const m = rails.instanceMatrix.array as Float32Array;
    for (let i = a; i < b; i += 2) {
      for (const side of [-1, 1]) {
        const nx = -(t.tz[i] ?? 0) * side;
        const nz = (t.tx[i] ?? 0) * side;
        const x = (t.x[i] ?? 0) + nx * (t.wall + 0.3);
        const z = (t.z[i] ?? 0) + nz * (t.wall + 0.3);
        const yaw = Math.atan2(t.tz[i] ?? 0, t.tx[i] ?? 1);
        const cs = Math.cos(-yaw);
        const sn = Math.sin(-yaw);
        m.set([cs, 0, -sn, 0, 0, 1, 0, 0, sn, 0, cs, 0, x, 0.45, z, 1], k * 16);
        k++;
      }
    }
    rails.count = k;
    rails.instanceMatrix.needsUpdate = true;
    g.add(rails);
    // Scenery past the barriers, deterministic per chunk.
    if (this.library) {
      let s = 1000 + c * 97 + this.course * 7919;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (const [id, height, every] of SCENERY) {
        const places: { x: number; y: number; z: number; yaw: number }[] = [];
        for (let i = a; i < b; i += every) {
          if (rnd() > 0.55) continue;
          const side = rnd() < 0.5 ? -1 : 1;
          const out = t.wall + 4 + rnd() * 16;
          const nx = -(t.tz[i] ?? 0) * side;
          const nz = (t.tx[i] ?? 0) * side;
          const x = (t.x[i] ?? 0) + nx * out;
          const z = (t.z[i] ?? 0) + nz * out;
          if (this.nearRoad(t, x, z)) continue;
          places.push({ x, y: 0, z, yaw: rnd() * TAU });
        }
        if (places.length === 0) continue;
        void this.library
          .crowd(id, undefined, { height })
          .then((model) => {
            for (const o of placeStatic(model, places)) g.add(o);
          })
          .catch(() => undefined);
      }
    }
    const mid = Math.min(t.count - 1, a + CHUNK / 2);
    this.trackGroup.add(g);
    this.streaming.built++;
    return { group: g, cx: t.x[mid] ?? 0, cz: t.z[mid] ?? 0 };
  }

  /** True when (x, z) is within the wall of any part of the track (scenery stays off the road). */
  private nearRoad(t: KartTrack, x: number, z: number): boolean {
    for (let i = 0; i < t.count; i += 3) {
      const dx = (t.x[i] ?? 0) - x;
      const dz = (t.z[i] ?? 0) - z;
      if (dx * dx + dz * dz < (t.wall + 3) ** 2) return true;
    }
    return false;
  }

  /** Stream: build the nearest missing chunks (two a frame) and drop far ones. */
  private stream(): void {
    const t = this.track;
    if (!t) return;
    const total = Math.ceil(t.count / CHUNK);
    const want: { c: number; d: number }[] = [];
    for (let c = 0; c < total; c++) {
      const i = Math.min(t.count - 1, c * CHUNK + CHUNK / 2);
      const d = Math.hypot((t.x[i] ?? 0) - this.focus.x, (t.z[i] ?? 0) - this.focus.z);
      if (d < STREAM_RADIUS) want.push({ c, d });
      else {
        const have = this.chunks.get(c);
        if (have && d > STREAM_RADIUS + 30) {
          this.trackGroup.remove(have.group);
          have.group.traverse((o) => (o as Mesh).geometry?.dispose?.());
          this.chunks.delete(c);
          this.streaming.dropped++;
        }
      }
    }
    want.sort((p, q) => p.d - q.d);
    let built = 0;
    for (const { c } of want) {
      if (this.chunks.has(c)) continue;
      if (built++ >= MAX_BUILDS_PER_FRAME) break;
      this.chunks.set(c, this.buildChunk(t, c));
    }
    this.streaming.live = this.chunks.size;
  }

  private kart(owner: number): KartView {
    let v = this.karts.get(owner);
    if (v) return v;
    const root = new Group();
    const body = new Group();
    root.add(body);
    const color = kartColor(owner);
    const mat = new MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2 });
    const chassis = new Mesh(new BoxGeometry(1.8, 0.45, 1.1), mat);
    chassis.position.y = 0.4;
    body.add(chassis);
    const tag = new Mesh(new CylinderGeometry(0, 0.2, 0.35, 4), new MeshBasicMaterial({ color }));
    tag.rotation.x = Math.PI;
    tag.position.y = KART_HEIGHT + 1.1;
    const flame = new Mesh(new CylinderGeometry(0.05, 0.28, 1.2, 8), new MeshBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0.85 }));
    flame.rotation.z = Math.PI / 2;
    flame.position.set(-1.3, 0.45, 0);
    flame.visible = false;
    body.add(flame);
    root.add(tag);
    this.scene.add(root);
    v = { root, body, model: null, animator: null, mats: [mat], tag, flame, color, paint: -1, lastFlags: 0, lastLap: -1, lastCoins: -1, lastBoost: 0, lean: 0, loading: false };
    this.karts.set(owner, v);
    if (this.library) {
      v.loading = true;
      const bots = this.style === "pixel" ? PIXEL_BOTS : BOT_MODELS;
      const id = owner >= BOT_PLAYER_BASE ? (bots[(owner - BOT_PLAYER_BASE) % bots.length] ?? this.playerModel) : this.playerModel;
      const kv = v;
      void this.library
        .character(id, undefined, { height: KART_HEIGHT })
        .then((ch) => {
          if (!this.karts.has(owner)) return;
          for (const c of [...kv.body.children]) if (c !== kv.flame) kv.body.remove(c);
          if (ch.height > KART_HEIGHT * 1.4) ch.root.scale.setScalar((KART_HEIGHT * 1.2) / ch.height);
          ch.root.rotation.y = MODEL_YAW;
          kv.body.add(ch.root);
          kv.model = ch.root;
          kv.animator = ch.animator;
          kv.mats = [];
          ch.root.traverse((o) => {
            const m = (o as Mesh).material as MeshStandardMaterial | undefined;
            if (m && (m as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial) kv.mats.push(m);
            (o as Mesh).castShadow = true;
          });
          kv.paint = -1;
        })
        .catch(() => undefined);
    }
    return v;
  }

  frame(o: { dt: number; realDt: number; self: SceneEntity | undefined; others: readonly SceneEntity[]; course: number }): FrameEvents {
    const ev: FrameEvents = { coins: 0, turbo: 0, boostStart: false, wall: false, lap: 0, finished: false, driftStart: false };
    this.setCourse(o.course);
    const t = this.track;
    this.time += o.dt;
    const seen = new Set<number>();
    const all = [...(o.self ? [o.self] : []), ...o.others];
    for (const e of all) {
      seen.add(e.owner);
      const v = this.kart(e.owner);
      const vals = e.values;
      const x = (vals[KF.x] ?? 0) / Q;
      const z = (vals[KF.z] ?? 0) / Q;
      const yaw = ((vals[KF.yaw] ?? 0) / 65536) * TAU;
      const flags = vals[KF.flags] ?? 0;
      const mine = e === o.self;
      v.root.position.set(x, 0, z);
      v.root.rotation.y = -yaw;
      // Lean into a drift.
      const drifting = (flags & KartFlag.Drifting) !== 0;
      const dir = (flags & KartFlag.DriftRight) !== 0 ? 1 : -1;
      const leanTo = drifting ? dir * 0.12 : 0;
      v.lean += (leanTo - v.lean) * Math.min(1, o.realDt * 10);
      v.body.rotation.x = v.lean;
      v.body.rotation.y = drifting ? -dir * 0.25 : 0;
      const boosting = (flags & KartFlag.Boosting) !== 0;
      v.flame.visible = boosting;
      if (boosting) v.flame.scale.set(1, 0.8 + Math.sin(this.time * 40) * 0.25, 1);
      const timers = vals[KF.timers] ?? 0;
      const charge = timers & 0xfff;
      if (drifting) {
        const tier = charge >= 120 ? 3 : charge >= 72 ? 2 : charge >= 33 ? 1 : 0;
        const color = tier === 3 ? 0xd16bff : tier === 2 ? 0xffa53a : tier === 1 ? 0x5fc8ff : 0xdddddd;
        if (Math.floor(this.time * 30) % 2 === 0) {
          const bx = x - Math.cos(yaw) * 0.9;
          const bz = z - Math.sin(yaw) * 0.9;
          this.stack.particles.burst("sparks", bx, 0.15, bz, { count: tier > 0 ? 3 : 1, color });
        }
      }
      if (mine) {
        if (drifting && (v.lastFlags & KartFlag.Drifting) === 0) ev.driftStart = true;
        const boost = (timers >>> 12) & 0xfff;
        if (boost > v.lastBoost + 5) {
          ev.boostStart = true;
          this.stack.particles.burst("burst", x, 0.5, z, { count: 14, color: 0x7fd0ff });
        }
        v.lastBoost = boost;
        if ((flags & KartFlag.Bumped) !== 0 && (v.lastFlags & KartFlag.Bumped) === 0) {
          ev.wall = true;
          this.counts.walls++;
        }
        const lap = ((vals[KF.track] ?? 0) >>> 16) & 0xff;
        if (v.lastLap >= 0 && lap > v.lastLap) {
          ev.lap = lap;
          this.counts.laps++;
        }
        v.lastLap = lap;
        if ((flags & KartFlag.Finished) !== 0 && (v.lastFlags & KartFlag.Finished) === 0) {
          ev.finished = true;
          this.stack.particles.burst("magic", x, 1.5, z, { count: 40, color: 0xffd23f });
        }
        const n = countBits(vals[KF.coinsLo] ?? 0) + countBits(vals[KF.coinsHi] ?? 0);
        if (v.lastCoins >= 0 && n > v.lastCoins) {
          ev.coins = n - v.lastCoins;
          this.counts.coins += ev.coins;
          this.stack.particles.burst("sparks", x, 1, z, { count: 8, color: 0xffd23f });
        }
        v.lastCoins = n;
        if (t) this.updateCoins(t, vals[KF.coinsLo] ?? 0, vals[KF.coinsHi] ?? 0);
        // The chase camera: behind the kart, swinging round smoothly.
        const want = Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
        let d = want - this.camYaw;
        while (d > Math.PI) d -= TAU;
        while (d < -Math.PI) d += TAU;
        this.camYaw += d * Math.min(1, o.realDt * 5);
        this.rig.yaw = this.camYaw;
        this.focus.set(x, 0.8, z);
      }
      v.lastFlags = flags;
      // Paint: the cosmetic tints the kart.
      const paint = (vals[KF.cosmetic] ?? 0) & 0xff;
      if (paint !== v.paint) {
        v.paint = paint;
        const look = paintOf(paint, v.color);
        for (const m of v.mats) m.emissive?.setHex(paint === 0 ? v.color : look.body).multiplyScalar(paint === 0 ? (v.model ? 0.12 : 0.25) : 0.4);
      }
      v.tag.visible = !mine && e.owner < BOT_PLAYER_BASE;
      v.animator?.update(o.dt);
    }
    for (const [owner, v] of this.karts) {
      if (seen.has(owner)) continue;
      this.scene.remove(v.root);
      this.karts.delete(owner);
    }
    if (!o.self && o.others[0]) {
      const lead = o.others[0];
      this.focus.set((lead.values[KF.x] ?? 0) / Q, 0.8, (lead.values[KF.z] ?? 0) / Q);
    }
    this.stream();
    this.rig.update(this.focus, o.dt, o.realDt);
    this.stack.frame(o.dt, this.focus);
    return ev;
  }

  private updateCoins(t: KartTrack, lo: number, hi: number): void {
    const mesh = this.coins;
    if (!mesh) return;
    const arr = mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < t.coinAt.length; i++) {
      const c = t.coinAt[i] as readonly [number, number];
      const sc = kartCoinTaken({ coinsLo: lo, coinsHi: hi }, i) ? 0 : 1;
      const a = this.time * 3 + i * 0.5;
      const cs = Math.cos(a) * sc;
      const sn = Math.sin(a) * sc;
      arr.set([cs, 0, -sn, 0, 0, sc, 0, 0, sn, 0, cs, 0, c[0], 0.9 + Math.sin(this.time * 2 + i) * 0.1 - (this.coinModel ? 0.5 : 0), c[1], 1], i * 16);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  project(x: number, y: number, z: number, w: number, h: number): { x: number; y: number; visible: boolean } {
    const v = new Vector3(x, y, z).project(this.rig.camera);
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, visible: v.z < 1 };
  }

  resize(w: number, h: number): void {
    this.rig.resize(w / h);
    this.rig.setDistance(w / h < 1 ? 12 : 9.5);
    this.stack.resize(w, h);
  }

  /** The track as drawn (the minimap reads it). */
  get trackNow(): KartTrack | null {
    return this.track;
  }
}

function countBits(v: number): number {
  let n = 0;
  for (let x = v >>> 0; x; x &= x - 1) n++;
  return n;
}
