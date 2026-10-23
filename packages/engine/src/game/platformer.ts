/**
 * The platformer template's machinery: compile a manifest's levels into the
 * engine-sim platform sim, drive it with the race runner (race.ts), seat
 * bots that run the course, a route planner that proves every level can be
 * finished (the gate's softlock check), and the netcode SimAdapter.
 */
import {
  Button,
  BOT_PLAYER_BASE,
  PlatFlag,
  PLAT_HALF_W,
  PLAT_HEIGHT,
  PLAT_STATS,
  addPlatformPlayer,
  applyPlatformPlayer,
  capturePlatformPlayer,
  createPlatformWorld,
  grantPlatformStat,
  moverBox,
  platformProgress,
  platformStep,
  removePlatformPlayer,
  resetPlatformPlayer,
  setPlatformFrozen,
  setPlatformLevel,
} from "@netforge/engine-sim";
import type { InputCommand, PlatBox, PlatformLevel, PlatformPlayer, PlatformTuning, PlatformWorld, PlatStat } from "@netforge/engine-sim";
import type { GameManifest } from "../api/registry.js";
import { GameDefinitionError } from "../api/schemas.js";
import type { BitReader, BitWriter } from "../net/bits.js";
import type { EntitySchema, EntityState } from "../net/schema.js";
import type { PlayerId, SimAdapter, SimCommand, SimEvent } from "../net/sim-adapter.js";
import { RaceRunner } from "./race.js";
import type { RaceCore, RaceRunnerOptions, RaceSimEvent } from "./race.js";

/** Platformer defaults: a 3 minute limit, 60 Hz, three seat bots. */
export const PLATFORMER_DEFAULTS = { roundSeconds: 180, tickRate: 60, bots: 3 } as const;

export interface CompiledPlatformer {
  readonly levels: readonly PlatformLevel[];
  /** Level names for the HUD (declared or "Level n"). */
  readonly names: readonly string[];
  readonly tuning: Partial<PlatformTuning>;
  /** Per PLAT_STATS index: the step of the declared upgrade on that stat. */
  readonly statSteps: readonly number[];
  /** Per declared upgrade (declaration order): its platform stat. */
  readonly upgradeStat: readonly PlatStat[];
}

const box = (x: number, y: number, w: number, h: number): PlatBox => [x, y, x + w, y + h];

