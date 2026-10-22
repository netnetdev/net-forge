/**
 * Turn a loaded glTF into a library model: cloned (skeletons included),
 * turned to face -z, scaled to its height, standing on y = 0, centred on
 * x/z, its palette shifted toward the look's tint, and its look parts
 * attached so they follow the animation.
 */
import { Box3, Color, Group, Matrix4, Mesh, Object3D, Quaternion, SRGBColorSpace, Vector3 } from "three/webgpu";
import type { BufferGeometry, Material, MeshStandardMaterial } from "three/webgpu";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import type { ResolvedLook } from "../look.js";
import { RIGS } from "../rigs.js";
import { buildPart } from "./parts.js";

export interface LoadedModel {
  readonly scene: Object3D;
  readonly animations: readonly import("three/webgpu").AnimationClip[];
}

export interface PreparedModel {
  /** Add this to the scene. Origin at the feet, facing -z. */
  readonly root: Group;
  /** The cloned glTF scene inside root (what an AnimationMixer drives). */
  readonly model: Object3D;
  readonly height: number;
  readonly width: number;
  readonly depth: number;
  /** The right-hand bone or node, for a held weapon (null when the rig has none). */
  readonly hand: Object3D | null;
}

const tmpColor = new Color();
const hsl = { h: 0, s: 0, l: 0 };
const tintHsl = { h: 0, s: 0, l: 0 };

/** Shift a colour's hue toward the tint, keep its lightness; near-greys and near-whites (eyes, teeth) stay. */
export function shiftColor(c: Color, tint: number, keepSkin = false): void {
  c.getHSL(hsl, SRGBColorSpace);
  tmpColor.setHex(tint).getHSL(tintHsl, SRGBColorSpace);
  if (hsl.s < 0.12 || hsl.l > 0.92 || hsl.l < 0.06) return;
  // People keep their skin: warm, mid-light, moderately saturated tones stay as they are.
  if (keepSkin && hsl.h >= 0.02 && hsl.h <= 0.12 && hsl.s <= 0.75 && hsl.l >= 0.35) return;
  c.setHSL(tintHsl.h, Math.min(1, hsl.s * 0.4 + tintHsl.s * 0.6), hsl.l * 0.5 + tintHsl.l * 0.5, SRGBColorSpace);
}

/**
 * Vertex-coloured models (the voxel style keeps each voxel's colour, with its
 * occlusion baked in, per vertex): shift each colour's hue toward the tint,
 * and scale lightness by one factor for the whole model so baked occlusion
 * keeps its contrast. Near-greys and near-whites (eyes, teeth) stay.
 */
function tintVertexColors(root: Object3D, tint: number, keepSkin: boolean): void {
  const done = new Map<BufferGeometry, BufferGeometry>();
  tmpColor.setHex(tint).getHSL(tintHsl, SRGBColorSpace);
  const c = new Color();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const src = m.geometry as BufferGeometry;
    const attr = src.getAttribute("color");
    if (!attr) return;
    let g = done.get(src);
    if (!g) {
      g = src.clone();
      const col = g.getAttribute("color");
      let sum = 0;
      for (let i = 0; i < col.count; i++) sum += c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).getHSL(hsl, SRGBColorSpace).l;
      const mean = col.count ? sum / col.count : 0.5;
      const k = mean > 0.02 ? (mean * 0.5 + tintHsl.l * 0.5) / mean : 1;
      for (let i = 0; i < col.count; i++) {
        c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).getHSL(hsl, SRGBColorSpace);
        if (hsl.s < 0.12 || hsl.l > 0.92 || hsl.l < 0.04) continue;
        if (keepSkin && hsl.h >= 0.02 && hsl.h <= 0.12 && hsl.s <= 0.75 && hsl.l >= 0.3) continue;
        c.setHSL(tintHsl.h, Math.min(1, hsl.s * 0.4 + tintHsl.s * 0.6), Math.min(1, hsl.l * k), SRGBColorSpace);
        col.setXYZ(i, c.r, c.g, c.b);
      }
      col.needsUpdate = true;
      done.set(src, g);
    }
    m.geometry = g;
  });
}

function tintMaterials(root: Object3D, tint: number, keepSkin: boolean): void {
  const done = new Map<Material, Material>();
  tintVertexColors(root, tint, keepSkin);
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const swap = (mat: Material): Material => {
      let c = done.get(mat);
      if (!c) {
        c = mat.clone();
        const sm = c as MeshStandardMaterial;
        if (sm.color) {
          if (sm.map) sm.color.lerp(tmpColor.setHex(tint), 0.3);
          else shiftColor(sm.color, tint, keepSkin);
        }
        done.set(mat, c);
      }
      return c;
    };
    m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
  });
}

