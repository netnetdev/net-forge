/**
 * Cartoon ground shadows: every shadow caster drawn a second time,
 * flattened onto the floor along the key light, in one flat colour.
 *
 * The flattened copy reuses the caster's own vertex stage (crowd motion,
 * VAT frames, skinning, instancing), so 2,000 enemies cast 2,000 matching
 * shadows with no extra CPU work and no shadow map. Overlaps never darken
 * twice: each shadow writes depth just above the floor and tests "less
 * than", so the second layer of the same shadow fails the test. They are
 * drawn after the opaque scene (the floor is already there) and before
 * effects.
 */
import { DoubleSide, LessDepth, MeshBasicNodeMaterial, Vector3 } from "three/webgpu";
import type { Color, Material, Node, UniformNode } from "three/webgpu";
import { cameraProjectionMatrix, cameraViewMatrix, float, max, modelWorldMatrix, mrt, positionLocal, uniform, vec3, vec4 } from "three/tsl";

export interface ShadowUniforms {
  /** Direction light travels from (unit, y > 0). */
  readonly dir: UniformNode<"vec3", Vector3>;
  readonly floor: UniformNode<"float", number>;
  readonly color: UniformNode<"color", Color>;
  readonly opacity: UniformNode<"float", number>;
}

export function shadowUniforms(color: Color): ShadowUniforms {
  return { dir: uniform(new Vector3(-0.45, 0.85, 0.3).normalize()), floor: uniform(0), color: uniform(color), opacity: uniform(0.34) };
}

/** The flattened twin of a caster's material. */
export function shadowTwin(source: Material, u: ShadowUniforms): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.name = `toon-shadow:${source.name}`;
  const pn = (source as unknown as { positionNode?: Node | null }).positionNode;
  if (pn) m.positionNode = pn;
  const world = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz;
  const h = max(world.y.sub(u.floor), float(0));
  // Steep sun: never stretch a shadow past about two heights.
  const dy = max(u.dir.y, float(0.35));
  const flat = vec3(world.x.sub(u.dir.x.div(dy).mul(h)), u.floor.add(0.012), world.z.sub(u.dir.z.div(dy).mul(h)));
  m.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(flat, 1));
  m.colorNode = vec4(vec3(u.color as unknown as Node<"vec3">), 1);
  m.opacityNode = u.opacity;
  m.transparent = true;
  m.depthWrite = true;
  m.depthFunc = LessDepth;
  m.side = DoubleSide;
  m.forceSinglePass = true;
  m.fog = true;
  // Shadows leave the ink pass's normals alone.
  m.mrtNode = mrt({ normal: vec4(0, 0, 0, 0) });
  return m;
}