/** Compile the platformer parts of a manifest. Issues are agent-readable. */
export function compilePlatformer(m: GameManifest, tickRate: number, issues: string[]): CompiledPlatformer {
  const g = m.game;
  if (!g.levels || g.levels.length === 0) issues.push("a platformer game sets levels: [{ start, flag, blocks, ... }] (the courses)");
  if (m.weapons.size > 0) issues.push("weapon(...) is not part of the platformer template: hazards, springs and movers make the challenge");
  if (m.director) issues.push("director(...) is not part of the platformer template");
  if (g.arena || g.field) issues.push("arena and field are for the arena and survivor templates; a platformer declares levels");
  if (g.players.loadout) issues.push("players.loadout is for the arena template");
  if (m.keepers.size > 0) issues.push("keeper(...) is for the survivor template");
  for (const [id, p] of m.prefabs) if ((p.kind ?? "enemy") === "enemy" && !p.prop) issues.push(`prefab "${id}" is an enemy; the platformer template has no enemies (use level hazards)`);
  const upgradeStat: PlatStat[] = [];
  const statSteps = PLAT_STATS.map(() => 0);
  for (const [id, u] of m.upgrades) {
    const i = PLAT_STATS.indexOf(u.stat as PlatStat);
    if (i < 0) {
      issues.push(`upgrade "${id}" raises ${u.stat}; platformer upgrades raise one of: ${PLAT_STATS.join(", ")}`);
      upgradeStat.push("speed");
      continue;
    }
    if (u.stat === "speed" && u.step > 0.5) issues.push(`upgrade "${id}": a speed step above 0.5 (+50% a level) breaks the courses`);
    if (u.stat === "amount" && u.step > 1) issues.push(`upgrade "${id}": at most 1 extra air jump a level`);
    statSteps[i] = u.step;
    upgradeStat.push(u.stat as PlatStat);
  }
  const names: string[] = [];
  const levels: PlatformLevel[] = (g.levels ?? []).map((l, li) => {
    names.push(l.name ?? `Level ${li + 1}`);
    const solids = l.blocks.map(([x, y, w, h]) => box(x, y, w, h));
    const where = `levels[${li}]`;
    const inside = (x: number, y: number) => solids.some((b) => x > b[0] + 0.05 && x < b[2] - 0.05 && y > b[1] + 0.05 && y < b[3] - 0.05);
    const body = (x: number, y: number) => solids.some((b) => x + PLAT_HALF_W > b[0] + 0.01 && x - PLAT_HALF_W < b[2] - 0.01 && y + PLAT_HEIGHT > b[1] + 0.01 && y < b[3] - 0.01);
    if (body(l.start[0], l.start[1])) issues.push(`${where}.start [${l.start.join(", ")}] is inside a block: put it on top of one (y = the block's top)`);
    if (l.flag[0] <= l.start[0] + 5) issues.push(`${where}.flag must be at least 5 m right of start (x runs from start to flag)`);
    if (body(l.flag[0], l.flag[1])) issues.push(`${where}.flag [${l.flag.join(", ")}] is inside a block: stand it on top of one`);
    l.coins.forEach(([x, y], i) => {
      if (inside(x, y)) issues.push(`${where}.coins[${i}] [${x}, ${y}] is inside a block`);
    });
    let lastX = -Infinity;
    l.checkpoints.forEach(([x, y], i) => {
      if (body(x, y)) issues.push(`${where}.checkpoints[${i}] [${x}, ${y}] is inside a block`);
      if (x <= lastX) issues.push(`${where}.checkpoints are in course order: each one further right than the last`);
      lastX = x;
    });
    const lowest = Math.min(...solids.map((b) => b[1]), l.start[1]);
    return {
      start: l.start,
      flag: l.flag,
      killY: l.killY ?? lowest - 8,
      solids,
      ledges: l.ledges.map(([x, y, w]) => box(x, y - 0.3, w, 0.3)),
      hazards: l.hazards.map(([x, y, w, h]) => box(x, y, w, h)),
      springs: l.springs.map(([x, y, power]) => ({ x, y, power })),
      movers: l.movers.map((mv) => ({
        box: box(mv.at[0], mv.at[1] - 0.3, mv.at[2], 0.3),
        dx: mv.to[0],
        dy: mv.to[1],
        periodTicks: Math.max(2, Math.round(mv.seconds * tickRate)),
        phaseTicks: Math.round(mv.phase * mv.seconds * tickRate),
      })),
      coins: l.coins,
      checkpoints: l.checkpoints,
    };
  });
  const mo = g.motor ?? {};
  const tuning: Partial<PlatformTuning> = Object.fromEntries(Object.entries(mo).filter(([, v]) => v !== undefined));
  return { levels, names, tuning, statSteps, upgradeStat };
}

// ---------------------------------------------------------------- bots

/** Per-bot memory for the course runner. */
export interface PlatformBotMemory {
  bestX: number;
  since: number;
  holdJump: number;
  /** The planned run this bot follows, from the tick it started. */
  tape?: readonly InputCommand[] | null;
  tapeAt?: number;
}

const surfaces = (lv: PlatformLevel, tick: number): PlatBox[] => [...lv.solids, ...lv.ledges, ...lv.movers.map((m) => moverBox(m, tick))];

/** Is there something to stand on at x, at most `drop` metres below y (and not above y + up)? */
function groundAt(lv: PlatformLevel, x: number, y: number, drop: number, tick: number, up = 0.05): boolean {
  for (const b of surfaces(lv, tick)) if (x > b[0] - 0.05 && x < b[2] + 0.05 && b[3] <= y + up && b[3] >= y - drop) return true;
  return false;
}

/**
 * What a course-running bot does this tick: run toward the flag, jump at
 * walls, gaps and hazards, wait for a moving platform, hold Jump for a full
 * jump, dash across a gap it is falling into. Deterministic.
 */
