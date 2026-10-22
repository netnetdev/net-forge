/**
 * The 3D stage every board template draws on: one three.js scene through
 * the engine's render stack in the game's art style (lowpoly, toon, ps1,
 * pixel, voxel, handdrawn), a tilted top-down camera that frames a
 * rectangle of ground, ground picking, library models with fallback shapes
 * (so a game always draws, built library or not) and instanced crowds.
 *
 * Network: one GET per distinct library id (LibraryClient). No chain reads.
 */
import {
  Box3,
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from "three/webgpu";
import type { BufferGeometry, Material } from "three/webgpu";
import { AnimatedCrowd, createRenderStack, styleKit } from "@netnetcapital/engine/runtime";
import type { FieldSpec, LookPreset, RenderStack, RendererHandle, StyleKit } from "@netnetcapital/engine/runtime";
import type { LibraryClient } from "@netnetcapital/asset-library/three";

export interface StageOptions {
  /** The art style drawn (the game's declared style or ?style=). */
  readonly style: string;
  readonly preset?: LookPreset;
  /** Real models; null draws the fallback shapes only (?shapes=1, or no library). */
  readonly library: LibraryClient | null;
  /** The ground the game stands on, metres, centred on the origin. */
  readonly ground: { readonly w: number; readonly h: number };
  /** Words a style kit dresses the ground with ("meadow", "yard"). */
  readonly theme?: string;
  /** Base colour of the template's own ground (no style surface). */
  readonly groundColor?: number;
  /** Camera pitch, radians above the ground (default 0.95). */
  readonly pitch?: number;
  /** Let a style that builds fields (voxel) lay its own land (default true). A game played on a surface of its own (a desk) says false. */
  readonly field?: boolean;
}

/** A model handle that swaps the fallback for the real model when it loads. */
export interface Placed {
  readonly root: Group;
  /** Resolves once the library model replaced the fallback (or failed and kept it). */
  readonly ready: Promise<void>;
}

/** An instanced crowd of one model: write instances between begin() and end() each frame. */
export interface Crowd {
  begin(): void;
  push(x: number, y: number, z: number, yaw: number, phase: number, speed: number, hit?: number, flash?: number, scale?: number): void;
  end(seconds: number): void;
}

const mat = (color: number, emissive = 0) => new MeshStandardMaterial({ color: new Color(color), emissive: new Color(emissive), roughness: 0.75, metalness: 0.1, flatShading: true });

/** A fallback shape by the library id's kind words: creatures are blobs, props are boxes, characters capsules. */
export function fallbackShape(id: string, height: number, color = 0xb7c0cc): { geometry: BufferGeometry; material: Material } {
  const name = id.split(".")[2] ?? "";
  let g: BufferGeometry;
  if (/turret|tower|generator|dish|obelisk|column/.test(name)) {
    g = new CylinderGeometry(height * 0.28, height * 0.36, height, 8);
    g.translate(0, height / 2, 0);
  } else if (/slime|blob|frog|crab|bee|bug|ghost|bat|fox|wolf|cat|pug|shiba|dino|imp|jelly|fluffy/.test(name)) {
    g = new IcosahedronGeometry(height * 0.45, 1);
    g.translate(0, height * 0.45, 0);
  } else if (/tree|pine|bush|rock|crystal|stump|mushroom/.test(name)) {
    g = new ConeGeometry(height * 0.35, height, 7);
    g.translate(0, height / 2, 0);
  } else {
    g = new BoxGeometry(height * 0.5, height, height * 0.5);
    g.translate(0, height / 2, 0);
  }
  return { geometry: g, material: mat(color) };
}

function groundTexture(color: number): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  if (!g) throw new Error("no 2d canvas");
  const base = new Color(color);
  g.fillStyle = `#${base.getHexString()}`;
  g.fillRect(0, 0, 256, 256);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    const k = 0.82 + rnd() * 0.3;
    g.fillStyle = `rgba(${Math.round(base.r * 255 * k)},${Math.round(base.g * 255 * k)},${Math.round(base.b * 255 * k)},0.55)`;
    g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class BoardStage {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(40, 16 / 9, 0.5, 400);
  readonly stack: RenderStack;
  readonly kit: StyleKit | null;
  readonly style: string;
  /** Ground height at a point (a style that builds its own field may raise it). */
  readonly groundAt: (x: number, z: number) => number;
  private readonly raycaster = new Raycaster();
  private readonly plane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly target = new Vector3();
  private readonly look = new Vector3();
  private span = { w: 20, h: 14 };
  private pitch: number;
  private aspect = 16 / 9;
  private shake = 0;
  private time = 0;
  /** Effects fired (playtest checks read these). */
  readonly counts = { bursts: 0, rings: 0, models: 0, failed: 0 };

  constructor(
    private readonly handle: RendererHandle,
    private readonly opts: StageOptions,
  ) {
    this.style = opts.style;
    this.pitch = opts.pitch ?? 0.95;
    this.kit = styleKit(opts.style);
    const library = opts.library;
    this.stack = createRenderStack(handle, this.scene, this.camera, {
      preset: opts.preset ?? "dusk",
      style: opts.style,
      quality: "auto",
      shadowExtent: Math.max(opts.ground.w, opts.ground.h) * 0.7,
      atmosphere: { heightFog: 0, near: 60, far: 160 },
      resolve: (id) => {
        try {
          return library?.url(id) ?? null;
        } catch {
          return null;
        }
      },
    });
    if (this.kit?.stack?.(opts.preset ?? "dusk").shadows === false) this.stack.lighting.setShadowMapSize(0);
    const { w, h } = opts.ground;
    let field: FieldSpec | null = null;
    if (this.kit?.field && opts.field !== false) {
      // A style that builds fields (voxel) lays the ground and the land past it.
      field = { half: Math.max(w, h) / 2 + 1, wallHeight: 0.6, outside: 30, theme: opts.theme ?? "meadow", wall: false };
      this.scene.add(...this.kit.field(field));
    } else {
      const session = this.stack.session;
      const tex = session?.surface?.("ground", { tile: 8, mood: opts.theme ?? "meadow" }) ?? groundTexture(opts.groundColor ?? 0x4f6b3a);
      const size = Math.max(w, h) + 120;
      const tile = (tex.userData as { tile?: number }).tile ?? 8;
      tex.repeat.set(size / tile, size / tile);
      const ground = new Mesh(new PlaneGeometry(size, size), new MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.02;
      ground.receiveShadow = true;
      ground.userData.surface = "ground";
      this.scene.add(ground);
    }
    const spec = field;
    this.groundAt = spec && this.kit?.groundHeight ? (x, z) => this.kit?.groundHeight?.(spec, x, z) ?? 0 : () => 0;
    this.frameRect(0, 0, w, h);
  }

  /** Frame a w x h metre rectangle centred on (x, z). */
  frameRect(x: number, z: number, w: number, h: number): void {
    this.target.set(x, 0, z);
    this.span = { w, h };
    this.place();
  }

  /** Keep the frame's size, move its centre (a walking hero). */
  follow(x: number, z: number, dt: number): void {
    const k = 1 - Math.exp(-dt * 6);
    this.target.x += (x - this.target.x) * k;
    this.target.z += (z - this.target.z) * k;
    this.place();
  }

  private place(): void {
    const fov = (this.camera.fov * Math.PI) / 180;
    // Distance so the span fits: height through the vertical fov (foreshortened by the pitch), width through the horizontal.
    const vSpan = this.span.h * Math.sin(this.pitch) + 2;
    const dV = vSpan / 2 / Math.tan(fov / 2);
    const hFov = 2 * Math.atan(Math.tan(fov / 2) * this.aspect);
    const dH = (this.span.w + 2) / 2 / Math.tan(hFov / 2);
    const d = Math.max(dV, dH);
    const j = this.shake > 0 ? this.shake * 0.25 : 0;
    const jx = j ? (Math.sin(this.time * 61) * j) : 0;
    const jz = j ? (Math.cos(this.time * 53) * j) : 0;
    this.camera.position.set(this.target.x + jx, Math.sin(this.pitch) * d, this.target.z + Math.cos(this.pitch) * d + jz);
    this.look.set(this.target.x + jx, 0, this.target.z + jz);
    this.camera.lookAt(this.look);
  }

  resize(width: number, height: number): void {
    this.aspect = Math.max(0.3, width / Math.max(1, height));
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    this.stack.resize(width, height);
    this.place();
  }

  /** The ground point under a client pixel, or null. */
  pick(clientX: number, clientY: number, rect: DOMRect): { x: number; z: number } | null {
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = new Vector3();
    return this.raycaster.ray.intersectPlane(this.plane, p) ? { x: p.x, z: p.z } : null;
  }

  /** Screen pixel of a world point (and whether it is in front of the camera). */
  project(x: number, y: number, z: number, width: number, height: number): { x: number; y: number; visible: boolean } {
    const v = new Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height, visible: v.z < 1 };
  }

  /** A static model by library id, standing `height` m tall: the fallback shape at once, the real model when it loads. */
  model(id: string, height: number, color?: number, fit?: number): Placed {
    const root = new Group();
    const fb = fallbackShape(id, height, color);
    const shape = new Mesh(fb.geometry, fb.material);
    shape.castShadow = true;
    root.add(shape);
    const lib = this.opts.library;
    const ready = lib
      ? lib.prop(id, undefined, { height }).then(
          (m) => {
            m.traverse((o) => {
              if ((o as Mesh).isMesh) o.castShadow = true;
            });
            // Wide models (a flat rock) shrink to fit `fit` metres across.
            if (fit !== undefined) {
              const box = new Box3().setFromObject(m);
              const across = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
              if (across > fit) m.scale.multiplyScalar(fit / across);
            }
            root.remove(shape);
            root.add(m);
            this.counts.models++;
          },
          () => {
            this.counts.failed++;
          },
        )
      : Promise.resolve();
    return { root, ready };
  }

  /** An instanced crowd of one model (up to `capacity`): the fallback shape until the library's parts load. */
  crowd(id: string, height: number, capacity: number, color?: number): Crowd {
    const fb = fallbackShape(id, height, color);
    let crowds: AnimatedCrowd[] = [new AnimatedCrowd(fb.geometry, fb.material as MeshStandardMaterial, capacity).addTo(this.scene)];
    const lib = this.opts.library;
    if (lib)
      lib.crowd(id, undefined, { height }).then(
        (c) => {
          for (const old of crowds) old.dispose();
          crowds = c.parts.map((p) => new AnimatedCrowd(p.geometry, p.material as MeshStandardMaterial, capacity).addTo(this.scene));
          this.counts.models++;
        },
        () => {
          this.counts.failed++;
        },
      );
    return {
      begin: () => {
        for (const c of crowds) c.begin();
      },
      push: (x, y, z, yaw, phase, speed, hit = 0, flash = 0, scale = 1) => {
        for (const c of crowds) c.push(x, y, z, yaw, phase, speed, hit, flash, scale);
      },
      end: (t) => {
        for (const c of crowds) c.end(t);
      },
    };
  }

  add(...o: Object3D[]): void {
    this.scene.add(...o);
  }

  /** A burst of particles (preset "burst", "sparks", "magic", "kill", "dust"...). */
  burst(preset: string, x: number, y: number, z: number, color?: number, count?: number): void {
    this.stack.particles.burst(preset, x, y, z, { ...(color !== undefined ? { color } : {}), ...(count !== undefined ? { count } : {}) });
    this.counts.bursts++;
  }

  /** A shockwave ring on the ground. */
  ring(x: number, z: number, radius: number, color: number): void {
    this.stack.rings.fire(x, z, radius, { color });
    this.counts.rings++;
  }

  /** Camera shake, 0..1. */
  kick(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  /** Draw one frame. */
  frame(dt: number): void {
    this.time += dt;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      this.place();
    }
    this.stack.frame(dt, { x: this.target.x, y: 0, z: this.target.z });
  }

  get renderer(): RendererHandle {
    return this.handle;
  }
}
