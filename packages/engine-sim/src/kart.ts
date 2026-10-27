/**
 * Kart mode: arcade vehicle physics on a closed track (template "racer").
 *
 * Pure TypeScript on a 1/1024 grid, like the platform mode, so a predicting
 * client replays its own kart exactly (its only inputs are its own commands
 * and the static track). The track is a closed centreline (Catmull-Rom
 * through control points, sampled every ~2 m) with a width: asphalt inside,
 * a grass band that slows you, then walls that bounce you back.
 *
 * The model: velocity is split into a forward and a sideways part each
 * tick. The engine pushes the forward part toward top speed, grip bleeds
 * the sideways part away (a lot on asphalt, a little while drifting), and
 * steering turns the kart with speed. Holding drift while steering through
 * a bend slides the kart and charges a mini-turbo: release it for a boost
 * (three tiers, by how long you held it). Boost pads and coins (each kart
 * collects its own; every coin held adds 1% top speed, up to 10) sit on the
 * track. Laps count only through the four quarter checkpoints in order, so
 * nobody laps by reversing over the line.
 *
 * Kart-to-kart bumps run only on the authority (the room server): a client
 * predicts its own kart alone, and the next snapshot corrects a bump.
 */
import { Button } from "./api.js";
import type { InputCommand } from "./api.js";
import { quantizeInput } from "./input.js";

export interface KartTrackDef {
  /** Control points [x, z] of the closed centreline, in driving order. */
  readonly points: readonly (readonly [number, number])[];
  /** Asphalt width, m. */
  readonly width: number;
  readonly laps: number;
  /** Boost pads: [lap fraction 0..1, lateral -1..1 of the half width]. */
  readonly boosts: readonly (readonly [number, number])[];
  /** Coins: [lap fraction, lateral]. At most 62. */
  readonly coins: readonly (readonly [number, number])[];
  /** Grass between the asphalt edge and the wall, m. Default 4. */
  readonly verge?: number;
}

/** A track, sampled. */
export interface KartTrack {
  readonly def: KartTrackDef;
  /** Sample positions along the centreline (closed: the last joins the first). */
  readonly x: Float64Array;
  readonly z: Float64Array;
  /** Unit tangent per sample. */
  readonly tx: Float64Array;
  readonly tz: Float64Array;
  /** Distance from the start line to each sample, m. */
  readonly dist: Float64Array;
  readonly length: number;
  readonly count: number;
  readonly half: number;
  readonly wall: number;
  /** Boost pads and coins as world points (centre, along-track tangent). */
  readonly pads: readonly { readonly x: number; readonly z: number; readonly tx: number; readonly tz: number }[];
  readonly coinAt: readonly (readonly [number, number])[];
  /** Grid slots behind the line: [x, z, yaw] by slot. */
  readonly grid: readonly (readonly [number, number, number])[];
}

export interface KartTuning {
  /** Top speed on asphalt, m/s. */
  readonly topSpeed: number;
  /** m/s² of thrust at a standstill (falls off toward top speed). */
  readonly accel: number;
  readonly brake: number;
  /** m/s² lost when coasting. */
  readonly drag: number;
  /** Turn rate at speed, rad/s. */
  readonly turn: number;
  /** Sideways speed bled per second on asphalt (higher grips harder), and while drifting. */
  readonly grip: number;
  readonly driftGrip: number;
  /** Top speed kept on grass. */
  readonly grass: number;
  /** Boost: top speed multiplier and thrust. */
  readonly boostSpeed: number;
  /** Seconds of mini-turbo for the three drift tiers, and the seconds of drift each tier needs. */
  readonly turbo: readonly [number, number, number];
  readonly turboAt: readonly [number, number, number];
  /** Seconds a boost pad boosts. */
  readonly padSeconds: number;
  /** Coin pickup reach, m. */
  readonly coinRadius: number;
}

