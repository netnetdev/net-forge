/**
 * The fallback shapes. Every library id the game
 * references is drawn from the per-style asset library
 * (@netforge/asset-library: real CC0 models, see scene.ts); these
 * primitives are what the scene shows until a model loads, and what it
 * keeps when the library is not built or not reachable, so the game always
 * draws. The keys are the template's original ids, which the library keeps
 * as aliases.
 */
import { assetById } from "@netforge/asset-library";
import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  Material,
  MeshStandardMaterial,
  OctahedronGeometry,
  TetrahedronGeometry,
  Vector2,
} from "three/webgpu";

export interface LibraryAsset {
  readonly geometry: BufferGeometry;
  readonly material: Material;
  /** Height of the model's origin above the floor, m. */
  readonly lift: number;
}

const mat = (color: number, emissive = 0x000000, emissiveIntensity = 1, roughness = 0.7) =>
  new MeshStandardMaterial({ color: new Color(color), emissive: new Color(emissive), emissiveIntensity, roughness, flatShading: true });

function bell(): BufferGeometry {
  const pts = [
    [0.0, 0.0],
    [1.0, 0.0],
    [0.95, 0.25],
    [0.8, 0.6],
    [0.7, 1.1],
    [0.62, 1.5],
    [0.45, 1.85],
    [0.2, 2.0],
    [0.0, 2.05],
  ].map(([x, y]) => new Vector2(x, y));
  return new LatheGeometry(pts, 9);
}

const builders: Record<string, (radius: number) => LibraryAsset> = {
  shade: (r) => {
    const g = new ConeGeometry(r * 1.05, r * 3, 5);
    g.translate(0, r * 1.5, 0);
    return { geometry: g, material: mat(0xff9a4a, 0x8a3410, 0.9, 0.55), lift: 0 };
  },
  gnat: (r) => {
    const g = new TetrahedronGeometry(r * 1.4);
    g.translate(0, r * 2.2, 0);
    return { geometry: g, material: mat(0xc6ff6b, 0x4c8a10, 1, 0.5), lift: 0 };
  },
  husk: (r) => {
    const g = new DodecahedronGeometry(r * 1.1);
    g.translate(0, r * 1.1, 0);
    return { geometry: g, material: mat(0xe0904a, 0x6a2c08, 0.8, 0.6), lift: 0 };
  },
  brute: (r) => {
    const g = new BoxGeometry(r * 1.8, r * 2.2, r * 1.4);
    g.translate(0, r * 1.1, 0);
    return { geometry: g, material: mat(0xff4d5e, 0x7a0c18, 0.9, 0.6), lift: 0 };
  },
  bell_warden: (r) => {
    const g = bell();
    g.scale(r, r * 1.2, r);
    return { geometry: g, material: mat(0xe8c27a, 0x6a4210, 0.9, 0.35), lift: 0 };
  },
  // Roles: each silhouette says what it does.
  spitter: (r) => {
    // A squat, open-mouthed bulb: it keeps its distance and spits.
    const g = new IcosahedronGeometry(r * 1.1, 0);
    g.scale(1, 0.8, 1);
    g.translate(0, r * 1.0, 0);
    return { geometry: g, material: mat(0x5affc8, 0x0f8a6a, 1.1, 0.5), lift: 0 };
  },
  ram: (r) => {
    // A wedge pointing where it charges.
    const g = new ConeGeometry(r * 1.2, r * 3, 4);
    g.rotateX(-Math.PI / 2);
    g.translate(0, r * 1.1, 0);
    return { geometry: g, material: mat(0xff7a3c, 0x8a2a00, 1, 0.5), lift: 0 };
  },
  bloat: (r) => {
    // A swollen ember: it walks up to you and bursts.
    const g = new DodecahedronGeometry(r * 1.25);
    g.translate(0, r * 1.25, 0);
    return { geometry: g, material: mat(0xffc04d, 0xff4a00, 1.8, 0.4), lift: 0 };
  },
  aegis: (r) => {
    const g = new OctahedronGeometry(r * 1.3);
    g.scale(0.8, 1.3, 0.8);
    g.translate(0, r * 1.6, 0);
    return { geometry: g, material: mat(0x6fd3ff, 0x1a5aa8, 1.2, 0.4), lift: 0 };
  },
  mender: (r) => {
    const g = new CapsuleGeometry(r * 0.7, r * 1.4, 4, 8);
    g.translate(0, r * 1.4, 0);
    return { geometry: g, material: mat(0x9dff7a, 0x2a8a10, 1.2, 0.5), lift: 0 };
  },
  brood: (r) => {
    const g = new IcosahedronGeometry(r * 1.2, 1);
    g.translate(0, r * 1.2, 0);
    return { geometry: g, material: mat(0xb07aff, 0x4a1aa8, 1, 0.55), lift: 0 };
  },
  caller: (r) => {
    const g = new ConeGeometry(r * 0.9, r * 4, 6);
    g.translate(0, r * 2, 0);
    return { geometry: g, material: mat(0xd07aff, 0x6a10a8, 1.3, 0.45), lift: 0 };
  },
  ash_matron: (r) => {
    const g = bell();
    g.scale(r * 0.9, r * 1.4, r * 0.9);
    return { geometry: g, material: mat(0xc9b6a0, 0x5a3a20, 0.9, 0.5), lift: 0 };
  },
  gloam_ram: (r) => {
    const g = new ConeGeometry(r * 1.1, r * 2.6, 5);
    g.rotateX(-Math.PI / 2);
    g.translate(0, r * 1.0, 0);
    return { geometry: g, material: mat(0x7a5cff, 0x2a10a8, 1.1, 0.4), lift: 0 };
  },
  ember_small: () => {
    const g = new OctahedronGeometry(0.16);
    return { geometry: g, material: mat(0xffc04d, 0xff8a00, 1.6, 0.3), lift: 0.35 };
  },
  ember_mid: () => {
    const g = new OctahedronGeometry(0.24);
    return { geometry: g, material: mat(0x7ad7ff, 0x1e90ff, 1.8, 0.3), lift: 0.4 };
  },
  ember_large: () => {
    const g = new IcosahedronGeometry(0.4);
    return { geometry: g, material: mat(0xff7ad9, 0xff2fb0, 2, 0.3), lift: 0.5 };
  },
  keeper_01: () => {
    const g = new CapsuleGeometry(0.4, 1.0, 4, 10);
    return { geometry: g, material: mat(0xffffff, 0x000000, 1, 0.5), lift: 0 };
  },
  // Pickups and props: shapes for when the library's models are not fetched.
  cell_heal: () => {
    const g = new BoxGeometry(0.34, 0.12, 0.34);
    return { geometry: g, material: mat(0x7dff9a, 0x1f9a3a, 1.6, 0.3), lift: 0.45 };
  },
  crystal: () => {
    const g = new OctahedronGeometry(0.3);
    g.scale(0.7, 1.3, 0.7);
    return { geometry: g, material: mat(0x9fd8ff, 0x2a6aff, 1.8, 0.2), lift: 0.55 };
  },
  grenade: () => {
    const g = new DodecahedronGeometry(0.24);
    return { geometry: g, material: mat(0xff8a4a, 0xff3d00, 1.8, 0.3), lift: 0.45 };
  },
  chest: () => {
    const g = new BoxGeometry(0.7, 0.45, 0.45);
    g.translate(0, 0.22, 0);
    return { geometry: g, material: mat(0xc9963a, 0x6a4210, 1.2, 0.4), lift: 0 };
  },
  barrel: (r) => {
    const g = new CylinderGeometry(r * 0.8, r * 0.9, r * 2, 8);
    g.translate(0, r, 0);
    return { geometry: g, material: mat(0x8a5a34, 0x2a1408, 0.5, 0.7), lift: 0 };
  },
  campfire: (r) => {
    const g = new ConeGeometry(r * 0.9, r * 1.4, 6);
    g.translate(0, r * 0.7, 0);
    return { geometry: g, material: mat(0xff9a40, 0xff5a00, 2, 0.4), lift: 0 };
  },
  fox: (r) => {
    const g = new ConeGeometry(r * 0.9, r * 2.4, 4);
    g.rotateX(-Math.PI / 2);
    g.translate(0, r * 0.9, 0);
    return { geometry: g, material: mat(0xffd36b, 0xffa000, 2, 0.3), lift: 0 };
  },
};

