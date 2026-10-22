/**
 * The ROMPHOUSE scene, on the engine's render stack and feel kit
 * (game-runtime.md §5, §13):
 *  - lighting with a following sun shadow, sky, fog, bloom, colour grade
 *    and tone mapping from `createRenderStack` (the game's `look`);
 *  - one animated instanced draw per enemy type (bob, waddle, lean, hit
 *    squash and flash in the vertex stage);
 *  - GPU particles, ground decals and shockwave rings for hits and kills;
 *  - client-side Rapier dressing: chunks off kills, crates and barrels the
 *    keepers shove and novas blast (./debris.ts);
 *  - FeelKit for flash, knockback offsets, damage numbers, shake, hit-stop,
 *    sound and rumble, honouring each prefab's and weapon's `feel`.
 */
import {
  CanvasTexture,
  Color,
  Group,
  InstancedMesh,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from "three/webgpu";
import type { BufferGeometry, Texture } from "three/webgpu";
import { AnimatedCrowd, CameraRig, createRenderStack, fieldBounds, HeroHighlight } from "@netnetcapital/engine/runtime";
import type { FeelKit, RenderStack, RendererHandle, StyleKit } from "@netnetcapital/engine/runtime";
import { CROWD_UNITS, F, PLAYER_UNITS, threatOf } from "@netnetcapital/engine/game";
import type { CompiledGame } from "@netnetcapital/engine/game";
import type { FeelDef, LookDef } from "@netnetcapital/engine";
import { EntityFlag, EntityKind, orbitAngle, PICKUP_SPECIAL, scaledWeapon, slotLevel, slotWeapon, weaponModsFor } from "@netnetcapital/engine-sim";
import type { ResolvedSimConfig } from "@netnetcapital/engine-sim";
import { assetById, restyleId } from "@netnetcapital/asset-library";
import type { CharacterAnimator, LibraryClient } from "@netnetcapital/asset-library/three";
import { PhysicsDressing } from "./debris.js";
import { ENEMY_HEIGHT_PER_RADIUS, KEEPER_HEIGHT } from "./decor.js";
import { fx, resolveAsset } from "./library.js";
import { ThreatLayer } from "./threats.js";
import { PartyStage } from "./stage.js";
import { KEEPER_COLORS, DISCO } from "./palette.js";

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
  /** Real seconds since the last frame (shake keeps moving during a hit-stop). */
  readonly realDt: number;
  /** Server tick the world is drawn at (fractional), for orbit blades. */
  readonly worldTick: number;
  /** Our own predicted character (drawn ahead of the server). */
  readonly self: SceneEntity | undefined;
  /** Everyone and everything else, interpolated ~100 ms in the past. */
  readonly others: readonly SceneEntity[];
  readonly selfPlayer: number;
  /** 0..1 red vignette (FeelKit.hurtPulse). */
  readonly hurt: number;
}

export interface FrameEvents {
  /** Our character took damage this frame (amount). */
  selfHurt: number;
  enemiesDrawn: number;
}

const MAX_PER_TYPE = 600;
const MAX_GEMS = 160;
const MAX_BOLTS = 160;
const MAX_BLADES = 96;
/** Camera distance, m (engine SURVIVOR_VIEWS must match: spawnEdge brings the crowd in just past this view). */
const CAMERA_DISTANCE = 17;
const CAMERA_DISTANCE_PORTRAIT = 24;
const CAMERA_PITCH = 0.98;
/** Metres of rock past the outer wall the camera may show. */
const OUTSIDE_VIEW = 16;
/** Props draw at their model's natural height times this. */
const PROP_SCALE = 1.25;

/** Defaults when a prefab or weapon declares no `feel`. */
const SMALL_KILL: FeelDef = { particles: "burst", decal: "splat", sound: "crunch" };
const BIG_KILL: FeelDef = { particles: "burst", decal: "scorch", sound: "boom", shake: 0.5, hitStop: 0.06 };
/** SOUND_CUES of the game API mapped onto FeelAudio's procedural cues. */
const CUE: Record<string, string> = { hit: "hit", crunch: "kill", boom: "bigKill", zap: "dash", chime: "coin", thud: "land" };

const hex = (c: string | undefined, fallback: number): number => (c ? parseInt(c.slice(1), 16) : fallback);
/** Teammates' area effects (novas, auras, sweeps) at this share of full brightness. */
const TEAM_FX = 0.35;
/** A colour scaled toward black (additive effects: dimmer). */
const dim = (c: number, k: number): number => (Math.round(((c >> 16) & 0xff) * k) << 16) | (Math.round(((c >> 8) & 0xff) * k) << 8) | Math.round((c & 0xff) * k);

const pos = (e: SceneEntity): [number, number, number] =>
  e.kind === EntityKind.Player
    ? [(e.values[F.px] ?? 0) / PLAYER_UNITS, (e.values[F.py] ?? 0) / PLAYER_UNITS, (e.values[F.pz] ?? 0) / PLAYER_UNITS]
    : [(e.values[F.ex] ?? 0) / CROWD_UNITS, 0, (e.values[F.ez] ?? 0) / CROWD_UNITS];

/** A stable 0..1 phase per entity id (desyncs crowd steps). */
const phaseOf = (id: number): number => (((Math.imul(id, 0x9e3779b1) >>> 0) % 1000) / 1000);

function radialTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  if (!g) throw new Error("no 2d canvas");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Plain instanced props (gems, bolts, blades): one draw each, no skeleton. */
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
  pool: Mesh;
  /** The keeper: the fallback shape until the library character loads, then the character. */
  body: Group;
  animator: CharacterAnimator | null;
  downed: boolean;
  lantern: Mesh;
  light: PointLight;
  cosmetic: number;
  keeper: number;
  lastWcd: number;
  lastFlags: number;
  lean: number;
  stride: number;
  /** The library character once loaded (the local hero gets an outline and rim on it). */
  model: Group | null;
  highlight: HeroHighlight | null;
}