export const DEFAULT_KART_TUNING: KartTuning = {
  topSpeed: 26,
  accel: 30,
  brake: 40,
  drag: 6,
  turn: 2.3,
  grip: 9,
  driftGrip: 1.8,
  grass: 0.55,
  boostSpeed: 1.35,
  turbo: [0.5, 0.9, 1.4],
  turboAt: [0.55, 1.2, 2.0],
  padSeconds: 0.9,
  coinRadius: 1.8,
};

/** Upgrade stats a kart can carry (4 bits each in `stats`). */
export const KART_STATS = ["speed", "haste", "might", "armor", "magnet"] as const;
export type KartStat = (typeof KART_STATS)[number];
export const KART_STAT_DOC: Readonly<Record<KartStat, string>> = {
  speed: "top speed x (1 + step x level)",
  haste: "drift charges x (1 + step x level) faster",
  might: "boosts last x (1 + step x level) longer",
  armor: "grass and wall losses x (1 - step x level), floor 40%",
  magnet: "coin reach + step x level metres",
};

export const KartFlag = {
  Drifting: 1 << 0,
  /** Drifting right (else left). */
  DriftRight: 1 << 1,
  OnGrass: 1 << 2,
  Finished: 1 << 3,
  Frozen: 1 << 4,
  Bot: 1 << 5,
  /** Hit a wall this tick. */
  Bumped: 1 << 6,
  Boosting: 1 << 7,
} as const;

export const KART_MAX_COINS = 62;
/** Coins held that raise top speed, and how much each adds. */
export const KART_COIN_CAP = 10;
export const KART_COIN_SPEED = 0.01;
/** Kart body radius for bumps, m. */
export const KART_RADIUS = 0.9;
/** Karts slower than this (parked on the grid, reading the controls, stuck nose-in) are passed through, never bumped. m/s. */
export const KART_BUMP_SPEED = 3;

export interface Kart {
  readonly id: number;
  x: number;
  z: number;
  /** Heading, radians (forward is (cos yaw, sin yaw) in x/z), kept on a u16 turn. */
  yaw: number;
  vx: number;
  vz: number;
  flags: number;
  /** Drift seconds charged, in ticks. */
  charge: number;
  /** Boost ticks left. */
  boost: number;
  /** Nearest centreline sample. */
  seg: number;
  /** Laps done. */
  lap: number;
  /** Quarter checkpoints passed this lap (bits 0..3). */
  cps: number;
  coinsLo: number;
  coinsHi: number;
  finishTick: number;
  stats: number;
  cosmetic: number;
  /** Grid slot (start position). */
  slot: number;
  ack: number;
  held: number;
}

export type KartEvent =
  | { readonly type: "coin"; readonly kart: number; readonly index: number }
  | { readonly type: "lap"; readonly kart: number; readonly lap: number }
  | { readonly type: "finish"; readonly kart: number; readonly tick: number }
  | { readonly type: "turbo"; readonly kart: number; readonly tier: number }
  | { readonly type: "pad"; readonly kart: number }
  | { readonly type: "wall"; readonly kart: number; readonly speed: number }
  | { readonly type: "bump"; readonly kart: number; readonly other: number };

export interface KartConfig {
  readonly tickRate: number;
  readonly tracks: readonly KartTrackDef[];
  readonly tuning?: Partial<KartTuning>;
  readonly statSteps?: readonly number[];
  /** Kart-to-kart bumps (the room server); a predicting client leaves them out. */
  readonly authority?: boolean;
}

export interface KartWorld {
  readonly tickRate: number;
  readonly dt: number;
  readonly tracks: readonly KartTrack[];
  track: KartTrack;
  trackIndex: number;
  readonly tuning: KartTuning;
  readonly statSteps: readonly number[];
  readonly authority: boolean;
  tick: number;
  readonly karts: Map<number, Kart>;
}

const Q = 1024;
const TAU = Math.PI * 2;
const snap = (v: number): number => Math.round(v * Q) / Q || 0;
const snapYaw = (r: number): number => {
  const u = ((Math.round((r / TAU) * 65536) % 65536) + 65536) % 65536;
  return (u / 65536) * TAU;
};

