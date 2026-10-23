// The local play host's authoritative loop: one world, a fixed tick, one
// input queue per player and per-player delta snapshots, built only from
// the engine's open netcode (@netforge/engine/net). It is written for
// one computer: no lag compensation history (hitscans resolve against the
// current hitboxes, which is exact at local latency), no run log, no
// replay, and nothing that pays anyone.

import {
  decodeInputPacket,
  DEFAULT_INPUT_QUEUE,
  encodeSnapshot,
  InputQueue,
  kindFieldIndices,
  quantizeEntity,
  SnapshotHistory,
  type EntityState,
  type Hitbox,
  type HitscanRequest,
  type InputCommand,
  type PlayerId,
  type PlayerRights,
  type QEntity,
  type SimAdapter,
  type SimCommand,
  type SimEvent,
} from "@netforge/engine/net";

/** What each player is sent: everything within `radius` of them (world units), nearest first, up to the caps. */
export interface LocalAoi {
  readonly radius: number;
  readonly maxEntities: number;
  /** Most entities of one kind (EntityKind number) a snapshot carries. */
  readonly kindCaps?: Readonly<Record<number, number>>;
  /** Kinds every player always receives (players, so the HUD sees teammates). */
  readonly alwaysKinds?: readonly number[];
}

export const SNAPSHOT_HZ = 20;
/** Jitter-buffer depth for one-input-per-tick sims (the room server's default). */
const ONE_PER_TICK_DEPTH = 2;

interface Conn<I> {
  readonly player: PlayerId;
  entity: number;
  readonly queue: InputQueue<I>;
  history: SnapshotHistory;
  ackTick: number;
}

export interface LocalTick {
  readonly tick: number;
  readonly events: readonly SimEvent[];
  readonly snapshots: ReadonlyMap<PlayerId, Uint8Array>;
}

/** Distance along a unit ray to a circle, or null. */
export function rayCircle(ox: number, oy: number, ux: number, uy: number, cx: number, cy: number, r: number): number | null {
  const mx = ox - cx;
  const my = oy - cy;
  const b = mx * ux + my * uy;
  const c = mx * mx + my * my - r * r;
  if (c > 0 && b > 0) return null;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}

/** The nearest hitbox a hitscan meets that the shooter does not own, or null. */
export function resolveHitscan(boxes: readonly Hitbox[], req: HitscanRequest): Hitbox | null {
  const len = Math.hypot(req.dx, req.dy);
  if (len === 0) return null;
  const ux = req.dx / len;
  const uy = req.dy / len;
  let best: Hitbox | null = null;
  let bestT = Infinity;
  for (const h of boxes) {
    if (h.owner === req.shooter) continue;
    const t = rayCircle(req.ox, req.oy, ux, uy, h.x, h.y, h.r);
    if (t !== null && t <= req.range && t < bestT) {
      bestT = t;
      best = h;
    }
  }
  return best;
}

export class LocalCore<W, I> {
  private worldRef: W;
  private tickN = 0;
  private snapAccum = 0;
  private readonly conns = new Map<PlayerId, Conn<I>>();
  private readonly rights = new Map<PlayerId, PlayerRights>();
  private nextPlayer = 1;
  private readonly freeIds: PlayerId[] = [];
  private boxes: readonly Hitbox[] = [];

  constructor(
    private readonly sim: SimAdapter<W, I>,
    private readonly aoi: LocalAoi,
    seed: number,
  ) {
    this.worldRef = sim.createWorld(seed, "server");
  }

  get world(): W {
    return this.worldRef;
  }

  get tick(): number {
    return this.tickN;
  }

  get players(): PlayerId[] {
    return [...this.conns.keys()];
  }

  addPlayer(): { player: PlayerId; entity: number } {
    const player = this.freeIds.shift() ?? this.nextPlayer++;
    if (player > 0xffff) throw new Error("player ids exhausted");
    const entity = this.sim.addPlayer(this.worldRef, player);
    this.conns.set(player, {
      player,
      entity,
      queue: new InputQueue<I>({
        ...DEFAULT_INPUT_QUEUE,
        maxCredits: Math.min(DEFAULT_INPUT_QUEUE.maxCredits, this.sim.maxInputsPerTick ?? Infinity),
        ...(this.sim.maxInputsPerTick === 1 ? { targetDepth: ONE_PER_TICK_DEPTH } : {}),
      }),
      history: new SnapshotHistory(64),
      ackTick: 0,
    });
    return { player, entity };
  }

  removePlayer(player: PlayerId): void {
    if (!this.conns.delete(player)) return;
    this.rights.delete(player);
    this.sim.removePlayer(this.worldRef, player);
    this.freeIds.push(player);
  }

  setRights(player: PlayerId, rights: PlayerRights | null): void {
    if (!this.conns.has(player)) return;
    if (rights) this.rights.set(player, rights);
    else this.rights.delete(player);
  }

  command(player: PlayerId, cmd: SimCommand): boolean {
    if (!this.sim.command || !this.conns.has(player)) return false;
    return this.sim.command(this.worldRef, player, cmd);
  }

  startRun(player: PlayerId): void {
    if (this.conns.has(player)) this.sim.startRun?.(this.worldRef, player);
  }