function findNode(root: Object3D, re: RegExp | null): Object3D | null {
  if (!re) return null;
  let hit: Object3D | null = null;
  root.traverse((o) => {
    if (!hit && re.test(o.name)) hit = o;
  });
  return hit;
}

/** Parent `child` to `bone` keeping the world placement it has now (relative to `frame`). */
function attachKeepingPlacement(child: Object3D, bone: Object3D): void {
  bone.updateWorldMatrix(true, false);
  const inv = new Matrix4().copy(bone.matrixWorld).invert();
  child.updateWorldMatrix(true, false);
  const local = inv.multiply(child.matrixWorld);
  const p = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  local.decompose(p, q, s);
  child.removeFromParent();
  bone.add(child);
  child.position.copy(p);
  child.quaternion.copy(q);
  child.scale.copy(s);
}

/**
 * Prepare a loaded model for drawing. `height` overrides the asset's own
 * (enemies are sized from their hit radius); the look's scale multiplies it.
 */
export function prepareModel(loaded: LoadedModel, look: ResolvedLook, opts: { height?: number } = {}): PreparedModel {
  const asset = look.asset;
  const model = cloneSkinned(loaded.scene);
  const inner = new Group();
  inner.add(model);
  // glTF models face +z; the runtime's forward is -z.
  inner.rotation.y = Math.PI + asset.yaw;
  const root = new Group();
  root.name = look.requested;
  root.add(inner);
  // Big wheels: grow the wheel nodes before measuring, so the truck stands on them.
  if (look.parts.some((p) => p.part === "big_wheels")) {
    const wheels: Object3D[] = [];
    model.traverse((o) => {
      // Outermost wheel nodes only, so a wheel and its child mesh are not both scaled.
      if (/wheel/i.test(o.name) && !(o.parent && /wheel/i.test(o.parent.name))) wheels.push(o);
    });
    for (const w of wheels) w.scale.multiplyScalar(1.9);
  }
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root, true);
  const size = box.getSize(new Vector3());
  const target = (opts.height ?? asset.height) * look.scale;
  const k = size.y > 1e-6 ? target / size.y : 1;
  inner.scale.setScalar(k);
  const centre = box.getCenter(new Vector3());
  inner.position.set(-centre.x * k, -box.min.y * k, -centre.z * k);
  root.updateMatrixWorld(true);
  const height = size.y * k;
  const width = size.x * k;
  const depth = size.z * k;
  if (look.tint !== null) tintMaterials(model, look.tint, asset.kind === "character");

  const rig = asset.rig ? RIGS[asset.rig] : undefined;
  const head = findNode(model, rig?.headBone ?? null);
  const headEnd = head ? findNode(model, /^head_end$/i) : null;
  const body = findNode(model, /^(torso|chest|spine|body)/i);
  const bodyColor = look.tint ?? 0xcccccc;
  for (const p of look.parts) {
    if (p.part === "big_wheels") continue;
    const part = buildPart(p.part, height, Math.max(width, depth * 0.6), look.accent, bodyColor);
    // Anchor points in the root's frame (facing -z): head on top, face in front, back and tail behind.
    // Anchors in the root's frame (facing -z). The head bone, when the rig has one, places head and face parts;
    // otherwise four-legged bodies carry their head at the front and bipeds on top.
    const four = asset.plan === "quadruped";
    const hp = head ? head.getWorldPosition(new Vector3()) : four ? new Vector3(0, height * 0.8, -depth * 0.4) : new Vector3(0, height * 0.85, 0);
    // The head bone sits at the neck; its end (when the rig has one) is the crown.
    const crown = headEnd ? headEnd.getWorldPosition(new Vector3()) : null;
    const headTop = crown ? crown.y : head ? Math.min(height * 0.99, hp.y + height * (four ? 0.12 : 0.1)) : four ? height * 0.95 : height * 0.97;
    const headSize = Math.max(0.05, headTop - (head ? hp.y : height * 0.75));
    switch (p.anchor) {
      case "head":
        part.position.set(crown?.x ?? hp.x, headTop - headSize * 0.08, crown?.z ?? hp.z);
        break;
      case "face":
        part.position.set(hp.x, head ? hp.y + headSize * 0.35 : height * 0.72, (head ? hp.z : 0) - (four ? depth * 0.12 : headSize * 0.62));
        break;
      case "back":
        part.position.set(0, height * (four ? 0.7 : 0.62), four ? 0 : depth * 0.35);
        break;
      case "tail":
        part.position.set(0, height * (four ? 0.55 : 0.3), depth * 0.48);
        break;
      default:
        part.position.set(0, height * 0.5, 0);
    }
    root.add(part);
    const bone = p.anchor === "head" || p.anchor === "face" ? head : p.anchor === "back" || p.anchor === "body" ? body : null;
    if (bone) attachKeepingPlacement(part, bone);
  }
  return { root, model, height, width, depth, hand: findNode(model, rig?.handBone ?? null) };
}