/** Sample a closed Catmull-Rom centreline every ~2 m. Pure arithmetic, identical on every side. */
export function buildKartTrack(def: KartTrackDef): KartTrack {
  const P = def.points;
  const n = P.length;
  if (n < 4) throw new RangeError("kart: a track needs at least 4 points");
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n] as readonly [number, number];
    const p1 = P[i] as readonly [number, number];
    const p2 = P[(i + 1) % n] as readonly [number, number];
    const p3 = P[(i + 2) % n] as readonly [number, number];
    const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(2, Math.ceil(seg / 2));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      pts.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  const count = pts.length;
  const x = new Float64Array(count);
  const z = new Float64Array(count);
  const tx = new Float64Array(count);
  const tz = new Float64Array(count);
  const dist = new Float64Array(count);
  let len = 0;
  for (let i = 0; i < count; i++) {
    const a = pts[i] as [number, number];
    const b = pts[(i + 1) % count] as [number, number];
    x[i] = a[0];
    z[i] = a[1];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    tx[i] = (b[0] - a[0]) / d;
    tz[i] = (b[1] - a[1]) / d;
    dist[i] = len;
    len += d;
  }
  const half = def.width / 2;
  const wall = half + (def.verge ?? 4);
  const at = (frac: number, lateral: number) => {
    const target = (((frac % 1) + 1) % 1) * len;
    let i = 0;
    while (i < count - 1 && (dist[i + 1] ?? len) <= target) i++;
    const into = target - (dist[i] ?? 0);
    const cx = (x[i] ?? 0) + (tx[i] ?? 0) * into;
    const cz = (z[i] ?? 0) + (tz[i] ?? 0) * into;
    const nx = -(tz[i] ?? 0);
    const nz = tx[i] ?? 0;
    return { x: cx + nx * lateral * half, z: cz + nz * lateral * half, tx: tx[i] ?? 1, tz: tz[i] ?? 0 };
  };
  const pads = def.boosts.map(([f, l]) => at(f, l));
  const coinAt = def.coins.map(([f, l]) => {
    const p = at(f, l);
    return [p.x, p.z] as const;
  });
  // A staggered grid behind the line: two columns, 4 m apart in each column. Each slot faces
  // down its own lane past the line (the first straight), not along the bend the grid sits on,
  // so a kart that just holds the throttle off the line stays on the road.
  const grid = Array.from({ length: 12 }, (_, slot) => {
    const row = Math.floor(slot / 2);
    const lateral = slot % 2 === 0 ? -0.35 : 0.35;
    const p = at(-(4 + row * 4) / len, lateral);
    const aim = at(20 / len, lateral);
    return [p.x, p.z, Math.atan2(aim.z - p.z, aim.x - p.x)] as const;
  });
  return { def, x, z, tx, tz, dist, length: len, count, half, wall, pads, coinAt, grid };
}

export function createKartWorld(cfg: KartConfig): KartWorld {
  const tracks = cfg.tracks.map(buildKartTrack);
  const first = tracks[0];
  if (!first) throw new RangeError("kart: declare at least one track");
  for (const t of cfg.tracks) if (t.coins.length > KART_MAX_COINS) throw new RangeError(`kart: at most ${KART_MAX_COINS} coins a track`);
  return {
    tickRate: cfg.tickRate,
    dt: 1 / cfg.tickRate,
    tracks,
    track: first,
    trackIndex: 0,
    tuning: { ...DEFAULT_KART_TUNING, ...cfg.tuning },
    statSteps: KART_STATS.map((_, i) => cfg.statSteps?.[i] ?? 0),
    authority: cfg.authority ?? true,
    tick: 0,
    karts: new Map(),
  };
}

export function setKartTrack(w: KartWorld, index: number): void {
  const i = ((Math.floor(index) % w.tracks.length) + w.tracks.length) % w.tracks.length;
  w.trackIndex = i;
  w.track = w.tracks[i] as KartTrack;
}

