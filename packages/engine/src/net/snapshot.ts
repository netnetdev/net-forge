// Delta-compressed, bit-packed snapshots.
//
// The server keeps, per client, the quantized entity sets it sent for the
// last N snapshot ticks. Each new snapshot is encoded against the most recent
// one the client acknowledged (its "baseline"):
//
//   - entities in the baseline but not in this snapshot are listed as removed
//     (destroyed, or left the client's area of interest),
//   - every other baseline entity costs one "changed?" bit, in id order (no
//     ids on the wire for a crowd); changed ones send a per-field changed
//     mask (or one bit when it repeats the previous changed entity's mask),
//     and each changed field goes either as a small signed delta or in full,
//   - entities absent from the baseline are sent in full ("new") by id gap.
//
// Both sides compare QUANTIZED integers, so the client's reconstruction is
// bit-identical to what the server believes it sent. With no acked baseline
// (first snapshot, or the ack fell out of history) the snapshot is full.

import { BitReader, BitWriter } from './bits.js';
import { fieldBits, fieldDeltaBits, type EntitySchema, type FieldSpec } from './schema.js';

/** One entity on the wire, values already quantized. */
export interface QEntity {
  readonly id: number;
  readonly kind: number;
  readonly owner: number;
  readonly q: readonly number[];
}

export interface SnapshotHeader {
  /** Server tick this snapshot describes. */
  readonly tick: number;
  /** Tick of the baseline it was encoded against; 0 means full. */
  readonly baselineTick: number;
  /** Highest input sequence number the server has applied for this client. */
  readonly ackSeq: number;
  /** The receiving player's own entity id (0 if none). */
  readonly self: number;
  /**
   * Inputs waiting in the server's queue for this client after this tick
   * (one-input-per-tick sims). The client speeds up or slows its input clock
   * to hold it near a small target. Absent from older encoders.
   */
  readonly inputBuffer?: number;
}

export interface DecodedSnapshot {
  readonly header: SnapshotHeader;
  /** The FULL reconstructed entity set for this tick (baseline + delta). */
  readonly entities: ReadonlyMap<number, QEntity>;
  /** Ids that were in the baseline and are gone now. */
  readonly removed: readonly number[];
}

export class BaselineMissingError extends Error {
  constructor(readonly baselineTick: number) {
    super(`snapshot baseline ${baselineTick} not in history`);
  }
}

const ANGLE_MOD = 65536;

/**
 * Encodes `current` (any order) against `baseline` (null for a full snapshot).
 */
