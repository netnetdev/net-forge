/**
 * The racer template's machinery: compile a manifest's tracks into the
 * engine-sim kart sim, drive it with the race runner (race.ts), seat bots
 * that drive the racing line, a client autopilot, and the netcode
 * SimAdapter.
 */
import {
  Button,
  BOT_PLAYER_BASE,
  KART_STATS,
  KartFlag,
  addKart,
  applyKart,
  captureKart,
  createKartWorld,
  grantKartStat,
  kartProgress,
  kartStep,
  lateralOffset,
  nearestSample,
  removeKart,
  resetKart,
  setKartTrack,
  setKartsFrozen,
} from "@netnetcapital/engine-sim";
import type { InputCommand, Kart, KartStat, KartTrackDef, KartTuning, KartWorld } from "@netnetcapital/engine-sim";
import type { GameManifest } from "../api/registry.js";
import type { EntitySchema, EntityState } from "../net/schema.js";
import type { PlayerId, SimAdapter, SimCommand, SimEvent } from "../net/sim-adapter.js";
import { raceInputCodec } from "./platformer.js";
import { RaceRunner } from "./race.js";
import type { RaceCore, RaceRunnerOptions, RaceSimEvent } from "./race.js";

/** Racer defaults: a 4 minute limit, 60 Hz, five seat bots. */
export const RACER_DEFAULTS = { roundSeconds: 240, tickRate: 60, bots: 5 } as const;

export interface CompiledRacer {
  readonly tracks: readonly KartTrackDef[];
  readonly names: readonly string[];
  readonly tuning: Partial<KartTuning>;
  readonly statSteps: readonly number[];
  readonly upgradeStat: readonly KartStat[];
}

/** Compile the racer parts of a manifest. Issues are agent-readable. */
export function compileRacer(m: GameManifest, issues: string[]): CompiledRacer {
  const g = m.game;
  if (!g.tracks || g.tracks.length === 0) issues.push("a racer game sets tracks: [{ points, width, laps, ... }] (the circuits)");
  if (m.weapons.size > 0) issues.push("weapon(...) is not part of the racer template: boost pads, coins and drifts make the race");
  if (m.director) issues.push("director(...) is not part of the racer template");
  if (g.arena || g.field || g.levels) issues.push("arena, field and levels belong to other templates; a racer declares tracks");
  if (g.players.loadout) issues.push("players.loadout is for the arena template");
  if (m.keepers.size > 0) issues.push("keeper(...) is for the survivor template");
  for (const [id, p] of m.prefabs) if ((p.kind ?? "enemy") === "enemy" && !p.prop) issues.push(`prefab "${id}" is an enemy; the racer template has no enemies`);
  const upgradeStat: KartStat[] = [];
  const statSteps = KART_STATS.map(() => 0);
  for (const [id, u] of m.upgrades) {
    const i = KART_STATS.indexOf(u.stat as KartStat);
    if (i < 0) {
      issues.push(`upgrade "${id}" raises ${u.stat}; racer upgrades raise one of: ${KART_STATS.join(", ")}`);
      upgradeStat.push("speed");
      continue;
    }
    if (u.stat === "speed" && u.step > 0.2) issues.push(`upgrade "${id}": a speed step above 0.2 (+20% a level) breaks the races`);
    statSteps[i] = u.step;
    upgradeStat.push(u.stat as KartStat);
  }
  const names: string[] = [];
  const tracks: KartTrackDef[] = (g.tracks ?? []).map((t, ti) => {
    names.push(t.name ?? `Track ${ti + 1}`);
    const where = `tracks[${ti}]`;
    // Neighbouring control points closer than the width fold the road over itself.
    t.points.forEach((p, i) => {
      const q = t.points[(i + 1) % t.points.length] as readonly [number, number];
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 6) issues.push(`${where}.points[${i}] is within 6 m of the next point: spread the control points out`);
    });
    let len = 0;
    for (let i = 0; i < t.points.length; i++) {
      const p = t.points[i] as readonly [number, number];
      const q = t.points[(i + 1) % t.points.length] as readonly [number, number];
      len += Math.hypot(q[0] - p[0], q[1] - p[1]);
    }
    if (len < 200) issues.push(`${where} is ${Math.round(len)} m round; a lap needs at least 200 m`);
    return { points: t.points, width: t.width, laps: t.laps, boosts: t.boosts, coins: t.coins, verge: t.verge };
  });
  const kt = g.kart ?? {};
  const tuning: Partial<KartTuning> = Object.fromEntries(Object.entries(kt).filter(([, v]) => v !== undefined));
  return { tracks, names, tuning, statSteps, upgradeStat };
}