function statValue(w: KartWorld, k: Kart, stat: KartStat): number {
  const i = KART_STATS.indexOf(stat);
  return ((k.stats >>> (i * 4)) & 0xf) * (w.statSteps[i] ?? 0);
}

export function kartStatLevel(k: { stats: number }, stat: KartStat): number {
  return (k.stats >>> (KART_STATS.indexOf(stat) * 4)) & 0xf;
}

export function grantKartStat(w: KartWorld, id: number, stat: KartStat): boolean {
  const k = w.karts.get(id);
  const i = KART_STATS.indexOf(stat);
  if (!k || i < 0) return false;
  const lvl = (k.stats >>> (i * 4)) & 0xf;
  if (lvl >= 15) return false;
  k.stats = ((k.stats & ~(0xf << (i * 4))) + ((lvl + 1) << (i * 4))) >>> 0;
  return true;
}

export function kartCoinTaken(k: { coinsLo: number; coinsHi: number }, i: number): boolean {
  return i < 31 ? ((k.coinsLo >>> i) & 1) === 1 : ((k.coinsHi >>> (i - 31)) & 1) === 1;
}

export function kartCoinCount(k: { coinsLo: number; coinsHi: number }): number {
  let n = 0;
  for (let v = k.coinsLo >>> 0; v; v &= v - 1) n++;
  for (let v = k.coinsHi >>> 0; v; v &= v - 1) n++;
  return n;
}

/** Nearest centreline sample to (x, z), searching around `from` (or everywhere). */
export function nearestSample(t: KartTrack, x: number, z: number, from = -1, reach = 24): number {
  let best = 0;
  let bd = Infinity;
  const scan = (i: number) => {
    const dx = (t.x[i] ?? 0) - x;
    const dz = (t.z[i] ?? 0) - z;
    const d = dx * dx + dz * dz;
    if (d < bd) {
      bd = d;
      best = i;
    }
  };
  if (from < 0) for (let i = 0; i < t.count; i++) scan(i);
  else for (let k = -reach; k <= reach; k++) scan((((from + k) % t.count) + t.count) % t.count);
  return best;
}

/** Signed sideways offset from the centreline at sample `seg` (positive to the right of travel). */
export function lateralOffset(t: KartTrack, seg: number, x: number, z: number): number {
  return (x - (t.x[seg] ?? 0)) * -(t.tz[seg] ?? 0) + (z - (t.z[seg] ?? 0)) * (t.tx[seg] ?? 0);
}

/** Race progress in laps (lap + this lap's fraction), for standings. */
export function kartProgress(w: KartWorld, k: Kart): number {
  if ((k.flags & KartFlag.Finished) !== 0) return w.track.def.laps;
  const frac = (w.track.dist[k.seg] ?? 0) / w.track.length;
  // Before the first crossing (on the grid, behind the line) the lap fraction reads near 1: count it as 0.
  const lapFrac = k.cps === 0 && frac > 0.75 ? frac - 1 : frac;
  return Math.max(0, k.lap + lapFrac);
}

export function addKart(w: KartWorld, id: number, opts: { bot?: boolean; frozen?: boolean; slot?: number } = {}): Kart {
  const k: Kart = {
    id,
    x: 0,
    z: 0,
    yaw: 0,
    vx: 0,
    vz: 0,
    flags: (opts.bot ? KartFlag.Bot : 0) | (opts.frozen ? KartFlag.Frozen : 0),
    charge: 0,
    boost: 0,
    seg: 0,
    lap: 0,
    cps: 0,
    coinsLo: 0,
    coinsHi: 0,
    finishTick: 0,
    stats: 0,
    cosmetic: 0,
    slot: opts.slot ?? w.karts.size,
    ack: 0,
    held: 0,
  };
  w.karts.set(id, k);
  resetKart(w, k, opts.frozen ?? false);
  return k;
}

