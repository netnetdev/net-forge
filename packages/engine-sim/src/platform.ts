/**
 * Platformer mode: a side-view race-to-the-flag sim (template "platformer").
 *
 * Pure TypeScript, no Rapier: the level is axis-aligned boxes in the x/y
 * plane, so a hand-written swept AABB mover is exact, cheap and easy to keep
 * bit-identical between the predicting client and the room server. Every
 * player's state is snapped to the 1/1024 grid at the end of each tick, the
 * same contract as the rest of engine-sim (apply(capture(w)) reproduces w).
 *
 * Players are ghosts to each other (no player-player collision), coins are
 * per player (a bitmask: collecting one removes it only for you), and moving
 * platforms are a pure function of the world tick. So a player's predicted
 * state depends only on their own inputs, the static level and the tick:
 * client prediction replays exactly.
 *
 * Jump feel (game-runtime.md §13): coyote time, a jump buffer, variable jump
 * height (releasing Jump while rising cuts the rise), a lighter apex while
 * Jump is held, a heavier fall, a terminal velocity, ground and air
 * acceleration, ceiling corner nudges, one-way ledges you can drop through,
 * an air dash, springs and extra air jumps from upgrades.
 */
import { Button } from "./api.js";
import type { InputCommand } from "./api.js";
import { quantizeInput } from "./input.js";

/** An axis-aligned box: [x0, y0, x1, y1] in metres, x0 < x1, y0 < y1. */
export type PlatBox = readonly [number, number, number, number];

export interface PlatformMover {
  /** The box at phase 0. */
  readonly box: PlatBox;
  /** Travel at the far end of the swing, metres. */
  readonly dx: number;
  readonly dy: number;
  /** Ticks for a full there-and-back swing. */
  readonly periodTicks: number;
  /** Ticks into the swing at tick 0. */
  readonly phaseTicks: number;
}

export interface PlatformSpring {
  readonly x: number;
  readonly y: number;
  /** Launch speed, m/s. */
  readonly power: number;
}

export interface PlatformLevel {
  /** Where every player starts: feet at [x, y]. */
  readonly start: readonly [number, number];
  /** The flag pole's foot. Touching it finishes the race. */
  readonly flag: readonly [number, number];
  /** Falling below this y is a fall (back to the last checkpoint). */
  readonly killY: number;
  /** Solid blocks. */
  readonly solids: readonly PlatBox[];
  /** One-way ledges: stand on the top, jump up through, hold down to drop through. */
  readonly ledges: readonly PlatBox[];
  /** Spikes, saws, lava: touching one is a fall. */
  readonly hazards: readonly PlatBox[];
  readonly springs: readonly PlatformSpring[];
  /** Moving one-way platforms. */
  readonly movers: readonly PlatformMover[];
  /** Coin centres. At most 62 coins. */
  readonly coins: readonly (readonly [number, number])[];
  /** Checkpoint flags (feet). A fall returns you to the furthest one you touched. */
  readonly checkpoints: readonly (readonly [number, number])[];
}

/** Motor numbers. Seconds become ticks at world creation. */
export interface PlatformTuning {
  /** Run speed, m/s. */
  readonly runSpeed: number;
  /** m/s² toward the stick's speed on the ground, and in the air. */
  readonly groundAccel: number;
  readonly airAccel: number;
  /** m/s² of braking on the ground with the stick released. */
  readonly friction: number;
  /** Apex height of a full jump, m, and the seconds to reach it. */
  readonly jumpHeight: number;
  readonly timeToApex: number;
  /** Gravity multiplier while falling (snappier falls). */
  readonly fallGravity: number;
  /** Rising speed kept when Jump is released early (variable jump height). */
  readonly jumpCut: number;
  /** Gravity multiplier near the apex while Jump is held (a little hang time). */
  readonly apexHang: number;
  /** |vy| below which the apex hang applies, m/s. */
  readonly apexWindow: number;
  readonly coyoteSeconds: number;
  readonly bufferSeconds: number;
  /** Fastest fall, m/s. */
  readonly terminal: number;
  /** Air jumps before an upgrade (0: none). */
  readonly airJumps: number;
  /** Air jump strength as a share of a ground jump. */
  readonly airJumpScale: number;
  readonly dashSpeed: number;
  readonly dashSeconds: number;
  readonly dashCooldown: number;
  /** Coin pickup reach from the body's centre, m. */
  readonly coinRadius: number;
  /** Seconds a fall takes before you are back at the checkpoint. */
  readonly respawnSeconds: number;
  /** Seconds of protection after a shield absorbs a hit or a respawn. */
  readonly iframeSeconds: number;
}