interface EnemyKind {
  crowd: AnimatedCrowd;
  /** More draws of the same instances when a library model has more than one material group. */
  extras: AnimatedCrowd[];
  big: boolean;
  /** A boss (or mini-boss): its death slows the world for a beat. */
  boss: boolean;
  feel: FeelDef;
  color: number;
  radius: number;
  /** Scenery (urns, campfires): culled when it stands between the camera and your keeper. */
  prop: boolean;
}

/** Feature switches for measurement and bisecting (URL ?shadows=0|1 &post=0 &lights=0 &props=0). */
export interface SceneSwitches {
  readonly shadows?: boolean;
  readonly post?: boolean;
  readonly lights?: boolean;
  readonly props?: boolean;
}

export class PartyScene {
  private readonly switches: SceneSwitches;
  readonly scene = new Scene();
  readonly rig: CameraRig;
  readonly stack: RenderStack;
  readonly dressing: PhysicsDressing;
  private readonly enemies: EnemyKind[] = [];
  private readonly gemCrowds: Crowd[] = [];
  private readonly boltCrowd: Crowd;
  private readonly lanceCrowd: Crowd;
  private readonly bladeCrowd: Crowd;
  /** Teammates' orbit blades: the same shape, a third as bright. */
  private readonly teamBladeCrowd: Crowd;
  private readonly players = new Map<number, PlayerMeshes>();
  private readonly lastHp = new Map<number, number>();
  /** Enemies' crit counters (timers bits 8..11 on the wire): a change is a crit. */
  private readonly lastCrit = new Map<number, number>();
  /** Embers for enemies rising on screen, capped per frame. */
  private risesThisFrame = 0;
  /** Keepers this frame: who is down and who could revive them (the reviver path). */
  private readonly downedAt: [number, number][] = [];
  private readonly upAt: [number, number][] = [];
  private readonly dead = new Set<number>();
  private prevPos = new Map<number, [number, number, number]>();
  private nextPos = new Map<number, [number, number, number]>();
  /** Projectiles seen last frame: id → weapon index (a vanished one sparks where it ended). */
  private shots = new Map<number, number>();
  private nextShots = new Map<number, number>();
  private readonly flames: [number, number, number][] = [];
  /** Bosses whose arrival has tolled, and boss hoards already announced. */
  private readonly bossesHeard = new Set<number>();
  private readonly hoardsSeen = new Set<number>();
  /** Special pickup indices that are boss hoards (chests with evolve). */
  private readonly hoardTypes: Set<number>;
  /** Pillars, to fade the ones that stand between the camera and your keeper. */
  private readonly pillars: { x: number; z: number; r: number; h: number; material: MeshStandardMaterial; fade: number; top: Mesh[] }[] = [];
  private readonly focus = new Vector3();
  private time = 0;
  private selfHp = -1;
  /** Effects fired so far (playtest checks read these). */
  readonly counts = { rings: 0, bursts: 0, flashes: 0, decals: 0, impacts: 0, crits: 0, rises: 0, slowMos: 0, levelUps: 0 };
  /** The lantern's pool of light on the ground (the art style may paint it). */
  private readonly poolTexture: Texture;
  /** Telegraph wind-ups and hostile shots (client/threats.ts), and when each last showed (an impact ring fires as one lands). */
  private readonly threats: ThreatLayer;
  private telegraphs = new Map<number, { x: number; z: number; r: number; p: number; friendly: boolean }>();
  private nextTelegraphs = new Map<number, { x: number; z: number; r: number; p: number; friendly: boolean }>();
  private width = 1;
  private height = 1;
  /** The asset library (real models); null draws the fallback shapes only. */
  private readonly library: LibraryClient | null;
  /** The art style drawn (the game's declared style, or ?style=), and its kit (null: the template's own low-poly drawing). */
  readonly style: string;
  private readonly kit: StyleKit | null;
  /** The playroom's floor, walls and party lights. */
  private readonly level: PartyStage;