export function removeKart(w: KartWorld, id: number): boolean {
  return w.karts.delete(id);
}

/** Back to the grid for a fresh race (stats kept; the runner clears them). */
export function resetKart(w: KartWorld, k: Kart, frozen: boolean): void {
  const g = w.track.grid[k.slot % w.track.grid.length] ?? [0, 0, 0];
  k.x = snap(g[0]);
  k.z = snap(g[1]);
  k.yaw = snapYaw(g[2]);
  k.vx = k.vz = 0;
  k.flags = (k.flags & KartFlag.Bot) | (frozen ? KartFlag.Frozen : 0);
  k.charge = k.boost = 0;
  k.seg = nearestSample(w.track, k.x, k.z);
  k.lap = 0;
  k.cps = 0;
  k.coinsLo = k.coinsHi = 0;
  k.finishTick = 0;
  k.held = 0;
}

export function setKartsFrozen(w: KartWorld, frozen: boolean): void {
  for (const k of w.karts.values()) k.flags = frozen ? k.flags | KartFlag.Frozen : k.flags & ~KartFlag.Frozen;
}

function ordered(w: KartWorld): Kart[] {
  return [...w.karts.values()].sort((a, b) => a.id - b.id);
}

/** One fixed tick. */
export function kartStep(w: KartWorld, inputs: ReadonlyMap<number, InputCommand>): KartEvent[] {
  const events: KartEvent[] = [];
  const next = w.tick + 1;
  const karts = ordered(w);
  for (const k of karts) {
    const raw = inputs.get(k.id);
    const cmd = raw ? quantizeInput(raw) : null;
    if (cmd) k.ack = cmd.seq;
    driveKart(w, k, cmd, next, events);
  }
  if (w.authority) bumpKarts(w, karts, events);
  for (const k of karts) {
    k.x = snap(k.x);
    k.z = snap(k.z);
    k.vx = snap(k.vx);
    k.vz = snap(k.vz);
    k.yaw = snapYaw(k.yaw);
  }
  w.tick = next;
  return events;
}

