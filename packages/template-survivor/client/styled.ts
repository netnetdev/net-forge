/**
 * EMBERWATCH's field drawn by an art style's kit (the voxel style's terraced
 * meadow, stone wall and brazier pillars), in place of the template's own
 * low-poly ground, wall and pillars. Kept out of scene.ts so each art style
 * adds one line there.
 */
import type { Material, Mesh, MeshStandardMaterial, Object3D, Scene } from "three/webgpu";
import type { FieldSpec, StyleKit } from "@netnetcapital/engine/runtime";
import type { ResolvedSimConfig } from "@netnetcapital/engine-sim";

/** A pillar as the scene fades it. */
export interface ScenePillar {
  x: number;
  z: number;
  r: number;
  h: number;
  material: MeshStandardMaterial;
  fade: number;
  top: Mesh[];
}

export interface StyledArena {
  readonly field: FieldSpec;
  readonly pillars: ScenePillar[];
  readonly flames: [number, number, number][];
}

/** EMBERWATCH's night meadow. */
export const ARENA_THEME = "meadow";

/** Build the field with the kit, or null when the kit does not draw fields (the scene draws its own). */
export function styledArena(kit: StyleKit | null, scene: Scene, config: ResolvedSimConfig, outside: number): StyledArena | null {
  if (!kit?.field || !kit.pillar) return null;
  const pillars = config.arena.pillars.map((p) => ({ x: p.x, z: p.z, radius: p.radius, height: p.height }));
  const field: FieldSpec = { half: config.arena.halfExtent, wallHeight: config.arena.wallHeight, outside, theme: ARENA_THEME, pillars };
  scene.add(...kit.field(field));
  const out: StyledArena = { field, pillars: [], flames: [] };
  pillars.forEach((p, i) => {
    const drawn = kit.pillar?.(p, ARENA_THEME, i);
    if (!drawn) return;
    scene.add(drawn.body, ...drawn.top);
    // The scene fades a pillar through one material (the kit gives it its own).
    const material = (drawn.fade[0] ?? (drawn.body as Object3D & { material: Material }).material) as unknown as MeshStandardMaterial;
    out.pillars.push({ x: p.x, z: p.z, r: p.radius, h: p.height + 0.8, material, fade: 1, top: drawn.top as Mesh[] });
    if (drawn.flame) out.flames.push([...drawn.flame]);
  });
  return out;
}

/** Height of the styled ground at (x, z) (scenery past the wall stands on it); 0 on the template's flat ground. */
export function groundAt(kit: StyleKit | null, arena: StyledArena | null, x: number, z: number): number {
  return arena && kit?.groundHeight ? kit.groundHeight(arena.field, x, z) : 0;
}