export function encodeSnapshot(
  schema: EntitySchema,
  header: SnapshotHeader,
  current: readonly QEntity[],
  baseline: ReadonlyMap<number, QEntity> | null,
): Uint8Array {
  const w = new BitWriter(512);
  w.writeBits(header.tick, 32);
  w.writeBits(baseline ? header.baselineTick : 0, 32);
  w.writeBits(header.ackSeq, 32);
  w.writeBits(header.self, 16);
  w.writeBool(header.inputBuffer !== undefined);
  if (header.inputBuffer !== undefined) w.writeBits(Math.max(0, Math.min(255, Math.round(header.inputBuffer))), 8);

  const sorted = [...current].sort((a, b) => a.id - b.id);
  const fields = schema.fields;

  // Removed: in the baseline and gone now, or replaced by a different
  // entity under the same id (kind or owner changed: removed, then new).
  const removed: number[] = [];
  const fresh: QEntity[] = [];
  const kept = new Map<number, QEntity>();
  if (baseline) {
    const live = new Map<number, QEntity>();
    for (const e of sorted) live.set(e.id, e);
    for (const [id, b] of baseline) {
      const e = live.get(id);
      if (!e || e.kind !== b.kind || e.owner !== b.owner) removed.push(id);
      else kept.set(id, e);
    }
    removed.sort((x, y) => x - y);
    for (const e of sorted) if (!kept.has(e.id)) fresh.push(e);
  } else {
    fresh.push(...sorted);
  }
  w.writeVarUint(removed.length);
  let prev = 0;
  for (const id of removed) {
    w.writeVarUint(id - prev);
    prev = id;
  }

  // Kept entities: one bit each, in baseline id order (changed or not), so a
  // crowd costs a bit per entity for "which ones", never an id. Changed ones
  // follow with a field mask (or one bit when it repeats the previous mask).
  if (baseline) {
    const keptIds = [...kept.keys()].sort((x, y) => x - y);
    let lastMask = -1;
    let lastMaskLen = -1;
    for (const id of keptIds) {
      const e = kept.get(id) as QEntity;
      const base = baseline.get(id) as QEntity;
      const idx = kindFieldIndices(schema, e.kind);
      let mask = 0;
      for (let j = 0; j < idx.length; j++) {
        const i = idx[j] as number;
        if (e.q[i] !== base.q[i]) mask |= 1 << j;
      }
      w.writeBool(mask !== 0);
      if (mask === 0) continue;
      if (mask === lastMask && idx.length === lastMaskLen) {
        w.writeBool(true);
      } else {
        w.writeBool(false);
        w.writeBits(mask, idx.length);
        lastMask = mask;
        lastMaskLen = idx.length;
      }
      for (let j = 0; j < idx.length; j++) {
        if ((mask & (1 << j)) === 0) continue;
        const i = idx[j] as number;
        const f = fieldAt(fields, i);
        const v = e.q[i] ?? 0;
        const db = fieldDeltaBits(f);
        if (db > 0) {
          const d = fieldDelta(f, base.q[i] ?? 0, v);
          if (fitsSigned(d, db)) {
            w.writeBool(true);
            w.writeSigned(d, db);
            continue;
          }
          w.writeBool(false);
        }
        writeFull(w, f, v);
      }
    }
  }

  // New entities, in full, by id gap.
  w.writeVarUint(fresh.length);
  prev = 0;
  for (const e of fresh) {
    w.writeVarUint(e.id - prev);
    prev = e.id;
    w.writeBits(e.kind, 8);
    w.writeBits(e.owner, 16);
    for (const i of kindFieldIndices(schema, e.kind)) writeFull(w, fieldAt(fields, i), e.q[i] ?? 0);
  }
  return w.finish();
}

/**
 * Decodes a snapshot. `baselineFor` returns the client's stored entity set
 * for a tick it previously decoded.
 */
export function decodeSnapshot(
  schema: EntitySchema,
  bytes: Uint8Array,
  baselineFor: (tick: number) => ReadonlyMap<number, QEntity> | undefined,
): DecodedSnapshot {
  const r = new BitReader(bytes);
  const tick = r.readBits(32);
  const baselineTick = r.readBits(32);
  const ackSeq = r.readBits(32);
  const self = r.readBits(16);
  const header: SnapshotHeader = r.readBool() ? { tick, baselineTick, ackSeq, self, inputBuffer: r.readBits(8) } : { tick, baselineTick, ackSeq, self };

  let base: ReadonlyMap<number, QEntity> | undefined;
  if (baselineTick !== 0) {
    base = baselineFor(baselineTick);
    if (!base) throw new BaselineMissingError(baselineTick);
  }
  const out = new Map<number, QEntity>(base ?? []);

  const removedCount = r.readVarUint();
  const removed: number[] = [];
  let prev = 0;
  for (let i = 0; i < removedCount; i++) {
    const id = prev + r.readVarUint();
    prev = id;
    removed.push(id);
    out.delete(id);
  }

  const fields = schema.fields;
  const nf = fields.length;
  if (base) {
    const keptIds = [...out.keys()].sort((x, y) => x - y);
    let lastMask = -1;
    let lastMaskLen = -1;
    for (const id of keptIds) {
      if (!r.readBool()) continue;
      const prevE = out.get(id) as QEntity;
      const idx = kindFieldIndices(schema, prevE.kind);
      let mask: number;
      if (r.readBool()) {
        if (idx.length !== lastMaskLen) throw new Error('snapshot: repeated mask for a different field set');
        mask = lastMask;
      } else {
        mask = r.readBits(idx.length);
        lastMask = mask;
        lastMaskLen = idx.length;
      }
      const q = [...prevE.q];
      for (let j = 0; j < idx.length; j++) {
        if ((mask & (1 << j)) === 0) continue;
        const i = idx[j] as number;
        const f = fieldAt(fields, i);
        const db = fieldDeltaBits(f);
        if (db > 0 && r.readBool()) {
          q[i] = applyDelta(f, prevE.q[i] ?? 0, r.readSigned(db));
        } else {
          q[i] = readFull(r, f);
        }
      }
      out.set(id, { id, kind: prevE.kind, owner: prevE.owner, q });
    }
  }

  const count = r.readVarUint();
  prev = 0;
  for (let n = 0; n < count; n++) {
    const id = prev + r.readVarUint();
    prev = id;
    const kind = r.readBits(8);
    const owner = r.readBits(16);
    const q = new Array<number>(nf).fill(0);
    for (const i of kindFieldIndices(schema, kind)) q[i] = readFull(r, fieldAt(fields, i));
    out.set(id, { id, kind, owner, q });
  }
  return { header, entities: out, removed };
}

