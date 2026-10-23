/**
 * The playroom as drawn: a checkered dance floor on the room's floor
 * (game.ts field.floors), striped party wallpaper on every wall box
 * (field.walls) and a ring of coloured party lights along the walls. One
 * merged mesh for all the walls and one for each floor, so the room is a
 * handful of draws.
 *
 * The whole room is lit from the start (a party has no fog of war). An
 * x-ray cut keeps a wall from hiding your player.
 *
 * An art style that paints surfaces (ps1's textures) paints these too
 * (surface roles "floor", "wall"); the toon, pixel, voxel and hand-drawn
 * styles reshade them in post like everything else.
 */
import { BufferAttribute, BufferGeometry, CanvasTexture, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, MeshStandardNodeMaterial, PlaneGeometry, RepeatWrapping, SphereGeometry, SRGBColorSpace, Vector3 } from "three/webgpu";
import { clamp, dot, float, length, positionWorld, select, uniform } from "three/tsl";
import type { Texture } from "three/webgpu";
import type { WallBox } from "@netforge/engine-sim";

/** Walls are drawn this tall (the sim's are 3 m): low enough that a wall south of you hides less of the room. */
export const WALL_DRAW_HEIGHT = 2.2;
/** Party lights hang this high along the walls, under the wall tops. */
const SCONCE_HEIGHT = 1.75;
/** Brightness of a floor nobody has walked into yet, and of one a wickbearer has. */
const UNSEEN = 0.2;
const LIT = 0.85;

function hash01(n: number): number {
  let t = (n + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A checkered dance floor, drawn on a canvas (one repeat covers 4 m: 4 x 4 checks of 1 m). */
function danceFloor(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    // Soft checks (dark plum and dusty pink, light lilac and blush): busy enough to read as a dance floor, quiet enough for the HUD over it.
    const tones = ["#4a3670", "#b9a3d9", "#5a3463", "#d3a3c4"];
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        const dark = (i + j) % 2 === 0;
        g.fillStyle = tones[(dark ? 0 : 1) + (hash01(j * 4 + i) < 0.5 ? 0 : 2)] ?? "#3a2a5c";
        g.fillRect(i * 64, j * 64, 64, 64);
        g.strokeStyle = "rgba(0, 0, 0, 0.18)";
        g.strokeRect(i * 64 + 1, j * 64 + 1, 62, 62);
      }
    }
    g.fillStyle = "rgba(255, 255, 255, 0.06)";
    for (let n = 0; n < 200; n++) g.fillRect(hash01(n * 3) * 256, hash01(n * 3 + 1) * 256, 2, 2);
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.userData = { tile: 4 };
  return t;
}

/** Party wallpaper: candy stripes (one repeat covers 2 m). */
function wallpaper(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 === 0 ? "#ffb3d6" : "#fff2c9";
      g.fillRect(i * 16, 0, 16, 128);
    }
    g.fillStyle = "rgba(122, 215, 255, 0.55)";
    g.fillRect(0, 96, 128, 10);
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

export class PartyStage {
  readonly group = new Group();
  /** Where the party lights hang ([x, y, z]): the scene drifts sparkles off the near ones. */
  readonly flames: [number, number, number][] = [];
  private readonly floors: FloorPiece[] = [];
  readonly cut = new WallCut();

  constructor(
    walls: readonly WallBox[],
    floors: readonly WallBox[],
    half: number,
    surface: ((kind: "floor" | "wall" | "stone" | "ground") => Texture | null) | null,
  ) {
    // A deep plum carpet under everything: what the camera sees past the walls.
    const rock = new Mesh(new PlaneGeometry(half * 2 + 60, half * 2 + 60), new MeshStandardMaterial({ color: 0x241534, roughness: 1 }));
    rock.rotation.x = -Math.PI / 2;
    rock.position.y = -0.02;
    rock.userData.surface = "rock";
    this.group.add(rock);

    // Floors: one mesh per room or corridor, so each can lift out of the dark on its own.
    const floorMap = surface?.("floor") ?? danceFloor();
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
      // A party has no fog of war: every floor is lit from the start.
      material.color.setScalar(LIT);
      this.floors.push({ box: f, material, lit: LIT, seen: true });
    }

    // Walls: one merged mesh with a darker cap, so the plan reads from above.
    const wallMap = surface?.("wall") ?? wallpaper();
    wallMap.wrapS = wallMap.wrapT = RepeatWrapping;
    const wtile = (wallMap.userData as { tile?: number }).tile ?? 2;
    const wall = new Mesh(boxesGeometry(walls, WALL_DRAW_HEIGHT, wtile), this.cut.material(0xffffff, wallMap, 0.85));
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.userData.surface = "wall";
    this.group.add(wall);
    const capMat = this.cut.material(0x7a2f62, null, 0.7);
    const cap = new Mesh(boxesGeometry(walls.map((b) => ({ x: b.x, z: b.z, hx: b.hx + 0.04, hz: b.hz + 0.04 })), 0.08, 1), capMat);
    cap.position.y = WALL_DRAW_HEIGHT;
    this.group.add(cap);

    // Candles: a sconce flame at each room's inner corners (rooms are the floors big enough to be rooms).
    const flameMat = new MeshBasicMaterial({ color: new Color(0xffb04a).multiplyScalar(5) });
    const flameGeo = new SphereGeometry(0.16, 8, 6);
    const sconceGeo = new CylinderGeometry(0.22, 0.12, 0.24, 6);
    const sconceMat = new MeshStandardMaterial({ color: 0x2a2420, roughness: 0.6, metalness: 0.4 });
    const bulbColors = [0xff5ab4, 0xffe066, 0x7ad7ff, 0x7affd4, 0xc9a7ff];
    const bulbMats = bulbColors.map((c) => new MeshBasicMaterial({ color: new Color(c).multiplyScalar(4) }));
    for (const f of floors) {
      if (f.hx < 4 || f.hz < 4) continue;
      // A ring of party lights along the walls, one every 4 m, in turn through the colours.
      let k = 0;
      const ring: [number, number][] = [];
      for (let x = -f.hx + 1; x <= f.hx - 1; x += 4) ring.push([f.x + x, f.z - f.hz + 0.3], [f.x + x, f.z + f.hz - 0.3]);
      for (let z = -f.hz + 3; z <= f.hz - 3; z += 4) ring.push([f.x - f.hx + 0.3, f.z + z], [f.x + f.hx - 0.3, f.z + z]);
      for (const [x, z] of ring) {
        const sconce = new Mesh(sconceGeo, sconceMat);
        sconce.position.set(x, SCONCE_HEIGHT - 0.12, z);
        this.group.add(sconce);
        const bulb = new Mesh(flameGeo, bulbMats[k++ % bulbMats.length] ?? flameMat);
        bulb.position.set(x, SCONCE_HEIGHT + 0.1, z);
        this.group.add(bulb);
        if (k % 3 === 0) this.flames.push([x, SCONCE_HEIGHT + 0.15, z]);
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
