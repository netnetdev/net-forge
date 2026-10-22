// Transport-agnostic game client: decodes snapshots, predicts the local
// player, interpolates everyone else, and builds input packets. The browser
// demo, the headless load bots and the netcode tests all drive this class;
// the Colyseus wiring is only `send` and `receiveSnapshot`.

import { encodeInputPacket, REDUNDANCY } from './input.js';
import { InterpolationBuffer, ServerClock, type InterpolatedEntity } from './interpolation.js';
import { Predictor } from './prediction.js';
import { dequantizeValues, type EntityState } from './schema.js';
import type { PlayerId, SimAdapter } from './sim-adapter.js';
import { BaselineMissingError, decodeSnapshot, SnapshotHistory, type QEntity } from './snapshot.js';

export interface NetClientOptions {
  /** How far behind the server remote entities are drawn. Spec: ~100 ms. */
  readonly interpDelayMs: number;
  /** Server input-queue depth the client clock steers toward (one-input-per-tick sims). */
  readonly inputBufferTarget?: number;
  /**
   * First input seq. A client rebuilt after a room rebase continues the old
   * client's numbering (`nextSeq`), because the server's input queue ignores
   * seqs it has already seen.
   */
  readonly firstSeq?: number;
}

export const DEFAULT_CLIENT: NetClientOptions = { interpDelayMs: 100, inputBufferTarget: 2 };

export interface ClientStats {
  snapshots: number;
  snapshotBytes: number;
  inputPackets: number;
  inputBytes: number;
  baselineMisses: number;
  staleSnapshots: number;
}

export class NetClient<W, I> {
  private readonly history = new SnapshotHistory(64);
  private readonly interp: InterpolationBuffer;
  private readonly clock: ServerClock;
  private readonly predictor: Predictor<W, I>;
  private latestTick = 0;
  private latestSelf: QEntity | undefined;
  private lastRenderMs = 0;
  private readonly tickMs: number;
  /** Smoothed server input-queue depth from snapshot headers; null until reported. */
  private serverBuffer: number | null = null;
  readonly stats: ClientStats = {
    snapshots: 0,
    snapshotBytes: 0,
    inputPackets: 0,
    inputBytes: 0,
    baselineMisses: 0,
    staleSnapshots: 0,
  };

  constructor(
    private readonly sim: SimAdapter<W, I>,
    readonly player: PlayerId,
    readonly selfEntity: number,
    private readonly send: (bytes: Uint8Array) => void,
    private readonly opts: NetClientOptions = DEFAULT_CLIENT,
  ) {
    this.tickMs = 1000 / sim.tickHz;
    this.interp = new InterpolationBuffer(sim.schema);
    this.clock = new ServerClock(this.tickMs);
    this.predictor = new Predictor(sim, player, selfEntity, 0, opts.firstSeq ?? 1);
  }

  /** The seq the next input gets; pass as `firstSeq` to a client that replaces this one. */
  get nextSeq(): number {
    return this.predictor.upcomingSeq;
  }

  receiveSnapshot(bytes: Uint8Array, nowMs: number): void {
    let snap;
    try {
      snap = decodeSnapshot(this.sim.schema, bytes, (t) => this.history.get(t));
    } catch (err) {
      if (err instanceof BaselineMissingError) {
        // Ask for a full snapshot by acking nothing until one arrives.
        this.stats.baselineMisses++;
        this.latestTick = 0;
        return;
      }
      throw err;
    }
    this.stats.snapshots++;
    this.stats.snapshotBytes += bytes.length;
    const { header, entities } = snap;
    if (header.tick <= this.latestTick) {
      this.stats.staleSnapshots++;
      return;
    }
    this.latestTick = header.tick;
    if (header.inputBuffer !== undefined) {
      this.serverBuffer = this.serverBuffer === null ? header.inputBuffer : this.serverBuffer + (header.inputBuffer - this.serverBuffer) * 0.1;
    }
    this.history.put(header.tick, entities);
    this.clock.observe(header.tick, nowMs);
    this.interp.push(header.tick, entities);
    const self = entities.get(this.selfEntity);
    this.latestSelf = self;
    if (self) this.predictor.reconcile(header.ackSeq, this.toState(self));
  }

  /** Call once per sim tick with the sampled input. Sends the input packet. */
  tick(input: I, nowMs: number): void {
    const viewTick16 = Math.max(0, Math.round(this.renderTick(nowMs) * 16));
    this.predictor.predict(input, viewTick16);
    const pending = this.predictor.unacked();
    const commands = pending.slice(Math.max(0, pending.length - REDUNDANCY));
    const bytes = encodeInputPacket(this.sim.input, { ackTick: this.latestTick, commands });
    this.stats.inputPackets++;
    this.stats.inputBytes += bytes.length;
    this.send(bytes);
  }

  /**
   * Milliseconds until the next input tick. Equal to the sim tick when the
   * server reports no input queue; otherwise up to 8% shorter when the
   * server's queue for us runs below target (we are behind, so input would
   * starve) and up to 8% longer when it runs above (added latency). This is
   * the client clock adjustment for one-input-per-tick sims.
   */
  tickIntervalMs(): number {
    if (this.serverBuffer === null) return this.tickMs;
    const target = this.opts.inputBufferTarget ?? 2;
    const scale = 1 + Math.max(-0.08, Math.min(0.08, (this.serverBuffer - target) * 0.03));
    return this.tickMs * scale;
  }

  /** Smoothed input-queue depth the server last reported, or null. */
  get serverInputBuffer(): number | null {
    return this.serverBuffer;
  }

  /** Server tick (fractional) that remote entities are drawn at. */
  renderTick(nowMs: number): number {
    return this.clock.serverTick(nowMs) - this.opts.interpDelayMs / this.tickMs;
  }

  render(nowMs: number): { self: EntityState | undefined; others: InterpolatedEntity[] } {
    const dt = this.lastRenderMs === 0 ? 0 : nowMs - this.lastRenderMs;
    this.lastRenderMs = nowMs;
    return {
      self: this.predictor.renderState(dt),
      others: this.interp.sample(this.renderTick(nowMs), this.selfEntity),
    };
  }

  /** The newest server state of our own entity (what prediction is ahead of). */
  authoritativeSelf(): EntityState | undefined {
    return this.latestSelf ? this.toState(this.latestSelf) : undefined;
  }

  /** Our own entity drawn like a remote one (what you'd see with no prediction). */
  interpolatedSelf(nowMs: number): InterpolatedEntity | undefined {
    return this.interp.sample(this.renderTick(nowMs)).find((e) => e.id === this.selfEntity);
  }

  /** Exact predicted state (no smoothing). */
  predicted(): EntityState | undefined {
    return this.predictor.state();
  }

  get ready(): boolean {
    return this.predictor.isReady;
  }

  get corrections(): number {
    return this.predictor.corrections;
  }

  get lastCorrection(): number {
    return this.predictor.lastCorrection;
  }

  get pendingInputs(): number {
    return this.predictor.unacked().length;
  }

  private toState(e: QEntity): EntityState {
    return { id: e.id, kind: e.kind, owner: e.owner, values: dequantizeValues(this.sim.schema, e.q) };
  }
}
