// Sequence-numbered input commands.
//
// The client produces one command per local tick and sends, every tick, all
// commands the server has not yet acknowledged (capped at REDUNDANCY), so a
// lost packet is covered by the next one. The server queues commands in
// sequence order, ignores ones it already has, and consumes them at no more
// than one per tick on average (a credit bucket), which is what stops a
// modified client from moving faster by sending more inputs.

import { BitReader, BitWriter } from './bits.js';
import type { InputCodec } from './sim-adapter.js';

export interface InputCommand<I> {
  readonly seq: number;
  /** Render tick the client was showing when it sampled this input, x16. */
  readonly viewTick16: number;
  readonly input: I;
}

export interface InputPacket<I> {
  /** Highest snapshot tick the client has decoded (its delta baseline). */
  readonly ackTick: number;
  readonly commands: readonly InputCommand<I>[];
}

/** How many unacked commands each packet repeats. */
export const REDUNDANCY = 4;

export function encodeInputPacket<I>(codec: InputCodec<I>, p: InputPacket<I>): Uint8Array {
  const w = new BitWriter(64);
  w.writeBits(p.ackTick, 32);
  w.writeVarUint(p.commands.length);
  const first = p.commands[0];
  if (first) {
    w.writeBits(first.seq, 32);
    w.writeBits(first.viewTick16, 32);
  }
  let prevView = first?.viewTick16 ?? 0;
  for (let i = 0; i < p.commands.length; i++) {
    const c = p.commands[i];
    if (!c) continue;
    if (first && c.seq !== first.seq + i) throw new Error('input commands must have consecutive seqs');
    if (i > 0) {
      w.writeSigned(c.viewTick16 - prevView, 16);
      prevView = c.viewTick16;
    }
    codec.write(w, c.input);
  }
  return w.finish();
}

export function decodeInputPacket<I>(codec: InputCodec<I>, bytes: Uint8Array): InputPacket<I> {
  const r = new BitReader(bytes);
  const ackTick = r.readBits(32);
  const n = r.readVarUint();
  if (n > 64) throw new Error('input packet: too many commands');
  const commands: InputCommand<I>[] = [];
  if (n > 0) {
    const firstSeq = r.readBits(32);
    let view = r.readBits(32);
    for (let i = 0; i < n; i++) {
      if (i > 0) view += r.readSigned(16);
      commands.push({ seq: firstSeq + i, viewTick16: view, input: codec.read(r) });
    }
  }
  return { ackTick, commands };
}

export interface InputQueueOptions {
  /** Most commands waiting at once; extra are dropped (client gets corrected). */
  readonly maxQueue: number;
  /** Credit bucket size: how far a player may catch up after a stall. */
  readonly maxCredits: number;
  /**
   * Jitter buffer for one-input-per-tick sims: after the queue runs dry, hold
   * input until this many commands are waiting, then resume one per tick.
   * 0 (default) consumes as soon as anything arrives. Clients hold the depth
   * near this target with `NetClient.tickIntervalMs()`.
   */
  readonly targetDepth?: number;
}

export const DEFAULT_INPUT_QUEUE: InputQueueOptions = { maxQueue: 16, maxCredits: 6 };

/** Server-side per-player input queue with speed-hack protection. */
export class InputQueue<I> {
  private readonly queue: InputCommand<I>[] = [];
  private lastQueuedSeq = 0;
  private credits = 1;
  /** Highest seq applied by the sim; echoed to the client as ackSeq. */
  lastAppliedSeq = 0;
  /** Commands dropped because the queue was full (telemetry). */
  dropped = 0;
  /** Ticks the queue was empty when the sim needed a command (telemetry). */
  starved = 0;
  private refilling = true;

  constructor(private readonly opts: InputQueueOptions = DEFAULT_INPUT_QUEUE) {}

  receive(commands: readonly InputCommand<I>[]): void {
    for (const c of commands) {
      if (c.seq <= this.lastQueuedSeq) continue;
      if (this.queue.length >= this.opts.maxQueue) {
        this.dropped++;
        this.lastQueuedSeq = c.seq;
        continue;
      }
      this.queue.push(c);
      this.lastQueuedSeq = c.seq;
    }
  }

  /** Commands to apply this tick (0..maxCredits of them). */
  consume(): InputCommand<I>[] {
    const target = this.opts.targetDepth ?? 0;
    if (target > 0) {
      if (this.queue.length === 0) {
        if (!this.refilling && this.lastAppliedSeq > 0) this.starved++;
        this.refilling = true;
        return [];
      }
      if (this.refilling && this.queue.length < target) return [];
      this.refilling = false;
    }
    this.credits = Math.min(this.credits + 1, this.opts.maxCredits);
    const n = Math.min(this.queue.length, Math.floor(this.credits));
    if (n === 0) return [];
    this.credits -= n;
    const out = this.queue.splice(0, n);
    const last = out[out.length - 1];
    if (last) this.lastAppliedSeq = last.seq;
    return out;
  }

  get pending(): number {
    return this.queue.length;
  }
}
