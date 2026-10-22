/**
 * Floating damage numbers. `NumberStack` is the DOM-free core (slots,
 * merging, motion); `DamageNumbers` draws it with a fixed pool of DOM nodes
 * moved by transforms only (no layout per frame).
 */

export interface NumberInput {
  /** Screen position in CSS pixels. */
  readonly x: number;
  readonly y: number;
  readonly amount: number;
  /** Entity id: rapid hits on one id merge into one growing number. */
  readonly id?: number;
  /** Big hits (bosses, crits) pop larger. */
  readonly big?: boolean;
  /** A colour key ("damage", "crit", "heal", "xp", ...) mapped by DamageNumbers. */
  readonly kind?: string;
}

export interface NumberSlot {
  active: boolean;
  id: number;
  amount: number;
  /** 0..1 through its life. */
  t: number;
  x: number;
  y: number;
  /** Sideways drift, px over the whole life. */
  drift: number;
  big: boolean;
  kind: string;
  /** When it was last added to (ms, the caller's clock). */
  at: number;
  /** Generation, bumped on reuse (renderers compare it to restyle). */
  gen: number;
}

export interface NumberStackOptions {
  /** Hits on the same id within this many ms merge. Default 120. */
  readonly mergeMs?: number;
  /** Seconds a number lives. Default 0.75. */
  readonly lifeSeconds?: number;
  /** Rise over its life, px. Default 34. */
  readonly rise?: number;
}

export interface NumberDraw {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly opacity: number;
}

const DRIFT = [-14, 9, -5, 13, -10, 4, 11, -7];

export class NumberStack {
  readonly slots: NumberSlot[];
  /** Numbers shown (merges do not count). */
  shown = 0;
  merged = 0;
  private readonly o: Required<NumberStackOptions>;
  private seq = 0;

  constructor(capacity = 48, opts: NumberStackOptions = {}) {
    this.o = { mergeMs: 120, lifeSeconds: 0.75, rise: 34, ...opts };
    this.slots = Array.from({ length: Math.max(1, capacity) }, () => ({
      active: false, id: -1, amount: 0, t: 1, x: 0, y: 0, drift: 0, big: false, kind: "damage", at: 0, gen: 0,
    }));
  }

  /** Add a number; returns its slot index and whether it merged into an existing one. */
  add(nowMs: number, n: NumberInput): { index: number; merged: boolean } {
    const id = n.id ?? -1;
    if (id >= 0) {
      for (let i = 0; i < this.slots.length; i++) {
        const s = this.slots[i] as NumberSlot;
        if (s.active && s.id === id && nowMs - s.at <= this.o.mergeMs && s.kind === (n.kind ?? "damage")) {
          s.amount += n.amount;
          s.at = nowMs;
          s.x = n.x;
          s.y = n.y;
          s.big = s.big || n.big === true;
          // Re-pop without restarting the fade completely.
          s.t = Math.min(s.t, 0.08);
          this.merged++;
          return { index: i, merged: true };
        }
      }
    }
    // A free slot, else recycle the oldest (cap on screen).
    let index = -1;
    let oldest = -1;
    let oldestT = -1;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i] as NumberSlot;
      if (!s.active) {
        index = i;
        break;
      }
      if (s.t > oldestT) {
        oldestT = s.t;
        oldest = i;
      }
    }
    if (index < 0) index = oldest;
    const s = this.slots[index] as NumberSlot;
    s.active = true;
    s.id = id;
    s.amount = n.amount;
    s.t = 0;
    s.x = n.x;
    s.y = n.y;
    s.drift = DRIFT[this.seq++ % DRIFT.length] ?? 0;
    s.big = n.big === true;
    s.kind = n.kind ?? "damage";
    s.at = nowMs;
    s.gen++;
    this.shown++;
    return { index, merged: false };
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const k = dt / this.o.lifeSeconds;
    for (const s of this.slots) {
      if (!s.active) continue;
      s.t = Math.min(1, s.t + k);
      if (s.t >= 1) s.active = false;
    }
  }

  /** Where and how to draw a slot: an arc (rise with ease-out, sideways drift), a pop, then a fade. */
  draw(s: NumberSlot): NumberDraw {
    const t = s.t;
    const rise = this.o.rise * (1 - (1 - t) * (1 - t)) * (s.big ? 1.3 : 1);
    const pop = t < 0.12 ? 1 + (0.12 - t) * (s.big ? 7 : 4.5) : 1;
    const base = s.big ? 1.35 : 1;
    return {
      x: s.x + s.drift * t,
      y: s.y - rise,
      scale: base * pop,
      opacity: t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4,
    };
  }

  get active(): number {
    let n = 0;
    for (const s of this.slots) if (s.active) n++;
    return n;
  }
}