  constructor(
    private readonly handle: RendererHandle,
    private readonly game: CompiledGame,
    private readonly config: ResolvedSimConfig,
    private readonly feel: FeelKit,
    opts: { quality?: "low" | "medium" | "high" | "auto"; switches?: SceneSwitches; library?: LibraryClient | null; style?: string } = {},
  ) {
    const s = this.scene;
    this.library = opts.library ?? null;
    this.style = opts.style ?? game.manifest.game.style;
    this.hoardTypes = new Set(game.specialPickups.flatMap((id, i) => (game.manifest.prefabs.get(id)?.pickup?.evolve ? [i] : [])));
    this.rig = new CameraRig(1, { distance: CAMERA_DISTANCE, height: 0.5, follow: 7, lead: 0.3, leadMax: 4, fov: 50, minPitch: 0.9, maxPitch: 1.1 });
    this.rig.pitch = CAMERA_PITCH;
    this.threats = new ThreatLayer(s);
    const look: LookDef | undefined = game.manifest.game.look;
    this.stack = createRenderStack(handle, s, this.rig.camera, {
      preset: look?.preset ?? "night",
      // The art style (game.ts's, or ?style=): the stack applies its kit's lighting, fog, grade, particles, post and session.
      style: this.style,
      quality: opts.quality ?? "auto",
      bloom: (look?.bloom ?? 1) > 0,
      outline: look?.outline ?? false,
      shadowExtent: 30,
      // A high top-down camera (17-24 m out): no height fog, and the haze starts past the playroom.
      atmosphere: { heightFog: 0, near: 40, far: 120 },
      // Library id to URL, for a style's own textures (ps1's surfaces).
      resolve: (id) => {
        try {
          return opts.library?.url(id) ?? null;
        } catch {
          return null;
        }
      },
    });
    // The style's kit (null: the template's own low-poly drawing), for its world builders below.
    this.kit = this.stack.kit;
    this.applyLook(look);
    this.poolTexture = this.stack.session?.surface?.("glow") ?? radialTexture();
    const sw = opts.switches ?? {};
    this.switches = sw;
    // Sun shadows are opt-in here (look.shadows: true, a style that wants them, or ?shadows=1) until the shadow pass
    // over the instanced crowds is tuned: with them on, headless Chrome on WebGPU held ~30 fps instead of 60.
    const shadowsOn = sw.shadows ?? look?.shadows ?? this.kit?.stack?.(look?.preset ?? "night").shadows === true;
    if (!shadowsOn) this.stack.lighting.setShadowMapSize(0);
    if (sw.post === false) this.stack.post.configure({ enabled: false });
    this.feel.particles = this.stack.particles;

    const half = config.arena.halfExtent;
    // The camera stops at the field: past the outer rock it never shows the void.
    this.rig.setBounds(fieldBounds(half, OUTSIDE_VIEW));
    // The playroom: carpet, the dance floor, walls and party lights from the game's field (game.ts).
    const surface = this.stack.session?.surface ? (k: "floor" | "wall" | "stone" | "ground") => this.stack.session?.surface?.(k, { mood: "party playroom" }) ?? null : null;
    this.level = new PartyStage(config.arena.walls ?? [], config.arena.floors ?? [], half, surface);
    s.add(this.level.group);
    this.flames.push(...this.level.flames);

    // Enemies: one animated instanced draw per prefab.
    game.enemyPrefabs.forEach((id, t) => {
      const def = game.manifest.prefabs.get(id);
      const radius = game.sim.content?.enemyTypes?.[t]?.radius ?? 0.35;
      // The model in the art style the game plays in (?style= or the declared style).
      const model = this.model(def?.model ?? "style.lowpoly.missing");
      const a = resolveAsset(model, radius);
      const big = def?.boss === true || radius >= 0.5;
      const motion = { bob: Math.min(0.25, radius * 0.35), fullSpeed: Math.max(1.5, def?.speed ?? 3), squash: big ? 0.18 : 0.32 };
      const capacity = def?.boss ? 4 : MAX_PER_TYPE;
      // Props are drawn at their model's natural size (a campfire stays a campfire), not by hit radius.
      const libHeight = def?.prop ? (assetById(model)?.height ?? radius * 2) * PROP_SCALE : radius * ENEMY_HEIGHT_PER_RADIUS;
      const crowd = new AnimatedCrowd(a.geometry, a.material as MeshStandardMaterial, capacity, motion).addTo(s);
      const color = (a.material as MeshStandardMaterial).color?.getHex?.() ?? 0xb59cff;
      const boss = def?.boss !== undefined && def.boss !== false;
      const kind: EnemyKind = { crowd, extras: [], big: (big || boss) && !def?.prop, boss, feel: def?.feel ?? (big && !def?.prop ? BIG_KILL : SMALL_KILL), color, radius, prop: def?.prop === true };
      this.enemies.push(kind);
      // The library model, about 3.2 hit radii tall, dressed by the prefab's appearance, keeping a faint glow in the shape's colour for the night.
      this.library?.crowd(model, def?.appearance, { height: libHeight }).then(
        (c) => {
          const glow = (a.material as MeshStandardMaterial).emissive;
          const made = c.parts.map((p) => {
            const m = p.material.clone() as MeshStandardMaterial;
            // Props keep their own colours (a glow made the stumps read as pink crystals).
            if (m.emissive && glow && !def?.prop) {
              m.emissive.copy(glow);
              m.emissiveIntensity = 0.35;
            }
            return new AnimatedCrowd(p.geometry, m, capacity, motion).addTo(s);
          });
          const [first, ...rest] = made;
          if (!first) return;
          s.remove(kind.crowd.mesh);
          kind.crowd = first;
          kind.extras = rest;
        },
        (e: unknown) => console.warn(`library: ${model} stays a shape (${e instanceof Error ? e.message : String(e)})`),
      );
    });
    for (const id of [...game.pickupPrefabs, ...game.specialPickups]) {
      const p = game.manifest.prefabs.get(id);
      const model = this.model(p?.model ?? "style.lowpoly.missing");
      const a = resolveAsset(model);
      const crowd = new Crowd(a.geometry, a.material, MAX_GEMS);
      this.gemCrowds.push(crowd);
      s.add(crowd.mesh);
      const asset = p ? assetById(model) : undefined;
      // A style kit draws its own procedural pickups (voxel gems); low-poly keeps the template's shapes.
      if (this.library && p && asset && (!("procedural" in asset.source) || this.kit)) {
        this.library.crowd(model, p.appearance, { height: 0.5 }).then(
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
    const b = fx.bolt();
    this.boltCrowd = new Crowd(b.geometry, b.material, MAX_BOLTS);
    const l = fx.lance();
    this.lanceCrowd = new Crowd(l.geometry, l.material, MAX_BOLTS);
    const bl = fx.blade();
    this.bladeCrowd = new Crowd(bl.geometry, bl.material, MAX_BLADES);
    const teamBlade = (bl.material as MeshStandardMaterial).clone();
    teamBlade.emissiveIntensity *= TEAM_FX;
    teamBlade.color.multiplyScalar(0.6);
    this.teamBladeCrowd = new Crowd(bl.geometry, teamBlade, MAX_BLADES);
    for (const c of [this.boltCrowd, this.lanceCrowd, this.bladeCrowd, this.teamBladeCrowd]) s.add(c.mesh);
    this.dressing = new PhysicsDressing(s, config, { props: opts.switches?.props !== false, ...(this.kit?.shape ? { shape: (n) => this.kit?.shape?.(n) ?? null } : {}) });
  }

  /**
   * Compile every pipeline before the first real frame. WebGPU builds a
   * pipeline the first time a material, instancing layout or pass is drawn,
   * which is a 100 ms+ hitch mid-fight (the first kill, the first decal);
   * drawing one instance of everything out of sight at load moves that cost
   * behind the loading banner.
   */
  async warmup(): Promise<void> {
    const hide = -60;
    for (const k of this.enemies) {
      k.crowd.begin();
      k.crowd.push(0, hide, 0, 0, 0, 1, 0.5, 0.5, 1);
      k.crowd.end(0);
    }
    for (const c of [...this.gemCrowds, this.boltCrowd, this.lanceCrowd, this.bladeCrowd, this.teamBladeCrowd]) {
      c.begin();
      c.push(0, hide, 0, 0, 1);
      c.end();
    }
    for (const preset of ["burst", "kill", "bigKill", "sparks", "hitSpark", "dust", "magic", "embers", "smoke"]) {
      this.stack.particles.burst(preset, 0, hide, 0, { count: 2 });
    }
    for (const kind of ["scorch", "splat", "ring"] as const) this.stack.decals.add(kind, 1000, 1000, { life: 0.1 });
    this.stack.rings.fire(1000, 1000, 1, { duration: 0.05 });
    this.dressing.shatter(0, 0, 0.3, new Color(0xffffff), 1);
    const r = this.handle.renderer as { compileAsync?: (scene: Scene, camera: unknown) => Promise<void> };
    try {
      // Never let a slow or stuck compile hold the game: the frames below build anything it missed.
      await Promise.race([r.compileAsync?.(this.scene, this.rig.camera), new Promise((ok) => setTimeout(ok, 1500))]);
    } catch {
      // Older renderers: the frames below still build the pipelines.
    }
    this.rig.update(this.focus, 0);
    for (let i = 0; i < 2; i++) this.stack.frame(0, this.focus);
    for (const k of this.enemies) {
      k.crowd.begin();
      k.crowd.end(0);
    }
    for (const c of [...this.gemCrowds, this.boltCrowd, this.lanceCrowd, this.bladeCrowd, this.teamBladeCrowd]) {
      c.begin();
      c.end();
    }
  }

  /** A library id in the style drawn: "style.lowpoly.ghost" is "style.voxel.ghost" in the voxel style. */
  private model(id: string): string {
    return restyleId(id, this.style);
  }

  /** Map the game's declared `look` onto the stack's grade and lighting. */
  private applyLook(look: LookDef | undefined): void {
    if (!look) return;
    const post = this.stack.post;
    if (look.bloom !== undefined && post.bloom) post.bloom.strength.value *= look.bloom;
    if (look.exposure !== undefined) post.exposure.value *= look.exposure;
    if (look.saturation !== undefined) post.saturation.value = look.saturation;
    if (look.contrast !== undefined) post.contrast.value = look.contrast;
    if (look.vignette !== undefined) post.vignette.value = look.vignette;
    if (look.tint) {
      const c = new Color(hex(look.tint, 0xffffff));
      post.highlightTint.value.set(c.r, c.g, c.b);
    }
    if (look.shadows === false) this.stack.lighting.setShadowMapSize(0);
    if (look.fog !== undefined) {
      // 0 = clear to the walls, 1 = thick: linear fog pulls in, exp2 thickens.
      const a = this.stack.atmosphere;
      a.far.value = 200 - 170 * look.fog;
      a.near.value = a.far.value * 0.3;
      a.density.value = 0.06 * look.fog;
    }
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.stack.resize(width, height);
    this.rig.resize(width / height);
    // Portrait phones: pull back so the swarm stays on screen.
    this.rig.setDistance(width < height ? CAMERA_DISTANCE_PORTRAIT : CAMERA_DISTANCE);
  }

  /** World position → CSS pixels on the canvas (for damage numbers and HUD markers). */
  project(x: number, y: number, z: number, width = this.width, height = this.height): { x: number; y: number; onScreen: boolean } {
    const v = new Vector3(x, y, z).project(this.rig.camera);
    return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height, onScreen: v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
  }

  /** Play a declared `feel` at a world point (kills, impacts, novas). */
  private playFeel(f: FeelDef, x: number, y: number, z: number, color: number, size: number, dirX = 0, dirZ = 0): void {
    const c = hex(f.color, color);
    if (f.particles) {
      this.stack.particles.burst(f.particles, x, y, z, { color: c, dirX, dirZ, count: Math.round(6 + size * 10) });
      this.counts.bursts++;
    }
    if (f.decal && f.decal !== "none") {
      this.stack.decals.add(f.decal, x, z, { size: size * 2.6, color: f.decal === "scorch" ? 0x1a1208 : c, life: 7, opacity: 0.7 });
      this.counts.decals++;
    }
    if (f.shake) this.rig.addTrauma(f.shake);
    if (f.hitStop) this.feel.clock.hitStop(f.hitStop * 1000);
    const cue = f.sound && f.sound !== "none" ? CUE[f.sound] : undefined;
    if (cue) this.feel.audio?.play(cue, { screenX: this.project(x, y, z).x, width: this.width });
  }

  private player(id: number, cosmetic: number, keeperIndex = 0): PlayerMeshes {
    let p = this.players.get(id);
    if (p && p.cosmetic === cosmetic && p.keeper === keeperIndex) return p;
    if (p) {
      this.scene.remove(p.body, p.light, p.pool);
      this.players.delete(id);
    }
    // A keeper brings its own model and tint (the Disco palette still wins).
    const keeperDef = [...this.game.manifest.keepers.values()][keeperIndex];
    const keeperTint = keeperDef?.tint ? parseInt(keeperDef.tint.slice(1), 16) : null;
    const color = cosmetic === 1 ? DISCO.body : (keeperTint ?? KEEPER_COLORS[(id - 1) % KEEPER_COLORS.length] ?? 0xffffff);
    const glow = cosmetic === 1 ? DISCO.glow : 0xffb347;
    const players = this.game.manifest.game.players;
    const model = this.model(keeperDef?.model ?? players.prefab);
    const a = resolveAsset(model);
    const shape = new Mesh(a.geometry, new MeshStandardMaterial({ color, roughness: 0.45, flatShading: true, emissive: new Color(color).multiplyScalar(0.12) }));
    shape.castShadow = true;
    const body = new Group();
    body.add(shape);
    const lantern = new Mesh(new SphereGeometry(0.16, 10, 8), new MeshBasicMaterial({ color: new Color(glow).multiplyScalar(5) }));
    lantern.position.set(0.35, 0.3, -0.25);
    shape.add(lantern);
    const light = new PointLight(glow, 30, 14, 1.4);
    light.visible = this.switches.lights !== false;
    const pool = new Mesh(new PlaneGeometry(9, 9), new MeshBasicMaterial({ map: this.poolTexture, color: glow, transparent: true, opacity: 0.4, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2;
    this.scene.add(body, light, pool);
    const made: PlayerMeshes = { pool, body, animator: null, downed: false, lantern, light, cosmetic, keeper: keeperIndex, lastWcd: 0, lastFlags: 0, lean: 0, stride: 0, model: null, highlight: null };
    p = made;
    this.players.set(id, p);
    // The library character in the keeper's slot colour (or the Disco palette), carrying the lantern.
    const own = players.appearance;
    const appearance = { ...own, parts: own?.parts ?? [], tint: cosmetic === 1 || keeperTint !== null || !own?.tint ? `#${color.toString(16).padStart(6, "0")}` : own.tint };
    this.library?.character(model, appearance, { height: KEEPER_HEIGHT }).then(
      (c) => {
        if (this.players.get(id) !== made) return;
        body.remove(shape);
        c.root.traverse((o) => {
          o.castShadow = true;
        });
        body.add(c.root);
        lantern.position.set(0.32, KEEPER_HEIGHT * 0.45, -0.25);
        body.add(lantern);
        made.animator = c.animator;
        made.model = c.root as Group;
      },
      (e: unknown) => console.warn(`library: keeper stays a shape (${e instanceof Error ? e.message : String(e)})`),
    );
    return p;
  }

  frame(input: FrameInput): FrameEvents {
    const dt = input.dt;
    this.time += dt;
    const feel = this.feel;
    const out: FrameEvents = { selfHurt: 0, enemiesDrawn: 0 };
    this.risesThisFrame = 0;
    this.downedAt.length = 0;
    this.upAt.length = 0;
    for (const k of this.enemies) for (const c of [k.crowd, ...k.extras]) c.begin();
    for (const c of this.gemCrowds) c.begin();
    this.boltCrowd.begin();
    this.lanceCrowd.begin();
    this.bladeCrowd.begin();
    this.teamBladeCrowd.begin();
    this.threats.begin(dt);
    const enemyTypes = this.config.content.enemyTypes;
    const seeThreat = (id: number, t: ReturnType<typeof threatOf>, friendly = false) => {
      if (!t) return;
      this.threats.draw(t, friendly);
      if (t.kind === "circle" && !t.shot) this.nextTelegraphs.set(id, { x: t.x, z: t.z, r: t.r, p: t.progress, friendly });
    };

    const seenPlayers = new Set<number>();
    const [sx, , sz] = input.self ? pos(input.self) : [this.focus.x, 0, this.focus.z];
    const all = input.self ? [input.self, ...input.others] : input.others;
    const next = this.nextPos;
    next.clear();
    this.nextShots.clear();

    for (const e of all) {
      const [x, y, z] = pos(e);
      const prev = this.prevPos.get(e.id);
      next.set(e.id, [x, y, z]);
      if (e.kind === EntityKind.Enemy) {
        const type = e.values[F.type] ?? 0;
        const flags = e.values[F.flags] ?? 0;
        const hp = e.values[F.health] ?? 0;
        const kind = this.enemies[type];
        if (!kind) continue;
        // Push direction: away from the nearest keeper we know of (ours).
        let dx = x - sx;
        let dz = z - sz;
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl;
        dz /= dl;
        if ((flags & EntityFlag.Dead) !== 0) {
          if (!this.dead.has(e.id)) {
            this.dead.add(e.id);
            const near = (x - sx) ** 2 + (z - sz) ** 2 < 49;
            feel.kill({ x, y: 0.4, z, big: kind.big && near, color: kind.color, dirX: dx, dirZ: dz, particles: kind.feel.particles ?? (kind.big ? "bigKill" : "kill") });
            this.playFeel({ ...kind.feel, particles: undefined }, x, 0.4, z, kind.color, kind.radius, dx, dz);
            this.dressing.shatter(x, z, kind.radius, new Color(kind.color), kind.big ? 12 : 3, dx, dz);
            this.counts.bursts++;
            // A boss falls: the world slows for a beat.
            if (kind.boss) {
              feel.clock.slowMo(0.25, 900, 500);
              this.stack.particles.burst("magic", x, 1.2, z, { count: 80, color: 0xffd36b, speed: 9 });
              this.counts.slowMos++;
            }
          }
          continue;
        }
        const last = this.lastHp.get(e.id);
        const crit = e.values[F.timers] ?? 0;
        const lastCrit = this.lastCrit.get(e.id);
        this.lastCrit.set(e.id, crit);
        if (last === undefined && kind.boss && !this.bossesHeard.has(e.id)) {
          // A boss arrives: the bell tolls (once per boss).
          this.bossesHeard.add(e.id);
          feel.audio?.play("boss");
        }
        if (last === undefined && this.risesThisFrame < 6 && (x - sx) ** 2 + (z - sz) ** 2 < 400) {
          // Something rose where we can see it (a summon, a split, a scattered urn): embers from the ground.
          this.risesThisFrame++;
          this.stack.particles.burst("embers", x, 0.2, z, { count: 8, color: 0xff8a3d, speed: 2.5 });
          this.counts.rises++;
        }
        if (last !== undefined && hp < last) {
          this.counts.flashes++;
          const isCrit = lastCrit !== undefined && crit !== lastCrit;
          if (isCrit) this.counts.crits++;
          if (kind.feel.flash !== false || isCrit) {
            feel.hit({ id: isCrit ? -e.id - 1 : e.id, x, y: 1 + (kind.big ? 2 : 0), z, amount: last - hp, big: kind.big || isCrit, dirX: dx, dirZ: dz, ...(isCrit ? { kind: "crit" } : {}) });
          }
          if (this.counts.flashes % 3 === 0) this.stack.particles.burst("hitSpark", x, 0.8, z, { count: 3, dirX: dx, dirZ: dz });
        }
        this.lastHp.set(e.id, hp);
        let yaw = 0;
        let speed = 0;
        if (prev) {
          const mx = x - prev[0];
          const mz = z - prev[2];
          const d2 = mx * mx + mz * mz;
          yaw = d2 > 1e-6 ? Math.atan2(-mx, -mz) : Math.atan2(sx - x, sz - z) + Math.PI;
          speed = dt > 0 ? Math.sqrt(d2) / dt : 0;
        }
        // Scenery between the camera and your keeper is not drawn (it never hides you).
        if (kind.prop && z - sz > -0.3 && z - sz < 1.8 && Math.abs(x - sx) < 1.4 + kind.radius) continue;
        const k = feel.knock.get(e.id);
        const squash = Math.max(0, 1 - k.sy);
        const elite = (flags & EntityFlag.Elite) !== 0;
        for (const c of [kind.crowd, ...kind.extras]) c.push(x + k.x, 0, z + k.z, yaw, phaseOf(e.id), Math.min(speed, 8), squash * 3, feel.flash.value(e.id), elite ? 1.5 : 1);
        const er = enemyTypes[type]?.radius ?? 0.35;
        if (elite) this.threats.mark(x, z, er * 1.5 + 0.35, 0xffc35a);
        if ((flags & EntityFlag.Shielded) !== 0) this.threats.mark(x, z, er + 0.5, 0x6fd3ff);
        const level = e.values[F.level] ?? 0;
        if (level !== 0) seeThreat(e.id, threatOf(enemyTypes, e.kind, flags, type, level, x, z));
        out.enemiesDrawn++;
      } else if (e.kind === EntityKind.Pickup) {
        // Gem tiers 0..2, then special pickups (type PICKUP_SPECIAL + i), which bob higher and spin slower.
        const type = e.values[F.type] ?? 0;
        const special = type >= PICKUP_SPECIAL;
        const gems = this.game.pickupPrefabs.length;
        const crowd = special ? this.gemCrowds[gems + (type - PICKUP_SPECIAL)] : this.gemCrowds[Math.min(gems - 1, type)];
        crowd?.push(x, (special ? 0.6 : 0.35) + Math.sin(this.time * 4 + e.id) * (special ? 0.15 : 0.08), z, this.time * (special ? 1 : 2) + e.id, special ? 1.4 : 1);
        if (special && this.hoardTypes.has(type - PICKUP_SPECIAL)) {
          // A boss's hoard: a gold pulse on the ground, and a burst and a chime when it first drops.
          this.threats.mark(x, z, 1.3 + 0.25 * Math.sin(this.time * 5), 0xffcf5a);
          if (!this.hoardsSeen.has(e.id)) {
            this.hoardsSeen.add(e.id);
            this.stack.particles.burst("magic", x, 1, z, { count: 60, color: 0xffd36b, speed: 7 });
            this.stack.rings.fire(x, z, 6, { color: 0xffcf5a, glow: 2.4, duration: 0.6 });
            feel.audio?.play("coin");
          }
        }
      } else if (e.kind === EntityKind.Projectile && ((e.values[F.flags] ?? 0) & EntityFlag.Hostile) !== 0) {
        seeThreat(e.id, threatOf(enemyTypes, e.kind, e.values[F.flags] ?? 0, e.values[F.type] ?? 0, e.values[F.level] ?? 0, x, z));
      } else if (e.kind === EntityKind.Projectile) {
        let yaw = 0;
        if (prev) yaw = Math.atan2(-(x - prev[0]), -(z - prev[2]));
        const weapon = e.values[F.type] ?? 0;
        const wdef = this.config.content.weapons[weapon];
        if ((e.values[F.flags] ?? 0) & EntityFlag.Elite) {
          // A keeper's meteor: a gold circle that fills, then lands.
          seeThreat(e.id, threatOf(enemyTypes, EntityKind.Projectile, EntityFlag.Hostile | EntityFlag.Elite, weapon, e.values[F.level] ?? 0, x, z), true);
          continue;
        }
        if (wdef?.kind === "boomerang") this.bladeCrowd.push(x, 0.8, z, this.time * 18 + e.id, 1.2);
        else (wdef && wdef.pierce < 3 ? this.boltCrowd : this.lanceCrowd).push(x, 0.8, z, yaw, 1);
        if (!this.shots.has(e.id)) this.stack.particles.burst("sparks", x, 0.8, z, { count: 3, color: 0xffd36b, speed: 3 });
        this.nextShots.set(e.id, weapon);
      } else if (e.kind === EntityKind.Player) {
        seenPlayers.add(e.owner);
        this.drawPlayer(e, x, y, z, prev, input, out);
        const pf = e.values[F.flags] ?? 0;
        if ((pf & EntityFlag.Downed) !== 0) this.downedAt.push([x, z]);
        else if ((pf & EntityFlag.Dead) === 0) this.upAt.push([x, z]);
      }
    }
    // The reviver path: dots on the ground from each downed keeper to the nearest one standing.
    for (const [dx, dz] of this.downedAt) {
      let best: [number, number] | null = null;
      let bd = 45 * 45;
      for (const u of this.upAt) {
        const d2 = (u[0] - dx) ** 2 + (u[1] - dz) ** 2;
        if (d2 < bd) {
          bd = d2;
          best = u;
        }
      }
      if (!best) continue;
      const len = Math.sqrt(bd);
      const n = Math.min(18, Math.floor(len / 1.8));
      const pulse = (this.time * 1.5) % 1;
      for (let i = 1; i < n; i++) {
        const t = (i - pulse) / n;
        this.threats.mark(dx + (best[0] - dx) * t, dz + (best[1] - dz) * t, 0.16, 0xff8a7a);
      }
      this.threats.mark(dx, dz, 1.4 + 0.2 * Math.sin(this.time * 6), 0xff5c5c);
    }
    // Projectiles that vanished hit something (an enemy or a pillar): a spark where they ended.
    for (const [id, weapon] of this.shots) {
      if (this.nextShots.has(id)) continue;
      const p = this.prevPos.get(id);
      if (!p) continue;
      const wf = this.game.manifest.weapons.get(this.game.weaponIds[weapon] ?? "")?.feel;
      this.stack.particles.burst(wf?.particles ?? "hitSpark", p[0], 0.8, p[2], { count: 6, color: hex(wf?.color, 0xffe08a) });
      if (wf) this.playFeel({ ...wf, particles: undefined }, p[0], 0.8, p[2], 0xffe08a, 0.4);
      this.counts.impacts++;
    }
    [this.shots, this.nextShots] = [this.nextShots, this.shots];
    this.prevPos = next;
    this.nextPos = new Map();
    // Forget hp for entities no longer in view.
    if (this.lastHp.size > 2000) {
      for (const id of this.lastHp.keys()) if (!next.has(id)) this.lastHp.delete(id);
      for (const id of this.dead) if (!next.has(id)) this.dead.delete(id);
    }
    for (const [id, p] of this.players) {
      if (seenPlayers.has(id)) continue;
      this.scene.remove(p.body, p.light, p.pool);
      this.players.delete(id);
    }
    this.dressing.keepOnly(seenPlayers);
    this.dressing.update(dt);
    for (const hit of this.dressing.impacts) {
      if (hit.speed > 5) feel.audio?.play("land", { gain: Math.min(1, hit.speed / 12), screenX: this.project(hit.x, hit.y, hit.z).x, width: this.width });
    }

    // Embers rising off the pillar braziers.
    for (const [fx0, fy, fz] of this.flames) {
      if ((fx0 - sx) ** 2 + (fz - sz) ** 2 < 900) this.stack.particles.emit("embers", fx0, fy, fz, 5, dt, { color: 0xffa040 });
    }

    const now = this.stack.time + dt;
    for (const k of this.enemies) for (const c of [k.crowd, ...k.extras]) c.end(now);
    for (const c of this.gemCrowds) c.end();
    this.boltCrowd.end();
    this.lanceCrowd.end();
    this.bladeCrowd.end();
    this.teamBladeCrowd.end();
    this.threats.end();
    // A circle that was nearly full and is gone has landed: an impact ring where it hit.
    for (const [id, t] of this.telegraphs) {
      if (!this.nextTelegraphs.has(id) && t.p >= 0.8) this.stack.rings.fire(t.x, t.z, t.r, { color: t.friendly ? 0xffd36b : 0xff6a3c, duration: 0.4, glow: 2 });
    }
    [this.telegraphs, this.nextTelegraphs] = [this.nextTelegraphs, this.telegraphs];
    this.nextTelegraphs.clear();

    if (input.self) {
      const [x, y, z] = pos(input.self);
      this.focus.set(x, y, z);
    }
    this.rig.yaw = 0;
    this.rig.update(this.focus, dt, input.realDt);
    this.fadePillars(dt);
    // Walls between the camera and your player open up (x-ray cut).
    this.level.cut.update(this.rig.camera.position, this.focus);
    // (A party has no fog of war: every floor is lit from the start.)
    this.level.update(dt, [...this.upAt, ...this.downedAt]);
    this.stack.post.hurt.value = input.hurt;
    this.stack.frame(dt, this.focus);
    return out;
  }

  /** Pillars between the camera (south, looking north and down) and your keeper fade to a ghost. */
  private fadePillars(dt: number): void {
    const reach = 1 / Math.tan(this.rig.pitch);
    const hx = this.focus.x;
    const hz = this.focus.z;
    for (const p of this.pillars) {
      const dz = p.z - hz;
      const covers = dz > -p.r && dz < p.h * reach + p.r && Math.abs(p.x - hx) < p.r + 0.9;
      const goal = covers ? 0.25 : 1;
      p.fade += (goal - p.fade) * Math.min(1, dt * 8);
      const m = p.material;
      const see = p.fade < 0.985;
      if (m.transparent !== see) {
        m.transparent = see;
        m.depthWrite = !see;
        m.needsUpdate = true;
      }
      m.opacity = see ? p.fade : 1;
      for (const t of p.top) t.visible = p.fade > 0.6;
    }
  }

  private drawPlayer(e: SceneEntity, x: number, y: number, z: number, prev: [number, number, number] | undefined, input: FrameInput, out: FrameEvents): void {
    const flags = e.values[F.flags] ?? 0;
    const pm = this.player(e.owner, e.values[F.type] ?? 0, ((e.values[F.value] ?? 0) >>> 12) & 0xf);
    const downed = (flags & EntityFlag.Downed) !== 0;
    const dead = (flags & EntityFlag.Dead) !== 0;
    const dashing = (flags & EntityFlag.Dashing) !== 0;
    const dt = input.dt;
    const mine = e.owner === input.selfPlayer;
    // Procedural locomotion: stride bob and a lean into the run.
    let speed = 0;
    if (prev && dt > 0) speed = Math.hypot(x - prev[0], z - prev[2]) / dt;
    pm.stride += dt * (2 + speed * 1.4);
    pm.lean += (Math.min(speed, 12) * 0.035 - pm.lean) * Math.min(1, dt * 10);
    const bob = Math.abs(Math.sin(pm.stride * Math.PI)) * Math.min(1, speed / 6) * 0.12;
    if (pm.animator) {
      // A library character stands on its feet (the sim's y is the capsule centre, 0.9 m up) and animates itself.
      pm.body.position.set(x, Math.max(0, y - 0.9), z);
      pm.body.rotation.set(downed ? 0 : -pm.lean * 0.5, e.values[F.yaw] ?? 0, 0, "YXZ");
      if (downed && !pm.downed) pm.animator.play("die", { hold: true });
      else if (!downed && pm.downed) pm.animator.play("idle");
      if (!downed) pm.animator.setSpeed(speed);
      pm.animator.update(dt);
    } else {
      pm.body.position.set(x, (downed ? 0.45 : y) + bob, z);
      pm.body.rotation.set(downed ? Math.PI / 2 : -pm.lean, e.values[F.yaw] ?? 0, 0, "YXZ");
    }
    pm.downed = downed;
    // Your own keeper is the brightest thing on screen: a dark outline and a warm rim on the character.
    if (mine && pm.model && pm.highlight?.root !== pm.model) {
      pm.highlight?.dispose();
      pm.highlight = new HeroHighlight(pm.model, { rim: 0xffd27a, rimStrength: 0.7, rimPower: 3, outline: 0x140a02, outlineWidth: 0.05 });
    }
    if (pm.highlight) pm.highlight.strength = downed ? 0.4 : 1;
    const iframes = (e.values[F.iframes] ?? 0) > 0;
    pm.body.visible = !dead && !(iframes && Math.floor(this.time * 20) % 2 === 0 && !dashing);
    pm.light.position.set(x, 2.2, z);
    pm.pool.position.set(x, 0.03, z);
    pm.pool.visible = !dead;
    pm.light.intensity = dead ? 0 : downed ? 6 + Math.sin(this.time * 6) * 4 : 22;
    this.dressing.keeper(e.owner, x, 1, z, !dead && !downed);
    // Dash: dust, a ring and (for us) the kit's dash punch.
    if (dashing && (pm.lastFlags & EntityFlag.Dashing) === 0) {
      this.stack.particles.burst("dust", x, 0.1, z, { count: 10 });
      if (mine) this.feel.dash();
    }
    pm.lastFlags = flags;
    if (mine) this.feel.footstep(dead || downed ? 0 : speed);
    // A weapon fired when its cooldown jumped up since last frame. Sizes come from the sim's own scaling.
    const wcd = e.values[F.wcd] ?? 0;
    const weapons = e.values[F.weapons] ?? 0;
    const mods = weaponModsFor(this.config, e.values[F.stats] ?? 0);
    // Teammates' area effects draw at a third of the brightness: yours stay loud, theirs never wash over you or the HUD.
    const fxk = mine ? 1 : TEAM_FX;
    for (let s = 0; s < 4; s++) {
      const wi = slotWeapon(weapons, s);
      const def = wi >= 0 ? this.config.content.weapons[wi] : undefined;
      if (!def) continue;
      const lvl = slotLevel(weapons, s);
      const sc = scaledWeapon(def, lvl, mods);
      const fired = ((wcd >>> (s * 8)) & 0xff) > ((pm.lastWcd >>> (s * 8)) & 0xff) + 1;
      if (def.kind === "aura" && !dead && !downed) {
        // The field you carry: a steady ring at its edge, a soft pulse when it bites.
        this.threats.mark(x, z, sc.range, mine ? 0xffa040 : dim(0xffa040, fxk));
        if (fired) this.stack.rings.fire(x, z, sc.range * 2, { color: 0xffa040, duration: 0.25, glow: 1.2 * fxk });
      } else if (def.kind === "cone" && fired) {
        // A sweep where the keeper faces: sparks across the arc.
        const yaw = e.values[F.yaw] ?? 0;
        const fx0 = -Math.sin(yaw);
        const fz0 = -Math.cos(yaw);
        const base = Math.atan2(fz0, fx0);
        const n = Math.max(5, Math.round((sc.spread / Math.PI) * 8));
        for (let i = 0; i < n; i++) {
          const a = base + (i / Math.max(1, n - 1) - 0.5) * sc.spread;
          this.stack.particles.burst("hitSpark", x + Math.cos(a) * sc.range * 0.8, 0.6, z + Math.sin(a) * sc.range * 0.8, { count: mine ? 3 : 1, color: mine ? 0xffc070 : dim(0xffc070, fxk), speed: 2 });
        }
      } else if (def.kind === "chain" && fired) {
        // Lightning to the nearest enemies in reach (the sim picks the same nearest first).
        let lx = x;
        let lz = z;
        const taken = new Set<number>();
        for (let j = 0; j <= sc.count; j++) {
          let best: SceneEntity | undefined;
          let bd = (j === 0 ? sc.range : Math.max(2.5, sc.speed)) ** 2;
          for (const o of input.others) {
            if (o.kind !== EntityKind.Enemy || taken.has(o.id)) continue;
            const [ox, , oz] = pos(o);
            const d2 = (ox - lx) ** 2 + (oz - lz) ** 2;
            if (d2 < bd) {
              bd = d2;
              best = o;
            }
          }
          if (!best) break;
          taken.add(best.id);
          const [bx, , bz] = pos(best);
          for (let t = 0.25; t < 1; t += 0.25) this.stack.particles.burst("sparks", lx + (bx - lx) * t, 0.9, lz + (bz - lz) * t, { count: 2, color: 0x9fd8ff, speed: 1.5 });
          lx = bx;
          lz = bz;
        }
      } else if (def.kind === "nova") {
        if (fired) {
          const r = sc.range;
          const wf = this.game.manifest.weapons.get(this.game.weaponIds[wi] ?? "")?.feel;
          const color = hex(wf?.color, 0xffb347);
          this.stack.rings.fire(x, z, r * 2, { color, glow: 2.2 * fxk });
          this.stack.particles.burst(wf?.particles ?? "magic", x, 0.4, z, { count: mine ? 14 : 4, color: mine ? color : dim(color, fxk), speed: r * 2.2, spread: 1 });
          this.stack.decals.add(wf?.decal && wf.decal !== "none" ? wf.decal : "ring", x, z, { size: r * 2, color, life: 2.5, opacity: 0.5 * fxk, glow: 1.6 * fxk });
          this.dressing.blast(x, z, r + 0.6, 4 + def.knockback * 0.6);
          if (mine && wf?.shake) this.rig.addTrauma(wf.shake);
          this.counts.rings++;
        }
      } else if (def.kind === "orbit" && !dead && !downed) {
        for (let b = 0; b < sc.count; b++) {
          const a = orbitAngle(input.worldTick, this.config.tickRate, sc.speed, b, sc.count);
          (mine ? this.bladeCrowd : this.teamBladeCrowd).push(x + Math.cos(a) * sc.range, 0.7, z + Math.sin(a) * sc.range, -a, 1);
        }
      }
    }
    pm.lastWcd = wcd;
    if (mine) {
      const hp = e.values[F.health] ?? 0;
      if (this.selfHp >= 0 && hp < this.selfHp) out.selfHurt += this.selfHp - hp;
      this.selfHp = hp;
    }
  }
}