function driveKart(w: KartWorld, k: Kart, cmd: InputCommand | null, next: number, events: KartEvent[]): void {
  const t = w.tuning;
  const dt = w.dt;
  const tr = w.track;
  const buttons = cmd?.buttons ?? 0;
  const driftHeld = (buttons & (Button.Sprint | Button.Jump)) !== 0;
  k.flags &= ~KartFlag.Bumped;
  if ((k.flags & (KartFlag.Frozen | KartFlag.Finished)) !== 0) {
    // Finished karts coast to a stop on their line.
    if ((k.flags & KartFlag.Finished) !== 0) {
      const decay = Math.max(0, 1 - 2.2 * dt);
      k.vx *= decay;
      k.vz *= decay;
      k.x += k.vx * dt;
      k.z += k.vz * dt;
    } else {
      k.vx = k.vz = 0;
      k.charge = 0;
      k.flags &= ~(KartFlag.Drifting | KartFlag.DriftRight);
    }
    k.held = driftHeld ? 1 : 0;
    return;
  }
  const throttle = cmd ? Math.max(-1, Math.min(1, cmd.moveZ)) : 0;
  const steer = cmd ? Math.max(-1, Math.min(1, cmd.moveX)) : 0;
  const fx = Math.cos(k.yaw);
  const fz = Math.sin(k.yaw);
  // Right of travel (screen convention: positive steer turns right).
  const rx = -fz;
  const rz = fx;
  let s = k.vx * fx + k.vz * fz;
  let l = k.vx * rx + k.vz * rz;
  const armor = Math.min(0.6, statValue(w, k, "armor"));
  const coins = Math.min(KART_COIN_CAP, kartCoinCount(k));
  const onGrass = (k.flags & KartFlag.OnGrass) !== 0;
  const boosting = k.boost > 0;
  let top = t.topSpeed * (1 + statValue(w, k, "speed")) * (1 + coins * KART_COIN_SPEED);
  if (onGrass && !boosting) top *= t.grass + (1 - t.grass) * armor;
  if (boosting) top *= t.boostSpeed;

  // Drift: press while steering at speed to start; hold to charge; release to fire the mini-turbo.
  const drifting = (k.flags & KartFlag.Drifting) !== 0;
  if (!drifting && driftHeld && !k.held && Math.abs(steer) > 0.3 && s > 9) {
    k.flags = (k.flags | KartFlag.Drifting) & ~KartFlag.DriftRight;
    if (steer > 0) k.flags |= KartFlag.DriftRight;
    k.charge = 0;
  } else if (drifting && (!driftHeld || s < 6)) {
    const secs = k.charge / w.tickRate;
    const tier = secs >= (t.turboAt[2] ?? 2) ? 3 : secs >= (t.turboAt[1] ?? 1.2) ? 2 : secs >= (t.turboAt[0] ?? 0.55) ? 1 : 0;
    if (tier > 0 && s >= 6) {
      const might = 1 + statValue(w, k, "might");
      k.boost = Math.max(k.boost, Math.round((t.turbo[tier - 1] ?? 0.5) * might * w.tickRate));
      events.push({ type: "turbo", kart: k.id, tier });
    }
    k.flags &= ~(KartFlag.Drifting | KartFlag.DriftRight);
    k.charge = 0;
  }
  k.held = driftHeld ? 1 : 0;
  const nowDrifting = (k.flags & KartFlag.Drifting) !== 0;
  const dir = (k.flags & KartFlag.DriftRight) !== 0 ? 1 : -1;
  if (nowDrifting) k.charge = Math.min(4000, k.charge + 1 + statValue(w, k, "haste") + Math.max(0, steer * dir) * 0.6);

  // Engine and brakes on the forward speed.
  if (boosting) s = Math.min(top, s + t.accel * 1.8 * dt);
  else if (throttle > 0.05) s = s < top ? Math.min(top, s + t.accel * throttle * Math.max(0.15, 1 - s / top) * dt) : Math.max(top, s - t.drag * 2 * dt);
  else if (throttle < -0.05) s = s > 0 ? s - t.brake * -throttle * dt : Math.max(-top * 0.3, s - t.accel * 0.5 * -throttle * dt);
  else s = s > 0 ? Math.max(0, s - t.drag * dt) : Math.min(0, s + t.drag * dt);
  if (s > top) s = Math.max(top, s - t.drag * 3 * dt);

  // Steering: turns faster with speed up to a point; a drift holds its line into the bend.
  const speedK = Math.min(1, Math.abs(s) / 10) * (Math.abs(s) > 22 ? 22 / Math.abs(s) * 0.3 + 0.7 : 1);
  let yawRate = steer * t.turn * speedK * Math.sign(s || 1);
  if (nowDrifting) yawRate = t.turn * speedK * (dir * 0.75 + steer * 0.45);
  k.yaw += yawRate * dt;

  // Grip bleeds sideways speed; a drift keeps some of it.
  const grip = nowDrifting ? t.driftGrip : t.grip;
  l *= Math.exp(-grip * dt);
  if (nowDrifting) l += -dir * Math.abs(s) * 0.12 * dt * 4;
  const nfx = Math.cos(k.yaw);
  const nfz = Math.sin(k.yaw);
  k.vx = nfx * s + -nfz * l;
  k.vz = nfz * s + nfx * l;
  k.x += k.vx * dt;
  k.z += k.vz * dt;

  // The track: grass past the asphalt, walls past the verge.
  const prevSeg = k.seg;
  k.seg = nearestSample(tr, k.x, k.z, k.seg);
  const off = lateralOffset(tr, k.seg, k.x, k.z);
  const abs = Math.abs(off);
  if (abs > tr.half) k.flags |= KartFlag.OnGrass;
  else k.flags &= ~KartFlag.OnGrass;
  if (abs > tr.wall - KART_RADIUS) {
    const side = Math.sign(off);
    const push = abs - (tr.wall - KART_RADIUS);
    const nx = -(tr.tz[k.seg] ?? 0) * side;
    const nz = (tr.tx[k.seg] ?? 0) * side;
    k.x -= nx * push;
    k.z -= nz * push;
    const into = k.vx * nx + k.vz * nz;
    if (into > 3) {
      // A hit: reflect the part going into the wall, damped; scrape a little speed.
      const loss = 0.82 + 0.1 * armor;
      k.vx = (k.vx - nx * into * 1.4) * loss;
      k.vz = (k.vz - nz * into * 1.4) * loss;
      events.push({ type: "wall", kart: k.id, speed: into });
      k.flags |= KartFlag.Bumped;
    } else if (into > 0) {
      // A shallow scrape slides along the wall: only the part going into it is lost, so a kart
      // throttling at a slight angle to the wall keeps rolling instead of grinding to a crawl.
      k.vx -= nx * into;
      k.vz -= nz * into;
      k.flags |= KartFlag.Bumped;
    }
  }

  // Quarter checkpoints in order, then the line.
  const len = tr.length;
  const before = tr.dist[prevSeg] ?? 0;
  const after = tr.dist[k.seg] ?? 0;
  for (let q = 1; q <= 3; q++) {
    const mark = (len * q) / 4;
    if (before < mark && after >= mark && after - before < len / 2 && (k.cps & (1 << (q - 1))) !== 0) k.cps |= 1 << q;
  }
  // Crossing the line forward: the end of a lap once every quarter was passed; the first crossing starts lap 1's count.
  if (before > len * 0.75 && after < len * 0.25) {
    if (k.cps === 0b1111) {
      k.lap++;
      events.push({ type: "lap", kart: k.id, lap: k.lap });
      if (k.lap >= tr.def.laps) {
        k.flags |= KartFlag.Finished;
        k.flags &= ~(KartFlag.Drifting | KartFlag.DriftRight);
        k.finishTick = next;
        events.push({ type: "finish", kart: k.id, tick: next });
      }
    }
    k.cps = 1;
  } else if (k.cps === 0 && after < len * 0.25 && before < len * 0.25) {
    // Started past the line (a late join on the grid's front row): the lap starts here.
    k.cps = 1;
  }

  // Boost pads and coins.
  if (k.boost > 0) k.boost--;
  for (const p of tr.pads) {
    const dx = k.x - p.x;
    const dz = k.z - p.z;
    const along = dx * p.tx + dz * p.tz;
    const side = -dx * p.tz + dz * p.tx;
    if (Math.abs(along) < 2 && Math.abs(side) < 1.6) {
      if (k.boost < w.tickRate * 0.2) events.push({ type: "pad", kart: k.id });
      k.boost = Math.max(k.boost, Math.round(t.padSeconds * (1 + statValue(w, k, "might")) * w.tickRate));
    }
  }
  if (k.boost > 0) k.flags |= KartFlag.Boosting;
  else k.flags &= ~KartFlag.Boosting;
  const reach = t.coinRadius + statValue(w, k, "magnet");
  for (let i = 0; i < tr.coinAt.length; i++) {
    if (kartCoinTaken(k, i)) continue;
    const c = tr.coinAt[i] as readonly [number, number];
    const dx = c[0] - k.x;
    const dz = c[1] - k.z;
    if (dx * dx + dz * dz <= reach * reach) {
      if (i < 31) k.coinsLo = (k.coinsLo | (1 << i)) >>> 0;
      else k.coinsHi = (k.coinsHi | (1 << (i - 31))) >>> 0;
      events.push({ type: "coin", kart: k.id, index: i });
    }
  }
}

