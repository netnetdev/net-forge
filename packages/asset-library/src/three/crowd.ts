/**
 * Crowd models: a library model baked into static geometry for
 * InstancedMesh, so 2,000 enemies stay one draw per material group. The
 * model is posed once (a frame of its walk or idle clip, so nobody is
 * frozen in a T-pose), skinning is applied on the CPU, and parts are merged:
 * untextured materials become vertex colours in one draw, textured ones
 * keep their map (one draw per map). Motion comes from the body plan
 * (bob, waddle, hover, squash) in the template's instance matrices.
 */
import { AnimationMixer, BufferAttribute, BufferGeometry, Color, InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh, Matrix4, Mesh, MeshStandardNodeMaterial, Quaternion, Vector3 } from "three/webgpu";
import { float, instancedBufferAttribute, positionGeometry } from "three/tsl";
import { billboardWorld, isSprite } from "@netforge/engine/runtime";
import type { MeshStandardMaterial } from "three/webgpu";
import type { AnimationClip, Material, SkinnedMesh, Texture } from "three/webgpu";
import type { RigDef } from "../rigs.js";
import { clipFor } from "../rigs.js";
import type { PreparedModel } from "./prepare.js";

export interface CrowdPart {
  readonly geometry: BufferGeometry;
  readonly material: Material;
}

export interface CrowdModel {
  readonly parts: readonly CrowdPart[];
  readonly height: number;
  readonly triangles: number;
}

interface Bucket {
  pos: number[];
  nor: number[];
  uv: number[];
  col: number[];
  map: Texture | null;
  emissive: Color;
  roughness: number;
  metalness: number;
}

export interface Placement {
  readonly x: number;
  readonly z: number;
  readonly y?: number;
  readonly yaw?: number;
  /** Scale across (x and z) and up (y). Default 1. */
  readonly across?: number;
  readonly up?: number;
}

/** Sprite scenery (pixel style): one draw of camera-facing planes, each at its spot and scale (yaw does not apply). */
function placeSprites(p: CrowdPart, placements: readonly Placement[]): Mesh {
  const g = new InstancedBufferGeometry();
  if (p.geometry.index) g.setIndex(p.geometry.index);
  for (const [name, a] of Object.entries(p.geometry.attributes)) g.setAttribute(name, a);
  const spots = new Float32Array(Math.max(1, placements.length) * 4);
  placements.forEach((pl, i) => spots.set([pl.x, pl.y ?? 0, pl.z, pl.up ?? 1], i * 4));
  const spot = new InstancedBufferAttribute(spots, 4);
  g.instanceCount = placements.length;
  const m = (p.material as MeshStandardNodeMaterial).clone();
  const at = instancedBufferAttribute<"vec4">(spot, "vec4");
  m.positionNode = billboardWorld(at.xyz, positionGeometry.x.mul(at.w), positionGeometry.y.mul(at.w), float(1));
  const mesh = new Mesh(g, m);
  mesh.frustumCulled = false;
  return mesh;
}

/** Static scenery: one InstancedMesh per part (sprites: one billboard draw), every placement drawn. Add the result to the scene. */
export function placeStatic(model: CrowdModel, placements: readonly Placement[]): Mesh[] {
  const m = new Matrix4();
  const q = new Quaternion();
  const axis = new Vector3(0, 1, 0);
  const pos = new Vector3();
  const scl = new Vector3();
  return model.parts.map((p) => {
    if (isSprite(p.geometry)) return placeSprites(p, placements);
    const mesh = new InstancedMesh(p.geometry, p.material, Math.max(1, placements.length));
    placements.forEach((pl, i) => {
      q.setFromAxisAngle(axis, pl.yaw ?? 0);
      pos.set(pl.x, pl.y ?? 0, pl.z);
      scl.set(pl.across ?? 1, pl.up ?? pl.across ?? 1, pl.across ?? 1);
      mesh.setMatrixAt(i, m.compose(pos, q, scl));
    });
    mesh.count = placements.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  });
}

/** Pose a prepared model at a frame of a clip (walk, else idle), in place. */
export function poseModel(p: PreparedModel, clips: readonly AnimationClip[], rig: RigDef | undefined, at = 0.25): void {
  if (!rig || clips.length === 0) return;
  const name = clipFor(rig, "walk", clips.map((c) => c.name)) ?? clipFor(rig, "idle", clips.map((c) => c.name));
  const clip = clips.find((c) => c.name === name);
  if (!clip) return;
  const mixer = new AnimationMixer(p.model);
  mixer.clipAction(clip).play();
  mixer.update(Math.min(at, clip.duration * 0.5));
  p.root.updateMatrixWorld(true);
}

/**
 * Skinning and mirrored exports can leave a mesh inside out. Faces of a
 * closed low-poly model mostly point away from its centre: if the summed
 * area-weighted outward dot is negative, swap every triangle's winding.
 */