export function platformBotInput(w: PlatformWorld, p: PlatformPlayer, mem: PlatformBotMemory, clock: number, skill: number): InputCommand {
  const lv = w.level;
  const idle = { seq: 0, tick: clock, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 };
  if ((p.flags & (PlatFlag.Finished | PlatFlag.Dead | PlatFlag.Frozen)) !== 0) return idle;
  const dir = lv.flag[0] >= p.x ? 1 : -1;
  const grounded = (p.flags & PlatFlag.Grounded) !== 0;
  const t = w.tick;
  const look = 0.55 + Math.abs(p.vx) * 0.12;
  const ax = p.x + dir * look;
  const wall = lv.solids.some((b) => ax + PLAT_HALF_W > b[0] && ax - PLAT_HALF_W < b[2] && p.y + 0.15 < b[3] && p.y + PLAT_HEIGHT > b[1]);
  const gap = !groundAt(lv, p.x + dir * (PLAT_HALF_W + 0.35), p.y, 0.6, t);
  const hazard = lv.hazards.some((b) => b[0] < p.x + dir * 2.4 + 0.3 && b[2] > p.x - 0.3 && (dir > 0 ? b[2] > p.x : b[0] < p.x) && b[3] > p.y - 0.4 && b[1] < p.y + 1.2);
  // A higher ledge just ahead with nothing to walk onto: jump up to it.
  const step = lv.solids.concat(lv.ledges).some((b) => (dir > 0 ? b[0] - p.x : p.x - b[2]) < 2.6 && (dir > 0 ? b[2] > p.x : b[0] < p.x) && b[3] > p.y + 0.5 && b[3] < p.y + 3.1);
  let moveX = dir * (0.6 + 0.4 * skill);
  let buttons = 0;
  if (grounded) {
    // A moving platform across the gap: wait until it is close.
    const ridingMover = (p.flags & PlatFlag.OnMover) !== 0;
    if (gap && !ridingMover) {
      const mv = lv.movers.find((m) => {
        const b0 = moverBox(m, t);
        const span0 = Math.min(b0[0], b0[0] + m.dx);
        const span1 = Math.max(b0[2], b0[2] + m.dx);
        return (dir > 0 ? span1 > p.x : span0 < p.x) && Math.abs((dir > 0 ? span0 : span1) - p.x) < 7;
      });
      if (mv) {
        const soon = moverBox(mv, t + Math.round(0.35 * w.tickRate));
        const near = dir > 0 ? soon[0] - (p.x + PLAT_HALF_W) : p.x - PLAT_HALF_W - soon[2];
        if (near > 1.6 || soon[3] > p.y + 2.8 || soon[3] < p.y - 3) moveX = 0;
        else buttons |= Button.Jump;
      } else buttons |= Button.Jump;
    } else if (wall || hazard || (gap && !ridingMover) || (step && wall)) buttons |= Button.Jump;
    if (ridingMover) {
      // Ride until the next solid ground is in reach, then jump off.
      const land = groundAt(lv, p.x + dir * 2.5, p.y + 1.5, 3, t, 1.6);
      if (land) buttons |= Button.Jump;
      else moveX = 0;
    }
    mem.holdJump = buttons & Button.Jump ? Math.round(0.4 * w.tickRate) : 0;
  } else {
    if (mem.holdJump > 0 && p.vy > 0) {
      mem.holdJump--;
      buttons |= Button.Jump;
    }
    // Falling into a gap: dash toward the flag if there is ground within a dash.
    if (p.vy < -2 && (p.flags & PlatFlag.DashReady) !== 0 && !groundAt(lv, p.x, p.y, 4, t) && groundAt(lv, p.x + dir * 3.2, p.y + 0.5, 2.5, t, 1)) buttons |= Button.Sprint;
    // Do not drift into a hazard below.
    const below = lv.hazards.some((b) => p.x + PLAT_HALF_W > b[0] && p.x - PLAT_HALF_W < b[2] && b[3] <= p.y && b[3] > p.y - 3);
    if (below) moveX = dir;
  }
  if (p.x * dir > mem.bestX * dir + 0.3) {
    mem.bestX = p.x;
    mem.since = clock;
  }
  return { seq: 0, tick: clock, moveX, moveZ: 0, yaw: 0, buttons };
}

// ---------------------------------------------------------------- route planner

export interface PlanResult {
  readonly found: boolean;
  /** Seconds the route takes. */
  readonly seconds: number;
  /** Furthest x reached. */
  readonly bestX: number;
  readonly expanded: number;
  /** One input per tick from the start signal. */
  readonly tape: readonly InputCommand[];
}

