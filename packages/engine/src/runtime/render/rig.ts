import {
  AnimationClip,
  Bone,
  CylinderGeometry,
  Float32BufferAttribute,
  Quaternion,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
  VectorKeyframeTrack,
} from "three/webgpu";
import type { BufferGeometry, Material } from "three/webgpu";

export interface SegmentRigOptions {
  /** Total height, m. Default 1.2. */
  readonly height?: number;
  /** Radius at the base, m. Default 0.35. */
  readonly radius?: number;
  /** Radius at the top (a cone when 0). Default radius x 0.75. */
  readonly topRadius?: number;
  readonly radialSegments?: number;
  readonly heightSegments?: number;
  /** Use this geometry instead of a cylinder (it must stand on y = 0, up to `height`). */
  readonly geometry?: BufferGeometry;
}

export interface SegmentRig {
  readonly mesh: SkinnedMesh;
  /** hip, spine, head. */
  readonly bones: readonly [Bone, Bone, Bone];
  /** "rest", "idle", "walk", "run", "hit", "attack", "die". */
  readonly clips: readonly AnimationClip[];
}

const q = (x: number, y: number, z: number): number[] => {
  const v = new Quaternion().setFromAxisAngle(new Vector3(x, y, z).normalize(), Math.hypot(x, y, z));
  return [v.x, v.y, v.z, v.w];
};

/** A looping rotation track: samples of [x, y, z] axis-angle rotations evenly over `seconds`. */
function rotTrack(bone: string, seconds: number, rots: [number, number, number][]): QuaternionKeyframeTrack {
  const times: number[] = [];
  const values: number[] = [];
  rots.forEach((r, i) => {
    times.push((seconds * i) / (rots.length - 1));
    values.push(...(Math.hypot(...r) < 1e-9 ? [0, 0, 0, 1] : q(...r)));
  });
  return new QuaternionKeyframeTrack(`${bone}.quaternion`, times, values);
}

function posTrack(bone: string, seconds: number, base: number, ys: number[]): VectorKeyframeTrack {
  const times: number[] = [];
  const values: number[] = [];
  ys.forEach((y, i) => {
    times.push((seconds * i) / (ys.length - 1));
    values.push(0, base + y, 0);
  });
  return new VectorKeyframeTrack(`${bone}.position`, times, values);
}

/**
 * A three-bone procedural character (hip, spine, head) skinned to a
 * cylinder or any upright geometry, with a full animation set built in
 * code: rest, idle, walk, run, hit, attack, die. Templates with procedural
 * art get real skinned animation (and VAT crowds via bakeVertexAnimation)
 * without any asset files.
 */
export function buildSegmentRig(material: Material, opts: SegmentRigOptions = {}): SegmentRig {
  const h = opts.height ?? 1.2;
  const r = opts.radius ?? 0.35;
  const geometry =
    opts.geometry ??
    (() => {
      const g = new CylinderGeometry(opts.topRadius ?? r * 0.75, r, h, opts.radialSegments ?? 10, opts.heightSegments ?? 6);
      g.translate(0, h / 2, 0);
      return g;
    })();
  const pos = geometry.getAttribute("position");
  const idx: number[] = [];
  const wts: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const y = Math.min(1, Math.max(0, pos.getY(i) / h));
    // Hip owns the bottom half, spine the middle, head the top third.
    if (y < 0.5) {
      const w = y / 0.5;
      idx.push(0, 1, 0, 0);
      wts.push(1 - w, w, 0, 0);
    } else {
      const w = Math.min(1, (y - 0.5) / 0.35);
      idx.push(1, 2, 0, 0);
      wts.push(1 - w, w, 0, 0);
    }
  }
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(idx, 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute(wts, 4));

  const hip = new Bone();
  hip.name = "hip";
  const spine = new Bone();
  spine.name = "spine";
  spine.position.y = h * 0.5;
  const head = new Bone();
  head.name = "head";
  head.position.y = h * 0.35;
  hip.add(spine);
  spine.add(head);
  const mesh = new SkinnedMesh(geometry, material);
  mesh.add(hip);
  mesh.bind(new Skeleton([hip, spine, head]));

  const hb = 0;
  const clips = [
    new AnimationClip("rest", 1, [rotTrack("hip", 1, [[0, 0, 0], [0, 0, 0]])]),
    new AnimationClip("idle", 2, [
      posTrack("hip", 2, hb, [0, -0.02 * h, 0]),
      rotTrack("spine", 2, [[0.02, 0, 0], [-0.03, 0, 0.02], [0.02, 0, 0]]),
      rotTrack("head", 2, [[0, 0.05, 0], [0, -0.05, 0], [0, 0.05, 0]]),
    ]),
    new AnimationClip("walk", 0.8, [
      posTrack("hip", 0.8, hb, [0, 0.05 * h, 0, 0.05 * h, 0]),
      rotTrack("hip", 0.8, [[-0.08, 0, 0.12], [-0.08, 0, 0], [-0.08, 0, -0.12], [-0.08, 0, 0], [-0.08, 0, 0.12]]),
      rotTrack("spine", 0.8, [[0, 0.12, -0.06], [0, 0, 0], [0, -0.12, 0.06], [0, 0, 0], [0, 0.12, -0.06]]),
      rotTrack("head", 0.8, [[0.05, -0.08, 0], [0.05, 0, 0], [0.05, 0.08, 0], [0.05, 0, 0], [0.05, -0.08, 0]]),
    ]),
    new AnimationClip("run", 0.5, [
      posTrack("hip", 0.5, hb, [0, 0.12 * h, 0, 0.12 * h, 0]),
      rotTrack("hip", 0.5, [[-0.22, 0, 0.18], [-0.22, 0, 0], [-0.22, 0, -0.18], [-0.22, 0, 0], [-0.22, 0, 0.18]]),
      rotTrack("spine", 0.5, [[-0.1, 0.2, -0.1], [-0.1, 0, 0], [-0.1, -0.2, 0.1], [-0.1, 0, 0], [-0.1, 0.2, -0.1]]),
      rotTrack("head", 0.5, [[0.15, 0, 0], [0.1, 0, 0], [0.15, 0, 0], [0.1, 0, 0], [0.15, 0, 0]]),
    ]),
    new AnimationClip("hit", 0.3, [
      rotTrack("spine", 0.3, [[0, 0, 0], [0.45, 0, 0.1], [0.1, 0, 0], [0, 0, 0]]),
      rotTrack("head", 0.3, [[0, 0, 0], [0.3, 0, -0.1], [0, 0, 0], [0, 0, 0]]),
    ]),
    new AnimationClip("attack", 0.45, [
      rotTrack("spine", 0.45, [[0, 0, 0], [0.15, -0.6, 0], [-0.3, 0.7, 0], [0, 0, 0]]),
      posTrack("hip", 0.45, hb, [0, -0.04 * h, 0.02 * h, 0]),
    ]),
    new AnimationClip("die", 0.7, [
      rotTrack("hip", 0.7, [[0, 0, 0], [0.4, 0, 0], [1.4, 0, 0.2]]),
      new VectorKeyframeTrack("head.scale", [0, 0.7], [1, 1, 1, 1, 0.8, 1]),
    ]),
  ];
  return { mesh, bones: [hip, spine, head], clips };
}