/** Karts that overlap push apart and trade some speed (authority only). */
function bumpKarts(w: KartWorld, karts: Kart[], events: KartEvent[]): void {
  for (let i = 0; i < karts.length; i++) {
    const a = karts[i] as Kart;
    if (a.flags & KartFlag.Frozen) continue;
    const aMoving = Math.hypot(a.vx, a.vz) >= KART_BUMP_SPEED;
    for (let j = i + 1; j < karts.length; j++) {
      const b = karts[j] as Kart;
      if (b.flags & KartFlag.Frozen) continue;
      // A parked kart is passed through: the field pulling away from the grid never launches
      // someone still sitting on it (or stuck nose-in at a wall) across the grass.
      if (!aMoving || Math.hypot(b.vx, b.vz) < KART_BUMP_SPEED) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      const min = KART_RADIUS * 2;
      if (d2 >= min * min || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const nz = dz / d;
      const push = (min - d) / 2;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
      const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rel < 0) {
        const imp = -rel * 0.6;
        a.vx -= nx * imp;
        a.vz -= nz * imp;
        b.vx += nx * imp;
        b.vz += nz * imp;
        events.push({ type: "bump", kart: a.id, other: b.id });
      }
    }
  }
}

/** Integer wire state of one kart. */
export interface KartWire {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  /** u16 turn. */
  readonly yaw: number;
  readonly vx: number;
  readonly vz: number;
  readonly flags: number;
  /** charge | boost << 12 | held << 24 */
  readonly timers: number;
  /** seg | lap << 16 | cps << 24 */
  readonly track: number;
  readonly coinsLo: number;
  readonly coinsHi: number;
  readonly finishTick: number;
  readonly stats: number;
  /** cosmetic | track index << 8 | slot << 12 */
  readonly cosmetic: number;
  readonly clock: number;
}

