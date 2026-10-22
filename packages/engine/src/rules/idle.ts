/**
 * The idle genre (template "idle"): a shared salt flat where up to eight
 * players each run a works. Pumps make brine, pans boil it into salt, kilns
 * cut salt into crystals; salt buys and levels plants; crystals go to a
 * contract everyone fills together. A shift has a fixed length; then the
 * room shows the end screen and a new shift starts from nothing.
 *
 * Why an idle game here cannot be farmed (the server is the referee):
 *  - Production happens only in `step`, on the room's ticks, for players in
 *    the room. There is no wall clock and no offline accrual: a player who
 *    leaves takes nothing with them, and a returning player starts a fresh
 *    works (and a fresh referee run) from the shift's starting salt.
 *  - A works runs only while it is tended: an action (rake, buy, ship)
 *    within `tend` seconds. An AFK tab produces nothing after that.
 *  - Raking has a cooldown, so clicking faster than it adds nothing.
 *  - Earn rules pay once a run (a shift, or a seat's time in it), and the
 *    genre's own checks measure the earliest any rule can pay with perfect
 *    play from a fresh works (the gate refuses a draft whose first payout
 *    comes too soon), which bounds what one seat can earn an hour even by
 *    leaving and rejoining.
 *  - Everything is integer milli-units and the room replays a run from its
 *    inputs exactly (referee/verify.ts).
 */
import type { GameManifest } from "../api/registry.js";
import { idleContent, type PlantDef } from "../api/idle.js";
import type { GameEvent } from "../game/earn.js";
import type { EntityState } from "../net/schema.js";
import { entity, RulesKind, UNITS } from "./kit.js";
import type { Avatar, RulesCheck, RulesContext, RulesGenre, RulesHarnessRun, RulesInput, RulesStats, RunOutcome } from "./kit.js";

/** Actions (RulesInput.act). */
export const IdleAct = { Rake: 1, Buy: 2, Ship: 3 } as const;

/** Milli-units per unit (litres, kg, crystals). */
export const MILLI = 1000;
/** The gate's floor: no earn rule may pay sooner than this after a fresh works starts, with perfect play (seconds). */
export const IDLE_MIN_FIRST_EARN = 180;

/** Plot layout: four across, two deep, each 12 x 10 m. */
export const PLOT = { w: 12, d: 10, cols: 4, rows: 2, gapX: 1.5, gapZ: 5 } as const;
export const IDLE_SEATS = PLOT.cols * PLOT.rows;

/** A plot's centre in metres. Rows sit either side of the canal the contract barge waits on. */
export function plotCenter(slot: number): { x: number; z: number } {
  const col = slot % PLOT.cols;
  const row = Math.floor(slot / PLOT.cols) % PLOT.rows;
  return { x: (col - (PLOT.cols - 1) / 2) * (PLOT.w + PLOT.gapX), z: (row === 0 ? -1 : 1) * (PLOT.d / 2 + PLOT.gapZ / 2) };
}

/** Where plant `i` stands on a plot (two rows of four), metres from the plot centre. */
export function plantSpot(i: number): { x: number; z: number } {
  return { x: ((i % 4) - 1.5) * 2.7, z: (Math.floor(i / 4) === 0 ? -1.8 : 1.2) };
}

export interface Works {
  slot: number;
  brine: number;
  salt: number;
  crystals: number;
  /** Salt made this shift (milli), raked and boiled. */
  made: number;
  packs: number;
  /** Crystal progress (milli). */
  cutAcc: number;
  cut: number;
  levels: number[];
  lastTend: number;
  rakeAt: number;
  shipped: number;
  rakes: number;
}

export interface IdleState {
  rng: { s: number };
  ctx: RulesContext;
  tick: number;
  players: Map<number, Works>;
  contract: number;
  filled: boolean;
  done: boolean;
  activity: number;
}

export interface CompiledIdleGame {
  readonly shiftTicks: number;
  readonly tendTicks: number;
  readonly start: number;
  readonly rakeSalt: number;
  readonly rakeTicks: number;
  readonly brinePerSalt: number;
  readonly saltPerCrystal: number;
  readonly packEvery: number;
  readonly contract: number;
  readonly plants: readonly { readonly id: string; readonly def: PlantDef }[];
}

const TICK = 30;