// ---------------------------------------------------------------- bots

/**
 * What a kart bot does: steer at a point on the racing line ahead (further
 * at speed), lift off for tight bends, and drift through long ones at
 * higher skill. `skill` 0..1 shades its top speed and its line.
 */
export function kartBotInput(w: KartWorld, k: Kart, clock: number, skill: number, lane = 0, mem?: { driftUntil: number }): InputCommand {
  const idle = { seq: 0, tick: clock, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 };
  if ((k.flags & (KartFlag.Frozen | KartFlag.Finished)) !== 0) return idle;
  const t = w.track;
  const speed = Math.hypot(k.vx, k.vz);
  const ahead = Math.round((8 + speed * 0.55) / 2);
  const i = (k.seg + ahead) % t.count;
  const far = (k.seg + ahead * 2) % t.count;
  const nx = -(t.tz[i] ?? 0);
  const nz = t.tx[i] ?? 0;
  // Pass a kart close ahead on our line: move over to the side it is not on.
  const fx = Math.cos(k.yaw);
  const fz = Math.sin(k.yaw);
  let pass = 0;
  for (const o of w.karts.values()) {
    if (o === k) continue;
    const dx = o.x - k.x;
    const dz = o.z - k.z;
    const ahead = dx * fx + dz * fz;
    const side = -dx * fz + dz * fx;
    if (ahead > 0 && ahead < 10 && Math.abs(side) < 2.2) pass = side >= 0 ? -1 : 1;
  }
  const off = Math.max(-0.8, Math.min(0.8, lane * 0.45 + pass * 0.55)) * t.half;
  const tx = (t.x[i] ?? 0) + nx * off;
  const tz = (t.z[i] ?? 0) + nz * off;
  const want = Math.atan2(tz - k.z, tx - k.x);
  let d = want - k.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const steer = Math.max(-1, Math.min(1, d * 2.2));
  // How sharp the road bends ahead: the angle between here and further on.
  const bend = Math.abs(Math.atan2((t.tx[i] ?? 0) * (t.tz[far] ?? 0) - (t.tz[i] ?? 0) * (t.tx[far] ?? 0), (t.tx[i] ?? 0) * (t.tx[far] ?? 0) + (t.tz[i] ?? 0) * (t.tz[far] ?? 0)));
  const cap = w.tuning.topSpeed * (0.78 + 0.2 * skill);
  let throttle = speed < cap ? 1 : 0;
  if (bend > 0.9 && speed > cap * 0.7) throttle = -0.3;
  let buttons = 0;
  const drifting = (k.flags & KartFlag.Drifting) !== 0;
  // Drift into a long bend and hold it through (a held drift charges the mini-turbo); let go as the road straightens.
  if (mem && skill > 0.55) {
    if (!drifting && bend > 0.5 && bend < 1.1 && speed > 14 && Math.abs(steer) > 0.35) mem.driftUntil = clock + Math.round((0.6 + skill * 0.3) * w.tickRate);
    // Let go early when the drift swings the nose past the line (the heading error flips against the drift).
    const dir = (k.flags & KartFlag.DriftRight) !== 0 ? 1 : -1;
    const overturn = drifting && d * dir < -0.25;
    if (!overturn && clock < mem.driftUntil) buttons |= Button.Sprint;
  }
  // A stuck kart (a wall nose-in) backs off and turns.
  if (speed < 2 && clock % 120 > 60) return { ...idle, moveX: -steer, moveZ: -1 };
  return { seq: 0, tick: clock, moveX: steer, moveZ: throttle, yaw: 0, buttons };
}

// ---------------------------------------------------------------- core

export class KartCore implements RaceCore {
  readonly tickRate: number;
  readonly world: KartWorld;
  private nextSlot = 0;
  private readonly memory = new Map<number, { driftUntil: number }>();

  constructor(
    readonly compiled: CompiledRacer,
    tickRate: number,
    authority = true,
  ) {
    this.tickRate = tickRate;
    this.world = createKartWorld({ tickRate, tracks: compiled.tracks, tuning: compiled.tuning, statSteps: compiled.statSteps, authority });
  }

  ids(): number[] {
    return [...this.world.karts.keys()].sort((a, b) => a - b);
  }

  /** The lowest grid slot nobody holds. */
  private freeSlot(): number {
    const used = new Set([...this.world.karts.values()].map((k) => k.slot));
    let s = 0;
    while (used.has(s)) s++;
    return s;
  }