/**
 * Per-client history of what was sent, keyed by tick, so the next snapshot
 * can be encoded against whatever the client last acked.
 */
export class SnapshotHistory {
  private readonly byTick = new Map<number, ReadonlyMap<number, QEntity>>();
  private readonly order: number[] = [];

  constructor(private readonly capacity = 64) {}

  put(tick: number, entities: readonly QEntity[] | ReadonlyMap<number, QEntity>): void {
    const m = entities instanceof Map ? entities : new Map((entities as readonly QEntity[]).map((e) => [e.id, e]));
    if (!this.byTick.has(tick)) this.order.push(tick);
    this.byTick.set(tick, m);
    while (this.order.length > this.capacity) {
      const old = this.order.shift();
      if (old !== undefined) this.byTick.delete(old);
    }
  }

  get(tick: number): ReadonlyMap<number, QEntity> | undefined {
    return this.byTick.get(tick);
  }

  /** Drop entries older than `tick` (they can never be a baseline again). */
  pruneBefore(tick: number): void {
    while (this.order.length > 0 && (this.order[0] ?? Infinity) < tick) {
      const old = this.order.shift();
      if (old !== undefined) this.byTick.delete(old);
    }
  }

  get size(): number {
    return this.order.length;
  }
}

const allIndices = new WeakMap<EntitySchema, readonly number[]>();

/** Field indices carried on the wire for an entity kind (all fields unless the schema narrows that kind). */
export function kindFieldIndices(schema: EntitySchema, kind: number): readonly number[] {
  const narrowed = schema.kindFields?.[kind];
  if (narrowed) return narrowed;
  let all = allIndices.get(schema);
  if (!all) {
    all = schema.fields.map((_, i) => i);
    allIndices.set(schema, all);
  }
  return all;
}

function fieldAt(fields: readonly FieldSpec[], i: number): FieldSpec {
  const f = fields[i];
  if (f === undefined) throw new Error(`schema has no field ${i}`);
  return f;
}

function writeFull(w: BitWriter, f: FieldSpec, v: number): void {
  if (f.kind === 'int') w.writeSigned(v, f.bits);
  else w.writeBits(v, fieldBits(f));
}

function readFull(r: BitReader, f: FieldSpec): number {
  if (f.kind === 'int') return r.readSigned(f.bits);
  return r.readBits(fieldBits(f));
}

function fieldDelta(f: FieldSpec, from: number, to: number): number {
  if (f.kind === 'angle16') {
    let d = (to - from) % ANGLE_MOD;
    if (d >= ANGLE_MOD / 2) d -= ANGLE_MOD;
    if (d < -ANGLE_MOD / 2) d += ANGLE_MOD;
    return d;
  }
  return to - from;
}

function applyDelta(f: FieldSpec, from: number, d: number): number {
  if (f.kind === 'angle16') return (((from + d) % ANGLE_MOD) + ANGLE_MOD) % ANGLE_MOD;
  return from + d;
}

function fitsSigned(d: number, bits: number): boolean {
  // zigzag(d) must fit in `bits` bits
  const z = d >= 0 ? d * 2 : -d * 2 - 1;
  return z < 2 ** bits;
}

