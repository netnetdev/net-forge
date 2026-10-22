// A deterministic simulated network for netcode tests: virtual clock,
// one-way latency, jitter (so packets reorder), and random loss. Models the
// unreliable-datagram case (WebTransport), which is strictly harder than the
// WebSocket case (in order, no loss, latency spikes instead).

export interface LinkOptions {
  /** Base one-way latency, ms. */
  readonly latencyMs: number;
  /** Uniform extra delay in [0, jitterMs). */
  readonly jitterMs: number;
  /** Probability a packet is dropped. */
  readonly loss: number;
}

interface InFlight {
  readonly at: number;
  readonly seq: number;
  readonly deliver: () => void;
}

export class VirtualNet {
  now = 0;
  private queue: InFlight[] = [];
  private seq = 0;
  private rng: number;
  sent = 0;
  dropped = 0;

  constructor(seed = 12345) {
    this.rng = seed;
  }

  random(): number {
    this.rng = (this.rng + 0x6d2b79f5) | 0;
    let t = this.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Sends over a link; `deliver` runs at arrival time unless dropped. */
  send(link: LinkOptions, deliver: () => void): void {
    this.sent++;
    if (this.random() < link.loss) {
      this.dropped++;
      return;
    }
    const at = this.now + link.latencyMs + this.random() * link.jitterMs;
    this.queue.push({ at, seq: this.seq++, deliver });
  }

  /** Advances the clock to `t`, delivering everything due, in arrival order. */
  advanceTo(t: number): void {
    for (;;) {
      let best = -1;
      for (let i = 0; i < this.queue.length; i++) {
        const q = this.queue[i];
        const b = best >= 0 ? this.queue[best] : undefined;
        if (q && q.at <= t && (!b || q.at < b.at || (q.at === b.at && q.seq < b.seq))) best = i;
      }
      if (best < 0) break;
      const [item] = this.queue.splice(best, 1);
      if (!item) break;
      this.now = item.at;
      item.deliver();
    }
    this.now = t;
  }
}
