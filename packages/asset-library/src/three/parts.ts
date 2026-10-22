/**
 * Look parts and procedural pickups, built from three.js primitives.
 * Parts are sized from the model's height and placed at an anchor; the
 * caller parents them so they follow the animation.
 */
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
} from "three/webgpu";
import type { AppearancePart } from "@netnetcapital/engine";
import { voxel } from "@netnetcapital/engine/runtime";

const mat = (color: number, emissive = 0, intensity = 1) =>
  new MeshStandardMaterial({ color: new Color(color), emissive: new Color(emissive), emissiveIntensity: intensity, roughness: 0.6, flatShading: true });

function mesh(g: BufferGeometry, m: MeshStandardMaterial, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): Mesh {
  const o = new Mesh(g, m);
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  return o;
}

/**
 * One part as a group whose origin is its anchor point, sized for a model
 * `h` metres tall and `w` metres wide, in the model's frame (facing -z,
 * y up). `accent` colours it; `body` is the model's main colour.
 */
export function buildPart(part: AppearancePart, h: number, w: number, accent: number, body: number): Group {
  const g = new Group();
  g.name = `look:${part}`;
  const a = mat(accent);
  const b = mat(body);
  const s = h * 0.12;
  switch (part) {
    case "horns":
      for (const side of [-1, 1]) g.add(mesh(new ConeGeometry(s * 0.35, s * 1.4, 6), a, side * w * 0.22, s * 0.5, 0, 0, 0, -side * 0.45));
      break;
    case "ears_long":
      for (const side of [-1, 1]) {
        const ear = new SphereGeometry(s * 0.45, 8, 6);
        ear.scale(0.45, 2.4, 0.3);
        g.add(mesh(ear, b, side * w * 0.2, s * 0.9, 0, 0, 0, -side * 0.25));
        const tip = new ConeGeometry(s * 0.22, s * 0.55, 6);
        g.add(mesh(tip, a, side * (w * 0.2 + s * 0.27), s * 1.85, 0, 0, 0, -side * 0.25));
      }
      break;
    case "ears_round":
      for (const side of [-1, 1]) {
        const ear = new SphereGeometry(s * 0.5, 10, 8);
        ear.scale(1, 1, 0.35);
        g.add(mesh(ear, b, side * w * 0.24, s * 0.35, 0));
      }
      break;
    case "antenna":
      g.add(mesh(new CylinderGeometry(s * 0.05, s * 0.05, s * 1.2, 5), a, 0, s * 0.6, 0));
      g.add(mesh(new SphereGeometry(s * 0.2, 8, 6), mat(accent, accent, 1.5), 0, s * 1.25, 0));
      break;
    case "crown": {
      g.add(mesh(new CylinderGeometry(w * 0.2, w * 0.22, s * 0.35, 10, 1, true), mat(0xffd34d, 0x6a4a00, 0.4), 0, s * 0.15, 0));
      for (let i = 0; i < 5; i++) {
        const t = (i / 5) * Math.PI * 2;
        g.add(mesh(new ConeGeometry(s * 0.12, s * 0.35, 4), mat(0xffd34d, 0x6a4a00, 0.4), Math.cos(t) * w * 0.2, s * 0.45, Math.sin(t) * w * 0.2));
      }
      break;
    }
    case "hat_cap": {
      const dome = new SphereGeometry(w * 0.24, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      g.add(mesh(dome, a, 0, -s * 0.1, 0));
      const brim = new CylinderGeometry(w * 0.16, w * 0.16, s * 0.06, 10, 1, false, -Math.PI / 2, Math.PI);
      g.add(mesh(brim, a, 0, -s * 0.08, -w * 0.18, 0, 0, 0));
      break;
    }
    case "hat_top":
      g.add(mesh(new CylinderGeometry(w * 0.3, w * 0.3, s * 0.08, 12), a, 0, 0, 0));
      g.add(mesh(new CylinderGeometry(w * 0.17, w * 0.18, s * 1.1, 12), a, 0, s * 0.55, 0));
      break;
    case "mustache":
      for (const side of [-1, 1]) {
        const m = new SphereGeometry(s * 0.28, 8, 6);
        m.scale(1.6, 0.55, 0.6);
        g.add(mesh(m, a, side * s * 0.32, 0, 0, 0, 0, side * 0.35));
      }
      break;
    case "tail": {
      const t = new ConeGeometry(s * 0.3, s * 2, 7);
      g.add(mesh(t, b, 0, s * 0.3, s * 0.8, -1.1, 0, 0));
      break;
    }
    case "tail_bolt": {
      const seg = (len: number) => new BoxGeometry(s * 0.28, len, s * 0.12);
      g.add(mesh(seg(s * 0.9), mat(accent, accent, 0.6), 0, s * 0.3, s * 0.35, -0.9, 0, 0));
      g.add(mesh(seg(s * 0.8), mat(accent, accent, 0.6), s * 0.18, s * 0.75, s * 0.7, 0.5, 0, 0.3));
      g.add(mesh(seg(s * 1.1), mat(accent, accent, 0.6), 0, s * 1.2, s * 1.05, -0.9, 0, 0));
      break;
    }
    case "wings":
      for (const side of [-1, 1]) {
        const wing = new BoxGeometry(s * 2.2, s * 0.9, s * 0.08);
        wing.translate(side * s * 1.1, 0, 0);
        g.add(mesh(wing, a, side * w * 0.08, 0, 0, 0, side * 0.5, side * 0.35));
      }
      break;
    case "armor":
      g.add(mesh(new BoxGeometry(w * 0.7, h * 0.28, w * 0.55), mat(0x9aa4b2, 0x101418, 0.2), 0, 0, 0));
      break;
    case "backpack":
      g.add(mesh(new BoxGeometry(w * 0.45, h * 0.25, w * 0.25), a, 0, 0, w * 0.1));
      break;
    case "big_wheels":
      // Applied to the model's wheel nodes (see prepare.ts), not added as geometry.
      break;
  }
  return g;
}

/** Procedural pickups (no file): gems, cells. Geometry centred at the origin. */
export function proceduralAsset(name: string): { geometry: BufferGeometry; material: MeshStandardMaterial } | null {
  // The voxel style's pickups are built from voxels ("voxel_gem_small").
  if (name.startsWith("voxel_")) return voxel.voxelPickup(name.slice(6)) as { geometry: BufferGeometry; material: MeshStandardMaterial } | null;
  switch (name) {
    case "gem_small":
      return { geometry: new OctahedronGeometry(0.16), material: mat(0xffc04d, 0xff8a00, 1.6) };
    case "gem_mid":
      return { geometry: new OctahedronGeometry(0.24), material: mat(0x7ad7ff, 0x1e90ff, 1.8) };
    case "gem_large":
      return { geometry: new IcosahedronGeometry(0.4), material: mat(0xff7ad9, 0xff2fb0, 2) };
    case "cell_heal": {
      const g = new OctahedronGeometry(0.3);
      g.scale(1, 1.5, 1);
      return { geometry: g, material: mat(0x7dff9a, 0x2bff6a, 1.8) };
    }
    case "cell_spark":
      return { geometry: new IcosahedronGeometry(0.22), material: mat(0x7ad7ff, 0x1e9bff, 1.8) };
    case "ring":
      return { geometry: new TorusGeometry(0.3, 0.06, 6, 16), material: mat(0xffd34d, 0xff9a00, 1) };
    default:
      return null;
  }
}
