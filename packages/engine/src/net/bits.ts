// Bit-level writer and reader for snapshots and input packets.
//
// Values are written LSB-first into a growable byte buffer. Every field in a
// snapshot is a fixed or schema-declared bit width, so nothing here allocates
// per field; the buffer doubles when it runs out.

export class BitWriter {
  private buf: Uint8Array;
  private bitPos = 0;

  constructor(initialBytes = 256) {
    this.buf = new Uint8Array(initialBytes);
  }

  /** Writes the low `bits` bits of `value` (0 <= bits <= 32). */
  writeBits(value: number, bits: number): void {
    if (bits <= 0) return;
    if (bits > 32) throw new RangeError(`writeBits: ${bits} > 32`);
    this.ensure(bits);
    let v = bits === 32 ? value >>> 0 : (value >>> 0) % 2 ** bits;
    let remaining = bits;
    while (remaining > 0) {
      const byteIndex = this.bitPos >>> 3;
      const bitOffset = this.bitPos & 7;
      const room = 8 - bitOffset;
      const take = remaining < room ? remaining : room;
      const chunk = v & ((1 << take) - 1);
      this.buf[byteIndex] = (this.buf[byteIndex] ?? 0) | (chunk << bitOffset);
      v = Math.floor(v / (1 << take));
      remaining -= take;
      this.bitPos += take;
    }
  }

  writeBool(b: boolean): void {
    this.writeBits(b ? 1 : 0, 1);
  }

  /** Signed integer in `bits` bits using zigzag encoding. */
  writeSigned(value: number, bits: number): void {
    this.writeBits(zigzag(value), bits);
  }

  /**
   * Unsigned varint in 4-bit groups with a continuation bit (5 bits per
   * group). Small counts (entity counts, id gaps) cost 5 bits, not 16.
   */
  writeVarUint(value: number): void {
    let v = value >>> 0;
    do {
      const group = v & 0xf;
      v >>>= 4;
      this.writeBits(group, 4);
      this.writeBool(v !== 0);
    } while (v !== 0);
  }

  get bitLength(): number {
    return this.bitPos;
  }

  finish(): Uint8Array {
    return this.buf.slice(0, (this.bitPos + 7) >>> 3);
  }

  private ensure(bits: number): void {
    const need = (this.bitPos + bits + 7) >>> 3;
    if (need <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < need) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf);
    this.buf = next;
  }
}

export class BitReader {
  private bitPos = 0;
  private readonly totalBits: number;

  constructor(private readonly buf: Uint8Array) {
    this.totalBits = buf.length * 8;
  }

  readBits(bits: number): number {
    if (bits <= 0) return 0;
    if (bits > 32) throw new RangeError(`readBits: ${bits} > 32`);
    if (this.bitPos + bits > this.totalBits) throw new RangeError('readBits: past end of buffer');
    let out = 0;
    let shift = 0;
    let remaining = bits;
    while (remaining > 0) {
      const byteIndex = this.bitPos >>> 3;
      const bitOffset = this.bitPos & 7;
      const room = 8 - bitOffset;
      const take = remaining < room ? remaining : room;
      const byte = this.buf[byteIndex] ?? 0;
      const chunk = (byte >>> bitOffset) & ((1 << take) - 1);
      out += chunk * 2 ** shift;
      shift += take;
      remaining -= take;
      this.bitPos += take;
    }
    return out;
  }

  readBool(): boolean {
    return this.readBits(1) === 1;
  }

  readSigned(bits: number): number {
    return unzigzag(this.readBits(bits));
  }

  readVarUint(): number {
    let out = 0;
    let shift = 0;
    for (;;) {
      const group = this.readBits(4);
      out += group * 2 ** shift;
      shift += 4;
      if (!this.readBool()) return out;
      if (shift > 32) throw new RangeError('readVarUint: too long');
    }
  }

  get remainingBits(): number {
    return this.totalBits - this.bitPos;
  }
}

export function zigzag(n: number): number {
  return n >= 0 ? n * 2 : -n * 2 - 1;
}

export function unzigzag(z: number): number {
  return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
}

/** Bits needed for a zigzagged signed value of magnitude up to `maxAbs`. */
export function bitsForSigned(maxAbs: number): number {
  return Math.max(1, Math.ceil(Math.log2(maxAbs * 2 + 2)));
}
