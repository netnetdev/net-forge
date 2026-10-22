/**
 * The VOLTYARD scene: three.js (WebGPU with WebGL2 fallback, via the engine
 * runtime). The yard is one floor, one fence and three merged draws for all
 * the transformers; projectiles, heal cells and sparks are instanced; each
 * wirejack is a few meshes. Game feel that lives in
 * the world: muzzle flashes, beams, hit flashes, death bursts, spawn
 * shields, camera lead toward the aim and shake.
 */
import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Plane,
  PlaneGeometry,
  PointLight,
  Raycaster,
  RepeatWrapping,
  RingGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
} from "three/webgpu";
import type { BufferGeometry } from "three/webgpu";
import { CameraRig, createRenderStack, fieldBounds, HeroHighlight, styleKit } from "@netnetcapital/engine/runtime";
import type { FeelKit, FieldSpec, RenderStack, RendererHandle, StyleKit } from "@netnetcapital/engine/runtime";
import { CROWD_UNITS, F, PLAYER_UNITS } from "@netnetcapital/engine/game";
import type { CompiledGame } from "@netnetcapital/engine/game";
import { beamRange, BOT_PLAYER_BASE, EntityFlag, EntityKind, slotWeapon } from "@netnetcapital/engine-sim";
import type { ResolvedSimConfig, WeaponDef } from "@netnetcapital/engine-sim";
import type { CharacterAnimator, LibraryClient } from "@netnetcapital/asset-library/three";
import { placeStatic } from "@netnetcapital/asset-library/three";
import { assetById, restyleId } from "@netnetcapital/asset-library";
import { BOT_MODEL, HELD_MODEL, PILLAR_MODEL, PLAYER_HEIGHT, YARD_DECOR } from "./decor.js";
import { fx, merge, resolveAsset } from "./library.js";
import { finishOf, playerColor } from "./palette.js";

/** One entity as the scene sees it (netcode values in the engine wire schema). */
export interface SceneEntity {
  readonly id: number;
  readonly kind: number;
  readonly owner: number;
  readonly values: readonly number[];
}

export interface FrameInput {
  /** Seconds since the last frame (already scaled by hit-stop). */
  readonly dt: number;
  /** Real seconds since the last frame (shake and punches keep moving during a hit-stop). */
  readonly realDt?: number;
  /** Our own predicted character (drawn ahead of the server). */
  readonly self: SceneEntity | undefined;
  /** Everyone and everything else, interpolated ~100 ms in the past. */
  readonly others: readonly SceneEntity[];
  readonly selfPlayer: number;
  /** Our aim this frame (the input's, ahead of the sim), radians. */
  readonly aim: number;
}

