/**
 * Smooth normals with a crease angle ("auto smooth"), written in place.
 *
 * Low-poly models ship faceted: every triangle has its own normal, so a
 * banded light cuts them into facets and they read as low-poly with an
 * outline. Cel shading wants smooth curves that the bands slice cleanly,
 * with real corners kept sharp. For every vertex, this averages the
 * (area-weighted) normals of the faces that meet at its position and lie
 * within `creaseDegrees` of the vertex's own normal (its face's, for a
 * faceted model). Topology, indices, colours and skin weights are untouched,
 * so skinned characters, instanced crowds and VAT bakes keep working.
 *
 * Pure array math: node-testable.
 */

export interface SmoothOptions {
  /** Faces meeting at more than this angle keep a hard edge. Default 62. */
  readonly creaseDegrees?: number;
  /** Positions closer than this are the same point (welds split vertices). Default 1e-4. */
  readonly tolerance?: number;
}

/**
 * Recompute `normals` (xyz per vertex) from `positions` and optional
 * triangle `indices`. `normals` is both the reference (each vertex's own
 * normal decides which neighbours it blends with) and the output.
 */
export function smoothNormalsInPlace(positions: ArrayLike<number>, normals: Float32Array | number[], indices: ArrayLike<number> | null, opts: SmoothOptions = {}): void {
  const vertexCount = Math.floor(positions.length / 3);
  const triCount = Math.floor((indices ? indices.length : vertexCount) / 3);
  if (triCount === 0) return;
  const cosCrease = Math.cos(((opts.creaseDegrees ?? 62) * Math.PI) / 180);
  const tol = opts.tolerance ?? 1e-4;
  const at = (t: number, k: number): number => (indices ? (indices[t * 3 + k] ?? 0) : t * 3 + k);
  // Area-weighted face normals.
  const face = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const a = at(t, 0) * 3;
    const b = at(t, 1) * 3;
    const c = at(t, 2) * 3;
    const ux = (positions[b] ?? 0) - (positions[a] ?? 0);
    const uy = (positions[b + 1] ?? 0) - (positions[a + 1] ?? 0);
    const uz = (positions[b + 2] ?? 0) - (positions[a + 2] ?? 0);
    const vx = (positions[c] ?? 0) - (positions[a] ?? 0);
    const vy = (positions[c + 1] ?? 0) - (positions[a + 1] ?? 0);
    const vz = (positions[c + 2] ?? 0) - (positions[a + 2] ?? 0);
    face[t * 3] = uy * vz - uz * vy;
    face[t * 3 + 1] = uz * vx - ux * vz;
    face[t * 3 + 2] = ux * vy - uy * vx;
  }
  // Faces around each welded position.
  const key = (v: number): string => `${Math.round((positions[v * 3] ?? 0) / tol)},${Math.round((positions[v * 3 + 1] ?? 0) / tol)},${Math.round((positions[v * 3 + 2] ?? 0) / tol)}`;
  const facesAt = new Map<string, number[]>();
  const keys: string[] = new Array<string>(vertexCount);
  for (let v = 0; v < vertexCount; v++) keys[v] = key(v);
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const v = at(t, k);
      const kk = keys[v] ?? "";
      let list = facesAt.get(kk);
      if (!list) {
        list = [];
        facesAt.set(kk, list);
      }
      list.push(t);
    }
  }
  // The reference normal of each vertex: its own (authored) normal, else the face it belongs to.
  const ref = new Float32Array(vertexCount * 3);
  for (let v = 0; v < vertexCount; v++) {
    let nx = normals[v * 3] ?? 0;
    let ny = normals[v * 3 + 1] ?? 0;
    let nz = normals[v * 3 + 2] ?? 0;
    const l = Math.hypot(nx, ny, nz);
    if (l > 1e-8) {
      ref[v * 3] = nx / l;
      ref[v * 3 + 1] = ny / l;
      ref[v * 3 + 2] = nz / l;
    } else {
      ref[v * 3] = Number.NaN;
    }
  }
  if (!indices) {
    // Non-indexed: a vertex with no authored normal takes its face's.
    for (let t = 0; t < triCount; t++) {
      const fx = face[t * 3] ?? 0;
      const fy = face[t * 3 + 1] ?? 0;
      const fz = face[t * 3 + 2] ?? 0;
      const l = Math.hypot(fx, fy, fz) || 1;
      for (let k = 0; k < 3; k++) {
        const v = t * 3 + k;
        if (Number.isNaN(ref[v * 3] ?? 0)) {
          ref[v * 3] = fx / l;
          ref[v * 3 + 1] = fy / l;
          ref[v * 3 + 2] = fz / l;
        }
      }
    }
  }
  for (let v = 0; v < vertexCount; v++) {
    const rx = ref[v * 3] ?? 0;
    const ry = ref[v * 3 + 1] ?? 0;
    const rz = ref[v * 3 + 2] ?? 0;
    if (Number.isNaN(rx)) continue;
    const list = facesAt.get(keys[v] ?? "");
    if (!list) continue;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const t of list) {
      const fx = face[t * 3] ?? 0;
      const fy = face[t * 3 + 1] ?? 0;
      const fz = face[t * 3 + 2] ?? 0;
      const l = Math.hypot(fx, fy, fz);
      if (l < 1e-12) continue;
      if ((fx * rx + fy * ry + fz * rz) / l < cosCrease) continue;
      sx += fx;
      sy += fy;
      sz += fz;
    }
    const l = Math.hypot(sx, sy, sz);
    if (l < 1e-12) continue;
    normals[v * 3] = sx / l;
    normals[v * 3 + 1] = sy / l;
    normals[v * 3 + 2] = sz / l;
  }
}