  add(id: number, bot: boolean, frozen: boolean): void {
    if (this.world.karts.has(id)) return;
    addKart(this.world, id, { bot, frozen, slot: this.freeSlot() });
    this.nextSlot++;
  }

  remove(id: number): void {
    removeKart(this.world, id);
  }

  reset(course: number, frozen: boolean): void {
    setKartTrack(this.world, course);
    this.world.tick = 0;
    // People take the front of the grid, seat bots fill in behind them.
    const order = [...this.world.karts.values()].sort((a, b) => (a.id >= BOT_PLAYER_BASE ? 1 : 0) - (b.id >= BOT_PLAYER_BASE ? 1 : 0) || a.id - b.id);
    order.forEach((k, slot) => {
      k.slot = slot;
      k.stats = 0;
      resetKart(this.world, k, frozen);
    });
  }

  setFrozen(frozen: boolean): void {
    setKartsFrozen(this.world, frozen);
  }

  finished(id: number): boolean {
    return ((this.world.karts.get(id)?.flags ?? 0) & KartFlag.Finished) !== 0;
  }

  progress(id: number): number {
    const k = this.world.karts.get(id);
    return k ? Math.min(1, kartProgress(this.world, k) / this.world.track.def.laps) : 0;
  }

  position(id: number): readonly [number, number, number] {
    const k = this.world.karts.get(id);
    return k ? [k.x, 0, k.z] : [0, 0, 0];
  }

  step(inputs: ReadonlyMap<number, InputCommand>): RaceSimEvent[] {
    const out: RaceSimEvent[] = [];
    for (const e of kartStep(this.world, inputs)) {
      if (e.type === "coin") out.push({ name: "coin.collected", player: e.kart });
      else if (e.type === "lap") out.push({ name: "lap.completed", player: e.kart });
      else if (e.type === "finish") out.push({ name: "player.finished", player: e.kart });
      else if (e.type === "turbo") out.push({ name: e.tier >= 3 ? "drift.ultra" : "drift.boosted", player: e.kart });
      else if (e.type === "wall") out.push({ name: "kart.bumped", player: e.kart });
    }
    return out;
  }

  botInput(id: number, clock: number, skill: number): InputCommand {
    const k = this.world.karts.get(id);
    if (!k) return { seq: 0, tick: clock, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 };
    const lane = ((id * 7) % 5) / 2 - 1;
    let mem = this.memory.get(id);
    if (!mem) {
      mem = { driftUntil: 0 };
      this.memory.set(id, mem);
    }
    return kartBotInput(this.world, k, clock, skill, lane * 0.6, mem);
  }

  grant(id: number, upgrade: number): boolean {
    const stat = this.compiled.upgradeStat[upgrade];
    return stat ? grantKartStat(this.world, id, stat) : false;
  }

  setCosmetic(id: number, cosmetic: number): void {
    const k = this.world.karts.get(id);
    if (k) k.cosmetic = cosmetic & 0xff;
  }
}

// ---------------------------------------------------------------- netcode

/** Field indices of the racer wire schema. */
export const KF = { x: 0, z: 1, yaw: 2, vx: 3, vz: 4, flags: 5, timers: 6, track: 7, coinsLo: 8, coinsHi: 9, finishTick: 10, stats: 11, cosmetic: 12, clock: 13 } as const;

export const kartSchema: EntitySchema = {
  fields: [
    { name: "x", kind: "int", bits: 22, deltaBits: 12 },
    { name: "z", kind: "int", bits: 22, deltaBits: 12 },
    { name: "yaw", kind: "uint", bits: 16, interp: "step" },
    { name: "vx", kind: "int", bits: 18, deltaBits: 12 },
    { name: "vz", kind: "int", bits: 18, deltaBits: 12 },
    { name: "flags", kind: "uint", bits: 8, interp: "step" },
    { name: "timers", kind: "uint", bits: 25, interp: "step" },
    { name: "track", kind: "uint", bits: 28, interp: "step" },
    { name: "coinsLo", kind: "uint", bits: 31, interp: "step" },
    { name: "coinsHi", kind: "uint", bits: 31, interp: "step" },
    { name: "finishTick", kind: "uint", bits: 20, interp: "step" },
    { name: "stats", kind: "uint", bits: 20, interp: "step" },
    { name: "cosmetic", kind: "uint", bits: 16, interp: "step" },
    { name: "clock", kind: "uint", bits: 20, interp: "step", deltaBits: 6 },
  ],
  xField: KF.x,
  yField: KF.z,
  unitsPerWorld: 1024,
};