  receiveInput(player: PlayerId, bytes: Uint8Array): void {
    const c = this.conns.get(player);
    if (!c) return;
    let pkt;
    try {
      pkt = decodeInputPacket(this.sim.input, bytes);
    } catch {
      return;
    }
    if (pkt.ackTick > c.ackTick && pkt.ackTick <= this.tickN) c.ackTick = pkt.ackTick;
    else if (pkt.ackTick === 0) c.ackTick = 0;
    const rights = this.rights.get(player);
    const restrict = this.sim.restrictInput;
    c.queue.receive(rights && restrict ? pkt.commands.map((cmd: InputCommand<I>) => ({ ...cmd, input: restrict.call(this.sim, cmd.input, rights) })) : pkt.commands);
  }

  step(): LocalTick {
    this.tickN++;
    const events: SimEvent[] = [];
    const inputs = new Map<PlayerId, I[]>();
    for (const c of this.conns.values()) {
      const list: I[] = [];
      for (const cmd of c.queue.consume()) {
        const req = this.sim.hitscans?.(this.worldRef, c.player, cmd.input) ?? null;
        if (req && this.sim.applyHit) {
          const hit = resolveHitscan(this.boxes, req);
          if (hit) events.push(...this.sim.applyHit(this.worldRef, c.player, hit));
        }
        list.push(cmd.input);
      }
      inputs.set(c.player, list);
    }
    events.push(...this.sim.step(this.worldRef, inputs));
    if (this.sim.hitboxes) this.boxes = this.sim.hitboxes(this.worldRef);
    this.snapAccum += SNAPSHOT_HZ / this.sim.tickHz;
    let snapshots: ReadonlyMap<PlayerId, Uint8Array> = new Map();
    if (this.snapAccum >= 1) {
      this.snapAccum -= 1;
      snapshots = this.buildSnapshots();
    }
    return { tick: this.tickN, events, snapshots };
  }

  /** A fresh world at a run boundary; every player is re-added under the same id. Returns the new entity ids. */
  rebase(seed: number): Map<PlayerId, number> {
    this.sim.disposeWorld?.(this.worldRef);
    this.worldRef = this.sim.createWorld(seed, "server");
    this.boxes = [];
    const out = new Map<PlayerId, number>();
    for (const c of this.conns.values()) {
      c.entity = this.sim.addPlayer(this.worldRef, c.player);
      c.history = new SnapshotHistory(64);
      c.ackTick = 0;
      out.set(c.player, c.entity);
    }
    return out;
  }

  dispose(): void {
    this.sim.disposeWorld?.(this.worldRef);
  }

  private buildSnapshots(): Map<PlayerId, Uint8Array> {
    const schema = this.sim.schema;
    const upw = schema.unitsPerWorld;
    const states = this.sim.snapshot(this.worldRef);
    const byId = new Map<number, EntityState>();
    for (const s of states) byId.set(s.id, s);
    const packed = new Map<number, QEntity>();
    const qOf = (s: EntityState): QEntity => {
      let q = packed.get(s.id);
      if (!q) {
        q = { id: s.id, kind: s.kind, owner: s.owner, q: quantizeEntity(schema, s, kindFieldIndices(schema, s.kind)) };
        packed.set(s.id, q);
      }
      return q;
    };
    const { radius, maxEntities, kindCaps, alwaysKinds } = this.aoi;
    const out = new Map<PlayerId, Uint8Array>();
    for (const c of this.conns.values()) {
      const self = byId.get(c.entity);
      const visible: QEntity[] = [];
      if (self) {
        const x = (self.values[schema.xField] ?? 0) / upw;
        const y = (self.values[schema.yField] ?? 0) / upw;
        const seen = new Set<number>([self.id]);
        visible.push(qOf(self));
        if (alwaysKinds) {
          for (const e of states) {
            if (!seen.has(e.id) && alwaysKinds.includes(e.kind)) {
              seen.add(e.id);
              visible.push(qOf(e));
            }
          }
        }
        const near: Array<{ e: EntityState; d: number }> = [];
        for (const e of states) {
          if (seen.has(e.id)) continue;
          const dx = (e.values[schema.xField] ?? 0) / upw - x;
          const dy = (e.values[schema.yField] ?? 0) / upw - y;
          const d = dx * dx + dy * dy;
          if (d <= radius * radius) near.push({ e, d });
        }
        near.sort((a, b) => a.d - b.d);
        const used = new Map<number, number>();
        for (const { e } of near) {
          if (visible.length >= maxEntities) break;
          const cap = kindCaps?.[e.kind];
          const n = used.get(e.kind) ?? 0;
          if (cap !== undefined && n >= cap) continue;
          used.set(e.kind, n + 1);
          visible.push(qOf(e));
        }
      }
      const baseline = c.ackTick > 0 ? (c.history.get(c.ackTick) ?? null) : null;
      const bytes = encodeSnapshot(
        schema,
        {
          tick: this.tickN,
          baselineTick: baseline ? c.ackTick : 0,
          ackSeq: c.queue.lastAppliedSeq,
          self: c.entity,
          ...(this.sim.maxInputsPerTick === 1 ? { inputBuffer: c.queue.pending } : {}),
        },
        visible,
        baseline,
      );
      c.history.put(this.tickN, visible);
      c.history.pruneBefore(c.ackTick);
      out.set(c.player, bytes);
    }
    return out;
  }
}
