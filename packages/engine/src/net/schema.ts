// Per-entity field schema: how each networked value is quantized, packed and
// interpolated. A game (via its SimAdapter) declares one schema; the snapshot
// codec, the interpolation buffer and area-of-interest all read it.

export type FieldSpec =
  /** Integer in [0, 2^bits). Positions in fixed-point sub-units use this. */
  | { readonly name: string; readonly kind: 'uint'; readonly bits: number; readonly interp?: Interp; readonly deltaBits?: number }
  /** Signed integer, zigzag-packed in `bits` bits. */
  | { readonly name: string; readonly kind: 'int'; readonly bits: number; readonly interp?: Interp; readonly deltaBits?: number }
  /** Float quantized linearly into [min, max] with `bits` bits of precision. */
  | {
      readonly name: string;
      readonly kind: 'quant';
      readonly min: number;
      readonly max: number;
      readonly bits: number;
      readonly interp?: Interp;
      readonly deltaBits?: number;
    }
  /** Angle in radians packed into 16 bits (0..2π). Interpolates the short way. */
  | { readonly name: string; readonly kind: 'angle16'; readonly deltaBits?: number }
  /** One bit. Never interpolated. */
  | { readonly name: string; readonly kind: 'bool' };

export type Interp = 'lerp' | 'step';

export interface EntitySchema {
  readonly fields: readonly FieldSpec[];
  /** Index of the field holding x, used by area-of-interest and rewind. */
  readonly xField: number;
  /** Index of the field holding y. */
  readonly yField: number;
  /** Units of x/y per world unit (e.g. 32 for 1/32 fixed point). */
  readonly unitsPerWorld: number;
  /**
   * Optional per-kind field subsets, ascending field indices. An entity of a
   * listed kind carries only those fields on the wire (its change mask is
   * that many bits) and decodes with the rest as 0. Crowds of simple
   * entities (2,000 enemies) cost a few bits each this way. At most 32 per kind.
   */
  readonly kindFields?: Readonly<Record<number, readonly number[]>>;
}

/** One entity as the sim reports it: values are real (dequantized) numbers. */
export interface EntityState {
  readonly id: number;
  readonly kind: number;
  /** Player id that owns it, 0 for none. */
  readonly owner: number;
  readonly values: readonly number[];
}

const TWO_PI = Math.PI * 2;

export function fieldBits(f: FieldSpec): number {
  switch (f.kind) {
    case 'uint':
    case 'int':
    case 'quant':
      return f.bits;
    case 'angle16':
      return 16;
    case 'bool':
      return 1;
  }
}

/** Default bit width for a "small change" delta of a field, or 0 for none. */
export function fieldDeltaBits(f: FieldSpec): number {
  if (f.kind === 'bool') return 0;
  if (f.deltaBits !== undefined) return f.deltaBits;
  const b = fieldBits(f);
  return b >= 8 ? Math.max(4, Math.ceil(b / 2)) : 0;
}

/** Real value to the integer the wire carries. */
export function quantize(f: FieldSpec, v: number): number {
  switch (f.kind) {
    case 'uint': {
      const max = 2 ** f.bits - 1;
      return clamp(Math.round(v), 0, max);
    }
    case 'int': {
      const lim = 2 ** (f.bits - 1);
      return clamp(Math.round(v), -lim, lim - 1);
    }
    case 'quant': {
      const steps = 2 ** f.bits - 1;
      const t = (clamp(v, f.min, f.max) - f.min) / (f.max - f.min);
      return Math.round(t * steps);
    }
    case 'angle16': {
      const a = ((v % TWO_PI) + TWO_PI) % TWO_PI;
      return Math.round((a / TWO_PI) * 65536) & 0xffff;
    }
    case 'bool':
      return v ? 1 : 0;
  }
}

/** Wire integer back to the real value. */
export function dequantize(f: FieldSpec, q: number): number {
  switch (f.kind) {
    case 'uint':
    case 'int':
    case 'bool':
      return q;
    case 'quant': {
      const steps = 2 ** f.bits - 1;
      return f.min + (q / steps) * (f.max - f.min);
    }
    case 'angle16':
      return (q / 65536) * TWO_PI;
  }
}

/** Interpolate one field between a and b (real values). */
export function interpolateField(f: FieldSpec, a: number, b: number, t: number): number {
  switch (f.kind) {
    case 'bool':
      return t < 1 ? a : b;
    case 'angle16': {
      let d = (b - a) % TWO_PI;
      if (d > Math.PI) d -= TWO_PI;
      if (d < -Math.PI) d += TWO_PI;
      return a + d * t;
    }
    default:
      if (f.interp === 'step') return t < 1 ? a : b;
      return a + (b - a) * t;
  }
}

/**
 * Quantize an entity's values. With `only` (the kind's wire fields), the
 * other fields are left 0: they never go on the wire for that kind.
 */
export function quantizeEntity(schema: EntitySchema, e: EntityState, only?: readonly number[]): number[] {
  const n = schema.fields.length;
  if (only && only.length < n) {
    const out = new Array<number>(n).fill(0);
    for (const i of only) {
      const f = schema.fields[i];
      if (f === undefined) throw new Error('schema field missing');
      out[i] = quantize(f, e.values[i] ?? 0);
    }
    return out;
  }
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const f = schema.fields[i];
    if (f === undefined) throw new Error('schema field missing');
    out[i] = quantize(f, e.values[i] ?? 0);
  }
  return out;
}

export function dequantizeValues(schema: EntitySchema, q: readonly number[]): number[] {
  const out = new Array<number>(schema.fields.length);
  for (let i = 0; i < schema.fields.length; i++) {
    const f = schema.fields[i];
    if (f === undefined) throw new Error('schema field missing');
    out[i] = dequantize(f, q[i] ?? 0);
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