export interface KartRoomWorld {
  readonly role: "server" | "client";
  readonly core: KartCore;
  readonly runner: RaceRunner | null;
}

export interface KartAdapterOptions {
  readonly name: string;
  readonly version: string;
  readonly manifest: GameManifest;
  readonly compiled: CompiledRacer;
  readonly tickRate: number;
  readonly bots: number;
  readonly roundSeconds: number | null;
  readonly runner?: RaceRunnerOptions;
}

type Wire = ReturnType<typeof captureKart>;

function toValues(s: Wire): number[] {
  return [s.x, s.z, s.yaw, s.vx, s.vz, s.flags, s.timers, s.track, s.coinsLo, s.coinsHi, s.finishTick, s.stats, s.cosmetic, s.clock];
}

export function kartFromValues(e: EntityState): Wire {
  const v = (i: number) => Math.round(e.values[i] ?? 0);
  return {
    id: e.id,
    x: v(KF.x),
    z: v(KF.z),
    yaw: v(KF.yaw) & 0xffff,
    vx: v(KF.vx),
    vz: v(KF.vz),
    flags: v(KF.flags),
    timers: v(KF.timers) >>> 0,
    track: v(KF.track) >>> 0,
    coinsLo: v(KF.coinsLo) >>> 0,
    coinsHi: v(KF.coinsHi) >>> 0,
    finishTick: v(KF.finishTick),
    stats: v(KF.stats) >>> 0,
    cosmetic: v(KF.cosmetic),
    clock: v(KF.clock),
  };
}

/** The racer's SimAdapter: the room runs the race; a client predicts only its own kart (no bumps). */
export function kartAdapter(o: KartAdapterOptions): SimAdapter<KartRoomWorld, InputCommand> {
  const upgradeIds = [...o.manifest.upgrades.keys()];
  const gear = new Set([...o.manifest.skus.values()].flatMap((s) => (s.grants && "gear" in s.grants ? [s.grants.gear] : [])));
  return {
    name: o.name,
    version: o.version,
    tickHz: o.tickRate,
    schema: kartSchema,
    input: raceInputCodec,
    maxInputsPerTick: 1,
    createWorld(seed, role) {
      const core = new KartCore(o.compiled, o.tickRate, role === "server");
      const runner = role === "server" ? new RaceRunner(o.manifest, core, { bots: o.bots, roundSeconds: o.roundSeconds, courses: o.compiled.tracks.length, seed, ...o.runner }) : null;
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
      return w.core.ids().map((id) => ({ id, kind: 1, owner: id, values: toValues(captureKart(w.core.world, w.core.world.karts.get(id) as Kart)) }));
    },
    applySnapshot(w, entities) {
      for (const e of entities) applyKart(w.core.world, kartFromValues(e));
    },
    info(w) {
      return w.runner ? { ...w.runner.info(), level: o.compiled.names[w.runner.courseNow] ?? null, laps: w.core.world.track.def.laps } : null;
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
      if (!o.manifest.skus.has(cmd.name) && !gear.has(cmd.name)) return false;
      const stat = o.compiled.upgradeStat[up];
      const def = o.manifest.upgrades.get(cmd.name);
      const k = w.core.world.karts.get(player);
      if (!stat || !def || !k) return false;
      const lvl = (k.stats >>> (KART_STATS.indexOf(stat) * 4)) & 0xf;
      if (lvl >= def.maxLevel) return false;
      return w.core.grant(player, up);
    },
    disposeWorld() {},
  };
}

/** A client autopilot: the seat bot's driving on our newest predicted kart. */
export function kartAutopilot(compiled: CompiledRacer, tickRate: number): (self: EntityState | undefined, tick: number, skill?: number, others?: readonly EntityState[]) => InputCommand {
  const core = new KartCore(compiled, tickRate, false);
  const mem = { driftUntil: 0 };
  return (self, tick, skill = 1, others = []) => {
    if (!self) return { seq: 0, tick, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 };
    // The karts we can see, so we pass them instead of queueing behind.
    for (const id of [...core.world.karts.keys()]) if (id !== self.id && !others.some((o) => o.id === id)) core.world.karts.delete(id);
    for (const o of others) if (o.id !== self.id) applyKart(core.world, kartFromValues(o));
    const k = applyKart(core.world, kartFromValues(self));
    return kartBotInput(core.world, k, tick, skill, 0, mem);
  };
}

export { nearestSample, lateralOffset };
