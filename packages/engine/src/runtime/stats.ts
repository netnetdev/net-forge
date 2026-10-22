/** Rolling frame-time statistics (ms) over the last `size` frames. */
export class FrameStats {
  private readonly buf: Float64Array;
  private i = 0;
  private n = 0;
  constructor(size = 240) {
    this.buf = new Float64Array(size);
  }
  push(ms: number): void {
    this.buf[this.i] = ms;
    this.i = (this.i + 1) % this.buf.length;
    this.n = Math.min(this.n + 1, this.buf.length);
  }
  get count(): number {
    return this.n;
  }
  mean(): number {
    let s = 0;
    for (let k = 0; k < this.n; k++) s += this.buf[k] ?? 0;
    return this.n ? s / this.n : 0;
  }
  percentile(q: number): number {
    if (!this.n) return 0;
    const a = Array.from(this.buf.subarray(0, this.n)).sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.floor(q * (a.length - 1)))] ?? 0;
  }
}