/**
 * Search for a run from the start to the flag (the gate's softlock check:
 * every level must be finishable). Best-first over short macro moves (run,
 * jump of three heights, dash, wait) on a one-player copy of the sim, keyed
 * by position cells so it never re-explores. Moving platforms run on the
 * real clock from `startTick`.
 */
export function planCourse(
  level: PlatformLevel,
  opts: { tickRate: number; tuning?: Partial<PlatformTuning>; statSteps?: readonly number[]; startTick?: number; budget?: number; from?: ReturnType<typeof capturePlatformPlayer> },
): PlanResult {
  const rate = opts.tickRate;
  const w = createPlatformWorld({ tickRate: rate, levels: [level], ...(opts.tuning ? { tuning: opts.tuning } : {}), ...(opts.statSteps ? { statSteps: opts.statSteps } : {}) });
  // From a given state (a climber mid-course), or from the start at `startTick`.
  const p0 = opts.from ? applyPlatformPlayer(w, { ...opts.from, id: 1, cosmetic: opts.from.cosmetic & 0xff }) : addPlatformPlayer(w, 1);
  if (!opts.from) w.tick = opts.startTick ?? 0;
  p0.flags &= ~(PlatFlag.Frozen | PlatFlag.Bot);
  type Node = { s: ReturnType<typeof capturePlatformPlayer>; tape: InputCommand[]; score: number };
  const seg = Math.max(4, Math.round(rate / 7.5));
  const mk = (moveX: number, buttons: number): InputCommand => ({ seq: 0, tick: 0, moveX, moveZ: 0, yaw: 0, buttons });
  const macros: InputCommand[][] = [];
  for (const d of [1, -1]) {
    macros.push(Array.from({ length: seg }, () => mk(d, 0)));
    for (const hold of [3, Math.round(rate * 0.16), Math.round(rate * 0.5)]) macros.push(Array.from({ length: Math.max(seg, hold + 2) }, (_, i) => mk(d, i < hold ? Button.Jump : 0)));
    macros.push(Array.from({ length: seg }, (_, i) => mk(d, i === 0 ? Button.Sprint : 0)));
    macros.push(Array.from({ length: seg }, (_, i) => mk(d, i === 1 ? Button.Jump : 0)));
  }
  macros.push(Array.from({ length: seg }, () => mk(0, 0)));
  macros.push(Array.from({ length: seg * 3 }, () => mk(0, 0)));
  const key = (p: PlatformPlayer) => `${Math.round(p.x * 2.5)},${Math.round(p.y * 2.5)},${p.flags & PlatFlag.Grounded ? 1 : 0},${p.vy > 0 ? 1 : 0},${Math.floor(w.tick / Math.max(1, Math.round(rate * 0.5))) % 64}`;
  const seen = new Set<string>();
  const open: Node[] = [{ s: capturePlatformPlayer(w, p0), tape: [], score: p0.x }];
  let best = p0.x;
  let expanded = 0;
  const budget = opts.budget ?? 25_000;
  const span = Math.max(1, level.flag[0] - level.start[0]);
  while (open.length > 0 && expanded < budget) {
    // Pop the most promising (furthest right, then shortest).
    let bi = 0;
    for (let i = 1; i < open.length; i++) if ((open[i] as Node).score > (open[bi] as Node).score) bi = i;
    const node = open[bi] as Node;
    open[bi] = open[open.length - 1] as Node;
    open.pop();
    expanded++;
    for (const mac of macros) {
      const p = applyPlatformPlayer(w, node.s);
      let fell = false;
      let done = false;
      const tape = node.tape.concat(mac);
      for (const c of mac) {
        const ev = platformStep(w, new Map([[1, c]]));
        if (ev.some((e) => e.type === "fell")) fell = true;
        if (p.flags & PlatFlag.Finished) {
          done = true;
          break;
        }
      }
      if (fell) continue;
      if (done) return { found: true, seconds: tape.length / rate, bestX: level.flag[0], expanded, tape };
      const k = key(p);
      if (seen.has(k)) continue;
      seen.add(k);
      best = Math.max(best, p.x);
      // Progress first; a little weight on staying high (ledges lead up).
      open.push({ s: capturePlatformPlayer(w, p), tape, score: p.x + p.y * 0.15 - tape.length * (span / (rate * 600)) });
    }
  }
  return { found: false, seconds: 0, bestX: best, expanded, tape: [] };
}

// ---------------------------------------------------------------- core