export interface FrameEvents {
  /** Opponents hurt soon after our own shots (ours, very likely): position, amount, who and the push direction. */
  hits: { x: number; y: number; z: number; amount: number; id: number; dirX: number; dirZ: number }[];
  /** Opponents that went down soon after we hit them (our kills, very likely). */
  kills: { x: number; z: number; id: number; color: number; dirX: number; dirZ: number }[];
  /** Our character took damage this frame (amount). */
  selfHurt: number;
  /** Our character healed (a cell). */
  selfHealed: boolean;
  /** Our character went down this frame. */
  selfDown: boolean;
  /** Someone else went down this frame (near us). */
  downs: number;
  /** Shots seen this frame. */
  shots: { kind: string; mine: boolean }[];
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

const MAX_BOLTS = 240;
const MAX_PELLETS = 320;
const MAX_CELLS = 48;
const MAX_PARTICLES = 700;
const BEAM_SECONDS = 0.2;
const FLASH_SECONDS = 0.06;
const PLAYER_HITBOX = 0.6;
/** How much of its own colour a wirejack glows with: enough to read against the dark yard from any distance. */
const GLOW = 0.55;
/** Seconds after one of our bolts reaches a wirejack on screen that its damage (and death) count as ours. */
const OURS_WINDOW = 0.6;
const MAX_LOCAL_SHOTS = 96;
/** The camera shows at most this much of the lot past the fence, m. */
const CAMERA_MARGIN = 5;
/** Preview camera: fighters this close to one another count as one fight, m. */
const PREVIEW_RADIUS = 20;
/** Preview camera distance bounds, m (the game's own is 31), and its pitch (the game's is 1.22). */
const PREVIEW_MIN_DISTANCE = 20;
const PREVIEW_MAX_DISTANCE = 48;
const PREVIEW_PITCH = 0.92;
/** The world theme a style kit dresses VOLTYARD as (the voxel style's YARD palette). */
const YARD_THEME = "yard";

const pos = (e: SceneEntity): [number, number, number] =>
  e.kind === EntityKind.Player
    ? [(e.values[F.px] ?? 0) / PLAYER_UNITS, (e.values[F.py] ?? 0) / PLAYER_UNITS, (e.values[F.pz] ?? 0) / PLAYER_UNITS]
    : [(e.values[F.ex] ?? 0) / CROWD_UNITS, 0, (e.values[F.ez] ?? 0) / CROWD_UNITS];

function floorTexture(half: number): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  if (!g) throw new Error("no 2d canvas");
  g.fillStyle = "#151b26";
  g.fillRect(0, 0, 512, 512);
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) {
    const v = 20 + Math.floor(rnd() * 22);
    g.fillStyle = `rgb(${v},${v + 4},${v + 12})`;
    g.fillRect(Math.floor(rnd() * 512), Math.floor(rnd() * 512), 2, 2);
  }
  // Panel seams every 4 m.
  const cells = (half * 2) / 4;
  g.strokeStyle = "rgba(120,170,220,0.10)";
  g.lineWidth = 2;
  for (let i = 0; i <= cells; i++) {
    const p = (i / cells) * 512;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, 512);
    g.moveTo(0, p);
    g.lineTo(512, p);
    g.stroke();
  }
  // A painted centre circle and lane marks.
  g.strokeStyle = "rgba(22,224,255,0.18)";
  g.lineWidth = 4;
  g.beginPath();
  g.arc(256, 256, 70, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = "rgba(255,176,32,0.28)";
  g.setLineDash([18, 14]);
  g.beginPath();
  g.moveTo(256, 20);
  g.lineTo(256, 180);
  g.moveTo(256, 332);
  g.lineTo(256, 492);
  g.moveTo(20, 256);
  g.lineTo(180, 256);
  g.moveTo(332, 256);
  g.lineTo(492, 256);
  g.stroke();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Hazard stripes for the fence's top band. */
function stripeTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 16;
  const g = c.getContext("2d");
  if (!g) throw new Error("no 2d canvas");
  g.fillStyle = "#151515";
  g.fillRect(0, 0, 64, 16);
  g.fillStyle = "#ffb020";
  for (let x = -16; x < 64; x += 16) {
    g.beginPath();
    g.moveTo(x, 16);
    g.lineTo(x + 8, 0);
    g.lineTo(x + 16, 0);
    g.lineTo(x + 8, 16);
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** The lot outside the fence: dark gravel with a few oil stains, repeated `repeat` times across. */
function gravelTexture(repeat: number): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  if (!g) throw new Error("no 2d canvas");
  g.fillStyle = "#1c2028";
  g.fillRect(0, 0, 256, 256);
  let s = 23;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = "rgba(8,10,14,0.35)";
    g.beginPath();
    g.ellipse(rnd() * 256, rnd() * 256, 18 + rnd() * 30, 10 + rnd() * 18, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 5000; i++) {
    const v = 22 + Math.floor(rnd() * 30);
    g.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
    g.fillRect(Math.floor(rnd() * 256), Math.floor(rnd() * 256), 2, 2);
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = SRGBColorSpace;
  return t;
}

class Crowd {
  mesh: InstancedMesh;
  count = 0;
  constructor(geometry: BufferGeometry, material: Material, readonly capacity: number) {
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }
  /** Draw a library model instead of the shape (same capacity and instances). */
  swap(geometry: BufferGeometry, material: Material): void {
    const m = new InstancedMesh(geometry, material, this.capacity);
    m.instanceMatrix = this.mesh.instanceMatrix;
    m.count = this.mesh.count;
    m.frustumCulled = false;
    this.mesh = m;
  }
  begin(): void {
    this.count = 0;
  }
  push(x: number, y: number, z: number, yaw: number, scale: number): void {
    if (this.count >= this.capacity) return;
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const o = this.count * 16;
    const c = Math.cos(yaw) * scale;
    const s = Math.sin(yaw) * scale;
    m[o] = c;
    m[o + 1] = 0;
    m[o + 2] = -s;
    m[o + 3] = 0;
    m[o + 4] = 0;
    m[o + 5] = scale;
    m[o + 6] = 0;
    m[o + 7] = 0;
    m[o + 8] = s;
    m[o + 9] = 0;
    m[o + 10] = c;
    m[o + 11] = 0;
    m[o + 12] = x;
    m[o + 13] = y;
    m[o + 14] = z;
    m[o + 15] = 1;
    this.count++;
  }
  end(): void {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

interface PlayerMeshes {
  root: Group;
  /** Turns with the aim: the fallback figure until the library character loads, then the character and its blaster. */
  body: Group;
  /** Materials the hit flash drives. */
  flashMats: MeshStandardMaterial[];
  animator: CharacterAnimator | null;
  lastX: number;
  lastZ: number;
  ring: Mesh;
  shield: Mesh;
  finish: number;
  lastWcd: number;
  lastHp: number;
  dead: boolean;
  flash: number;
  /** Last time (scene seconds) this wirejack took damage soon after one of our shots. */
  hitByUs: number;
  /** The colour it is drawn in. */
  color: number;
  /** Outline and a rim in its own colour (engine HeroHighlight), once the library character loads. */
  highlight: HeroHighlight | null;
}

interface Beam {
  mesh: Mesh;
  t: number;
}

export class ArenaScene {
  readonly scene = new Scene();
  readonly rig: CameraRig;
  private readonly bolts: Crowd;
  private readonly pellets: Crowd;
  private readonly cells: Crowd[] = [];
  private readonly sparks: Crowd;
  private readonly particles: Particle[] = [];
  private readonly players = new Map<number, PlayerMeshes>();
  private readonly beams: Beam[] = [];
  private readonly flashes: { mesh: Mesh; t: number }[] = [];
  /** Our own blaster bolts, drawn the frame we fire. */
  private readonly localShots: { x: number; z: number; dx: number; dz: number; yaw: number; speed: number; left: number; pellet: boolean }[] = [];
  private prevPos = new Map<number, [number, number, number]>();
  private readonly focus = new Vector3();
  private readonly aimLead = new Vector3();
  /** Preview camera (?preview=1, the Launcher's style previews): frame the busiest fight, not our own fighter. */
  private preview: { distance: number } | null = null;
  /** Standing fighters in the fight the preview camera frames (0 outside preview mode). */
  previewFight = 0;
  private time = 0;
  private lastShotAt = -10;
  /** When our own bolts or beams last reached each wirejack as drawn (owner to scene seconds): hits and kills we can claim. */
  private readonly ourHitAt = new Map<number, number>();
  /** The wirejack the last beamLength call stopped at, or -1. */
  private beamHit = -1;
  private readonly weapons: readonly WeaponDef[];
  private readonly raycaster = new Raycaster();
  private readonly ground = new Plane(new Vector3(0, 1, 0), -1);
  /** Effects fired so far (playtest checks read these). */
  readonly counts = { beams: 0, flashes: 0, bursts: 0, shots: 0 };
  /** The art style drawn (the game's declared style, or ?style=). */
  readonly style: string;
  /** That style's kit, or null: the template's own low-poly drawing (no render stack, the scene's own lights and fog). */
  private readonly kit: StyleKit | null;
  /** The engine render stack, only when a style kit draws the frame. */
  private readonly stack: RenderStack | null = null;
  /** The field as the style's kit drew it (the voxel yard), or null. */
  private readonly field: FieldSpec | null = null;

  constructor(
    private readonly handle: RendererHandle,
    private readonly game: CompiledGame,
    private readonly config: ResolvedSimConfig,
    /** The asset library (real models); null draws the fallback shapes only. */
    private readonly library: LibraryClient | null = null,
    /** The engine feel kit: hit flash and knockback offsets on the wirejacks. */
    private readonly feel: FeelKit | null = null,
    opts: { style?: string } = {},
  ) {
    this.weapons = config.content.weapons;
    const s = this.scene;
    this.rig = new CameraRig(1, { distance: 31, height: 0.5, follow: 9, lead: 0.12, fov: 42, minPitch: 0.9, maxPitch: 1.4 });
    this.style = opts.style ?? game.manifest.game.style;
    this.kit = styleKit(this.style);
    const half = config.arena.halfExtent;
    if (this.kit) {
      // An art style draws the frame through the engine render stack: its lighting, fog, grade, particles, post and session.
      this.stack = createRenderStack(handle, s, this.rig.camera, {
        preset: "night",
        style: this.style,
        quality: "auto",
        shadowExtent: 30,
        // The camera sits ~31-44 m out: fog starts past the fence and swallows the lot, as the yard's own fog does.
        atmosphere: { heightFog: 0, near: 40, far: 95 },
        // Library id to URL, for a style's own textures (ps1's surfaces).
        resolve: (id) => {
          try {
            return library?.url(id) ?? null;
          } catch {
            return null;
          }
        },
      });
      if (this.kit.stack?.("night").shadows !== true) this.stack.lighting.setShadowMapSize(0);
      if (feel) feel.particles = this.stack.particles;
      // A kit that draws fields (voxel) builds the yard: its floor, the lot past the fence and the fence.
      if (this.kit.field) {
        this.field = { half, wallHeight: config.arena.wallHeight, outside: 40, theme: YARD_THEME, pillars: config.arena.pillars.map((p) => ({ x: p.x, z: p.z, radius: p.radius, height: p.height })) };
        s.add(...this.kit.field(this.field));
      }
    } else {
      const sky = new Color(0x0b1020);
      s.background = sky;
      // Fog swallows the ground well past the fence, so the yard never ends in a hard edge.
      s.fog = new Fog(sky, 34, 78);
      s.add(new HemisphereLight(0x8fb4ff, 0x1a1408, 1.3));
      s.add(new AmbientLight(0xffffff, 0.3));
      const moon = new DirectionalLight(0xcfe0ff, 1.5);
      moon.position.set(-18, 40, 12);
      s.add(moon);
    }
    const styledField = this.field !== null;
    const session = this.stack?.session ?? null;

    // The style may paint the floor and the lot (hand-drawn); its texture says how many metres one tile covers.
    const floorMap = session?.surface?.("floor") ?? null;
    if (floorMap) {
      const tile = (floorMap.userData as { tile?: number }).tile ?? 8;
      floorMap.repeat.set((half * 2) / tile, (half * 2) / tile);
    }
    const floor = new Mesh(new PlaneGeometry(half * 2, half * 2), new MeshStandardMaterial({ map: floorMap ?? floorTexture(half), roughness: 0.95, metalness: 0.05 }));
    floor.rotation.x = -Math.PI / 2;
    // Surface roles: an art style that textures surfaces (ps1) dresses these with its own maps.
    floor.userData.surface = "plate";
    if (!styledField) s.add(floor);
    // Outside the fence: a gravel lot the parked trucks stand on, lit and fading into the fog.
    const lot = half * 2 + 160;
    const lotMap = session?.surface?.("ground") ?? null;
    if (lotMap) {
      const tile = (lotMap.userData as { tile?: number }).tile ?? 9.4;
      lotMap.repeat.set(lot / tile, lot / tile);
    }
    const apron = new Mesh(new PlaneGeometry(lot, lot), new MeshStandardMaterial({ map: lotMap ?? gravelTexture(lot / 6), color: lotMap ? 0xffffff : 0x9aa3b4, roughness: 1, metalness: 0 }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.02;
    apron.userData.surface = "gravel";
    if (!styledField) s.add(apron);
    // Yard lamps on the four corners outside the fence: warm pools on the lot.
    const poleMat = new MeshStandardMaterial({ color: 0x2a303c, roughness: 0.7, metalness: 0.4 });
    const headMat = new MeshBasicMaterial({ color: 0xffd9a0 });
    for (const [cx, cz] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ] as const) {
      const x = cx * (half + 3);
      const z = cz * (half + 3);
      const gy = this.groundAt(x, z);
      const pole = new Mesh(new CylinderGeometry(0.12, 0.16, 6, 6), poleMat);
      pole.position.set(x, gy + 3, z);
      pole.userData.surface = "metal";
      const head = new Mesh(new BoxGeometry(0.9, 0.18, 0.4), headMat);
      head.position.set(x - cx * 0.4, gy + 6, z - cz * 0.4);
      s.add(pole, head);
      const l = new PointLight(0xffc98a, 40, 22, 1.4);
      l.position.set(x - cx * 1.5, gy + 5.5, z - cz * 1.5);
      s.add(l);
    }

    // The fence: a low dark barrier (the sim's wall is taller; nobody jumps) with a hazard strip on its inner face.
    const h = 1.2;
    const panelMat = new MeshStandardMaterial({ color: 0x1d2433, roughness: 0.8, metalness: 0.3, flatShading: true });
    const stripes = stripeTexture();
    for (const [x, z, w, d, ix, iz] of [
      [0, half + 0.3, half * 2 + 1.2, 0.6, 0, -1],
      [0, -half - 0.3, half * 2 + 1.2, 0.6, 0, 1],
      [half + 0.3, 0, 0.6, half * 2 + 1.2, -1, 0],
      [-half - 0.3, 0, 0.6, half * 2 + 1.2, 1, 0],
    ] as const) {
      // A style that draws its own field (voxel) builds its own fence.
      if (styledField) continue;
      const m = new Mesh(new BoxGeometry(w, h, d), panelMat);
      m.position.set(x, h / 2, z);
      m.userData.surface = "metal";
      s.add(m);
      const along = Math.max(w, d);
      const map = stripes.clone();
      map.repeat.set(along / 1.5, 1);
      map.needsUpdate = true;
      const band = new Mesh(new PlaneGeometry(along, 0.4), new MeshStandardMaterial({ map, emissive: new Color(0x3a2400), roughness: 0.6 }));
      band.position.set(x + ix * (w / 2 + 0.01), h - 0.3, z + iz * (d / 2 + 0.01));
      band.rotation.y = Math.atan2(ix, iz);
      band.userData.surface = "hazard";
      s.add(band);
    }

    // Transformers: bodies, glowing coils and caps, each a single merged draw.
    const bodies: BufferGeometry[] = [];
    const coils: BufferGeometry[] = [];
    const caps: BufferGeometry[] = [];
    for (const p of config.arena.pillars) {
      const body = new CylinderGeometry(p.radius * 0.92, p.radius, p.height, 10);
      body.translate(p.x, p.height / 2, p.z);
      bodies.push(body);
      const base = new BoxGeometry(p.radius * 2.3, 0.3, p.radius * 2.3);
      base.translate(p.x, 0.15, p.z);
      bodies.push(base);
      // One low coil band per transformer: a hint of charge, never brighter than a wirejack.
      const ring = new TorusGeometry(p.radius * 0.97, 0.04 + p.radius * 0.01, 6, 28);
      ring.rotateX(Math.PI / 2);
      ring.translate(p.x, 0.55, p.z);
      coils.push(ring);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const ins = new ConeGeometry(0.16, 0.7, 6);
        ins.translate(p.x + Math.cos(a) * p.radius * 0.5, p.height + 0.35, p.z + Math.sin(a) * p.radius * 0.5);
        caps.push(ins);
      }
    }
    const shapes: Mesh[] = [];
    if (bodies.length > 0) {
      const kitPillars = styledField && this.kit?.pillar ? this.kit.pillar : null;
      if (kitPillars) {
        // The style's own transformer posts (voxel blocks); the coils still glow around them.
        config.arena.pillars.forEach((p, i) => {
          const drawn = kitPillars({ x: p.x, z: p.z, radius: p.radius, height: p.height }, YARD_THEME, i);
          s.add(drawn.body, ...drawn.top);
        });
      } else {
        const body = new Mesh(merge(bodies), new MeshStandardMaterial({ color: 0x2c3340, roughness: 0.6, metalness: 0.5, flatShading: true }));
        body.userData.surface = "metal";
        const cap = new Mesh(merge(caps), new MeshStandardMaterial({ color: 0x7d786e, roughness: 0.5, flatShading: true }));
        cap.userData.surface = "stone";
        shapes.push(body, cap);
        s.add(...shapes);
      }
      s.add(new Mesh(merge(coils), new MeshStandardMaterial({ color: 0x2b3f48, emissive: new Color(0x0e6878), emissiveIntensity: 0.5, roughness: 0.4 })));
    }
    if (library) this.dress(library, config, shapes, styledField);
    // A few lights: the centre and two flanks.
    for (const [x, z, color] of [
      [0, 0, 0x16e0ff],
      [half * 0.6, -half * 0.6, 0xff4fd8],
      [-half * 0.6, half * 0.6, 0xff4fd8],
    ] as const) {
      // Under a style's own lighting rig the coloured pools are a tint, not the only light.
      const l = new PointLight(color, this.stack ? 28 : 60, 26, 1.6);
      l.position.set(x, 5, z);
      s.add(l);
    }

    // Instanced projectiles, cells and sparks.
    // An art style may redraw the machinery shapes (voxel bolts and shards); the rest keep the template's own.
    const styled = (name: "bolt" | "pellet" | "shard") => this.kit?.shape?.(name) ?? null;
    const b = styled("bolt") ?? fx.bolt();
    this.bolts = new Crowd(b.geometry, b.material, MAX_BOLTS);
    const p = styled("pellet") ?? fx.pellet();
    this.pellets = new Crowd(p.geometry, p.material, MAX_PELLETS);
    const shard = styled("shard");
    this.sparks = new Crowd(shard?.geometry ?? fx.shard(), shard?.material ?? new MeshBasicMaterial({ color: 0xbff8ff }), MAX_PARTICLES);
    for (const id of game.pickupPrefabs) {
      const a = resolveAsset(this.model(game.manifest.prefabs.get(id)?.model ?? "style.lowpoly.missing"));
      const crowd = new Crowd(a.geometry, a.material, MAX_CELLS);
      this.cells.push(crowd);
      s.add(crowd.mesh);
      // A file-backed library pickup (a gem, a coin, food) replaces the shape once it loads.
      const p = game.manifest.prefabs.get(id);
      const model = p ? this.model(p.model) : "";
      const asset = p ? assetById(model) : undefined;
      // A style kit draws its own procedural pickups (voxel gems); low-poly keeps the template's shapes.
      if (library && p && asset && (!("procedural" in asset.source) || this.kit)) {
        library.crowd(model, p.appearance, { height: 0.6 }).then(
          (c) => {
            const part = c.parts[0];
            if (!part) return;
            s.remove(crowd.mesh);
            crowd.swap(part.geometry, part.material);
            s.add(crowd.mesh);
          },
          () => undefined,
        );
      }
    }
    s.add(this.bolts.mesh, this.pellets.mesh, this.sparks.mesh);

    const beamGeo = fx.beam();
    for (let i = 0; i < 16; i++) {
      const mesh = new Mesh(beamGeo, new MeshBasicMaterial({ color: 0xff7ef0, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending }));
      mesh.visible = false;
      s.add(mesh);
      this.beams.push({ mesh, t: 1 });
    }
    const flashGeo = new SphereGeometry(0.28, 8, 6);
    for (let i = 0; i < 16; i++) {
      const mesh = new Mesh(flashGeo, new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending }));
      mesh.visible = false;
      s.add(mesh);
      this.flashes.push({ mesh, t: 1 });
    }

    // The camera never shows more than CAMERA_MARGIN m of the lot past the fence.
    this.rig.setBounds(fieldBounds(half, CAMERA_MARGIN));
    this.rig.pitch = 1.22;
  }

  /**
   * Library dressing (template machinery): each transformer body becomes a
   * generator machine inside its glowing coils, and parked trucks, vans and
   * barrels line the yard outside the fence.
   */
  private dress(library: LibraryClient, config: ResolvedSimConfig, shapes: readonly Mesh[], styledField: boolean): void {
    const s = this.scene;
    const pillars = config.arena.pillars;
    // A style that builds its own field (voxel) draws its own transformer posts.
    if (!styledField) library.crowd(this.model(PILLAR_MODEL), undefined, { height: 1 }).then(
      (c) => {
        let half = 0.1;
        for (const p of c.parts) {
          p.geometry.computeBoundingBox();
          const b = p.geometry.boundingBox;
          if (b) half = Math.max(half, (b.max.x - b.min.x) / 2, (b.max.z - b.min.z) / 2);
        }
        const placed = placeStatic(c, pillars.map((p, i) => ({ x: p.x, z: p.z, yaw: (i % 4) * (Math.PI / 2), across: (p.radius * 0.95) / half, up: p.height })));
        // Scenery stays quiet: the machines are drawn dark and grey so the wirejacks are the loudest colour on screen.
        const grey = new Color(0x4a505c);
        for (const o of placed) {
          o.traverse((n) => {
            const mesh = n as Mesh;
            const src = mesh.material as MeshStandardMaterial | undefined;
            if (!mesh.isMesh || !src || Array.isArray(src) || !src.color) return;
            // A copy: library materials may be shared with other models.
            const m = src.clone();
            m.color.lerp(grey, 0.8).multiplyScalar(0.65);
            if (m.emissive) m.emissive.multiplyScalar(0.3);
            mesh.material = m;
          });
        }
        s.add(...placed);
        for (const m of shapes) m.visible = false;
      },
      () => undefined,
    );
    const half = config.arena.halfExtent;
    YARD_DECOR.forEach(([id, height, count], k) => {
      library.crowd(this.model(id), undefined, { height }).then(
        (c) => {
          const places = Array.from({ length: count }, (_, i) => {
            const side = (i + k) % 4;
            const along = ((i * 7 + k * 3) % 11) / 10 - 0.5;
            const out = half + 3 + ((i * 5 + k) % 4) * 1.6;
            const pos = side === 0 ? [along * half * 1.8, out] : side === 1 ? [along * half * 1.8, -out] : side === 2 ? [out, along * half * 1.8] : [-out, along * half * 1.8];
            const x = pos[0] ?? 0;
            const z = pos[1] ?? 0;
            return { x, y: this.groundAt(x, z), z, yaw: side * (Math.PI / 2) + (i % 2) * Math.PI };
          });
          s.add(...placeStatic(c, places));
        },
        () => undefined,
      );
    });
  }

  /** A library id in the style drawn: "style.lowpoly.van" is "style.voxel.van" in the voxel style. */
  private model(id: string): string {
    return restyleId(id, this.style);
  }

  /** Height of the style's ground at (x, z) (the voxel yard is terraced past the fence); 0 on the template's flat lot. */
  private groundAt(x: number, z: number): number {
    return this.field && this.kit?.groundHeight ? this.kit.groundHeight(this.field, x, z) : 0;
  }

  resize(width: number, height: number): void {
    if (this.stack) this.stack.resize(width, height);
    else this.handle.renderer.setSize(width, height, false);
    this.rig.resize(width / height);
    this.rig.setDistance(width < height ? 44 : 31);
  }

  shake(amplitude: number, seconds: number): void {
    this.rig.shake(amplitude, seconds);
  }

  /** World position → CSS pixels on the canvas (name tags, damage numbers). */
  project(x: number, y: number, z: number, width: number, height: number): { x: number; y: number; onScreen: boolean } {
    const v = new Vector3(x, y, z).project(this.rig.camera);
    return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height, onScreen: v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
  }

  /** A screen point (CSS px) on the gun-height plane, or null. */
  groundPoint(clientX: number, clientY: number, width: number, height: number): { x: number; z: number } | null {
    const ndc = new Vector2((clientX / width) * 2 - 1, -(clientY / height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    const hit = new Vector3();
    return this.raycaster.ray.intersectPlane(this.ground, hit) ? { x: hit.x, z: hit.z } : null;
  }

  private burst(x: number, y: number, z: number, n: number): void {
    this.counts.bursts++;
    for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 6;
      this.particles.push({ x, y: y + 0.8, z, vx: Math.cos(a) * sp, vy: 2 + Math.random() * 5, vz: Math.sin(a) * sp, life: 0.4 + Math.random() * 0.4 });
    }
  }

  private flash(x: number, y: number, z: number, color: number): void {
    const f = this.flashes.find((q) => q.t >= 1) ?? this.flashes[0];
    if (!f) return;
    this.counts.flashes++;
    f.t = 0;
    f.mesh.position.set(x, y, z);
    (f.mesh.material as MeshBasicMaterial).color.setHex(color);
    f.mesh.visible = true;
  }

  private beam(x: number, z: number, yaw: number, length: number, color: number): void {
    const b = this.beams.find((q) => q.t >= 1) ?? this.beams[0];
    if (!b) return;
    this.counts.beams++;
    b.t = 0;
    b.mesh.position.set(x, 1.0, z);
    b.mesh.rotation.set(0, yaw, 0);
    b.mesh.scale.set(1, 1, Math.max(0.1, length));
    (b.mesh.material as MeshBasicMaterial).color.setHex(color);
    b.mesh.visible = true;
  }

  private player(owner: number, finish: number): PlayerMeshes {
    let p = this.players.get(owner);
    if (p && p.finish === finish) return p;
    if (p) {
      this.scene.remove(p.root);
      p.highlight?.dispose();
      this.players.delete(owner);
    }
    const look = finishOf(finish, playerColor(owner));
    const bot = owner >= BOT_PLAYER_BASE;
    const players = this.game.manifest.game.players;
    const model = this.model(bot ? BOT_MODEL : players.prefab);
    const a = resolveAsset(model);
    const shapeMat = new MeshStandardMaterial({ color: look.body, roughness: look.roughness, metalness: look.metalness, flatShading: true, emissive: new Color(look.glow).multiplyScalar(GLOW) });
    const shape = new Mesh(a.geometry, shapeMat);
    shape.scale.setScalar(1.3);
    const body = new Group();
    body.add(shape);
    // A bright base ring in the wirejack's colour: the one thing on the floor that marks a fighter.
    const ring = new Mesh(new RingGeometry(0.58, 0.92, 32), new MeshBasicMaterial({ color: look.glow, transparent: true, opacity: 0.9, side: DoubleSide, depthWrite: false, blending: AdditiveBlending }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    const shield = new Mesh(new SphereGeometry(1.0, 16, 12), new MeshBasicMaterial({ color: 0x9ff6ff, transparent: true, opacity: 0.18, depthWrite: false, blending: AdditiveBlending }));
    shield.position.y = 0.9;
    const root = new Group();
    root.add(body, ring, shield);
    this.scene.add(root);
    const made: PlayerMeshes = { root, body, flashMats: [shapeMat], animator: null, lastX: 0, lastZ: 0, ring, shield, finish, lastWcd: 0, lastHp: -1, dead: false, flash: 0, hitByUs: -10, color: look.glow, highlight: null };
    p = made;
    this.players.set(owner, p);
    // The library character in this player's colour (or finish), carrying a library blaster.
    const library = this.library;
    if (library) {
      const tint = `#${look.body.toString(16).padStart(6, "0")}`;
      const l = bot ? { tint, parts: [] } : { ...players.appearance, parts: players.appearance?.parts ?? [], tint: players.appearance?.tint && finish === 0 ? players.appearance.tint : tint };
      Promise.all([library.character(model, l, { height: PLAYER_HEIGHT }), library.prop(this.model(HELD_MODEL), undefined, { height: 0.42 })]).then(
        ([c, gun]) => {
          if (this.players.get(owner) !== made) return;
          body.remove(shape);
          // Held at the right hand in the shooting pose, pointing along the aim (-z).
          gun.position.set(c.width * 0.32, c.height * 0.5, -c.depth * 0.75);
          c.root.add(gun);
          body.add(c.root);
          const mats: MeshStandardMaterial[] = [];
          c.root.traverse((o) => {
            const m = (o as Mesh).material as MeshStandardMaterial | undefined;
            if (m && (o as Mesh).isMesh && m.emissive && !mats.includes(m)) {
              m.emissive.setHex(look.glow).multiplyScalar(GLOW);
              m.metalness = Math.max(m.metalness ?? 0, look.metalness * 0.6);
              mats.push(m);
            }
          });
          made.flashMats = mats;
          made.animator = c.animator;
          // Every wirejack reads off the yard: a dark outline and a rim in its own colour.
          made.highlight = new HeroHighlight(c.root, { rim: look.glow, rimStrength: 1.3, rimPower: 2.4, outline: 0x05070c, outlineWidth: 0.045 });
        },
        (e: unknown) => console.warn(`library: ${model} stays a shape (${e instanceof Error ? e.message : String(e)})`),
      );
    }
    return p;
  }

  /** The beam's visible reach from (x, z) along yaw: walls, pillars, then the first player in the way. */
  private beamLength(x: number, z: number, yaw: number, range: number, shooter: number, drawn: readonly SceneEntity[]): number {
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    this.beamHit = -1;
    let len = beamRange(this.config, x, z, dx, dz, range);
    for (const e of drawn) {
      if (e.kind !== EntityKind.Player || e.owner === shooter || ((e.values[F.flags] ?? 0) & EntityFlag.Dead) !== 0) continue;
      const [px, , pz] = pos(e);
      const mx = x - px;
      const mz = z - pz;
      const b = mx * dx + mz * dz;
      const c = mx * mx + mz * mz - PLAYER_HITBOX * PLAYER_HITBOX;
      const disc = b * b - c;
      if (disc < 0 || (c > 0 && b > 0)) continue;
      const t = Math.max(0, -b - Math.sqrt(disc));
      if (t < len) {
        len = t;
        this.beamHit = e.owner;
      }
    }
    return len;
  }

  frame(input: FrameInput): FrameEvents {
    const dt = input.dt;
    this.time += dt;
    const out: FrameEvents = { hits: [], kills: [], selfHurt: 0, selfHealed: false, selfDown: false, downs: 0, shots: [] };
    this.bolts.begin();
    this.pellets.begin();
    for (const c of this.cells) c.begin();

    const all = input.self ? [input.self, ...input.others] : input.others;
    const next = new Map<number, [number, number, number]>();
    const seen = new Set<number>();
    const [sx, , sz] = input.self ? pos(input.self) : [this.focus.x, 0, this.focus.z];

    for (const e of all) {
      const [x, y, z] = pos(e);
      const prev = this.prevPos.get(e.id);
      next.set(e.id, [x, y, z]);
      if (e.kind === EntityKind.Projectile) {
        // Our own bolts are drawn locally from the moment we fire (stepLocalShots).
        if (e.owner === input.selfPlayer) continue;
        const def = this.weapons[e.values[F.type] ?? 0];
        let yaw = 0;
        if (prev && (x !== prev[0] || z !== prev[2])) yaw = Math.atan2(-(x - prev[0]), -(z - prev[2]));
        (def && def.count > 1 ? this.pellets : this.bolts).push(x, 1.0, z, yaw, 1);
      } else if (e.kind === EntityKind.Pickup) {
        const tier = Math.min(this.cells.length - 1, e.values[F.type] ?? 0);
        this.cells[tier]?.push(x, 0.6 + Math.sin(this.time * 3 + e.id) * 0.12, z, this.time * 1.6 + e.id, 1);
      } else if (e.kind === EntityKind.Player) {
        seen.add(e.owner);
        this.drawPlayer(e, x, y, z, e.owner === input.selfPlayer, input, all, out, sx, sz);
      }
    }
    this.prevPos = next;
    this.stepLocalShots(dt, all, input.selfPlayer);
    for (const [id, p] of this.players) {
      if (seen.has(id)) continue;
      this.scene.remove(p.root);
      p.highlight?.dispose();
      this.players.delete(id);
    }

    // Sparks.
    this.sparks.begin();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i] as Particle;
      p.life -= dt;
      if (p.life <= 0) {
        this.particles[i] = this.particles[this.particles.length - 1] as Particle;
        this.particles.pop();
        continue;
      }
      p.vy -= 16 * dt;
      p.x += p.vx * dt;
      p.y = Math.max(0.05, p.y + p.vy * dt);
      p.z += p.vz * dt;
      this.sparks.push(p.x, p.y, p.z, p.life * 11, Math.min(1, p.life * 2.5));
    }
    for (const b of this.beams) {
      if (b.t >= 1) continue;
      b.t = Math.min(1, b.t + dt / BEAM_SECONDS);
      (b.mesh.material as MeshBasicMaterial).opacity = 0.95 * (1 - b.t);
      b.mesh.scale.x = b.mesh.scale.y = 1 + b.t * 1.5;
      if (b.t >= 1) b.mesh.visible = false;
    }
    for (const f of this.flashes) {
      if (f.t >= 1) continue;
      f.t = Math.min(1, f.t + dt / FLASH_SECONDS);
      (f.mesh.material as MeshBasicMaterial).opacity = 1 - f.t;
      f.mesh.scale.setScalar(1 + f.t);
      if (f.t >= 1) f.mesh.visible = false;
    }
    this.bolts.end();
    this.pellets.end();
    this.sparks.end();
    for (const c of this.cells) c.end();

    // Camera: follow our wirejack, leaning a few metres toward the aim.
    if (this.preview) this.framePreview(all, dt);
    else if (input.self) {
      const [x, y, z] = pos(input.self);
      const k = Math.min(1, dt * 6);
      this.aimLead.x += (-Math.sin(input.aim) * 3.2 - this.aimLead.x) * k;
      this.aimLead.z += (-Math.cos(input.aim) * 3.2 - this.aimLead.z) * k;
      this.focus.set(x + this.aimLead.x, y, z + this.aimLead.z);
    }
    this.rig.yaw = 0;
    this.rig.update(this.focus, dt, input.realDt ?? dt);
    if (this.stack) this.stack.frame(dt, this.focus);
    else this.handle.renderer.render(this.scene, this.rig.camera);
    return out;
  }

  /**
   * Preview mode: no hero. Screenshots of a style need the fight, so the
   * camera eases to the biggest group of standing fighters (everyone within
   * PREVIEW_RADIUS of one of them) and pulls back far enough to hold all of
   * that group, at a lower, three-quarter pitch that shows their bodies.
   */
  setPreview(on: boolean): void {
    this.preview = on ? { distance: 31 } : null;
  }

  private framePreview(all: readonly SceneEntity[], dt: number): void {
    const p = this.preview;
    if (!p) return;
    const fighters: [number, number][] = [];
    for (const e of all) {
      if (e.kind !== EntityKind.Player || ((e.values[F.flags] ?? 0) & EntityFlag.Dead) !== 0) continue;
      const [x, , z] = pos(e);
      fighters.push([x, z]);
    }
    this.rig.pitch = PREVIEW_PITCH;
    if (fighters.length === 0) return;
    let best: [number, number][] = [];
    for (const [ax, az] of fighters) {
      const group = fighters.filter(([x, z]) => Math.hypot(x - ax, z - az) <= PREVIEW_RADIUS);
      if (group.length > best.length) best = group;
    }
    this.previewFight = best.length;
    let cx = 0;
    let cz = 0;
    for (const [x, z] of best) {
      cx += x / best.length;
      cz += z / best.length;
    }
    let spread = 0;
    for (const [x, z] of best) spread = Math.max(spread, Math.hypot(x - cx, z - cz));
    const k = Math.min(1, dt * 1.5);
    this.focus.x += (cx - this.focus.x) * k;
    this.focus.z += (cz - this.focus.z) * k;
    p.distance += (Math.min(PREVIEW_MAX_DISTANCE, Math.max(PREVIEW_MIN_DISTANCE, 14 + spread * 1.6)) - p.distance) * k;
    this.rig.setDistance(p.distance);
  }

  private drawPlayer(
    e: SceneEntity,
    x: number,
    y: number,
    z: number,
    mine: boolean,
    input: FrameInput,
    drawn: readonly SceneEntity[],
    out: FrameEvents,
    sx: number,
    sz: number,
  ): void {
    const flags = e.values[F.flags] ?? 0;
    const dead = (flags & EntityFlag.Dead) !== 0;
    const pm = this.player(e.owner, e.values[F.type] ?? 0);
    // Our own gun follows the input's aim this frame; everyone else's the snapshot's.
    const yaw = mine && !dead ? input.aim : (e.values[F.yaw] ?? 0);
    // Knockback (FeelKit): a hit pushes the drawn wirejack back a little and squashes it.
    const k = this.feel?.knock.get(e.owner);
    pm.root.position.set(x + (k?.x ?? 0), Math.max(0, y - 0.9), z + (k?.z ?? 0));
    pm.body.scale.set(k?.sx ?? 1, k?.sy ?? 1, k?.sz ?? 1);
    pm.body.rotation.set(0, yaw, 0);
    const iframes = (e.values[F.iframes] ?? 0) > 0 && (flags & EntityFlag.Dashing) === 0;
    pm.shield.visible = iframes && !dead;
    pm.shield.scale.setScalar(1 + Math.sin(this.time * 8) * 0.04);
    pm.root.visible = !dead;
    (pm.ring.material as MeshBasicMaterial).opacity = mine ? 0.95 : 0.85;
    pm.ring.scale.setScalar(mine ? 1.1 + Math.sin(this.time * 4) * 0.05 : 1 + Math.sin(this.time * 6 + e.owner) * 0.06);

    const hp = e.values[F.health] ?? 0;
    // Ours: one of our own bolts or beams reached this wirejack on our screen just now.
    const ours = !mine && this.time - (this.ourHitAt.get(e.owner) ?? -10) < OURS_WINDOW;
    const dirX = x - sx;
    const dirZ = z - sz;
    const dl = Math.hypot(dirX, dirZ) || 1;
    if (dead && !pm.dead) {
      this.burst(x, 0, z, 26);
      if (mine) out.selfDown = true;
      else {
        if ((x - sx) ** 2 + (z - sz) ** 2 < 900) out.downs++;
        if (ours || this.time - pm.hitByUs < OURS_WINDOW) out.kills.push({ x, z, id: e.owner, color: pm.color, dirX: dirX / dl, dirZ: dirZ / dl });
      }
    }
    if (!dead && pm.lastHp >= 0 && hp < pm.lastHp && !pm.dead) {
      pm.flash = 0.1;
      this.burst(x, 0.2, z, 4);
      if (mine) out.selfHurt += pm.lastHp - hp;
      else if (ours) {
        pm.hitByUs = this.time;
        out.hits.push({ x, y: 2.1, z, amount: pm.lastHp - hp, id: e.owner, dirX: dirX / dl, dirZ: dirZ / dl });
      }
    }
    if (mine && !dead && !pm.dead && pm.lastHp >= 0 && hp > pm.lastHp) out.selfHealed = true;
    pm.lastHp = hp;
    pm.dead = dead;
    if (pm.flash > 0) pm.flash -= input.dt;
    const flash = Math.max(pm.flash > 0 ? pm.flash * 10 : 0, this.feel?.flash.value(e.owner) ?? 0);
    const glow = 1 + flash * 4;
    for (const m of pm.flashMats) m.emissiveIntensity = glow;
    if (pm.animator) {
      pm.animator.setSpeed(Math.hypot(x - pm.lastX, z - pm.lastZ) / Math.max(1e-3, input.dt));
      pm.animator.update(input.dt);
    }
    pm.lastX = x;
    pm.lastZ = z;

    // Shots: a weapon slot's cooldown jumped up since last frame.
    const wcd = e.values[F.wcd] ?? 0;
    const weapons = e.values[F.weapons] ?? 0;
    for (let s = 0; s < 4; s++) {
      const now = (wcd >>> (s * 8)) & 0xff;
      const before = (pm.lastWcd >>> (s * 8)) & 0xff;
      if (dead || now <= before + 1) continue;
      const def = this.weapons[slotWeapon(weapons, s)];
      if (!def) continue;
      this.counts.shots++;
      const mx = x - Math.sin(yaw) * 0.75;
      const mz = z - Math.cos(yaw) * 0.75;
      const color = def.kind === "beam" ? 0xff7ef0 : def.count > 1 ? 0xffb020 : 0x9ff6ff;
      this.flash(mx, 1.0, mz, color);
      if (def.kind === "beam") {
        this.beam(mx, mz, yaw, this.beamLength(x, z, yaw, def.range, e.owner, drawn) - 0.75, color);
        if (mine && this.beamHit >= 0) this.ourHitAt.set(this.beamHit, this.time);
      }
      // Our own bolts leave the muzzle this frame (the server's copies arrive a round trip later and are not drawn).
      else if (mine && def.kind === "blaster") this.localVolley(x, z, yaw, def);
      out.shots.push({ kind: def.kind === "blaster" && def.count > 1 ? "blaster-wide" : def.kind, mine });
      pm.animator?.play("shoot", { once: true });
      if (mine) this.lastShotAt = this.time;
    }
    pm.lastWcd = wcd;
  }

  /** Our blaster volley, drawn at once: the same fan, speed and reach as the sim's, stopped by pillars and walls. */
  private localVolley(x: number, z: number, yaw: number, def: WeaponDef): void {
    const muzzle = this.config.player.radius + 0.25;
    const spread = def.spread ?? 0;
    for (let b = 0; b < def.count; b++) {
      if (this.localShots.length >= MAX_LOCAL_SHOTS) this.localShots.shift();
      const a = yaw + (def.count > 1 ? (b / (def.count - 1) - 0.5) * spread : 0);
      const dx = -Math.sin(a);
      const dz = -Math.cos(a);
      const ox = x + dx * muzzle;
      const oz = z + dz * muzzle;
      this.localShots.push({ x: ox, z: oz, dx, dz, yaw: a, speed: def.speed, left: beamRange(this.config, ox, oz, dx, dz, Math.max(0, def.range - muzzle)), pellet: def.count > 1 });
    }
  }

  /** Move our own bolts; one that reaches a wirejack (as drawn) or cover stops in a spark. */
  private stepLocalShots(dt: number, drawn: readonly SceneEntity[], self: number): void {
    const r = PLAYER_HITBOX + 0.2;
    for (let i = this.localShots.length - 1; i >= 0; i--) {
      const s = this.localShots[i];
      if (!s) continue;
      const step = Math.min(s.left, s.speed * dt);
      let stop = s.left - step <= 0;
      for (const e of drawn) {
        if (e.kind !== EntityKind.Player || e.owner === self || ((e.values[F.flags] ?? 0) & EntityFlag.Dead) !== 0) continue;
        const [px, , pz] = pos(e);
        const mx = s.x - px;
        const mz = s.z - pz;
        const b = mx * s.dx + mz * s.dz;
        const c = mx * mx + mz * mz - r * r;
        const disc = b * b - c;
        if (disc < 0 || (c > 0 && b > 0)) continue;
        const t = Math.max(0, -b - Math.sqrt(disc));
        if (t <= step) {
          stop = true;
          this.ourHitAt.set(e.owner, this.time);
          this.burst(s.x + s.dx * t, 0.2, s.z + s.dz * t, 3);
          break;
        }
      }
      s.x += s.dx * step;
      s.z += s.dz * step;
      s.left -= step;
      if (stop) {
        this.localShots.splice(i, 1);
        continue;
      }
      (s.pellet ? this.pellets : this.bolts).push(s.x, 1.0, s.z, s.yaw, 1);
    }
  }
}
