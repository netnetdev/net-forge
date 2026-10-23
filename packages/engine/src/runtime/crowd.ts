import { InstancedMesh, Material } from "three/webgpu";
import type { BufferGeometry } from "three/webgpu";
import type { RenderView } from "@netforge/engine-sim";
import { lerp, lerpAngle } from "./interpolate.js";

/**
 * One InstancedMesh per entity kind: 2,000 enemies are one draw call
 * (spec §5). Each frame writes interpolated matrices straight into the
 * instance buffer (rotation about y only; no per-instance Object3D).
 */
export class InstancedCrowd {
  readonly mesh: InstancedMesh;
  private readonly capacity: number;

  constructor(
    geometry: BufferGeometry,
    material: Material,
    capacity: number,
    private readonly kind: number,
    private readonly scale = 1,
  ) {
    this.capacity = capacity;
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.count = 0;
    // Instances span the whole arena; culling one bounding sphere saves nothing.
    this.mesh.frustumCulled = false;
  }

  /** Write this frame's instances from a sim render view at interpolation `alpha` (0..1). */
  update(view: RenderView, alpha: number): number {
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const s = this.scale;
    let n = 0;
    for (let i = 0; i < view.count && n < this.capacity; i++) {
      if (view.kind[i] !== this.kind) continue;
      const x = lerp(view.prevX[i] ?? 0, view.x[i] ?? 0, alpha);
      const y = lerp(view.prevY[i] ?? 0, view.y[i] ?? 0, alpha);
      const z = lerp(view.prevZ[i] ?? 0, view.z[i] ?? 0, alpha);
      const yaw = lerpAngle(view.prevYaw[i] ?? 0, view.yaw[i] ?? 0, alpha);
      const c = Math.cos(yaw) * s;
      const sn = Math.sin(yaw) * s;
      const o = n * 16;
      m[o] = c;
      m[o + 1] = 0;
      m[o + 2] = -sn;
      m[o + 3] = 0;
      m[o + 4] = 0;
      m[o + 5] = s;
      m[o + 6] = 0;
      m[o + 7] = 0;
      m[o + 8] = sn;
      m[o + 9] = 0;
      m[o + 10] = c;
      m[o + 11] = 0;
      m[o + 12] = x;
      m[o + 13] = y;
      m[o + 14] = z;
      m[o + 15] = 1;
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    return n;
  }

  dispose(): void {
    this.mesh.dispose();
  }
}