/** Planned runs by starting state (course, tick, body), shared by every room of a process (courses never change). */
const ROUTES = new Map<string, readonly InputCommand[] | null>();
const ROUTE_CACHE_MAX = 256;
/** Courses the planner found no route through from the start: bots there run on reflexes, not routes. */
const UNROUTABLE = new WeakSet<PlatformLevel>();

/** True when routeFor found no way from this course's start to its flag. */
export function unroutable(level: PlatformLevel): boolean {
  return UNROUTABLE.has(level);
}

/**
 * A planned run from a climber's exact state (cached), or null when the
 * planner found none. Without `from`, from the start at `startTick`.
 */
export function routeFor(
  level: PlatformLevel,
  tickRate: number,
  tuning: Partial<PlatformTuning>,
  startTick: number,
  from?: ReturnType<typeof capturePlatformPlayer>,
): readonly InputCommand[] | null {
  const body = from ? { ...from, id: 0, cosmetic: 0, flags: from.flags & ~PlatFlag.Bot, clock: startTick } : null;
  const key = JSON.stringify([level.start, level.flag, level.solids.length, level.movers, level.solids[0], tickRate, tuning, startTick, body]);
  const hit = ROUTES.get(key);
  if (hit !== undefined) return hit;
  if (UNROUTABLE.has(level)) return null;
  const r = planCourse(level, { tickRate, tuning, ...(body ? { from: body } : { startTick }) });
  const tape = r.found ? r.tape : null;
  if (!tape && !body) UNROUTABLE.add(level);
  if (ROUTES.size >= ROUTE_CACHE_MAX) ROUTES.delete(ROUTES.keys().next().value as string);
  ROUTES.set(key, tape);
  return tape;
}

/** Seconds a bot of this skill waits after the start signal before running its route (quarter seconds). */
export function botDelaySeconds(id: number, skill: number): number {
  return Math.round(((1 - Math.max(0, Math.min(1, skill))) * 3 + (id % 4) * 0.25) * 4) / 4;
}

/** The platform sim as the race runner drives it. */
export class PlatformCore implements RaceCore {
  readonly tickRate: number;
  readonly world: PlatformWorld;
  private readonly memory = new Map<number, PlatformBotMemory>();
  /** World tick of this round's start signal (-1 while frozen). */
  private startTick = -1;
  /** Players present at the start signal: they may run a planned route. */
  private readonly starters = new Set<number>();

  constructor(readonly compiled: CompiledPlatformer, tickRate: number) {
    this.tickRate = tickRate;
    this.world = createPlatformWorld({ tickRate, levels: compiled.levels, tuning: compiled.tuning, statSteps: compiled.statSteps });
  }

  ids(): number[] {
    return [...this.world.players.keys()].sort((a, b) => a - b);
  }

  add(id: number, bot: boolean, frozen: boolean): void {
    if (this.world.players.has(id)) return;
    const p = addPlatformPlayer(this.world, id, { bot, frozen });
    resetPlatformPlayer(this.world, p, frozen);
    this.memory.set(id, { bestX: p.x, since: 0, holdJump: 0 });
  }

  remove(id: number): void {
    removePlatformPlayer(this.world, id);
    this.memory.delete(id);
    this.starters.delete(id);
  }

  reset(course: number, frozen: boolean): void {
    setPlatformLevel(this.world, course);
    this.world.tick = 0;
    for (const p of this.world.players.values()) {
      p.stats = 0;
      resetPlatformPlayer(this.world, p, frozen);
    }
    for (const m of this.memory.values()) {
      m.bestX = this.world.level.start[0];
      m.since = 0;
      m.holdJump = 0;
      delete m.tape;
      delete m.tapeAt;
    }
  }

  setFrozen(frozen: boolean): void {
    setPlatformFrozen(this.world, frozen);
    this.starters.clear();
    this.startTick = frozen ? -1 : this.world.tick;
    if (!frozen) for (const id of this.world.players.keys()) this.starters.add(id);
  }

  finished(id: number): boolean {
    return ((this.world.players.get(id)?.flags ?? 0) & PlatFlag.Finished) !== 0;
  }

  progress(id: number): number {
    const p = this.world.players.get(id);
    return p ? platformProgress(this.world, p) : 0;
  }

  position(id: number): readonly [number, number, number] {
    const p = this.world.players.get(id);
    return p ? [p.x, p.y, 0] : [0, 0, 0];
  }