export const DEFAULT_PLATFORM_TUNING: PlatformTuning = {
  runSpeed: 7.5,
  groundAccel: 80,
  airAccel: 48,
  friction: 70,
  jumpHeight: 3.3,
  timeToApex: 0.36,
  fallGravity: 1.75,
  jumpCut: 0.45,
  apexHang: 0.55,
  apexWindow: 2.4,
  coyoteSeconds: 0.1,
  bufferSeconds: 0.13,
  terminal: 26,
  airJumps: 0,
  airJumpScale: 0.85,
  dashSpeed: 16,
  dashSeconds: 0.16,
  dashCooldown: 0.75,
  coinRadius: 0.85,
  respawnSeconds: 0.7,
  iframeSeconds: 1.2,
};

/** Half width and height of the body box (feet at y). */
export const PLAT_HALF_W = 0.34;
export const PLAT_HEIGHT = 1.4;
/** Most coins a level holds (two u31 masks). */
export const PLAT_MAX_COINS = 62;

/** Player flags (u16 on the wire). */
export const PlatFlag = {
  Grounded: 1 << 0,
  FacingLeft: 1 << 1,
  /** Rising from a jump that Jump is still allowed to cut. */
  Rising: 1 << 2,
  /** Fell: waiting to respawn. */
  Dead: 1 << 3,
  Finished: 1 << 4,
  /** The countdown holds everyone at the start. */
  Frozen: 1 << 5,
  /** The air dash is available (refills on landing). */
  DashReady: 1 << 6,
  /** A seat bot (drawn as one; never earns). */
  Bot: 1 << 7,
  /** Ridden this tick: the body stands on a moving platform. */
  OnMover: 1 << 8,
} as const;

/** Upgrade stats a platformer player can carry (4 bits each in `stats`). */
export const PLAT_STATS = ["speed", "amount", "magnet", "maxHealth", "haste"] as const;
export type PlatStat = (typeof PLAT_STATS)[number];
/** What one level of each stat does (the declared upgrade's step scales it). */
export const PLAT_STAT_DOC: Readonly<Record<PlatStat, string>> = {
  speed: "run speed x (1 + step x level)",
  amount: "extra air jumps: step x level",
  magnet: "coin reach + step x level metres",
  maxHealth: "shield hits per life: step x level",
  haste: "dash cooldown x (1 - step x level), floor 30%",
};

export interface PlatformPlayer {
  readonly id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  flags: number;
  coyote: number;
  buffer: number;
  airLeft: number;
  dashT: number;
  dashCd: number;
  /** Ticks left of dropping through ledges. */
  drop: number;
  /** Furthest checkpoint index touched, -1 for the start. */
  cp: number;
  coinsLo: number;
  coinsHi: number;
  /** World tick the player finished on (0: not yet). */
  finishTick: number;
  respawn: number;
  iframes: number;
  /** Shield hits left this life. */
  shield: number;
  /** Packed stat levels, 4 bits each in PLAT_STATS order. */
  stats: number;
  cosmetic: number;
  /** Last input sequence consumed (reconciliation keys on it). */
  ack: number;
  /** Buttons held last tick (edges are found against these). */
  held: number;
}

export type PlatformEvent =
  | { readonly type: "coin"; readonly player: number; readonly index: number }
  | { readonly type: "checkpoint"; readonly player: number; readonly index: number }
  | { readonly type: "finish"; readonly player: number; readonly tick: number }
  | { readonly type: "fell"; readonly player: number; readonly hazard: boolean }
  | { readonly type: "shield"; readonly player: number }
  | { readonly type: "jump"; readonly player: number; readonly air: boolean }
  | { readonly type: "land"; readonly player: number; readonly speed: number }
  | { readonly type: "spring"; readonly player: number }
  | { readonly type: "dash"; readonly player: number }
  | { readonly type: "respawn"; readonly player: number };

export interface PlatformConfig {
  readonly tickRate: number;
  /** The courses, in rotation order (setPlatformLevel picks one). */
  readonly levels: readonly PlatformLevel[];
  readonly tuning?: Partial<PlatformTuning>;
  /** Per stat index (PLAT_STATS order): the declared upgrade's step for one level. */
  readonly statSteps?: readonly number[];
}

