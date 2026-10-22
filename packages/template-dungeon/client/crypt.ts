/**
 * The crypt as drawn: dark rock under everything, a flagstone floor on
 * every room and corridor (game.ts field.floors), stone walls on every
 * wall box (field.walls), and candles in sconces at the room corners. One merged mesh for all the walls and one for all
 * the floors, so the whole level is a handful of draws.
 *
 * Rooms nobody has walked into yet stay dim (a soft fog of war that lifts
 * as a wickbearer enters); the walls stay readable so the plan is always
 * there to see.
 *
 * An art style that paints surfaces (ps1's textures) paints these too
 * (surface roles "floor", "wall", "stone"); the toon, pixel, voxel and
 * hand-drawn styles reshade them in post like everything else.
 */
import { BufferAttribute, BufferGeometry, CanvasTexture, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, MeshStandardNodeMaterial, PlaneGeometry, RepeatWrapping, SphereGeometry, SRGBColorSpace, Vector3 } from "three/webgpu";
import { clamp, dot, float, length, positionWorld, select, uniform } from "three/tsl";
import type { Texture } from "three/webgpu";
import type { WallBox } from "@netnetcapital/engine-sim";

/** Walls are drawn this tall (the sim's are 3 m): low enough that a wall south of you hides less of the room. */
export const WALL_DRAW_HEIGHT = 2.2;
/** Candles burn in sconces this high in the room corners, under the wall tops. */
const SCONCE_HEIGHT = 1.75;
/** Brightness of a floor nobody has walked into yet, and of one a wickbearer has. */
const UNSEEN = 0.2;
const LIT = 0.8;

function hash01(n: number): number {
  let t = (n + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Worn flagstones, drawn on a canvas (one repeat covers 4 m). */
function flagstones(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#3b342d";
    g.fillRect(0, 0, 256, 256);
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        const k = j * 4 + i;
        const off = j % 2 === 0 ? 0 : 32;
        const v = 70 + Math.floor(hash01(k) * 26);
        g.fillStyle = `rgb(${v + 8}, ${v}, ${v - 10})`;
        g.fillRect(((i * 64 + off) % 256) + 2, j * 64 + 2, 60, 60);
        // Cracks and wear.
        g.strokeStyle = "rgba(20, 16, 12, 0.35)";
        g.beginPath();
        g.moveTo(((i * 64 + off) % 256) + 8 + hash01(k + 50) * 40, j * 64 + 6);
        g.lineTo(((i * 64 + off) % 256) + 10 + hash01(k + 90) * 44, j * 64 + 58);
        g.stroke();
      }
    }
    g.fillStyle = "rgba(255, 220, 160, 0.04)";
    for (let n = 0; n < 300; n++) g.fillRect(hash01(n * 3) * 256, hash01(n * 3 + 1) * 256, 2, 2);
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.userData = { tile: 4 };
  return t;
}

/** Coursed stone blocks for the walls (one repeat covers 2 m). */
function masonry(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#1d1a18";
    g.fillRect(0, 0, 128, 128);
    for (let j = 0; j < 4; j++) {
      for (let i = -1; i < 3; i++) {
        const v = 52 + Math.floor(hash01(j * 7 + i + 20) * 22);
        g.fillStyle = `rgb(${v}, ${v - 4}, ${v - 9})`;
        g.fillRect(i * 64 + (j % 2) * 32 + 2, j * 32 + 2, 60, 28);
      }
    }
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.userData = { tile: 2 };
  return t;
}

/**
 * Boxes as one geometry with world-space UVs (so a texture tiles at the
 * same scale on a 1 m stub and a 40 m run). `h` is the height; the floor
 * is y = 0.
 */
