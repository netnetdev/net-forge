// Client-side prediction and server reconciliation (Gambetta).
//
// The client applies each input to its local world the moment it is sampled
// and keeps it until the server acknowledges it. When a snapshot arrives, the
// predicted entity is reset to the server's state and every input the server
// has not yet applied is replayed on top. Input never waits for the round
// trip, and the result converges to the server's state.
//
// A correction (server disagreed) would snap the character; instead the
// visual position carries the error as an offset that decays over ~100 ms.

import type { EntityState } from './schema.js';
import type { InputCommand } from './input.js';
import type { PlayerId, SimAdapter } from './sim-adapter.js';

export class Predictor<W, I> {
  private readonly world: W;
  private pending: InputCommand<I>[] = [];
  private nextSeq = 1;
  private ready = false;
  private offsetX = 0;
  private offsetY = 0;
  /** Magnitude of the last correction in world units (telemetry/tests). */
  lastCorrection = 0;
  /** Count of reconciliations that moved the predicted entity. */
  corrections = 0;

  constructor(
    private readonly sim: SimAdapter<W, I>,
    private readonly player: PlayerId,
    private readonly selfEntity: number,
    seed = 0,
    firstSeq = 1,
  ) {
    this.world = sim.createWorld(seed, 'client');
    this.nextSeq = firstSeq;
  }

  /** The seq the next predicted command gets (a rebased predictor continues from here). */
  get upcomingSeq(): number {
    return this.nextSeq;
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** Applies one tick of input locally. Returns the command to send. */
  predict(input: I, viewTick16: number): InputCommand<I> | null {
    if (!this.ready) return null;
    const cmd: InputCommand<I> = { seq: this.nextSeq++, viewTick16, input };
    this.pending.push(cmd);
    // Bound memory if the server stops acking (disconnect): keep ~4 s at 60 Hz.
    if (this.pending.length > 240) this.pending.shift();
    this.sim.step(this.world, new Map([[this.player, [input]]]));
    return cmd;
  }

  /** Unacknowledged commands, oldest first. */
  unacked(): readonly InputCommand<I>[] {
    return this.pending;
  }

  reconcile(ackSeq: number, serverSelf: EntityState): void {
    const before = this.ready ? this.state() : null;
    this.pending = this.pending.filter((c) => c.seq > ackSeq);
    this.sim.applySnapshot(this.world, [serverSelf]);
    for (const c of this.pending) this.sim.step(this.world, new Map([[this.player, [c.input]]]));
    this.ready = true;
    if (!before) return;
    const after = this.state();
    if (!after) return;
    const xi = this.sim.schema.xField;
    const yi = this.sim.schema.yField;
    const ex = (before.values[xi] ?? 0) - (after.values[xi] ?? 0);
    const ey = (before.values[yi] ?? 0) - (after.values[yi] ?? 0);
    this.lastCorrection = Math.hypot(ex, ey) / this.sim.schema.unitsPerWorld;
    if (ex !== 0 || ey !== 0) {
      this.corrections++;
      this.offsetX += ex;
      this.offsetY += ey;
    }
  }

  /** The predicted entity, exact (what reconciliation converges on). */
  state(): EntityState | undefined {
    return this.sim.snapshot(this.world).find((e) => e.id === this.selfEntity);
  }

  /** The predicted entity with the correction offset applied, for drawing. */
  renderState(dtMs: number): EntityState | undefined {
    const s = this.state();
    if (!s) return undefined;
    const decay = Math.exp(-dtMs / 50);
    this.offsetX *= decay;
    this.offsetY *= decay;
    if (Math.abs(this.offsetX) < 0.01) this.offsetX = 0;
    if (Math.abs(this.offsetY) < 0.01) this.offsetY = 0;
    const values = [...s.values];
    const xi = this.sim.schema.xField;
    const yi = this.sim.schema.yField;
    values[xi] = (values[xi] ?? 0) + this.offsetX;
    values[yi] = (values[yi] ?? 0) + this.offsetY;
    return { ...s, values };
  }
}
