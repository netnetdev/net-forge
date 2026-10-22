import type { RenderView, SimWorld } from "./api.js";
import { internal, liveOrder } from "./world.js";

interface Buffers {
  cap: number;
  view: RenderView;
}
const cache = new WeakMap<SimWorld, Buffers>();

function alloc(cap: number, tick: number): RenderView {
  return {
    tick,
    count: 0,
    netId: new Uint32Array(cap),
    kind: new Uint8Array(cap),
    owner: new Uint16Array(cap),
    health: new Uint16Array(cap),
    flags: new Uint8Array(cap),
    x: new Float32Array(cap),
    y: new Float32Array(cap),
    z: new Float32Array(cap),
    yaw: new Float32Array(cap),
    prevX: new Float32Array(cap),
    prevY: new Float32Array(cap),
    prevZ: new Float32Array(cap),
    prevYaw: new Float32Array(cap),
  };
}

/**
 * Dense arrays for rendering this tick, in netId order, with last tick's
 * transforms for interpolation. The buffers are reused: copy anything you
 * need to keep past the next `step` or `applyState`.
 */
export function renderView(world: SimWorld): RenderView {
  const w = internal(world);
  const order = liveOrder(w);
  let b = cache.get(world);
  if (!b || b.cap < order.length) {
    const cap = Math.max(64, order.length * 2);
    b = { cap, view: alloc(cap, w.tick) };
    cache.set(world, b);
  }
  const v = b.view;
  const { Transform: T, Networked: N, Owner: O, Health: H, SimState: S } = w.c;
  let i = 0;
  for (const eid of order) {
    v.netId[i] = N.netId[eid] ?? 0;
    v.kind[i] = N.kind[eid] ?? 0;
    v.owner[i] = O.player[eid] ?? 0;
    v.health[i] = Math.max(0, H.hp[eid] ?? 0);
    v.flags[i] = S.flags[eid] ?? 0;
    v.x[i] = T.x[eid] ?? 0;
    v.y[i] = T.y[eid] ?? 0;
    v.z[i] = T.z[eid] ?? 0;
    v.yaw[i] = T.yaw[eid] ?? 0;
    v.prevX[i] = T.px[eid] ?? 0;
    v.prevY[i] = T.py[eid] ?? 0;
    v.prevZ[i] = T.pz[eid] ?? 0;
    v.prevYaw[i] = T.pyaw[eid] ?? 0;
    i++;
  }
  const out: RenderView = { ...v, tick: w.tick, count: i };
  b.view = out;
  return out;
}
