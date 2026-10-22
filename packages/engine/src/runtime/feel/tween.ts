/**
 * Juicy UI tweens: a tiny tween manager with an easing table, and DOM
 * helpers (pop, shake, count up) built on it. The helpers use the CSS
 * `scale` and `translate` properties, so they never fight a transform the
 * page already sets.
 */
export type EaseFn = (t: number) => number;

const c1 = 1.70158;
const c3 = c1 + 1;
const bounce = (t: number): number => {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};

export const Ease = {
  linear: (t: number) => t,
  quadIn: (t: number) => t * t,
  quadOut: (t: number) => 1 - (1 - t) * (1 - t),
  quadInOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  cubicOut: (t: number) => 1 - Math.pow(1 - t, 3),
  cubicInOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  sineInOut: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  expoOut: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  backOut: (t: number) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
  elasticOut: (t: number) =>
    t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  bounceOut: bounce,
} as const satisfies Record<string, EaseFn>;

export type EaseName = keyof typeof Ease;

export interface TweenOptions {
  /** Seconds. */
  readonly duration: number;
  readonly ease?: EaseName | EaseFn;
  /** Seconds before it starts (start values are read when it starts). */
  readonly delay?: number;
  /** Play back to the start after each forward play. */
  readonly yoyo?: boolean;
  /** Extra plays after the first (-1 forever). Default 0. */
  readonly repeat?: number;
  readonly onUpdate?: () => void;
  readonly onDone?: () => void;
}

type NumericKeys<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];
export type TweenProps<T> = Partial<Record<NumericKeys<T>, number>>;

interface Running {
  id: number;
  target: Record<string, unknown>;
  keys: string[];
  from: number[];
  to: number[];
  started: boolean;
  delay: number;
  elapsed: number;
  duration: number;
  ease: EaseFn;
  yoyo: boolean;
  repeatsLeft: number;
  forward: boolean;
  onUpdate: (() => void) | undefined;
  onDone: (() => void) | undefined;
}

export class Tweens {
  private list: Running[] = [];
  private nextId = 1;

  /** Tween numeric properties of `target` to `props`. Returns a handle for `cancel`. */
  to<T extends object>(target: T, props: TweenProps<T>, opts: TweenOptions): number {
    const keys = Object.keys(props);
    const rec = target as unknown as Record<string, unknown>;
    const to = keys.map((k) => Number((props as Record<string, unknown>)[k]));
    const ease = typeof opts.ease === "function" ? opts.ease : Ease[opts.ease ?? "cubicOut"];
    const id = this.nextId++;
    this.list.push({
      id,
      target: rec,
      keys,
      from: keys.map(() => 0),
      to,
      started: false,
      delay: Math.max(0, opts.delay ?? 0),
      elapsed: 0,
      duration: Math.max(1e-4, opts.duration),
      ease,
      yoyo: opts.yoyo === true,
      repeatsLeft: opts.repeat ?? 0,
      forward: true,
      onUpdate: opts.onUpdate,
      onDone: opts.onDone,
    });
    return id;
  }

  /** Stop a tween by handle, or every tween on a target object. Values stay where they are. */
  cancel(handleOrTarget: number | object): void {
    this.list = this.list.filter((r) => (typeof handleOrTarget === "number" ? r.id !== handleOrTarget : r.target !== handleOrTarget));
  }

  /** Tweens running or waiting. */
  get active(): number {
    return this.list.length;
  }