function orientOutward(b: Bucket): void {
  const p = b.pos;
  const n = p.length / 9;
  if (n === 0) return;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < p.length; i += 3) {
    cx += p[i] ?? 0;
    cy += p[i + 1] ?? 0;
    cz += p[i + 2] ?? 0;
  }
  const vn = p.length / 3;
  cx /= vn;
  cy /= vn;
  cz /= vn;
  let score = 0;
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const ax = p[o] ?? 0, ay = p[o + 1] ?? 0, az = p[o + 2] ?? 0;
    const ux = (p[o + 3] ?? 0) - ax, uy = (p[o + 4] ?? 0) - ay, uz = (p[o + 5] ?? 0) - az;
    const wx = (p[o + 6] ?? 0) - ax, wy = (p[o + 7] ?? 0) - ay, wz = (p[o + 8] ?? 0) - az;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    score += nx * (ax - cx) + ny * (ay - cy) + nz * (az - cz);
  }
  if (score >= 0) return;
  const swap = (arr: number[], width: number) => {
    for (let t = 0; t < n; t++) {
      const b1 = (t * 3 + 1) * width;
      const b2 = (t * 3 + 2) * width;
      for (let k = 0; k < width; k++) {
        const x = arr[b1 + k] ?? 0;
        arr[b1 + k] = arr[b2 + k] ?? 0;
        arr[b2 + k] = x;
      }
    }
  };
  swap(b.pos, 3);
  swap(b.col, 3);
  swap(b.uv, 2);
}

/** Bake a prepared (and posed) model into merged static parts in the root's frame. */
export function bakeCrowd(p: PreparedModel): CrowdModel {
  p.root.updateMatrixWorld(true);
  const rootInv = p.root.matrixWorld.clone().invert();
  const buckets = new Map<string, Bucket>();
  const v = new Vector3();
  const tmp = new Color();
  let triangles = 0;
  p.root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || !m.visible) return;
    const g = m.geometry as BufferGeometry;
    const pos = g.getAttribute("position");
    if (!pos) return;
    const uv = g.getAttribute("uv");
    // Vertex colours (the voxel style's per-voxel colour and occlusion) multiply the material's.
    const vc = g.getAttribute("color");
    const index = g.getIndex();
    const mats: Material[] = Array.isArray(m.material) ? m.material : [m.material];
    const groups = g.groups.length ? g.groups : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }];
    const world = rootInv.clone().multiply(m.matrixWorld);
    const skinned = (m as SkinnedMesh).isSkinnedMesh;
    // A mirrored transform flips triangle winding; swap two corners back so faces point out.
    const mirrored = world.determinant() < 0;
    for (const grp of groups) {
      const mat = (mats[grp.materialIndex ?? 0] ?? mats[0]) as MeshStandardMaterial;
      const map = mat.map ?? null;
      const key = map ? `map:${map.uuid}` : "color";
      let b = buckets.get(key);
      if (!b) {
        b = { pos: [], nor: [], uv: [], col: [], map, emissive: (mat.emissive ?? new Color(0)).clone(), roughness: mat.roughness ?? 0.7, metalness: mat.metalness ?? 0 };
        buckets.set(key, b);
      }
      const color = mat.color ? tmp.copy(mat.color) : tmp.setRGB(1, 1, 1);
      for (let k = grp.start; k < grp.start + grp.count; k++) {
        const corner = (k - grp.start) % 3;
        const kk = mirrored && corner > 0 ? k + (corner === 1 ? 1 : -1) : k;
        const i = index ? index.getX(kk) : kk;
        if (skinned) (m as SkinnedMesh).getVertexPosition(i, v);
        else v.fromBufferAttribute(pos, i);
        v.applyMatrix4(world);
        b.pos.push(v.x, v.y, v.z);
        b.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
        if (vc) b.col.push(color.r * vc.getX(i), color.g * vc.getY(i), color.b * vc.getZ(i));
        else b.col.push(color.r, color.g, color.b);
      }
      triangles += Math.floor(grp.count / 3);
    }
  });
  const parts: CrowdPart[] = [];
  for (const b of buckets.values()) {
    orientOutward(b);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(b.pos), 3));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(b.col), 3));
    if (b.map) geometry.setAttribute("uv", new BufferAttribute(new Float32Array(b.uv), 2));
    // Flat normals: the library is low-poly and reads best faceted.
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    // A node material (vertex colours on) so the engine's AnimatedCrowd can take it as-is, and plain InstancedMesh draws it too.
    const material = new MeshStandardNodeMaterial();
    Object.assign(material, { vertexColors: true, map: b.map, roughness: b.roughness, metalness: b.metalness, flatShading: true });
    material.emissive.copy(b.emissive);
    parts.push({ geometry, material });
  }
  return { parts, height: p.height, triangles };
}