  step(inputs: ReadonlyMap<number, InputCommand>): RaceSimEvent[] {
    const out: RaceSimEvent[] = [];
    for (const e of platformStep(this.world, inputs)) {
      if (e.type === "coin") out.push({ name: "coin.collected", player: e.player });
      else if (e.type === "checkpoint") out.push({ name: "checkpoint.reached", player: e.player });
      else if (e.type === "finish") out.push({ name: "player.finished", player: e.player });
      else if (e.type === "fell") out.push({ name: "player.fell", player: e.player });
      else if (e.type === "spring") out.push({ name: "spring.bounced", player: e.player });
    }
    return out;
  }

  botInput(id: number, clock: number, skill: number): InputCommand {
    const p = this.world.players.get(id);
    let mem = this.memory.get(id);
    if (!mem) {
      mem = { bestX: p?.x ?? 0, since: clock, holdJump: 0 };
      this.memory.set(id, mem);
    }
    const idle = { seq: 0, tick: clock, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 };
    if (!p) return idle;
    if ((p.flags & PlatFlag.Frozen) !== 0) mem.since = clock;
    // A bot that heard the start signal runs a planned route, after a wait its skill sets (looser bots start later).
    // The route is planned from the bot's exact state when it sets off (cached: every bot that waited the same
    // time stands in the same state), so playing it back is exact.
    if (this.startTick >= 0 && this.starters.has(id) && (p.flags & PlatFlag.Frozen) === 0) {
      const wait = Math.round(botDelaySeconds(id, skill) * this.tickRate);
      const at = this.world.tick - (this.startTick + wait);
      if (at < 0) return idle;
      if (at === 0 || mem.tapeAt === undefined) {
        mem.tape = routeFor(this.world.level, this.tickRate, this.compiled.tuning, this.world.tick, capturePlatformPlayer(this.world, p));
        mem.tapeAt = this.world.tick;
      }
      if (mem.tape) {
        const c = mem.tape[this.world.tick - (mem.tapeAt ?? 0)];
        return c ? { ...c, tick: clock } : idle;
      }
    }
    // A seat bot stuck for 5 s skips ahead to the next checkpoint (bots never earn; a stuck bot is no race).
    if (id >= BOT_PLAYER_BASE && clock - mem.since > 5 * this.tickRate && (p.flags & (PlatFlag.Finished | PlatFlag.Dead)) === 0) {
      const next = this.world.level.checkpoints[p.cp + 1];
      if (next) {
        p.x = next[0];
        p.y = next[1];
        p.vx = p.vy = 0;
      }
      mem.since = clock;
      mem.bestX = p.x;
    }
    return platformBotInput(this.world, p, mem, clock, skill);
  }

  grant(id: number, upgrade: number): boolean {
    const stat = this.compiled.upgradeStat[upgrade];
    return stat ? grantPlatformStat(this.world, id, stat) : false;
  }

  setCosmetic(id: number, cosmetic: number): void {
    const p = this.world.players.get(id);
    if (p) p.cosmetic = cosmetic & 0xff;
  }
}

// ---------------------------------------------------------------- netcode

/** Field indices of the platformer wire schema. */
export const PF = { x: 0, y: 1, vx: 2, vy: 3, flags: 4, timers: 5, timers2: 6, cp: 7, coinsLo: 8, coinsHi: 9, finishTick: 10, stats: 11, cosmetic: 12, clock: 13 } as const;

export const platformSchema: EntitySchema = {
  fields: [
    { name: "x", kind: "int", bits: 21, deltaBits: 12 },
    { name: "y", kind: "int", bits: 19, deltaBits: 12 },
    { name: "vx", kind: "int", bits: 17, deltaBits: 12 },
    { name: "vy", kind: "int", bits: 17, deltaBits: 12 },
    { name: "flags", kind: "uint", bits: 16, interp: "step" },
    { name: "timers", kind: "uint", bits: 32, interp: "step" },
    { name: "timers2", kind: "uint", bits: 32, interp: "step" },
    { name: "cp", kind: "uint", bits: 5, interp: "step" },
    { name: "coinsLo", kind: "uint", bits: 31, interp: "step" },
    { name: "coinsHi", kind: "uint", bits: 31, interp: "step" },
    { name: "finishTick", kind: "uint", bits: 20, interp: "step" },
    { name: "stats", kind: "uint", bits: 20, interp: "step" },
    { name: "cosmetic", kind: "uint", bits: 16, interp: "step" },
    { name: "clock", kind: "uint", bits: 20, interp: "step", deltaBits: 6 },
  ],
  xField: PF.x,
  yField: PF.y,
  unitsPerWorld: 1024,
};