export interface DamageNumbersOptions extends NumberStackOptions {
  /** Pool size (most numbers on screen). Default 48. */
  readonly capacity?: number;
  /** Class on every node (style it in the template). Default "dmg"; big ones also get "big". */
  readonly className?: string;
  /** Colour per kind (CSS colours). */
  readonly colors?: Readonly<Record<string, string>>;
  /** Number formatting. Default rounds. */
  readonly format?: (amount: number) => string;
}

/** The DOM pool. Construct only in a browser (it creates nodes under `host`). */
export class DamageNumbers {
  readonly stack: NumberStack;
  private readonly els: { el: HTMLElement; gen: number; amount: number; shown: boolean }[] = [];
  private readonly colors: Readonly<Record<string, string>>;
  private readonly format: (amount: number) => string;
  private readonly cls: string;

  constructor(host: HTMLElement, opts: DamageNumbersOptions | number = {}) {
    const o: DamageNumbersOptions = typeof opts === "number" ? { capacity: opts } : opts;
    this.stack = new NumberStack(o.capacity ?? 48, o);
    this.colors = o.colors ?? {};
    this.format = o.format ?? ((a) => String(Math.round(a)));
    this.cls = o.className ?? "dmg";
    const doc = host.ownerDocument ?? (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    for (let i = 0; i < this.stack.slots.length; i++) {
      const el = doc.createElement("div");
      el.className = this.cls;
      el.style.opacity = "0";
      el.style.willChange = "transform, opacity";
      host.append(el);
      this.els.push({ el, gen: -1, amount: Number.NaN, shown: false });
    }
  }

  /** Numbers shown so far (playtest counters). */
  get shown(): number {
    return this.stack.shown;
  }

  /** The classic call: show(x, y, amount, big). */
  show(x: number, y: number, amount: number, big = false): void {
    this.add({ x, y, amount, big });
  }

  add(n: NumberInput, nowMs: number = typeof performance !== "undefined" ? performance.now() : Date.now()): void {
    this.stack.add(nowMs, n);
  }

  update(dt: number): void {
    this.stack.update(dt);
    const slots = this.stack.slots;
    for (let i = 0; i < this.els.length; i++) {
      const r = this.els[i];
      const s = slots[i];
      if (!r || !s) continue;
      if (!s.active) {
        if (r.shown) {
          r.el.style.opacity = "0";
          r.shown = false;
        }
        continue;
      }
      if (r.gen !== s.gen) {
        r.gen = s.gen;
        r.el.className = s.big ? `${this.cls} big` : this.cls;
        if (s.kind !== "damage") r.el.classList.add(s.kind);
        r.el.style.color = this.colors[s.kind] ?? "";
      }
      if (r.amount !== s.amount) {
        r.amount = s.amount;
        r.el.textContent = this.format(s.amount);
      }
      const d = this.stack.draw(s);
      r.shown = true;
      r.el.style.opacity = d.opacity.toFixed(3);
      r.el.style.transform = `translate(${d.x.toFixed(1)}px, ${d.y.toFixed(1)}px) translate(-50%, -50%) scale(${d.scale.toFixed(3)})`;
    }
  }
}