/** A shape for any library id: its alias's builder, else one by body plan. */
function byPlan(id: string, r: number): LibraryAsset | null {
  const a = assetById(id);
  if (!a) return null;
  for (const alias of a.aliases) {
    const b = builders[alias.split(".")[2] ?? ""];
    if (b) return b(r);
  }
  const name = a.id.split(".")[2] ?? "";
  if (name.startsWith("gem_")) return builders[name === "gem_small" ? "ember_small" : name === "gem_mid" ? "ember_mid" : "ember_large"]?.(r) ?? null;
  switch (a.plan) {
    case "flyer":
      return builders.shade?.(r) ?? null;
    case "blob": {
      const g = new IcosahedronGeometry(r * 1.1, 1);
      g.scale(1, 0.75, 1);
      g.translate(0, r * 0.8, 0);
      return { geometry: g, material: mat(0x7bd88f, 0x1e5a2a, 0.6), lift: 0 };
    }
    case "quadruped":
    case "wheeled": {
      const g = new BoxGeometry(r * 1.4, r * 1.2, r * 2.2);
      g.translate(0, r * 0.6, 0);
      return { geometry: g, material: mat(0xc9a27a, 0x3a2a10, 0.5), lift: 0 };
    }
    case "biped": {
      const g = new CapsuleGeometry(r * 0.8, r * 1.6, 4, 8);
      g.translate(0, r * 1.6, 0);
      return { geometry: g, material: mat(0xe0904a, 0x6a2c08, 0.6), lift: 0 };
    }
    default:
      return null;
  }
}

/** Resolve a library id ("style.lowpoly.ghost") to its fallback shape for an entity of `radius` m. Unknown ids get a marked box. */
export function resolveAsset(id: string, radius = 0.35): LibraryAsset {
  const name = id.split(".")[2] ?? "";
  const b = builders[name] ?? null;
  if (b) return b(radius);
  const p = byPlan(id, radius);
  if (p) return p;
  const g = new BoxGeometry(radius * 2, radius * 2, radius * 2);
  g.translate(0, radius, 0);
  return { geometry: g, material: mat(0xff00ff, 0x400040), lift: 0 };
}

/** Projectile, blade and effect meshes (template machinery, not library assets). */
export const fx = {
  bolt: () => {
    const g = new CylinderGeometry(0.06, 0.12, 0.9, 5);
    g.rotateX(Math.PI / 2);
    return { geometry: g, material: mat(0xffe08a, 0xffb000, 2.2, 0.2) };
  },
  lance: () => {
    const g = new CylinderGeometry(0.05, 0.16, 1.6, 6);
    g.rotateX(Math.PI / 2);
    return { geometry: g, material: mat(0xff8a5c, 0xff3d00, 2.4, 0.2) };
  },
  blade: () => {
    const g = new OctahedronGeometry(0.32);
    g.scale(1.4, 0.35, 0.7);
    return { geometry: g, material: mat(0xfff2c4, 0xffd36b, 1.8, 0.2) };
  },
  shard: () => new TetrahedronGeometry(0.12),
};
