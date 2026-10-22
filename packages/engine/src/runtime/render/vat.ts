import {
  AnimationMixer,
  BufferGeometry,
  DataTexture,
  DynamicDrawUsage,
  Float32BufferAttribute,
  FloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NearestFilter,
  RGBAFormat,
  Vector3,
} from "three/webgpu";
import type { AnimationClip, Material, Node, Object3D, SkinnedMesh } from "three/webgpu";
import {
  cameraViewMatrix,
  cos,
  float,
  floor,
  fract,
  instancedBufferAttribute,
  int,
  materialEmissive,
  ivec2,
  mix,
  mod,
  normalize,
  sin,
  textureLoad,
  uniform,
  varying,
  vec3,
  vec4,
  vertexIndex,
} from "three/tsl";

export interface VatClip {
  readonly name: string;
  /** First frame of this clip in the texture. */
  readonly start: number;
  readonly frames: number;
}

/** A vertex animation texture: every vertex's skinned position (and normal) per frame. */
export interface VertexAnimation {
  readonly positions: DataTexture;
  readonly normals: DataTexture | null;
  readonly vertexCount: number;
  /** Texture width (vertices per row) and rows per frame. */
  readonly width: number;
  readonly rowsPerFrame: number;
  readonly totalFrames: number;
  readonly fps: number;
  readonly clips: readonly VatClip[];
  /** The source geometry (index, uv) the crowd draws. */
  readonly geometry: BufferGeometry;
}

export interface BakeOptions {
  /** Sample rate, frames per second. Default 30. */
  readonly fps?: number;
  /** Frames per clip (default ceil(duration x fps), at least 1). */
  readonly frames?: number;
  /** Also bake per-frame normals (smooth-shaded crowds). Default true. */
  readonly normals?: boolean;
  /** Max texture width. Default 2048. */
  readonly maxWidth?: number;
}

/**
 * Bake one or more clips of a skinned mesh into a vertex animation texture
 * (CPU, at load). Frames are laid out clip after clip; a crowd then plays
 * any clip on thousands of instances in one draw (`VatCrowd`).
 */
export function bakeVertexAnimation(mesh: SkinnedMesh, clips: AnimationClip | readonly AnimationClip[], opts: BakeOptions = {}): VertexAnimation {
  const list = Array.isArray(clips) ? (clips as readonly AnimationClip[]) : [clips as AnimationClip];
  const fps = opts.fps ?? 30;
  const geometry = mesh.geometry;
  const count = geometry.getAttribute("position").count;
  const width = Math.min(count, opts.maxWidth ?? 2048);
  const rowsPerFrame = Math.ceil(count / width);
  const plan: VatClip[] = [];
  let total = 0;
  for (const c of list) {
    const frames = Math.max(1, opts.frames ?? Math.ceil(c.duration * fps));
    plan.push({ name: c.name, start: total, frames });
    total += frames;
  }
  const height = rowsPerFrame * total;
  const pos = new Float32Array(width * height * 4);
  const wantNormals = opts.normals ?? true;
  const nor = wantNormals ? new Float32Array(width * height * 4) : null;
  const scratch = wantNormals ? new BufferGeometry() : null;
  if (scratch) {
    if (geometry.index) scratch.setIndex(geometry.index);
    scratch.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * 3), 3));
  }
  const mixer = new AnimationMixer(mesh);
  const v = new Vector3();
  list.forEach((clip, ci) => {
    const p = plan[ci] as VatClip;
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.reset().play();
    for (let f = 0; f < p.frames; f++) {
      mixer.setTime(p.frames > 1 ? (f / p.frames) * clip.duration : 0);
      mesh.updateMatrixWorld(true);
      mesh.skeleton.update();
      const sp = scratch?.getAttribute("position").array as Float32Array | undefined;
      for (let i = 0; i < count; i++) {
        mesh.getVertexPosition(i, v);
        const row = (p.start + f) * rowsPerFrame + Math.floor(i / width);
        const o = (row * width + (i % width)) * 4;
        pos[o] = v.x;
        pos[o + 1] = v.y;
        pos[o + 2] = v.z;
        pos[o + 3] = 1;
        if (sp) {
          sp[i * 3] = v.x;
          sp[i * 3 + 1] = v.y;
          sp[i * 3 + 2] = v.z;
        }
      }
      if (scratch && nor) {
        scratch.getAttribute("position").needsUpdate = true;
        scratch.computeVertexNormals();
        const n = scratch.getAttribute("normal");
        for (let i = 0; i < count; i++) {
          const row = (p.start + f) * rowsPerFrame + Math.floor(i / width);
          const o = (row * width + (i % width)) * 4;
          nor[o] = n.getX(i);
          nor[o + 1] = n.getY(i);
          nor[o + 2] = n.getZ(i);
          nor[o + 3] = 0;
        }
      }
    }
    action.stop();
  });
  mixer.uncacheRoot(mesh);
  const tex = (data: Float32Array) => {
    const t = new DataTexture(data, width, height, RGBAFormat, FloatType);
    t.minFilter = NearestFilter;
    t.magFilter = NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  return {
    positions: tex(pos),
    normals: nor ? tex(nor) : null,
    vertexCount: count,
    width,
    rowsPerFrame,
    totalFrames: total,
    fps,
    clips: plan,
    geometry,
  };
}