/** The engine InputCommand on the wire (moves int8, yaw u16, buttons u16), shared by the race templates. */
export const raceInputCodec = {
  idle: { seq: 0, tick: 0, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 } as InputCommand,
  write(w: BitWriter, i: InputCommand): void {
    const axis = (v: number) => (Number.isFinite(v) ? Math.round(Math.max(-1, Math.min(1, v)) * 127) : 0);
    w.writeSigned(axis(i.moveX), 8);
    w.writeSigned(axis(i.moveZ), 8);
    const TAU = Math.PI * 2;
    w.writeBits(Number.isFinite(i.yaw) ? Math.round(((((i.yaw % TAU) + TAU) % TAU) / TAU) * 65536) & 0xffff : 0, 16);
    w.writeBits(i.buttons & 0xffff, 16);
  },
  read(r: BitReader): InputCommand {
    const moveX = r.readSigned(8) / 127;
    const moveZ = r.readSigned(8) / 127;
    const yaw = (r.readBits(16) / 65536) * Math.PI * 2;
    return { seq: 0, tick: 0, moveX, moveZ, yaw, buttons: r.readBits(16) };
  },
};

export interface PlatformRoomWorld {
  readonly role: "server" | "client";
  readonly core: PlatformCore;
  readonly runner: RaceRunner | null;
}

export interface PlatformAdapterOptions {
  readonly name: string;
  readonly version: string;
  readonly manifest: GameManifest;
  readonly compiled: CompiledPlatformer;
  readonly tickRate: number;
  readonly bots: number;
  readonly roundSeconds: number | null;
  readonly runner?: RaceRunnerOptions;
}

function toValues(s: ReturnType<typeof capturePlatformPlayer>): number[] {
  return [s.x, s.y, s.vx, s.vy, s.flags, s.timers, s.timers2, s.cp, s.coinsLo, s.coinsHi, s.finishTick, s.stats, s.cosmetic, s.clock];
}

function fromValues(e: EntityState): ReturnType<typeof capturePlatformPlayer> {
  const v = (i: number) => Math.round(e.values[i] ?? 0);
  return {
    id: e.id,
    x: v(PF.x),
    y: v(PF.y),
    vx: v(PF.vx),
    vy: v(PF.vy),
    flags: v(PF.flags),
    timers: v(PF.timers) >>> 0,
    timers2: v(PF.timers2) >>> 0,
    cp: v(PF.cp),
    coinsLo: v(PF.coinsLo) >>> 0,
    coinsHi: v(PF.coinsHi) >>> 0,
    finishTick: v(PF.finishTick),
    stats: v(PF.stats) >>> 0,
    cosmetic: v(PF.cosmetic),
    clock: v(PF.clock),
  };
}