/** Derived per-tick numbers. */
interface Motor {
  readonly dt: number;
  readonly gravity: number;
  readonly jumpV: number;
  readonly coyote: number;
  readonly buffer: number;
  readonly dashTicks: number;
  readonly dashCd: number;
  readonly respawn: number;
  readonly iframes: number;
}

export interface PlatformWorld {
  readonly tickRate: number;
  readonly levels: readonly PlatformLevel[];
  /** The course being run (levels[levelIndex]). */
  level: PlatformLevel;
  levelIndex: number;
  readonly tuning: PlatformTuning;
  readonly motor: Motor;
  readonly statSteps: readonly number[];
  /** Ticks since the round began (moving platforms run on it). */
  tick: number;
  readonly players: Map<number, PlatformPlayer>;
}

const Q = 1024;
const snap = (v: number): number => Math.round(v * Q) / Q || 0;
const snapDown = (v: number): number => Math.floor(v * Q + 1e-9) / Q || 0;
const snapUp = (v: number): number => Math.ceil(v * Q - 1e-9) / Q || 0;
const EPS = 1e-6;
/** How far past a face a body may already be and still count as on its near side (grid rounding). */
const SKIN = 0.01;

/** Normalize a box so x0 < x1 and y0 < y1. */
export function platBox(x0: number, y0: number, x1: number, y1: number): PlatBox {
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

export function createPlatformWorld(cfg: PlatformConfig): PlatformWorld {
  const tuning = { ...DEFAULT_PLATFORM_TUNING, ...cfg.tuning };
  const rate = cfg.tickRate;
  if (!(rate > 0)) throw new RangeError("platform: tickRate must be positive");
  const first = cfg.levels[0];
  if (!first) throw new RangeError("platform: declare at least one level");
  for (const l of cfg.levels) if (l.coins.length > PLAT_MAX_COINS) throw new RangeError(`platform: at most ${PLAT_MAX_COINS} coins a level`);
  const gravity = (2 * tuning.jumpHeight) / (tuning.timeToApex * tuning.timeToApex);
  const ticks = (s: number) => Math.max(1, Math.round(s * rate));
  return {
    tickRate: rate,
    levels: cfg.levels,
    level: first,
    levelIndex: 0,
    tuning,
    motor: {
      dt: 1 / rate,
      gravity,
      jumpV: gravity * tuning.timeToApex,
      coyote: ticks(tuning.coyoteSeconds),
      buffer: ticks(tuning.bufferSeconds),
      dashTicks: ticks(tuning.dashSeconds),
      dashCd: ticks(tuning.dashCooldown),
      respawn: ticks(tuning.respawnSeconds),
      iframes: ticks(tuning.iframeSeconds),
    },
    statSteps: PLAT_STATS.map((_, i) => cfg.statSteps?.[i] ?? 0),
    tick: 0,
    players: new Map(),
  };
}

/** Switch the course (a new round). Players keep their state; reset them after. */
export function setPlatformLevel(w: PlatformWorld, index: number): void {
  const i = ((Math.floor(index) % w.levels.length) + w.levels.length) % w.levels.length;
  w.levelIndex = i;
  w.level = w.levels[i] as PlatformLevel;
}

/** A stat's level (0..15) from the packed word. */
export function platStatLevel(p: { stats: number }, stat: PlatStat): number {
  const i = PLAT_STATS.indexOf(stat);
  return (p.stats >>> (i * 4)) & 0xf;
}

function statValue(w: PlatformWorld, p: PlatformPlayer, stat: PlatStat): number {
  const i = PLAT_STATS.indexOf(stat);
  return ((p.stats >>> (i * 4)) & 0xf) * (w.statSteps[i] ?? 0);
}

/** Add one level of a stat (store upgrades and gear). Returns false at the 4-bit cap. */
export function grantPlatformStat(w: PlatformWorld, id: number, stat: PlatStat): boolean {
  const p = w.players.get(id);
  const i = PLAT_STATS.indexOf(stat);
  if (!p || i < 0) return false;
  const lvl = (p.stats >>> (i * 4)) & 0xf;
  if (lvl >= 15) return false;
  p.stats = (p.stats & ~(0xf << (i * 4))) + ((lvl + 1) << (i * 4));
  p.stats >>>= 0;
  if (stat === "maxHealth") p.shield = Math.round(statValue(w, p, "maxHealth"));
  if (stat === "amount" && (p.flags & PlatFlag.Grounded) !== 0) p.airLeft = airJumps(w, p);
  return true;
}

function airJumps(w: PlatformWorld, p: PlatformPlayer): number {
  return Math.max(0, Math.min(7, Math.round(w.tuning.airJumps + statValue(w, p, "amount"))));
}

/** Where a fall puts you back: the furthest checkpoint touched, or the start. */
export function platformRespawnPoint(w: PlatformWorld, cp: number): readonly [number, number] {
  return (cp >= 0 ? w.level.checkpoints[cp] : undefined) ?? w.level.start;
}

export function addPlatformPlayer(w: PlatformWorld, id: number, opts: { bot?: boolean; frozen?: boolean } = {}): PlatformPlayer {
  const [x, y] = w.level.start;
  const p: PlatformPlayer = {
    id,
    x: snap(x),
    y: snap(y),
    vx: 0,
    vy: 0,
    flags: PlatFlag.DashReady | (opts.bot ? PlatFlag.Bot : 0) | (opts.frozen ? PlatFlag.Frozen : 0),
    coyote: 0,
    buffer: 0,
    airLeft: 0,
    dashT: 0,
    dashCd: 0,
    drop: 0,
    cp: -1,
    coinsLo: 0,
    coinsHi: 0,
    finishTick: 0,
    respawn: 0,
    iframes: 0,
    shield: 0,
    stats: 0,
    cosmetic: 0,
    ack: 0,
    held: 0,
  };
  p.airLeft = airJumps(w, p);
  w.players.set(id, p);
  return p;
}

export function removePlatformPlayer(w: PlatformWorld, id: number): boolean {
  return w.players.delete(id);
}

/** Put a player back at the start of a fresh round (stats are kept; the runner clears them per run). */
export function resetPlatformPlayer(w: PlatformWorld, p: PlatformPlayer, frozen: boolean): void {
  const [x, y] = w.level.start;
  p.x = snap(x);
  p.y = snap(y);
  p.vx = p.vy = 0;
  p.flags = (p.flags & PlatFlag.Bot) | PlatFlag.DashReady | (frozen ? PlatFlag.Frozen : 0);
  p.coyote = p.buffer = p.dashT = p.dashCd = p.drop = p.respawn = p.iframes = 0;
  p.cp = -1;
  p.coinsLo = p.coinsHi = 0;
  p.finishTick = 0;
  p.airLeft = airJumps(w, p);
  p.shield = Math.round(statValue(w, p, "maxHealth"));
}

/** The countdown: hold (or release) every player. */
export function setPlatformFrozen(w: PlatformWorld, frozen: boolean): void {
  for (const p of w.players.values()) p.flags = frozen ? p.flags | PlatFlag.Frozen : p.flags & ~PlatFlag.Frozen;
}

/** A moving platform's box at a tick: a smooth there-and-back swing. */
export function moverBox(m: PlatformMover, tick: number): PlatBox {
  const period = Math.max(2, m.periodTicks);
  const t = (((tick + m.phaseTicks) % period) + period) % period;
  const half = period / 2;
  const u = t < half ? t / half : 2 - t / half;
  const s = u * u * (3 - 2 * u);
  const ox = m.dx * s;
  const oy = m.dy * s;
  return [m.box[0] + ox, m.box[1] + oy, m.box[2] + ox, m.box[3] + oy];
}

export function platformCoinTaken(p: { coinsLo: number; coinsHi: number }, i: number): boolean {
  return i < 31 ? ((p.coinsLo >>> i) & 1) === 1 : ((p.coinsHi >>> (i - 31)) & 1) === 1;
}

export function platformCoinCount(p: { coinsLo: number; coinsHi: number }): number {
  let n = 0;
  for (let v = p.coinsLo >>> 0; v; v &= v - 1) n++;
  for (let v = p.coinsHi >>> 0; v; v &= v - 1) n++;
  return n;
}

const overlaps = (ax0: number, ay0: number, ax1: number, ay1: number, b: PlatBox): boolean => ax0 < b[2] - EPS && ax1 > b[0] + EPS && ay0 < b[3] - EPS && ay1 > b[1] + EPS;

/** Players in id order: every loop that changes state walks this, so both sides agree. */
function ordered(w: PlatformWorld): PlatformPlayer[] {
  return [...w.players.values()].sort((a, b) => a.id - b.id);
}

/** One fixed tick. Inputs by player id; a player with none gets a neutral input. */
export function platformStep(w: PlatformWorld, inputs: ReadonlyMap<number, InputCommand>): PlatformEvent[] {
  const events: PlatformEvent[] = [];
  const next = w.tick + 1;
  for (const p of ordered(w)) {
    const raw = inputs.get(p.id);
    const cmd = raw ? quantizeInput(raw) : null;
    if (cmd) p.ack = cmd.seq;
    stepPlayer(w, p, cmd, next, events);
  }
  w.tick = next;
  return events;
}

function stepPlayer(w: PlatformWorld, p: PlatformPlayer, cmd: InputCommand | null, next: number, events: PlatformEvent[]): void {
  const m = w.motor;
  const t = w.tuning;
  const lv = w.level;
  const buttons = cmd?.buttons ?? 0;
  const held = buttons & (Button.Jump | Button.Sprint);
  const pressed = held & ~p.held;
  p.held = held;
  if (p.iframes > 0) p.iframes--;

  if ((p.flags & (PlatFlag.Frozen | PlatFlag.Finished)) !== 0) {
    p.vx = 0;
    p.vy = 0;
    p.buffer = 0;
    return;
  }
  if ((p.flags & PlatFlag.Dead) !== 0) {
    if (--p.respawn <= 0) {
      const [rx, ry] = platformRespawnPoint(w, p.cp);
      p.x = snap(rx);
      p.y = snap(ry);
      p.vx = p.vy = 0;
      p.respawn = 0;
      p.flags = (p.flags & ~(PlatFlag.Dead | PlatFlag.Rising)) | PlatFlag.DashReady;
      p.iframes = m.iframes;
      p.shield = Math.round(statValue(w, p, "maxHealth"));
      p.airLeft = airJumps(w, p);
      events.push({ type: "respawn", player: p.id });
    }
    return;
  }

  const moveX = cmd ? Math.max(-1, Math.min(1, cmd.moveX)) : 0;
  const down = cmd ? cmd.moveZ < -0.5 : false;
  const wasGrounded = (p.flags & PlatFlag.Grounded) !== 0;
  if (moveX < -0.1) p.flags |= PlatFlag.FacingLeft;
  else if (moveX > 0.1) p.flags &= ~PlatFlag.FacingLeft;

  // Ride a moving platform: carried by its motion this tick.
  if ((p.flags & PlatFlag.OnMover) !== 0) {
    for (const mv of lv.movers) {
      const a = moverBox(mv, w.tick);
      if (Math.abs(p.y - a[3]) < 0.03 && p.x + PLAT_HALF_W > a[0] && p.x - PLAT_HALF_W < a[2]) {
        const b = moverBox(mv, next);
        p.x += b[0] - a[0];
        p.y = snapUp(b[3]);
        break;
      }
    }
  }

  // Timers.
  if ((pressed & Button.Jump) !== 0) p.buffer = m.buffer;
  if (wasGrounded) {
    p.coyote = m.coyote;
    p.airLeft = airJumps(w, p);
    p.flags |= PlatFlag.DashReady;
  }
  if (p.dashCd > 0) p.dashCd--;
  if (p.drop > 0) p.drop--;
  if (down && wasGrounded && (pressed & Button.Jump) !== 0 && standingOnLedge(w, p)) {
    // Down + Jump on a ledge drops through it instead of jumping.
    p.drop = Math.round(0.25 * w.tickRate);
    p.buffer = 0;
    p.coyote = 0;
  }

  // Dash: a burst along the facing, gravity off for its length.
  if ((pressed & Button.Sprint) !== 0 && p.dashCd === 0 && (p.flags & PlatFlag.DashReady) !== 0 && p.dashT === 0) {
    p.dashT = m.dashTicks;
    const haste = Math.min(0.7, statValue(w, p, "haste"));
    p.dashCd = Math.max(1, Math.round(m.dashCd * (1 - haste)));
    if (!wasGrounded) p.flags &= ~PlatFlag.DashReady;
    p.flags &= ~PlatFlag.Rising;
    events.push({ type: "dash", player: p.id });
  }

  const speed = t.runSpeed * (1 + statValue(w, p, "speed"));
  if (p.dashT > 0) {
    p.dashT--;
    p.vx = (p.flags & PlatFlag.FacingLeft ? -1 : 1) * t.dashSpeed;
    p.vy = 0;
  } else {
    // Horizontal: accelerate toward the stick, brake with friction when it is released on the ground.
    const target = moveX * speed;
    const accel = wasGrounded ? (Math.abs(moveX) < 0.1 ? t.friction : t.groundAccel) : t.airAccel;
    const dv = accel * m.dt;
    if (p.vx < target) p.vx = Math.min(target, p.vx + dv);
    else if (p.vx > target) p.vx = Math.max(target, p.vx - dv);

    // Jump: a buffered press inside coyote time, else an air jump on the press itself.
    if (p.buffer > 0 && p.coyote > 0) {
      p.vy = m.jumpV;
      p.buffer = 0;
      p.coyote = 0;
      p.flags = (p.flags | PlatFlag.Rising) & ~(PlatFlag.Grounded | PlatFlag.OnMover);
      events.push({ type: "jump", player: p.id, air: false });
    } else if ((pressed & Button.Jump) !== 0 && p.coyote === 0 && p.airLeft > 0 && !wasGrounded) {
      p.vy = m.jumpV * t.airJumpScale;
      p.airLeft--;
      p.buffer = 0;
      p.flags |= PlatFlag.Rising;
      events.push({ type: "jump", player: p.id, air: true });
    }
    // Variable height: letting go while rising cuts the rise once.
    if ((held & Button.Jump) === 0 && (p.flags & PlatFlag.Rising) !== 0 && p.vy > 0) {
      p.vy *= t.jumpCut;
      p.flags &= ~PlatFlag.Rising;
    }
    if (p.vy <= 0) p.flags &= ~PlatFlag.Rising;
    // Gravity: heavier falling, lighter at the apex while Jump is held.
    let g = m.gravity;
    if (p.vy < 0) g *= t.fallGravity;
    else if ((held & Button.Jump) !== 0 && Math.abs(p.vy) < t.apexWindow) g *= t.apexHang;
    p.vy = Math.max(-t.terminal, p.vy - g * m.dt);
  }

  // Move: x first, then y, each clamped against the level.
  const solids = lv.solids;
  const prevY = p.y;
  let nx = p.x + p.vx * m.dt;
  for (const b of solids) {
    if (!(p.y < b[3] - EPS && p.y + PLAT_HEIGHT > b[1] + EPS)) continue;
    if (p.vx > 0 && p.x + PLAT_HALF_W <= b[0] + SKIN && nx + PLAT_HALF_W > b[0]) {
      nx = snapDown(b[0] - PLAT_HALF_W);
      p.vx = 0;
    } else if (p.vx < 0 && p.x - PLAT_HALF_W >= b[2] - SKIN && nx - PLAT_HALF_W < b[2]) {
      nx = snapUp(b[2] + PLAT_HALF_W);
      p.vx = 0;
    }
  }
  p.x = nx;

  let ny = p.y + p.vy * m.dt;
  let grounded = false;
  let onMover = false;
  if (p.vy <= 0) {
    let top = -Infinity;
    const land = (b: PlatBox, mover: boolean) => {
      if (p.x + PLAT_HALF_W <= b[0] + EPS || p.x - PLAT_HALF_W >= b[2] - EPS) return;
      if (prevY >= b[3] - SKIN && ny <= b[3] && b[3] > top) {
        top = b[3];
        onMover = mover;
      }
    };
    for (const b of solids) land(b, false);
    if (p.drop === 0 && !down) for (const b of lv.ledges) land(b, false);
    else if (p.drop === 0) for (const b of lv.ledges) if (!(down && wasGrounded)) land(b, false);
    if (p.drop === 0) for (const mv of lv.movers) land(moverBox(mv, next), true);
    if (top > -Infinity) {
      if (!wasGrounded && p.vy < -6) events.push({ type: "land", player: p.id, speed: -p.vy });
      ny = snapUp(top);
      p.vy = 0;
      grounded = true;
    }
  } else {
    for (const b of solids) {
      if (p.x + PLAT_HALF_W <= b[0] + EPS || p.x - PLAT_HALF_W >= b[2] - EPS) continue;
      if (prevY + PLAT_HEIGHT <= b[1] + SKIN && ny + PLAT_HEIGHT > b[1]) {
        // Corner nudge: clipping a ceiling's edge by a little slides you past it.
        const leftGap = b[2] - (p.x - PLAT_HALF_W);
        const rightGap = p.x + PLAT_HALF_W - b[0];
        if (leftGap > 0 && leftGap < 0.22 && !blocked(w, b[2] + PLAT_HALF_W, prevY)) {
          p.x = b[2] + PLAT_HALF_W;
          continue;
        }
        if (rightGap > 0 && rightGap < 0.22 && !blocked(w, b[0] - PLAT_HALF_W, prevY)) {
          p.x = b[0] - PLAT_HALF_W;
          continue;
        }
        ny = snapDown(b[1] - PLAT_HEIGHT);
        p.vy = 0;
        p.flags &= ~PlatFlag.Rising;
      }
    }
  }
  p.y = ny;
  if (grounded) p.flags |= PlatFlag.Grounded;
  else p.flags &= ~PlatFlag.Grounded;
  if (onMover) p.flags |= PlatFlag.OnMover;
  else p.flags &= ~PlatFlag.OnMover;
  if (!grounded && p.coyote > 0) p.coyote--;
  if (p.buffer > 0) p.buffer--;

  // Springs: landing on one launches you.
  if (p.vy <= 0) {
    for (const s of lv.springs) {
      if (Math.abs(p.x - s.x) < 0.5 + PLAT_HALF_W && p.y <= s.y + 0.45 && p.y >= s.y - 0.2) {
        p.vy = s.power;
        p.flags = (p.flags & ~(PlatFlag.Grounded | PlatFlag.OnMover | PlatFlag.Rising)) | PlatFlag.DashReady;
        p.coyote = 0;
        p.airLeft = airJumps(w, p);
        events.push({ type: "spring", player: p.id });
        break;
      }
    }
  }

  // Coins (yours only), checkpoints, the flag.
  const cx = p.x;
  const cy = p.y + PLAT_HEIGHT / 2;
  const reach = t.coinRadius + statValue(w, p, "magnet");
  for (let i = 0; i < lv.coins.length; i++) {
    if (platformCoinTaken(p, i)) continue;
    const c = lv.coins[i] as readonly [number, number];
    const dx = c[0] - cx;
    const dy = c[1] - cy;
    if (dx * dx + dy * dy <= reach * reach) {
      if (i < 31) p.coinsLo = (p.coinsLo | (1 << i)) >>> 0;
      else p.coinsHi = (p.coinsHi | (1 << (i - 31))) >>> 0;
      events.push({ type: "coin", player: p.id, index: i });
    }
  }
  for (let i = p.cp + 1; i < lv.checkpoints.length; i++) {
    const c = lv.checkpoints[i] as readonly [number, number];
    if (Math.abs(p.x - c[0]) < 0.9 && p.y > c[1] - 1 && p.y < c[1] + 3.5) {
      p.cp = i;
      events.push({ type: "checkpoint", player: p.id, index: i });
    }
  }
  const [fx, fy] = lv.flag;
  if (p.x + PLAT_HALF_W >= fx - 0.3 && p.x - PLAT_HALF_W <= fx + 0.6 && p.y < fy + 4.5 && p.y + PLAT_HEIGHT > fy) {
    p.flags = (p.flags | PlatFlag.Finished) & ~PlatFlag.Rising;
    p.finishTick = next;
    p.vx = p.vy = 0;
    events.push({ type: "finish", player: p.id, tick: next });
  }

  // Falls: hazards and the kill plane.
  const hurt = p.iframes === 0 && lv.hazards.some((b) => overlaps(p.x - PLAT_HALF_W + 0.08, p.y, p.x + PLAT_HALF_W - 0.08, p.y + PLAT_HEIGHT - 0.1, b));
  if ((p.flags & PlatFlag.Finished) === 0 && (hurt || p.y < lv.killY)) {
    if (hurt && p.shield > 0) {
      p.shield--;
      p.iframes = m.iframes;
      p.vy = m.jumpV * 0.6;
      p.flags &= ~(PlatFlag.Grounded | PlatFlag.OnMover);
      events.push({ type: "shield", player: p.id });
    } else {
      p.flags = (p.flags | PlatFlag.Dead) & ~(PlatFlag.Grounded | PlatFlag.OnMover | PlatFlag.Rising);
      p.respawn = m.respawn;
      p.dashT = 0;
      p.vx = 0;
      p.vy = 0;
      if (p.y < lv.killY) p.y = lv.killY;
      events.push({ type: "fell", player: p.id, hazard: hurt });
    }
  }

  p.x = snap(p.x);
  p.y = snap(p.y);
  p.vx = snap(p.vx);
  p.vy = snap(p.vy);
}

function standingOnLedge(w: PlatformWorld, p: PlatformPlayer): boolean {
  return w.level.ledges.some((b) => Math.abs(p.y - b[3]) < 0.03 && p.x + PLAT_HALF_W > b[0] && p.x - PLAT_HALF_W < b[2]);
}

function blocked(w: PlatformWorld, x: number, y: number): boolean {
  return w.level.solids.some((b) => overlaps(x - PLAT_HALF_W, y, x + PLAT_HALF_W, y + PLAT_HEIGHT, b));
}

/** Integer wire state of one player (positions and speeds in 1/1024). */
export interface PlatformPlayerWire {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly flags: number;
  /** coyote | buffer << 6 | dashT << 12 | drop << 18 | airLeft << 24 | shield << 28 */
  readonly timers: number;
  /** dashCd | respawn << 8 | iframes << 16 | held << 24 (Jump bit 0, Sprint bit 1) */
  readonly timers2: number;
  readonly cp: number;
  readonly coinsLo: number;
  readonly coinsHi: number;
  readonly finishTick: number;
  readonly stats: number;
  /** cosmetic | level index << 8 */
  readonly cosmetic: number;
  /** The world tick this state was captured on (moving platforms run on it). */
  readonly clock: number;
}

const clamp = (v: number, bits: number) => Math.max(0, Math.min((1 << bits) - 1, v | 0));

export function capturePlatformPlayer(w: PlatformWorld, p: PlatformPlayer): PlatformPlayerWire {
  const heldBits = (p.held & Button.Jump ? 1 : 0) | (p.held & Button.Sprint ? 2 : 0);
  return {
    id: p.id,
    x: Math.round(p.x * Q),
    y: Math.round(p.y * Q),
    vx: Math.round(p.vx * Q),
    vy: Math.round(p.vy * Q),
    flags: p.flags,
    timers: (clamp(p.coyote, 6) | (clamp(p.buffer, 6) << 6) | (clamp(p.dashT, 6) << 12) | (clamp(p.drop, 6) << 18) | (clamp(p.airLeft, 4) << 24) | (clamp(p.shield, 4) << 28)) >>> 0,
    timers2: (clamp(p.dashCd, 8) | (clamp(p.respawn, 8) << 8) | (clamp(p.iframes, 8) << 16) | (heldBits << 24)) >>> 0,
    cp: p.cp + 1,
    coinsLo: p.coinsLo >>> 0,
    coinsHi: p.coinsHi >>> 0,
    finishTick: p.finishTick,
    stats: p.stats >>> 0,
    cosmetic: (p.cosmetic & 0xff) | (w.levelIndex << 8),
    clock: w.tick,
  };
}

/** Overwrite (or create) a player from wire state, and take the world tick from it. */
export function applyPlatformPlayer(w: PlatformWorld, s: PlatformPlayerWire): PlatformPlayer {
  const p = w.players.get(s.id) ?? addPlatformPlayer(w, s.id);
  p.x = s.x / Q;
  p.y = s.y / Q;
  p.vx = s.vx / Q;
  p.vy = s.vy / Q;
  p.flags = s.flags;
  p.coyote = s.timers & 0x3f;
  p.buffer = (s.timers >>> 6) & 0x3f;
  p.dashT = (s.timers >>> 12) & 0x3f;
  p.drop = (s.timers >>> 18) & 0x3f;
  p.airLeft = (s.timers >>> 24) & 0xf;
  p.shield = (s.timers >>> 28) & 0xf;
  p.dashCd = s.timers2 & 0xff;
  p.respawn = (s.timers2 >>> 8) & 0xff;
  p.iframes = (s.timers2 >>> 16) & 0xff;
  const hb = (s.timers2 >>> 24) & 3;
  p.held = (hb & 1 ? Button.Jump : 0) | (hb & 2 ? Button.Sprint : 0);
  p.cp = s.cp - 1;
  p.coinsLo = s.coinsLo >>> 0;
  p.coinsHi = s.coinsHi >>> 0;
  p.finishTick = s.finishTick;
  p.stats = s.stats >>> 0;
  p.cosmetic = s.cosmetic & 0xff;
  if (w.levelIndex !== s.cosmetic >>> 8) setPlatformLevel(w, s.cosmetic >>> 8);
  w.tick = s.clock;
  return p;
}

/** How far along the course a player is, 0..1 (by x from start to flag). */
export function platformProgress(w: PlatformWorld, p: { x: number; flags: number }): number {
  if ((p.flags & PlatFlag.Finished) !== 0) return 1;
  const x0 = w.level.start[0];
  const x1 = w.level.flag[0];
  const span = x1 - x0 || 1;
  return Math.max(0, Math.min(0.999, (p.x - x0) / span));
}