function boxesGeometry(boxes: readonly WallBox[], h: number, tile: number): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[], uvOf: (p: number[]) => [number, number]) => {
    const base = pos.length / 3;
    for (const p of [a, b, c, d]) {
      pos.push(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
      nor.push(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0);
      const [u, v] = uvOf(p);
      uv.push(u / tile, v / tile);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const b of boxes) {
    const x0 = b.x - b.hx;
    const x1 = b.x + b.hx;
    const z0 = b.z - b.hz;
    const z1 = b.z + b.hz;
    const xz = (p: number[]): [number, number] => [p[0] ?? 0, p[2] ?? 0];
    const xy = (p: number[]): [number, number] => [p[0] ?? 0, p[1] ?? 0];
    const zy = (p: number[]): [number, number] => [p[2] ?? 0, p[1] ?? 0];
    quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 1, 0], xz);
    quad([x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1], [0, 0, 1], xy);
    quad([x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0], [0, 0, -1], xy);
    quad([x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1], [1, 0, 0], zy);
    quad([x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0], [-1, 0, 0], zy);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * The x-ray cut: wall fragments near the line from the camera to your
 * wickbearer (and in front of them) are not drawn, so a wall south of you
 * never hides you. Works on the node material every backend draws, and the
 * art styles carry it over (they copy opacity nodes and the alpha test).
 */
export class WallCut {
  readonly camera = uniform(new Vector3(0, 20, 20));
  readonly hero = uniform(new Vector3(0, 1, 0));
  /** Radius of the cut, m. */
  readonly radius = uniform(1.6);

  /** A wall material with the cut in it. */
  material(color: number, map: Texture | null, roughness: number): MeshStandardNodeMaterial {
    const m = new MeshStandardNodeMaterial({ color, roughness, flatShading: true });
    if (map) m.map = map;
    const c = this.camera;
    const seg = this.hero.sub(c);
    const p = positionWorld;
    const t = clamp(dot(p.sub(c), seg).div(dot(seg, seg)), 0, 1);
    const d = length(p.sub(c.add(seg.mul(t))));
    // Cut: close to the sight line, before the hero, and above the wall's foot (the base still outlines the room).
    const cut = d.lessThan(this.radius).and(t.lessThan(0.97)).and(p.y.greaterThan(0.12));
    m.opacityNode = select(cut, float(0), float(1));
    m.alphaTest = 0.5;
    return m;
  }

  update(camera: Vector3, hero: Vector3): void {
    this.camera.value.copy(camera);
    this.hero.value.set(hero.x, hero.y + 0.9, hero.z);
  }
}

interface FloorPiece {
  readonly box: WallBox;
  readonly material: MeshStandardMaterial;
  lit: number;
  seen: boolean;
}

export class CryptLevel {
  readonly group = new Group();
  /** Where candles burn ([x, y, z]): the scene drifts embers off the near ones. */
  readonly flames: [number, number, number][] = [];
  private readonly floors: FloorPiece[] = [];
  readonly cut = new WallCut();

  constructor(
    walls: readonly WallBox[],
    floors: readonly WallBox[],
    half: number,
    surface: ((kind: "floor" | "wall" | "stone" | "ground") => Texture | null) | null,
  ) {
    // Rock under everything: what the camera sees past the walls.
    const rock = new Mesh(new PlaneGeometry(half * 2 + 60, half * 2 + 60), new MeshStandardMaterial({ color: 0x0b0a0c, roughness: 1 }));
    rock.rotation.x = -Math.PI / 2;
    rock.position.y = -0.02;
    rock.userData.surface = "rock";
    this.group.add(rock);

    // Floors: one mesh per room or corridor, so each can lift out of the dark on its own.
    const floorMap = surface?.("floor") ?? flagstones();
    const ftile = (floorMap.userData as { tile?: number }).tile ?? 4;
    for (const f of floors) {
      const map = floorMap.clone();
      map.needsUpdate = true;
      map.repeat.set((f.hx * 2) / ftile, (f.hz * 2) / ftile);
      map.offset.set(((f.x - f.hx) / ftile) % 1, ((f.z - f.hz) / ftile) % 1);
      const material = new MeshStandardMaterial({ map, roughness: 0.95, color: new Color(UNSEEN, UNSEEN, UNSEEN) });
      const m = new Mesh(new PlaneGeometry(f.hx * 2, f.hz * 2), material);
      m.rotation.x = -Math.PI / 2;
      m.position.set(f.x, 0.005, f.z);
      m.receiveShadow = true;
      m.userData.surface = "floor";
      this.group.add(m);
      this.floors.push({ box: f, material, lit: UNSEEN, seen: false });
    }

    // Walls: one merged mesh with a darker cap, so the plan reads from above.
    const wallMap = surface?.("wall") ?? masonry();
    wallMap.wrapS = wallMap.wrapT = RepeatWrapping;
    const wtile = (wallMap.userData as { tile?: number }).tile ?? 2;
    const wall = new Mesh(boxesGeometry(walls, WALL_DRAW_HEIGHT, wtile), this.cut.material(0x9a8f84, wallMap, 0.92));
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.userData.surface = "wall";
    this.group.add(wall);
    const capMat = this.cut.material(0x2b2420, null, 1);
    const cap = new Mesh(boxesGeometry(walls.map((b) => ({ x: b.x, z: b.z, hx: b.hx + 0.04, hz: b.hz + 0.04 })), 0.08, 1), capMat);
    cap.position.y = WALL_DRAW_HEIGHT;
    this.group.add(cap);

    // Candles: a sconce flame at each room's inner corners (rooms are the floors big enough to be rooms).
    const flameMat = new MeshBasicMaterial({ color: new Color(0xffb04a).multiplyScalar(5) });
    const flameGeo = new SphereGeometry(0.16, 8, 6);
    const sconceGeo = new CylinderGeometry(0.22, 0.12, 0.24, 6);
    const sconceMat = new MeshStandardMaterial({ color: 0x2a2420, roughness: 0.6, metalness: 0.4 });
    for (const f of floors) {
      if (f.hx < 4 || f.hz < 4) continue;
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        // A candle in an iron sconce, set into the corner.
        const x = f.x + sx * (f.hx - 0.3);
        const z = f.z + sz * (f.hz - 0.3);
        const sconce = new Mesh(sconceGeo, sconceMat);
        sconce.position.set(x, SCONCE_HEIGHT - 0.12, z);
        this.group.add(sconce);
        const flame = new Mesh(flameGeo, flameMat);
        flame.position.set(x, SCONCE_HEIGHT + 0.1, z);
        this.group.add(flame);
        this.flames.push([x, SCONCE_HEIGHT + 0.15, z]);
      }
    }
  }

  /** Lift the dark off every floor a wickbearer stands on (or within 2 m of). */
  update(dt: number, players: readonly (readonly [number, number])[]): void {
    for (const f of this.floors) {
      if (!f.seen) {
        for (const [x, z] of players) {
          if (Math.abs(x - f.box.x) <= f.box.hx + 2 && Math.abs(z - f.box.z) <= f.box.hz + 2) f.seen = true;
        }
      }
      const goal = f.seen ? LIT : UNSEEN;
      if (Math.abs(goal - f.lit) < 0.002) continue;
      f.lit += (goal - f.lit) * Math.min(1, dt * 2.5);
      // Candle-warm: a touch less blue than red.
      f.material.color.setRGB(f.lit, f.lit * 0.93, f.lit * 0.84);
    }
  }

  /** A fresh descent: every room goes back into the dark. */
  reset(): void {
    for (const f of this.floors) f.seen = false;
  }
}