export interface VatCrowdOptions {
  /** Use baked normals (smooth shading). Off for flat-shaded materials. Default true when baked. */
  readonly bakedNormals?: boolean;
}

/**
 * Thousands of animated characters in one draw: every instance samples the
 * VAT at its own clip, phase and rate, then is rotated, scaled and placed
 * from per-instance attributes. CPU work per instance is one 12-float write.
 */
export class VatCrowd {
  readonly mesh: Mesh;
  readonly time = uniform(0);
  count = 0;
  private readonly xform: InstancedBufferAttribute;
  private readonly anim: InstancedBufferAttribute;
  private readonly clip: InstancedBufferAttribute;
  private readonly clipIndex = new Map<string, VatClip>();

  constructor(
    readonly vat: VertexAnimation,
    material: Material & { positionNode: Node | null; normalNode: Node | null; emissiveNode?: Node | null; flatShading?: boolean },
    readonly capacity: number,
    opts: VatCrowdOptions = {},
  ) {
    for (const c of vat.clips) this.clipIndex.set(c.name, c);
    const g = new InstancedBufferGeometry();
    const src = vat.geometry;
    if (src.index) g.setIndex(src.index);
    for (const name of ["position", "normal", "uv"]) {
      const a = src.getAttribute(name);
      if (a) g.setAttribute(name, a);
    }
    g.instanceCount = 0;
    const mk = () => {
      const a = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.xform = mk(); // x, y, z, yaw
    this.anim = mk(); // phase s, rate, scale, flash
    this.clip = mk(); // start frame, frames
    const X = instancedBufferAttribute<"vec4">(this.xform, "vec4");
    const A = instancedBufferAttribute<"vec4">(this.anim, "vec4");
    const C = instancedBufferAttribute<"vec4">(this.clip, "vec4");
    const tt = this.time.mul(A.y).add(A.x).mul(vat.fps);
    const frames = C.y.max(1);
    const f0 = mod(floor(tt), frames);
    const f1 = mod(f0.add(1), frames);
    const a = fract(tt);
    const vi = int(vertexIndex);
    const w = int(vat.width);
    const col = vi.mod(w);
    const row = vi.div(w);
    const rpf = int(vat.rowsPerFrame);
    const at = (f: Node<"float">) => ivec2(col, int(C.x.add(f)).mul(rpf).add(row));
    const p0 = textureLoad(vat.positions, at(f0)).xyz;
    const p1 = textureLoad(vat.positions, at(f1)).xyz;
    const p = mix(p0, p1, a).mul(A.z);
    const cy = cos(X.w);
    const sy = sin(X.w);
    const rot = (v: Node<"vec3">) => {
      const n = v;
      return vec3(n.x.mul(cy).add(n.z.mul(sy)), n.y, n.x.mul(sy).negate().add(n.z.mul(cy)));
    };
    material.positionNode = rot(p).add(X.xyz);
    const useNormals = (opts.bakedNormals ?? true) && vat.normals !== null && material.flatShading !== true;
    if (useNormals && vat.normals) {
      const n = mix(textureLoad(vat.normals, at(f0)).xyz, textureLoad(vat.normals, at(f1)).xyz, a);
      const nw = varying(rot(n));
      material.normalNode = normalize(cameraViewMatrix.mul(vec4(nw, 0)).xyz);
    }
    if ("emissiveNode" in material) {
      material.emissiveNode = materialEmissive.add(vec3(varying(A.w)).mul(float(2.5)));
    }
    this.mesh = new Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.name = "VatCrowd";
  }

  clipNamed(name: string): VatClip | undefined {
    return this.clipIndex.get(name);
  }

  begin(): void {
    this.count = 0;
  }

  /** Add one instance this frame. `phase` offsets the clip in seconds; `rate` scales playback. */
  push(x: number, y: number, z: number, yaw: number, opts: { clip?: string; phase?: number; rate?: number; scale?: number; flash?: number } = {}): void {
    if (this.count >= this.capacity) return;
    const o = this.count * 4;
    const X = this.xform.array as Float32Array;
    const A = this.anim.array as Float32Array;
    const C = this.clip.array as Float32Array;
    X[o] = x;
    X[o + 1] = y;
    X[o + 2] = z;
    X[o + 3] = yaw;
    A[o] = opts.phase ?? 0;
    A[o + 1] = opts.rate ?? 1;
    A[o + 2] = opts.scale ?? 1;
    A[o + 3] = Math.min(1, Math.max(0, opts.flash ?? 0));
    const c = (opts.clip !== undefined ? this.clipIndex.get(opts.clip) : undefined) ?? this.vat.clips[0];
    C[o] = c?.start ?? 0;
    C[o + 1] = c?.frames ?? 1;
    this.count++;
  }

  /** Upload the instances written since `begin` and set the time (seconds). */
  end(timeSeconds: number): void {
    this.time.value = timeSeconds;
    (this.mesh.geometry as InstancedBufferGeometry).instanceCount = this.count;
    for (const a of [this.xform, this.anim, this.clip]) {
      a.clearUpdateRanges();
      if (this.count > 0) a.addUpdateRange(0, this.count * 4);
      a.needsUpdate = true;
    }
  }

  addTo(parent: Object3D): this {
    parent.add(this.mesh);
    return this;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.vat.positions.dispose();
    this.vat.normals?.dispose();
  }
}