/** The platformer's SimAdapter: the room runs the race; a client predicts only its own runner. */
export function platformAdapter(o: PlatformAdapterOptions): SimAdapter<PlatformRoomWorld, InputCommand> {
  const upgradeIds = [...o.manifest.upgrades.keys()];
  const gear = new Set([...o.manifest.skus.values()].flatMap((s) => (s.grants && "gear" in s.grants ? [s.grants.gear] : [])));
  return {
    name: o.name,
    version: o.version,
    tickHz: o.tickRate,
    schema: platformSchema,
    input: raceInputCodec,
    maxInputsPerTick: 1,
    createWorld(seed, role) {
      const core = new PlatformCore(o.compiled, o.tickRate);
      const runner = role === "server" ? new RaceRunner(o.manifest, core, { bots: o.bots, roundSeconds: o.roundSeconds, courses: o.compiled.levels.length, seed, ...o.runner }) : null;
      return { role, core, runner };
    },
    addPlayer(w, player) {
      if (w.runner) w.runner.joined(player);
      else w.core.add(player, false, false);
      return player;
    },
    removePlayer(w, player) {
      if (w.runner) w.runner.left(player);
      else w.core.remove(player);
    },
    step(w, inputsByPlayer) {
      const inputs = new Map<PlayerId, InputCommand>();
      for (const [p, list] of inputsByPlayer) {
        const c = list[0];
        if (c) inputs.set(p, c);
      }
      if (!w.runner) {
        w.core.step(inputs);
        return [];
      }
      w.runner.beforeStep(inputs);
      const r = w.runner.afterStep(w.core.step(inputs));
      const out: SimEvent[] = [];
      for (const a of r.awards) out.push({ type: "earn", player: a.player, rule: a.rule, units: a.units });
      for (const p of w.runner.takeProgress()) out.push({ type: "progress", player: p.player, kind: p.kind, id: p.id });
      if (r.reset) out.push({ type: "run.reset" });
      return out;
    },
    snapshot(w) {
      return w.core.ids().map((id) => {
        const p = w.core.world.players.get(id) as PlatformPlayer;
        return { id, kind: 1, owner: id, values: toValues(capturePlatformPlayer(w.core.world, p)) };
      });
    },
    applySnapshot(w, entities) {
      for (const e of entities) applyPlatformPlayer(w.core.world, fromValues(e));
    },
    info(w) {
      return w.runner ? { ...w.runner.info(), level: o.compiled.names[w.runner.courseNow] ?? null } : null;
    },
    startRun(w, player) {
      w.runner?.startRun(player);
    },
    command(w, player, cmd: SimCommand) {
      if (cmd.name === "cosmetic") {
        w.core.setCosmetic(player, cmd.value ?? 0);
        return true;
      }
      const up = upgradeIds.indexOf(cmd.name);
      if (up < 0) return false;
      // A store SKU named after an upgrade, or gear the room issues at a staked run's start.
      if (!o.manifest.skus.has(cmd.name) && !gear.has(cmd.name)) return false;
      const stat = o.compiled.upgradeStat[up];
      const def = o.manifest.upgrades.get(cmd.name);
      const p = w.core.world.players.get(player);
      if (!stat || !def || !p) return false;
      // One level per SKU a round, up to the upgrade's maxLevel.
      const lvl = (p.stats >>> (PLAT_STATS.indexOf(stat) * 4)) & 0xf;
      if (lvl >= def.maxLevel) return false;
      return w.core.grant(player, up);
    },
    disposeWorld() {},
  };
}

/** Throw the collected compile issues, agent-readable. */
export function assertNoIssues(issues: readonly string[]): void {
  if (issues.length > 0) throw new GameDefinitionError("game module", issues);
}

/**
 * A playing autopilot for a client (measurement, previews, load tests): from
 * the newest predicted state of our own climber it plans a route to the flag
 * (cached by state), plays it back tick for tick on the course clock, and
 * replans after a fall, a new course or the end of the tape. Falls back to
 * the course bot's reflexes while no route is known.
 */
export function platformAutopilot(compiled: CompiledPlatformer, tickRate: number): (self: EntityState | undefined, course: number, tick: number) => InputCommand {
  const core = new PlatformCore(compiled, tickRate);
  let tape: { inputs: readonly InputCommand[]; start: number; course: number } | null = null;
  let lastPlan = -1e9;
  return (self, course, tick) => {
    const idle = { seq: 0, tick, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 };
    if (!self) return idle;
    const s = fromValues(self);
    if (s.flags & (PlatFlag.Frozen | PlatFlag.Finished | PlatFlag.Dead)) {
      if (s.flags & PlatFlag.Dead) tape = null;
      return idle;
    }
    if (tape && (tape.course !== course || s.clock - tape.start >= tape.inputs.length || s.clock < tape.start)) tape = null;
    const level = compiled.levels[course];
    if (!tape && level && tick - lastPlan > tickRate * 1.5) {
      lastPlan = tick;
      const r = routeFor(level, tickRate, compiled.tuning, s.clock, s);
      if (r) tape = { inputs: r, start: s.clock, course };
    }
    if (!tape) {
      const p = applyPlatformPlayer(core.world, s);
      if (core.world.levelIndex !== course) setPlatformLevel(core.world, course);
      return platformBotInput(core.world, p, { bestX: p.x, since: tick, holdJump: 0 }, tick, 1);
    }
    const c = tape.inputs[s.clock - tape.start];
    return c ? { ...c, tick } : idle;
  };
}
