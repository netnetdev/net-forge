import { EntityFlag, EntityKind, SNAPSHOT_VERSION, YAW_UNITS } from "./api.js";
import type { EntityKindId, EntityState, SimState, SimWorld } from "./api.js";
import { dqPos, dqVel, dqYaw, qPos, qVel, qYaw } from "./quant.js";
import { despawnEntity, internal, liveOrder, spawnEntity } from "./world.js";

/** Read the world's networked state. `include` filters entities (interest management). */
export function captureState(world: SimWorld, include?: (e: EntityState) => boolean): SimState {
  const w = internal(world);
  const { Transform: T, Velocity: V, Networked: N, Owner: O, Health: H, SimState: S, Game: G } = w.c;
  const entities: EntityState[] = [];
  for (const eid of liveOrder(w)) {
    const e: EntityState = {
      netId: N.netId[eid] ?? 0,
      kind: (N.kind[eid] ?? 0) as EntityKindId,
      owner: O.player[eid] ?? 0,
      px: qPos(T.x[eid] ?? 0),
      py: qPos(T.y[eid] ?? 0),
      pz: qPos(T.z[eid] ?? 0),
      vx: qVel(V.x[eid] ?? 0),
      vy: qVel(V.y[eid] ?? 0),
      vz: qVel(V.z[eid] ?? 0),
      yaw: qYaw(T.yaw[eid] ?? 0),
      health: Math.max(0, H.hp[eid] ?? 0),
      flags: S.flags[eid] ?? 0,
      ack: S.ack[eid] ?? 0,
      cooldown: Math.max(0, S.cooldown[eid] ?? 0),
      buttons: S.buttons[eid] ?? 0,
      timers: S.timers[eid] ?? 0,
      type: G.type[eid] ?? 0,
      value: G.value[eid] ?? 0,
      level: G.level[eid] ?? 0,
      xp: G.xp[eid] ?? 0,
      weapons: G.weapons[eid] ?? 0,
      wcd: G.wcd[eid] ?? 0,
      stats: G.stats[eid] ?? 0,
      choices: G.choices[eid] ?? 0,
      bleed: G.bleed[eid] ?? 0,
      revive: G.revive[eid] ?? 0,
      iframes: G.iframes[eid] ?? 0,
      dash: G.dash[eid] ?? 0,
    };
    if (!include || include(e)) entities.push(e);
  }
  return { tick: w.tick, rng: w.rng >>> 0, nextNetId: w.nextNetId, kills: w.kills, entities };
}

/**
 * Make the world match `state`: update entities present in both, spawn
 * missing ones with their netIds, remove the rest. Lossless for captured
 * states. Interpolation history is reset (prev = current).
 */
export function applyState(world: SimWorld, state: SimState): void {
  const w = internal(world);
  const { Transform: T, Velocity: V, Networked: N, Owner: O, Health: H, SimState: S, Game: G } = w.c;
  const keep = new Set<number>();
  for (const e of state.entities) keep.add(e.netId);
  for (const eid of [...liveOrder(w)]) {
    const id = N.netId[eid] ?? 0;
    if (!keep.has(id)) despawnEntity(w, eid);
  }
  w.doomed.clear();
  for (const e of state.entities) {
    let eid = w.byNetId.get(e.netId);
    if (
      eid !== undefined &&
      (N.kind[eid] !== e.kind || (O.player[eid] ?? 0) !== e.owner || (e.kind === EntityKind.Enemy && (G.type[eid] ?? 0) !== e.type))
    ) {
      despawnEntity(w, eid);
      eid = undefined;
    }
    if (eid === undefined) {
      if (e.kind === EntityKind.Player && w.players.has(e.owner)) {
        const stale = w.players.get(e.owner);
        if (stale !== undefined) despawnEntity(w, stale);
      }
      eid = spawnEntity(w, e.kind, [dqPos(e.px), dqPos(e.py), dqPos(e.pz)], { netId: e.netId, owner: e.owner, type: e.type });
    }
    if (e.kind === EntityKind.Enemy) {
      // Keep the live/corpse counters right as the Dead flag changes.
      const wasDead = ((S.flags[eid] ?? 0) & EntityFlag.Dead) !== 0;
      const isDead = (e.flags & EntityFlag.Dead) !== 0;
      if (wasDead !== isDead) {
        w.corpseCount += isDead ? 1 : -1;
        w.typeCount[e.type] = (w.typeCount[e.type] ?? 0) + (isDead ? -1 : 1);
      }
    }
    T.x[eid] = T.px[eid] = dqPos(e.px);
    T.y[eid] = T.py[eid] = dqPos(e.py);
    T.z[eid] = T.pz[eid] = dqPos(e.pz);
    T.yaw[eid] = T.pyaw[eid] = dqYaw(e.yaw);
    V.x[eid] = dqVel(e.vx);
    V.y[eid] = dqVel(e.vy);
    V.z[eid] = dqVel(e.vz);
    O.player[eid] = e.owner;
    H.hp[eid] = e.health;
    S.flags[eid] = e.flags;
    S.ack[eid] = e.ack;
    S.cooldown[eid] = e.cooldown;
    S.buttons[eid] = e.buttons;
    S.timers[eid] = e.timers;
    G.type[eid] = e.type;
    G.value[eid] = e.value;
    G.level[eid] = e.level;
    G.xp[eid] = e.xp;
    G.weapons[eid] = e.weapons;
    G.wcd[eid] = e.wcd;
    G.stats[eid] = e.stats;
    G.choices[eid] = e.choices;
    G.bleed[eid] = e.bleed;
    G.revive[eid] = e.revive;
    G.iframes[eid] = e.iframes;
    G.dash[eid] = e.dash;
    const col = w.colliders.get(eid);
    if (col) col.setTranslation({ x: dqPos(e.px), y: dqPos(e.py), z: dqPos(e.pz) });
  }
  w.tick = state.tick;
  w.rng = state.rng >>> 0;
  w.nextNetId = Math.max(state.nextNetId, w.nextNetId);
  w.kills = state.kills;
  liveOrder(w);
}