  tick(dt: number): void {
    if (dt <= 0 || this.list.length === 0) return;
    const done: Running[] = [];
    for (const r of this.list) {
      let left = dt;
      if (r.delay > 0) {
        const d = Math.min(r.delay, left);
        r.delay -= d;
        left -= d;
        if (r.delay > 0) continue;
      }
      if (!r.started) {
        r.started = true;
        r.from = r.keys.map((k) => Number(r.target[k] ?? 0));
      }
      r.elapsed += left;
      while (r.elapsed >= r.duration) {
        // A play finished: decide the next one.
        if (r.repeatsLeft === 0 && (!r.yoyo || !r.forward)) break;
        if (r.yoyo && r.forward) {
          r.forward = false;
        } else {
          if (r.repeatsLeft > 0) r.repeatsLeft--;
          r.forward = true;
        }
        r.elapsed -= r.duration;
      }
      const finished = r.elapsed >= r.duration;
      const p = Math.min(1, r.elapsed / r.duration);
      const e = r.ease(r.forward ? p : 1 - p);
      for (let i = 0; i < r.keys.length; i++) {
        const a = r.from[i] ?? 0;
        const b = r.to[i] ?? 0;
        r.target[r.keys[i] as string] = finished ? (r.forward ? b : a) : a + (b - a) * e;
      }
      r.onUpdate?.();
      if (finished) done.push(r);
    }
    if (done.length > 0) {
      this.list = this.list.filter((r) => !done.includes(r));
      for (const r of done) r.onDone?.();
    }
  }
}

/** The shared UI tween manager. It drives itself on requestAnimationFrame in a browser; call `uiTweens.tick(dt)` elsewhere. */
export const uiTweens = new Tweens();
let rafOn = false;
let rafLast = 0;
function ensureLoop(): void {
  if (rafOn || typeof requestAnimationFrame === "undefined") return;
  rafOn = true;
  rafLast = 0;
  const loop = (t: number) => {
    const dt = rafLast === 0 ? 1 / 60 : Math.min(0.1, (t - rafLast) / 1000);
    rafLast = t;
    uiTweens.tick(dt);
    if (uiTweens.active > 0) requestAnimationFrame(loop);
    else rafOn = false;
  };
  requestAnimationFrame(loop);
}

/** A minimal element: anything with a style and text (real elements, or fakes in tests). */
export interface FeelElement {
  readonly style: { scale: string; translate: string };
  textContent: string | null;
}

const states = new WeakMap<object, { s: number; dx: number }>();
function stateOf(el: object): { s: number; dx: number } {
  let st = states.get(el);
  if (!st) {
    st = { s: 1, dx: 0 };
    states.set(el, st);
  }
  return st;
}

/** Punch an element's scale up to `scale` and spring it back (level-up, coin gain). */
export function pop(el: FeelElement, scale = 1.25, ms = 260, tweens: Tweens = uiTweens): void {
  const st = stateOf(el);
  tweens.cancel(st);
  st.s = scale;
  el.style.scale = String(scale);
  tweens.to(st, { s: 1 }, { duration: ms / 1000, ease: "backOut", onUpdate: () => (el.style.scale = st.s.toFixed(4)) });
  if (tweens === uiTweens) ensureLoop();
}

/** Shake an element sideways by up to `px`, decaying over `ms` (denied action, damage taken). */
export function shakeEl(el: FeelElement, px = 6, ms = 280, tweens: Tweens = uiTweens): void {
  const st = stateOf(el);
  const prog = { t: 0 };
  tweens.to(prog, { t: 1 }, {
    duration: ms / 1000,
    ease: "linear",
    onUpdate: () => {
      st.dx = Math.sin(prog.t * Math.PI * 9) * px * (1 - prog.t);
      el.style.translate = `${st.dx.toFixed(2)}px 0`;
    },
    onDone: () => {
      st.dx = 0;
      el.style.translate = "";
    },
  });
  if (tweens === uiTweens) ensureLoop();
}

/** Count a number up in an element's text (scores, balances). */
export function countUp(
  el: FeelElement,
  from: number,
  to: number,
  ms = 600,
  format: (n: number) => string = (n) => String(Math.round(n)),
  tweens: Tweens = uiTweens,
): void {
  const v = { n: from };
  el.textContent = format(from);
  tweens.to(v, { n: to }, { duration: ms / 1000, ease: "expoOut", onUpdate: () => (el.textContent = format(v.n)) });
  if (tweens === uiTweens) ensureLoop();
}
