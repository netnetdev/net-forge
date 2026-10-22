/**
 * The fallback shapes. Every library id the game
 * references is drawn from the per-style asset library
 * (@netnetcapital/asset-library: real CC0 models, see scene.ts); these
 * primitives are what the scene shows until a model loads, and what it
 * keeps when the library is not built or not reachable, so the game always
 * draws. The keys are the template's original ids, which the library keeps
 * as aliases.
 */
import { assetById } from "@netnetcapital/asset-library";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Material,
  MeshStandardMaterial,
  OctahedronGeometry,
  TetrahedronGeometry,
} from "three/webgpu";

/** Concatenate geometries (positions and normals) into one draw. */
export function merge(parts: readonly BufferGeometry[]): BufferGeometry {
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  let n = 0;
  for (const p of flat) n += p.getAttribute("position").count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const p of flat) {
    p.computeVertexNormals();
    const a = p.getAttribute("position");
    const b = p.getAttribute("normal");
    for (let i = 0; i < a.count; i++) {
      pos[(o + i) * 3] = a.getX(i);
      pos[(o + i) * 3 + 1] = a.getY(i);
      pos[(o + i) * 3 + 2] = a.getZ(i);
      nor[(o + i) * 3] = b.getX(i);
      nor[(o + i) * 3 + 1] = b.getY(i);
      nor[(o + i) * 3 + 2] = b.getZ(i);
    }
    o += a.count;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("normal", new BufferAttribute(nor, 3));
  return g;
}

export interface LibraryAsset {
  readonly geometry: BufferGeometry;
  readonly material: Material;
  /** Height of the model's origin above the floor, m. */
  readonly lift: number;
}

const mat = (color: number, emissive = 0x000000, emissiveIntensity = 1, roughness = 0.7, metalness = 0.1) =>
  new MeshStandardMaterial({ color: new Color(color), emissive: new Color(emissive), emissiveIntensity, roughness, metalness, flatShading: true });

/** A figure facing -z: torso capsule, a visor, shoulder pads and a gun barrel forward. */
function figure(scale: number, bulk: number): BufferGeometry {
  const torso = new CapsuleGeometry(0.36 * bulk, 0.7, 4, 8);
  torso.translate(0, 0.75, 0);
  const visor = new BoxGeometry(0.42, 0.14, 0.2);
  visor.translate(0, 1.25, -0.22);
  const padL = new BoxGeometry(0.22, 0.16, 0.3);
  padL.translate(-0.38 * bulk, 1.05, 0);
  const padR = padL.clone();
  padR.translate(0.76 * bulk, 0, 0);
  const barrel = new CylinderGeometry(0.06, 0.08, 0.85, 6);
  barrel.rotateX(Math.PI / 2);
  barrel.translate(0.22, 0.85, -0.55);
  const pack = new BoxGeometry(0.4, 0.5, 0.2);
  pack.translate(0, 0.9, 0.32);
  const g = merge([torso, visor, padL, padR, barrel, pack]);
  g.scale(scale, scale, scale);
  return g;
}

const builders: Record<string, (radius: number) => LibraryAsset> = {
  wirejack: () => ({ geometry: figure(1, 1), material: mat(0xffffff, 0x000000, 1, 0.45, 0.35), lift: 0 }),
  bruiser: () => ({ geometry: figure(1.08, 1.25), material: mat(0xffffff, 0x000000, 1, 0.5, 0.4), lift: 0 }),
  volt_cell: () => {
    const g = new OctahedronGeometry(0.3);
    g.scale(1, 1.5, 1);
    return { geometry: g, material: mat(0x7dff9a, 0x2bff6a, 1.8, 0.25), lift: 0.6 };
  },
  spark_cell: () => {
    const g = new IcosahedronGeometry(0.22);
    return { geometry: g, material: mat(0x7ad7ff, 0x1e9bff, 1.8, 0.25), lift: 0.5 };
  },
  drone: (r) => {
    const g = new ConeGeometry(r * 1.1, r * 1.6, 4);
    g.rotateX(Math.PI / 2);
    g.translate(0, r * 1.4, 0);
    return { geometry: g, material: mat(0xff5a4f, 0x7a1208, 1, 0.5), lift: 0 };
  },
  scrap_mite: (r) => {
    const g = new TetrahedronGeometry(r * 1.3);
    g.translate(0, r * 1.2, 0);
    return { geometry: g, material: mat(0xffb020, 0x6a3a00, 0.9, 0.55), lift: 0 };
  },
};

/** Resolve a library id ("style.lowpoly.mini_male_f") to its fallback shape for an entity of `radius` m. Unknown ids get a marked box. */
export function resolveAsset(id: string, radius = 0.35): LibraryAsset {
  const name = id.split(".")[2] ?? "";
  const b = builders[name];
  if (b) return b(radius);
  // A library id: its alias's builder, else a figure for characters.
  const a = assetById(id);
  for (const alias of a?.aliases ?? []) {
    const ab = builders[alias.split(".")[2] ?? ""];
    if (ab) return ab(radius);
  }
  if (a?.kind === "character") return builders.wirejack?.(radius) ?? { geometry: figure(1, 1), material: mat(0xffffff), lift: 0 };
  const g = new BoxGeometry(radius * 2, radius * 2, radius * 2);
  g.translate(0, radius, 0);
  return { geometry: g, material: mat(0xff00ff, 0x400040), lift: 0 };
}

/** Projectile, beam and effect meshes (template machinery, not library assets). */
export const fx = {
  /** A rifle bolt: a thin streak along -z. */
  bolt: () => {
    const g = new BoxGeometry(0.08, 0.08, 1.1);
    return { geometry: g, material: mat(0x9ff6ff, 0x16e0ff, 3, 0.2) };
  },
  /** A scatter pellet. */
  pellet: () => {
    const g = new OctahedronGeometry(0.11);
    g.scale(1, 1, 2);
    return { geometry: g, material: mat(0xffd27a, 0xff8a00, 3, 0.2) };
  },
  /** A beam: a unit-long bar along -z, scaled to the beam's reach. */
  beam: () => {
    const g = new BoxGeometry(0.12, 0.12, 1);
    g.translate(0, 0, -0.5);
    return g;
  },
  shard: () => new TetrahedronGeometry(0.1),
};