// ------------------------------------------------------------- wire format
//
//   magic "NS" (2 bytes), version u8, flags u8 (bit0 = delta)
//   tick, [baseTick if delta], rng, nextNetId, kills         (varints)
//   removedCount, removed netIds as ascending gaps            (varints)
//   entityCount, then per entity:
//     netId gap from the previous listed netId               (varint)
//     changed-field mask                                     (varint, bit per FIELDS entry)
//     per set bit: zigzag varint of (value - baseline value) (yaw wraps mod 65536)
//
// A full snapshot is a delta against nothing (every baseline field is 0)
// and lists every entity. A delta lists only entities that changed or are
// new, and carries the netIds that left (removed, or out of interest).

const MAGIC0 = 0x4e; // N
const MAGIC1 = 0x53; // S
const FLAG_DELTA = 1;

const FIELDS = [
  "kind",
  "owner",
  "px",
  "py",
  "pz",
  "vx",
  "vy",
  "vz",
  "yaw",
  "health",
  "flags",
  "ack",
  "cooldown",
  "buttons",
  "timers",
  "type",
  "value",
  "level",
  "xp",
  "weapons",
  "wcd",
  "stats",
  "choices",
  "bleed",
  "revive",
  "iframes",
  "dash",
] as const satisfies readonly (keyof EntityState)[];
const YAW_FIELD = FIELDS.indexOf("yaw");

/** The baseline for a new entity: every field 0 (kind 0 is "none" on the wire). */
const ZERO: EntityState = {
  netId: 0,
  kind: 0 as EntityKindId,
  owner: 0,
  px: 0,
  py: 0,
  pz: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  yaw: 0,
  health: 0,
  flags: 0,
  ack: 0,
  cooldown: 0,
  buttons: 0,
  timers: 0,
  type: 0,
  value: 0,
  level: 0,
  xp: 0,
  weapons: 0,
  wcd: 0,
  stats: 0,
  choices: 0,
  bleed: 0,
  revive: 0,
  iframes: 0,
  dash: 0,
};

