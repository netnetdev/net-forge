/** FNV-1a over the raw IEEE-754 bits of numbers: two states hash equal only when every bit matches. */
export class BitHash {
  private h = 0x811c9dc5;
  private readonly f = new Float64Array(1);
  private readonly u = new Uint32Array(this.f.buffer);

  private word(w: number): void {
    let h = this.h;
    for (let i = 0; i < 4; i++) {
      h ^= (w >>> (i * 8)) & 0xff;
      h = Math.imul(h, 0x01000193);
    }
    this.h = h >>> 0;
  }

  num(v: number): this {
    // Fold -0 and NaN payloads so equal values hash equal.
    this.f[0] = v === 0 ? 0 : Number.isNaN(v) ? Number.NaN : v;
    this.word(this.u[0] ?? 0);
    this.word(this.u[1] ?? 0);
    return this;
  }

  int(v: number): this {
    this.word(v >>> 0);
    return this;
  }

  bool(v: boolean): this {
    this.word(v ? 1 : 0);
    return this;
  }

  bytes(b: Uint8Array): this {
    let h = this.h;
    for (let i = 0; i < b.length; i++) {
      h ^= b[i] ?? 0;
      h = Math.imul(h, 0x01000193);
    }
    this.h = h >>> 0;
    return this;
  }

  get value(): number {
    return this.h >>> 0;
  }
}