export function compileIdleGame(m: GameManifest): CompiledIdleGame {
  const c = idleContent(m);
  return {
    shiftTicks: Math.round(c.flat.shift * TICK),
    tendTicks: Math.round(c.flat.tend * TICK),
    start: Math.round(c.flat.start * MILLI),
    rakeSalt: Math.round(c.flat.rake.salt * MILLI),
    rakeTicks: Math.max(1, Math.round(c.flat.rake.cooldown * TICK)),
    brinePerSalt: c.flat.brinePerSalt,
    saltPerCrystal: c.flat.saltPerCrystal,
    packEvery: Math.round(c.flat.packEvery * MILLI),
    contract: c.flat.contract.crystals,
    plants: c.plants.map(([id, def]) => ({ id, def })),
  };
}

/** Salt (milli) the next level of plant `i` costs at `level`. */
export function plantCost(g: CompiledIdleGame, i: number, level: number): number {
  const p = g.plants[i]?.def;
  if (!p) return Infinity;
  return Math.round(p.cost * Math.pow(p.growth, level) * MILLI);
}

/** Per-second rates a works runs at (litres, kg, crystals), before tending. */
export function works(g: CompiledIdleGame, w: Pick<Works, "levels">, might: number): { pump: number; pan: number; kiln: number } {
  let pump = 0;
  let pan = 0;
  let kiln = 0;
  g.plants.forEach((p, i) => {
    const r = p.def.rate * (w.levels[i] ?? 0) * (1 + might);
    if (p.def.kind === "pump") pump += r;
    else if (p.def.kind === "pan") pan += r;
    else kiln += r;
  });
  return { pump, pan, kiln };
}

/** Bot policies: "best" plays the chain as well as the template knows, "human" slower, "clicker" only rakes, "idle" does nothing. */
export type IdlePolicy = "best" | "human" | "clicker" | "idle";