class Writer {
  buf = new Uint8Array(256);
  len = 0;
  private grow(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  u8(v: number): void {
    this.grow(1);
    this.buf[this.len++] = v & 0xff;
  }
  /** Unsigned varint (LEB128) for 0..2^53. */
  uv(v: number): void {
    if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`engine-sim: varint out of range: ${v}`);
    this.grow(8);
    while (v >= 0x80) {
      this.buf[this.len++] = (v % 0x80) | 0x80;
      v = Math.floor(v / 0x80);
    }
    this.buf[this.len++] = v;
  }
  /** Signed varint, zigzag. */
  sv(v: number): void {
    this.uv(v >= 0 ? v * 2 : -v * 2 - 1);
  }
  bytes(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

class Reader {
  pos = 0;
  constructor(private readonly buf: Uint8Array) {}
  u8(): number {
    const v = this.buf[this.pos++];
    if (v === undefined) throw new RangeError("engine-sim: truncated snapshot");
    return v;
  }
  uv(): number {
    let out = 0;
    let mul = 1;
    for (let i = 0; i < 8; i++) {
      const b = this.u8();
      out += (b & 0x7f) * mul;
      if ((b & 0x80) === 0) return out;
      mul *= 0x80;
    }
    throw new RangeError("engine-sim: varint too long");
  }
  sv(): number {
    const z = this.uv();
    return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
  }
  done(): boolean {
    return this.pos === this.buf.length;
  }
}

const wrapYaw = (d: number): number => {
  const m = (((d + YAW_UNITS / 2) % YAW_UNITS) + YAW_UNITS) % YAW_UNITS;
  return m - YAW_UNITS / 2;
};

/** Binary snapshot. With `baseline`, a delta against it (the receiver must hold the same baseline). */
export function encodeSnapshot(state: SimState, baseline?: SimState): Uint8Array {
  const w = new Writer();
  w.u8(MAGIC0);
  w.u8(MAGIC1);
  w.u8(SNAPSHOT_VERSION);
  w.u8(baseline ? FLAG_DELTA : 0);
  w.uv(state.tick);
  if (baseline) w.uv(baseline.tick);
  w.uv(state.rng >>> 0);
  w.uv(state.nextNetId);
  w.uv(state.kills);

  const base = new Map<number, EntityState>();
  if (baseline) for (const e of baseline.entities) base.set(e.netId, e);

  // Removed: in the baseline, not in the state.
  const present = new Set<number>();
  for (const e of state.entities) present.add(e.netId);
  const removed: number[] = [];
  for (const id of base.keys()) if (!present.has(id)) removed.push(id);
  removed.sort((a, b) => a - b);
  w.uv(removed.length);
  let prev = 0;
  for (const id of removed) {
    w.uv(id - prev);
    prev = id;
  }

  const sorted = isSorted(state.entities) ? state.entities : [...state.entities].sort((a, b) => a.netId - b.netId);
  const listed: { e: EntityState; mask: number; b: EntityState }[] = [];
  for (const e of sorted) {
    const b = base.get(e.netId) ?? ZERO;
    let mask = 0;
    for (let i = 0; i < FIELDS.length; i++) {
      const f = FIELDS[i] as (typeof FIELDS)[number];
      if (e[f] !== b[f]) mask |= 1 << i;
    }
    // Full snapshots list everything; deltas skip unchanged entities.
    if (baseline && mask === 0 && b !== ZERO) continue;
    listed.push({ e, mask, b });
  }
  w.uv(listed.length);
  prev = 0;
  for (const { e, mask, b } of listed) {
    w.uv(e.netId - prev);
    prev = e.netId;
    w.uv(mask);
    for (let i = 0; i < FIELDS.length; i++) {
      if ((mask & (1 << i)) === 0) continue;
      const f = FIELDS[i] as (typeof FIELDS)[number];
      const d = e[f] - b[f];
      w.sv(i === YAW_FIELD ? wrapYaw(d) : d);
    }
  }
  return w.bytes();
}

/** The baseline tick a delta snapshot needs, or null for a full snapshot. */
export function snapshotBaseTick(bytes: Uint8Array): number | null {
  const r = new Reader(bytes);
  readHeader(r);
  const flags = bytes[3] ?? 0;
  r.uv(); // tick
  return (flags & FLAG_DELTA) !== 0 ? r.uv() : null;
}

function readHeader(r: Reader): number {
  if (r.u8() !== MAGIC0 || r.u8() !== MAGIC1) throw new Error("engine-sim: not a snapshot");
  const v = r.u8();
  if (v !== SNAPSHOT_VERSION) throw new Error(`engine-sim: snapshot version ${v}, expected ${SNAPSHOT_VERSION}`);
  return r.u8();
}

export function decodeSnapshot(bytes: Uint8Array, baseline?: SimState): SimState {
  const r = new Reader(bytes);
  const flags = readHeader(r);
  const delta = (flags & FLAG_DELTA) !== 0;
  const tick = r.uv();
  if (delta) {
    const baseTick = r.uv();
    if (!baseline) throw new Error(`engine-sim: delta snapshot needs baseline tick ${baseTick}`);
    if (baseline.tick !== baseTick) {
      throw new Error(`engine-sim: delta snapshot is against tick ${baseTick}, got baseline ${baseline.tick}`);
    }
  }
  const rng = r.uv() >>> 0;
  const nextNetId = r.uv();
  const kills = r.uv();

  const out = new Map<number, EntityState>();
  if (delta && baseline) for (const e of baseline.entities) out.set(e.netId, { ...e });
  const removedCount = r.uv();
  let prev = 0;
  for (let i = 0; i < removedCount; i++) {
    prev += r.uv();
    out.delete(prev);
  }
  const count = r.uv();
  prev = 0;
  for (let n = 0; n < count; n++) {
    prev += r.uv();
    const mask = r.uv();
    const b = out.get(prev);
    const e: EntityState = { ...(b ?? ZERO) };
    e.netId = prev;
    for (let i = 0; i < FIELDS.length; i++) {
      if ((mask & (1 << i)) === 0) continue;
      const f = FIELDS[i] as (typeof FIELDS)[number];
      const v = (b ? b[f] : 0) + r.sv();
      if (i === YAW_FIELD) e.yaw = ((v % YAW_UNITS) + YAW_UNITS) % YAW_UNITS;
      else (e[f] as number) = v;
    }
    out.set(prev, e);
  }
  if (!r.done()) throw new Error("engine-sim: trailing bytes in snapshot");
  const entities = [...out.values()].sort((a, b) => a.netId - b.netId);
  return { tick, rng, nextNetId, kills, entities };
}

function isSorted(es: readonly EntityState[]): boolean {
  for (let i = 1; i < es.length; i++) if ((es[i - 1]?.netId ?? 0) >= (es[i]?.netId ?? 0)) return false;
  return true;
}