const yawU = (r: number) => ((Math.round((r / TAU) * 65536) % 65536) + 65536) % 65536;

export function captureKart(w: KartWorld, k: Kart): KartWire {
  return {
    id: k.id,
    x: Math.round(k.x * Q),
    z: Math.round(k.z * Q),
    yaw: yawU(k.yaw),
    vx: Math.round(k.vx * Q),
    vz: Math.round(k.vz * Q),
    flags: k.flags,
    timers: ((Math.min(4095, k.charge) & 0xfff) | ((Math.min(4095, k.boost) & 0xfff) << 12) | ((k.held & 1) << 24)) >>> 0,
    track: ((k.seg & 0xffff) | ((Math.min(255, k.lap) & 0xff) << 16) | ((k.cps & 0xf) << 24)) >>> 0,
    coinsLo: k.coinsLo >>> 0,
    coinsHi: k.coinsHi >>> 0,
    finishTick: k.finishTick,
    stats: k.stats >>> 0,
    cosmetic: ((k.cosmetic & 0xff) | ((w.trackIndex & 0xf) << 8) | ((k.slot & 0xf) << 12)) >>> 0,
    clock: w.tick,
  };
}

export function applyKart(w: KartWorld, s: KartWire): Kart {
  const ti = (s.cosmetic >>> 8) & 0xf;
  if (w.trackIndex !== ti) setKartTrack(w, ti);
  const k = w.karts.get(s.id) ?? addKart(w, s.id, { slot: (s.cosmetic >>> 12) & 0xf });
  k.x = s.x / Q;
  k.z = s.z / Q;
  k.yaw = (s.yaw / 65536) * TAU;
  k.vx = s.vx / Q;
  k.vz = s.vz / Q;
  k.flags = s.flags;
  k.charge = s.timers & 0xfff;
  k.boost = (s.timers >>> 12) & 0xfff;
  k.held = (s.timers >>> 24) & 1;
  k.seg = s.track & 0xffff;
  k.lap = (s.track >>> 16) & 0xff;
  k.cps = (s.track >>> 24) & 0xf;
  k.coinsLo = s.coinsLo >>> 0;
  k.coinsHi = s.coinsHi >>> 0;
  k.finishTick = s.finishTick;
  k.stats = s.stats >>> 0;
  k.cosmetic = s.cosmetic & 0xff;
  k.slot = (s.cosmetic >>> 12) & 0xf;
  w.tick = s.clock;
  return k;
}