export function idleGenre(m: GameManifest): RulesGenre<IdleState> & { readonly game: CompiledIdleGame; policyInput(s: IdleState, player: number, a: Avatar, tick: number, policy: IdlePolicy): RulesInput } {
  const g = compileIdleGame(m);
  const tickRate = TICK;
  const AVATAR_STEP = Math.round((8 * UNITS) / tickRate);
  const half = { x: (PLOT.cols * (PLOT.w + PLOT.gapX)) / 2 + 2, z: PLOT.d + PLOT.gapZ / 2 + 2 };
  const humans = (s: IdleState): number[] => [...s.players.keys()].filter((p) => !s.ctx.isBot(p));

  const add = (s: IdleState, p: number, w: Works, salt: number, emit: (e: GameEvent) => void): void => {
    w.salt += salt;
    w.made += salt;
    while (w.made >= (w.packs + 1) * g.packEvery) {
      w.packs++;
      emit({ name: "salt.packed", players: [p], own: true });
    }
  };

  const tend = (s: IdleState, w: Works): void => {
    w.lastTend = s.tick;
  };

  const policyInput = (s: IdleState, player: number, a: Avatar, tick: number, policy: IdlePolicy): RulesInput => {
    const w = s.players.get(player);
    const c = plotCenter(w?.slot ?? 0);
    const idle: RulesInput = { mx: 0, mz: 0, cx: Math.round(c.x * 16), cz: Math.round(c.z * 16), act: 0, a: 0, b: 0, c: 0 };
    if (!w || policy === "idle") return idle;
    const act = (k: number, aa = 0): RulesInput => ({ ...idle, act: k, a: aa });
    const rakeReady = s.tick >= w.rakeAt;
    if (policy === "clicker") return rakeReady ? act(IdleAct.Rake) : idle;
    // A person reacts in about a second and does one thing at a time.
    if (policy === "human" && (tick + player * 11) % 20 !== 0) return idle;
    const r = works(g, w, s.ctx.bonus(player, "might"));
    // Buy what the chain is short of: pumps until the pans are fed, pans until the brine is boiled, kilns once salt flows.
    const saltRate = Math.min(r.pan, r.pump / g.brinePerSalt);
    const kind = r.pump / g.brinePerSalt <= r.pan ? "pump" : "pan";
    const late = s.tick > g.shiftTicks * 0.35;
    const wantKind = late && saltRate > r.kiln * g.saltPerCrystal * 2 ? "kiln" : kind;
    let best = -1;
    let bestScore = Infinity;
    g.plants.forEach((p, i) => {
      if (p.def.kind !== wantKind || (w.levels[i] ?? 0) >= p.def.max) return;
      const score = plantCost(g, i, w.levels[i] ?? 0) / p.def.rate;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0 && w.salt >= plantCost(g, best, w.levels[best] ?? 0)) return act(IdleAct.Buy, best);
    if (rakeReady) return act(IdleAct.Rake);
    if (w.crystals >= MILLI && !s.filled) return act(IdleAct.Ship, Math.floor(w.crystals / MILLI));
    return idle;
  };

  /** One fresh works on its own for a whole shift under a policy: the tick each rule's event count first reaches its n. */
  const solo = (policy: IdlePolicy): { first: Map<string, number>; packs: number } => {
    const isBot = () => false;
    const ctx: RulesContext = { bonus: () => 0, isBot };
    const s = genre.create(7, ctx);
    genre.join(s, 1);
    const a: Avatar = { x: 0, z: 0, yaw: 0, cosmetic: 0, flags: 0 };
    const counts = new Map<string, number>();
    const first = new Map<string, number>();
    const emit = (e: GameEvent) => {
      if (!e.players.includes(1)) return;
      const n = (counts.get(e.name) ?? 0) + 1;
      counts.set(e.name, n);
      for (const [id, r] of m.earnRules) if (r.when === e.name && n >= r.n && !first.has(id)) first.set(id, s.tick);
    };
    for (let t = 0; t < g.shiftTicks && !s.done; t++) {
      const i = policyInput(s, 1, a, t, policy);
      if (i.act !== 0) genre.act(s, 1, i, a, emit);
      genre.step(s, emit);
    }
    return { first, packs: s.players.get(1)?.packs ?? 0 };
  };

  const genre: RulesGenre<IdleState> & { readonly game: CompiledIdleGame; policyInput: typeof policyInput } = {
    template: "idle",
    tickRate,
    endSeconds: 10,
    infoEveryTicks: 6,
    game: g,
    policyInput,

    create(seed, ctx) {
      return { rng: { s: seed | 0 }, ctx, tick: 0, players: new Map(), contract: 0, filled: false, done: false, activity: 0 };
    },

    spawn(s, player) {
      const slot = s?.players.get(player)?.slot ?? 0;
      const c = plotCenter(slot);
      return { x: Math.round(c.x * UNITS), z: Math.round((c.z + 3.6) * UNITS) };
    },

    moveAvatar(a: Avatar, i: RulesInput) {
      if (i.cx === 0 && i.cz === 0 && i.act === 0) return;
      const tx = Math.round(Math.max(-half.x, Math.min(half.x, i.cx / 16)) * UNITS);
      const tz = Math.round(Math.max(-half.z, Math.min(half.z, i.cz / 16)) * UNITS);
      const dx = tx - a.x;
      const dz = tz - a.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 1) return;
      if (d <= AVATAR_STEP) {
        a.x += dx;
        a.z += dz;
      } else {
        a.x += Math.round((dx * AVATAR_STEP) / d);
        a.z += Math.round((dz * AVATAR_STEP) / d);
      }
      if (d > 8) a.yaw = Math.round((Math.atan2(-dx, -dz) / (Math.PI * 2)) * 65536) & 0xffff;
    },

    join(s, player) {
      const used = new Set([...s.players.values()].map((w) => w.slot));
      let slot = 0;
      while (used.has(slot) && slot < IDLE_SEATS - 1) slot++;
      // A fresh works every time: nothing carries over from an earlier seat, a closed tab or another shift.
      s.players.set(player, { slot, brine: 0, salt: g.start, crystals: 0, made: 0, packs: 0, cutAcc: 0, cut: 0, levels: g.plants.map(() => 0), lastTend: s.tick, rakeAt: s.tick, shipped: 0, rakes: 0 });
      s.activity++;
    },

    leave(s, player) {
      s.players.delete(player);
    },

    act(s, player, i, _a, emit) {
      const w = s.players.get(player);
      if (!w || s.done) return;
      if (i.act === IdleAct.Rake) {
        if (s.tick < w.rakeAt) return;
        const haste = s.ctx.bonus(player, "haste");
        w.rakeAt = s.tick + Math.max(1, Math.round(g.rakeTicks / (1 + haste)));
        w.rakes++;
        tend(s, w);
        add(s, player, w, Math.round(g.rakeSalt * (1 + s.ctx.bonus(player, "amount"))), emit);
        s.activity++;
        return;
      }
      if (i.act === IdleAct.Buy) {
        const p = g.plants[i.a];
        if (!p) return;
        const lvl = w.levels[i.a] ?? 0;
        const cost = plantCost(g, i.a, lvl);
        if (lvl >= p.def.max || w.salt < cost) return;
        w.salt -= cost;
        w.levels[i.a] = lvl + 1;
        tend(s, w);
        s.activity++;
        emit({ name: lvl === 0 ? "plant.built" : "plant.upgraded", players: [player], own: true });
        return;
      }
      if (i.act === IdleAct.Ship) {
        const n = Math.min(Math.floor(w.crystals / MILLI), Math.max(1, i.a));
        if (n <= 0 || s.filled) return;
        w.crystals -= n * MILLI;
        w.shipped += n;
        s.contract += n;
        tend(s, w);
        s.activity++;
        for (let k = 0; k < n; k++) emit({ name: "crystal.shipped", players: [player], own: true });
        if (s.contract >= g.contract && !s.filled) {
          s.filled = true;
          // The whole flat's work: it pays the players who shipped to it (world progress, so never a run that started after the shift began).
          emit({ name: "contract.filled", players: [...s.players].filter(([id, x]) => x.shipped > 0 && !s.ctx.isBot(id)).map(([id]) => id) });
        }
      }
    },

    step(s, emit) {
      // The shift's clock runs only while someone is on the flat: an empty room is not a shift.
      if (humans(s).length === 0 || s.done) return;
      s.tick++;
      for (const [p, w] of s.players) {
        // An untended works stops: an AFK seat makes nothing.
        if (s.tick - w.lastTend > g.tendTicks) continue;
        const r = works(g, w, s.ctx.bonus(p, "might"));
        w.brine += Math.round((r.pump * MILLI) / tickRate);
        const boil = Math.min(Math.round((r.pan * MILLI) / tickRate), Math.floor(w.brine / g.brinePerSalt));
        if (boil > 0) {
          w.brine -= Math.round(boil * g.brinePerSalt);
          add(s, p, w, boil, emit);
        }
        const cutSalt = Math.min(Math.round((r.kiln * g.saltPerCrystal * MILLI) / tickRate), w.salt);
        if (cutSalt > 0) {
          w.salt -= cutSalt;
          w.cutAcc += Math.round(cutSalt / g.saltPerCrystal);
          while (w.cutAcc >= MILLI) {
            w.cutAcc -= MILLI;
            w.crystals += MILLI;
            w.cut++;
            emit({ name: "crystal.cut", players: [p], own: true });
          }
        }
      }
      if (s.tick % tickRate === 0) s.activity++;
      if (s.tick >= g.shiftTicks) {
        s.done = true;
        emit({ name: "shift.ended", players: humans(s) });
      }
    },

    outcome(s): RunOutcome | null {
      return s.done ? (s.filled ? "won" : "lost") : null;
    },

    view(s, player) {
      const me = player !== null ? s.players.get(player) : undefined;
      const left = Math.max(0, Math.ceil((g.shiftTicks - s.tick) / tickRate));
      return {
        genre: "idle",
        left,
        shift: Math.round(g.shiftTicks / tickRate),
        contract: s.contract,
        contractTarget: g.contract,
        filled: s.filled,
        players: [...s.players].map(([id, w]) => ({ id, slot: w.slot, made: Math.floor(w.made / MILLI), shipped: w.shipped, tended: s.tick - w.lastTend <= g.tendTicks })),
        ...(me && player !== null
          ? {
              slot: me.slot,
              brine: Math.floor(me.brine / MILLI),
              salt: Math.floor(me.salt / MILLI),
              crystals: Math.floor(me.crystals / MILLI),
              made: Math.floor(me.made / MILLI),
              nextPack: Math.round(((me.packs + 1) * g.packEvery) / MILLI),
              levels: me.levels,
              costs: g.plants.map((_, i) => Math.ceil(plantCost(g, i, me.levels[i] ?? 0) / MILLI)),
              stall: Math.max(0, Math.ceil((g.tendTicks - (s.tick - me.lastTend)) / tickRate)),
              rake: Math.max(0, me.rakeAt - s.tick),
              rates: works(g, me, s.ctx.bonus(player, "might")),
            }
          : {}),
      };
    },

    entities(s, out: EntityState[]) {
      const u = (m: number) => Math.round(m * UNITS);
      out.push(entity(1, RulesKind.Unit, 0, 0, 0, 0, 0, 0, s.filled ? 1 : 0, Math.min(0xffff, s.contract), Math.min(0xffff, g.contract)));
      for (const [p, w] of s.players) {
        const c = plotCenter(w.slot);
        const tended = s.tick - w.lastTend <= g.tendTicks ? 1 : 0;
        w.levels.forEach((lvl, i) => {
          if (lvl <= 0) return;
          const at = plantSpot(i);
          out.push(entity(0x100000 + p * 16 + i, RulesKind.Structure, p, u(c.x + at.x), u(c.z + at.z), 0, i, 0, tended, lvl, 0));
        });
        out.push(entity(0x200000 + p, RulesKind.Pickup, p, u(c.x + 4.6), u(c.z + 3.4), 0, 0, Math.floor(w.brine / MILLI), tended, Math.min(0xffff, Math.floor(w.salt / MILLI)), Math.min(0xffff, Math.floor(w.crystals / MILLI))));
      }
    },

    bot(s, player, a, tick, skill) {
      return policyInput(s, player, a, tick, skill >= 1 ? "best" : "human");
    },

    stats(s): RulesStats {
      let top = 0;
      let scorers = 0;
      let made = 0;
      let level = 0;
      for (const w of s.players.values()) {
        top = Math.max(top, w.packs);
        if (w.packs > 0) scorers++;
        made += w.packs;
        for (const l of w.levels) level = Math.max(level, l);
      }
      return { kills: made, wave: 1 + Math.floor((s.tick / Math.max(1, g.shiftTicks)) * 10), level, deaths: 0, peakUnits: s.players.size, scorers, topScore: top };
    },

    activity(s) {
      return s.activity;
    },

    checks(run: RulesHarnessRun): RulesCheck[] {
      const best = solo("best");
      const clicker = solo("clicker");
      const idle = solo("idle");
      const firstBest = Math.min(...[...best.first.values()].map((t) => t / tickRate), Infinity);
      const firstClick = Math.min(...[...clicker.first.values()].map((t) => t / tickRate), Infinity);
      // The most one seat can earn an hour: every rule paid as often as a fresh works can reach it (leaving and rejoining included).
      let perHour = 0;
      for (const [id, r] of m.earnRules) {
        const t = Math.min(best.first.get(id) ?? Infinity, clicker.first.get(id) ?? Infinity) / tickRate;
        if (Number.isFinite(t)) perHour += (r.pay * 3600) / Math.max(t, 1);
      }
      const min = Math.round(run.seconds / 6) / 10;
      return [
        { ok: idle.first.size === 0 && idle.packs === 0, line: "a seat that never acts must make nothing: the works must stall when untended (keep tend at 300 seconds or less and start salt below one crate)" },
        {
          ok: firstBest >= IDLE_MIN_FIRST_EARN && firstClick >= IDLE_MIN_FIRST_EARN,
          line: `the first earn rule pays ${Math.round(Math.min(firstBest, firstClick))} s into a fresh works with perfect play; it must take at least ${IDLE_MIN_FIRST_EARN} s (raise packEvery or the first rule's n, or slow raking), or a seat could farm it by rejoining`,
        },
        { ok: Object.keys(run.earned).length > 0 || run.seconds < 200, line: `no earn rule fired in ${min} minutes of ${run.players}-player play: make one reachable within about 4 minutes` },
        { ok: true, line: `bound: first payout after ${Math.round(Math.min(firstBest, firstClick))} s, at most ${Math.round(perHour)} coins an hour a seat` },
      ];
    },

    progress(run) {
      const shift = g.shiftTicks / tickRate;
      return Math.min(1, run.stats.topScore / 30) * 0.6 + (run.stats.level >= 5 ? 0.2 : 0) + (run.seconds >= shift || run.runs.won + run.runs.lost > 0 ? 0.2 : 0.1);
    },
  };
  return genre;
}
