/**
 * The race machinery shared by the platformer and the racer templates: a
 * round is a run (countdown, race, results), finishing order, seat bots that
 * fill empty places and never earn, the declared systems on the race clock,
 * earn rules, achievements and missions. Each template plugs its own sim in
 * through `RaceCore` (platformer.ts, racer.ts).
 *
 * Runs only on the authoritative side (room server, headless harness).
 * Clients predict their own body and read the rest from snapshots and the
 * broadcast `RaceInfo`.
 */
import type { InputCommand } from "@netnetcapital/engine-sim";
import { BOT_PLAYER_BASE, Button } from "@netnetcapital/engine-sim";
import { SystemScheduler } from "../api/scheduler.js";
import type { GameManifest, PlayerView } from "../api/registry.js";
import { EarnTracker } from "./earn.js";
import type { EarnAward, GameEvent } from "./earn.js";
import type { RunProgress } from "./profile.js";

/** What the sim says happened this tick, as named game events for one player. */
export interface RaceSimEvent {
  readonly name: string;
  readonly player: number;
}

/** A template's sim as the race runner drives it. */
export interface RaceCore {
  readonly tickRate: number;
  /** Player ids present, ascending. */
  ids(): number[];
  add(id: number, bot: boolean, frozen: boolean): void;
  remove(id: number): void;
  /** A fresh round on course `course`: everyone back to the start, run upgrades cleared, frozen or not. */
  reset(course: number, frozen: boolean): void;
  setFrozen(frozen: boolean): void;
  finished(id: number): boolean;
  /** Course progress, 0..1 (1: finished). */
  progress(id: number): number;
  position(id: number): readonly [number, number, number];
  /** One fixed tick. Events: "player.finished" plus the template's own ("coin.collected", "lap.completed", ...). */
  step(inputs: ReadonlyMap<number, InputCommand>): RaceSimEvent[];
  /** What a bot does now: deterministic, `skill` 0..1. */
  botInput(id: number, clock: number, skill: number): InputCommand;
  /** One level of a declared upgrade (store SKU or gear) for the rest of the round. */
  grant(id: number, upgrade: number): boolean;
  setCosmetic(id: number, cosmetic: number): void;
}

export type RacePhase = "countdown" | "racing" | "results";

export interface RacePlayerInfo {
  readonly id: number;
  readonly bot: boolean;
  /** Finishing place (1 = first), or null while racing. */
  readonly place: number | null;
  /** Seconds from the start to the finish line, or null. */
  readonly time: number | null;
  /** 0..1 along the course. */
  readonly progress: number;
  /** Live position among everyone (finished first, then by progress). */
  readonly rank: number;
  readonly counts: Readonly<Record<string, number>>;
  readonly ready: boolean;
}

export interface RaceInfo {
  readonly run: number;
  readonly phase: RacePhase;
  /** The course (level or track) index this round runs. */
  readonly course: number;
  /** Seconds left of the countdown (countdown phase). */
  readonly countdown: number;
  /** Seconds since the start signal. */
  readonly seconds: number;
  /** Seconds left before the round closes (time limit), or null. */
  readonly left: number | null;
  readonly players: readonly RacePlayerInfo[];
  readonly announce: { readonly id: number; readonly text: string; readonly tone: "info" | "danger" | "reward" } | null;
  readonly next: { readonly label: string; readonly in: number } | null;
  /** Seconds until the next round while results show. */
  readonly nextRunIn: number | null;
  /** Results: each human's coins by earn rule this round. */
  readonly coins: readonly { readonly id: number; readonly rules: readonly { readonly rule: string; readonly units: number }[] }[];
}

export interface RaceRunnerOptions {
  /** Seconds of countdown before each round. Default 3. */
  readonly countdownSeconds?: number;
  /** Seconds the results show. Default 8. */
  readonly endSeconds?: number;
  /** After every person present has finished, seconds the others get. Default 4. */
  readonly graceSeconds?: number;
  /** After the first person finishes, seconds everyone else has to reach the finish (an idle player never holds the round). Default 25. */
  readonly finishWindowSeconds?: number;
}

export interface RaceStep {
  readonly events: readonly GameEvent[];
  readonly awards: readonly EarnAward[];
  readonly reset: boolean;
}

const isBot = (id: number) => id >= BOT_PLAYER_BASE;
const MIN_END_SECONDS = 2;
/** Seat bots run looser than the playtest bot; the newest person in a round faces looser bots still. */
const SEAT_BOT_SKILL = 0.72;

export class RaceRunner {
  private scheduler!: SystemScheduler;
  private runN = 0;
  private runTick = 0;
  private clock = 0;
  private phase: RacePhase = "countdown";
  private phaseTicks = 0;
  private course = 0;
  private pending: GameEvent[] = [];
  private dispatchingUnpaid = false;
  private readonly lateStart = new Set<number>();
  private readonly earn: EarnTracker;
  private readonly achievements: EarnTracker;
  private readonly missions: EarnTracker;
  private readonly tracked: readonly string[];
  private reached: RunProgress[] = [];
  private readonly places = new Map<number, number>();
  private readonly times = new Map<number, number>();
  private readonly coins = new Map<number, Map<string, number>>();
  private readonly ready = new Set<number>();
  private announcement: RaceInfo["announce"] = null;
  private announceN = 0;
  private upcomingAt: { label: string; tick: number } | null = null;
  private allDoneTick = -1;
  /** Run tick the round closes at once someone has finished (-1: nobody yet). */
  private closeAt = -1;
  private readonly windowTicks: number;
  private rng: number;
  private readonly countdownTicks: number;
  private readonly endTicks: number;
  private readonly graceTicks: number;
  private readonly limitTicks: number;

  constructor(
    readonly manifest: GameManifest,
    readonly core: RaceCore,
    private readonly opts: { readonly bots: number; readonly roundSeconds: number | null; readonly courses: number; readonly seed: number } & RaceRunnerOptions,
  ) {
    const rate = core.tickRate;
    this.earn = new EarnTracker(manifest.earnRules);
    const asRules = (m: ReadonlyMap<string, { when: string; n: number }>) => new Map([...m].map(([id, d]) => [id, { when: d.when, n: d.n, pay: 0, oncePer: "run" as const }]));
    this.achievements = new EarnTracker(asRules(manifest.achievements));
    this.missions = new EarnTracker(asRules(manifest.missions));
    this.tracked = [...new Set([...manifest.achievements.values(), ...manifest.missions.values()].map((d) => d.when))];
    this.countdownTicks = Math.round((opts.countdownSeconds ?? 3) * rate);
    this.endTicks = Math.round((opts.endSeconds ?? 8) * rate);
    this.graceTicks = Math.round((opts.graceSeconds ?? 4) * rate);
    this.limitTicks = opts.roundSeconds ? Math.round(opts.roundSeconds * rate) : 0;
    this.windowTicks = Math.round((opts.finishWindowSeconds ?? 25) * rate);
    this.rng = (opts.seed >>> 0) || 0x9e3779b9;
    // The first course comes from the world's seed: a room rebuilds its world (a fresh seed) between rounds,
    // so every round draws its course; a world that runs many rounds (the harness) takes them in order.
    this.course = (opts.seed >>> 0) % Math.max(1, opts.courses);
    this.newRun(true);
  }

  private random(): number {
    let s = this.rng;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.rng = s >>> 0;
    return this.rng / 4294967296;
  }

  private newRun(first = false): void {
    this.runN++;
    this.runTick = 0;
    this.phase = "countdown";
    this.phaseTicks = 0;
    if (!first) this.course = (this.course + 1) % Math.max(1, this.opts.courses);
    this.places.clear();
    this.times.clear();
    this.coins.clear();
    this.ready.clear();
    this.announcement = null;
    this.upcomingAt = null;
    this.allDoneTick = -1;
    this.closeAt = -1;
    this.earn.resetRun();
    this.achievements.resetRun();
    this.missions.resetRun();
    this.lateStart.clear();
    if (this.reached.length > 1024) this.reached = [];
    this.core.reset(this.course, true);
    this.scheduler = new SystemScheduler(this.manifest, {
      tickRate: this.core.tickRate,
      tick: () => this.runTick,
      players: () => this.playerViews(),
      spawn: () => {
        throw new Error("spawn is not part of the race templates: build the course in game() instead");
      },
      random: () => this.random(),
      emit: (event, players) => {
        const ev = { name: event, players: players ? [...players] : this.core.ids() };
        this.pending.push(this.dispatchingUnpaid ? { ...ev, unpaid: true } : ev);
      },
      end: () => this.closeRound(),
      announce: (text, tone) => {
        this.announcement = { id: ++this.announceN, text, tone };
      },
      upcoming: (label, seconds) => {
        this.upcomingAt = { label, tick: this.runTick + Math.round(seconds * this.core.tickRate) };
      },
    });
    this.scheduler.start();
  }

  private playerViews(): PlayerView[] {
    return this.core.ids().map((id) => ({
      id,
      position: this.core.position(id),
      health: 1,
      alive: !this.core.finished(id),
      kills: 0,
      deaths: 0,
      bot: isBot(id),
    }));
  }

  get phaseNow(): RacePhase {
    return this.phase;
  }

  get runNumber(): number {
    return this.runN;
  }

  get courseNow(): number {
    return this.course;
  }

  placeOf(id: number): number | null {
    return this.places.get(id) ?? null;
  }

  /** Seats bots fill up to, with at least one person present; one change a tick. */
  private fillSeats(): void {
    const ids = this.core.ids();
    const humans = ids.filter((id) => !isBot(id)).length;
    const bots = ids.filter(isBot);
    const want = humans > 0 ? Math.max(0, this.opts.bots - humans) : 0;
    if (bots.length < want) {
      let id = BOT_PLAYER_BASE;
      while (bots.includes(id)) id++;
      this.core.add(id, true, this.phase !== "racing");
    } else if (bots.length > want) {
      this.core.remove(Math.max(...bots));
    }
  }

  /** A player joined (room addPlayer): they race from the start, held if the countdown runs. */
  joined(id: number): void {
    this.core.add(id, false, this.phase !== "racing");
  }

  left(id: number): void {
    this.core.remove(id);
    this.earn.forget(id);
    this.places.delete(id);
  }

  /** Call before each sim step: seats, systems, the clock, and every bot's input. */
  beforeStep(inputs: Map<number, InputCommand>): void {
    this.clock++;
    this.fillSeats();
    if (this.phase === "racing") this.scheduler.tick();
    if (this.phase === "results") {
      for (const [pid, cmd] of inputs) if ((cmd.buttons & Button.Ready) !== 0) this.ready.add(pid);
    }
    const n = this.core.ids().filter((id) => !isBot(id)).length;
    for (const id of this.core.ids()) {
      if (!isBot(id)) continue;
      // Seat bots spread out: each one a little looser than the last, and looser with more people present.
      const k = (id - BOT_PLAYER_BASE) % 8;
      const skill = Math.max(0.35, SEAT_BOT_SKILL - 0.05 * k - 0.04 * Math.max(0, n - 1));
      inputs.set(id, this.core.botInput(id, this.clock, skill));
    }
  }

  private humansPresent(): number[] {
    return this.core.ids().filter((id) => !isBot(id));
  }

  private record(ev: GameEvent): EarnAward[] {
    if (ev.unpaid) return [];
    const late = ev.own === true || this.lateStart.size === 0 ? null : this.lateStart;
    const paid = ev.players.filter((p) => !isBot(p) && !(late?.has(p) ?? false));
    return paid.length === ev.players.length ? this.earn.record(ev) : this.earn.record({ name: ev.name, players: paid });
  }

  /** The round is over: "round.finished" for everyone present, then results. */
  private closeRound(): void {
    if (this.phase !== "racing") return;
    this.pending.push({ name: "round.finished", players: this.core.ids() });
    this.phase = "results";
    this.phaseTicks = 0;
    this.core.setFrozen(true);
  }

  /** Call after each sim step with its events. */
  afterStep(sim: readonly RaceSimEvent[]): RaceStep {
    const events: GameEvent[] = this.pending;
    this.pending = [];
    if (this.phase === "racing") {
      for (const e of sim) {
        if (e.name === "player.finished") {
          if (this.places.has(e.player)) continue;
          const place = this.places.size + 1;
          this.places.set(e.player, place);
          if (this.closeAt < 0 && !isBot(e.player)) {
            this.closeAt = this.runTick + this.windowTicks;
            this.announcement = { id: ++this.announceN, text: `${Math.round(this.windowTicks / this.core.tickRate)} seconds to the finish`, tone: "info" };
          }
          this.times.set(e.player, this.runTick / this.core.tickRate);
          const bot = isBot(e.player);
          // Finishing is the player's own act. Winning or a podium needs another person in the round:
          // beating a field of seat bots pays nothing extra (the arena's round.top rule).
          events.push(bot ? { name: "player.finished", players: [e.player], unpaid: true } : { name: "player.finished", players: [e.player], own: true });
          const contested = this.humansPresent().length >= 2 && !bot;
          if (place === 1) events.push(contested ? { name: "race.won", players: [e.player] } : { name: "race.won", players: [e.player], unpaid: true });
          if (place <= 3) events.push(contested ? { name: "race.podium", players: [e.player] } : { name: "race.podium", players: [e.player], unpaid: true });
        } else {
          events.push(isBot(e.player) ? { name: e.name, players: [e.player], unpaid: true } : { name: e.name, players: [e.player], own: true });
        }
      }
    }
    const awards: EarnAward[] = [];
    for (const ev of events) {
      this.dispatchingUnpaid = ev.unpaid === true;
      try {
        this.scheduler.dispatch(ev.name, ev.players);
      } finally {
        this.dispatchingUnpaid = false;
      }
      awards.push(...this.record(ev));
    }
    for (const ev of this.pending) {
      awards.push(...this.record(ev));
      events.push(ev);
    }
    this.pending = [];
    for (const ev of events) this.progress(ev);
    for (const a of awards) {
      const row = this.coins.get(a.player) ?? new Map<string, number>();
      row.set(a.rule, (row.get(a.rule) ?? 0) + a.units);
      this.coins.set(a.player, row);
    }

    let reset = false;
    const ids = this.core.ids();
    if (this.phase === "countdown") {
      if (++this.phaseTicks >= this.countdownTicks) {
        this.phase = "racing";
        this.phaseTicks = 0;
        this.core.setFrozen(false);
      }
    } else if (this.phase === "racing") {
      this.runTick++;
      const humans = ids.filter((id) => !isBot(id));
      if (humans.length > 0 && humans.every((id) => this.places.has(id))) {
        if (this.allDoneTick < 0) this.allDoneTick = this.runTick;
        if (this.runTick - this.allDoneTick >= this.graceTicks || ids.every((id) => this.places.has(id))) this.closeRound();
      }
      if (this.limitTicks > 0 && this.runTick >= this.limitTicks) this.closeRound();
      if (this.closeAt >= 0 && this.runTick >= this.closeAt) this.closeRound();
      if (this.upcomingAt && this.runTick >= this.upcomingAt.tick) this.upcomingAt = null;
      if ((this.phase as RacePhase) === "results") {
        for (const ev of this.pending.splice(0)) {
          awards.push(...this.record(ev));
          events.push(ev);
          this.progress(ev);
        }
      }
      if (ids.length === 0 && this.runTick > 1) reset = true;
    } else if (++this.phaseTicks >= this.endTicks || this.allReady()) {
      reset = true;
    }
    if (reset) this.newRun();
    return { events, awards, reset };
  }

  private allReady(): boolean {
    if (this.phaseTicks < MIN_END_SECONDS * this.core.tickRate) return false;
    const humans = this.humansPresent();
    return humans.length > 0 && humans.every((id) => this.ready.has(id));
  }

  private progress(ev: GameEvent): void {
    if (this.tracked.length === 0 || !this.tracked.includes(ev.name)) return;
    const e = { name: ev.name, players: ev.players.filter((p) => !isBot(p)) };
    for (const a of this.achievements.record(e)) this.reached.push({ player: a.player, kind: "achievement", id: a.rule });
    for (const g of this.missions.record(e)) this.reached.push({ player: g.player, kind: "goal", id: g.rule });
  }

  takeProgress(): RunProgress[] {
    if (this.reached.length === 0) return [];
    const out = this.reached;
    this.reached = [];
    return out;
  }

  /** A referee run starts for this player: counts start over; a run begun mid-race is not paid world progress. */
  startRun(player: number): void {
    this.earn.forget(player);
    if (this.phase === "racing" && this.runTick > 0) this.lateStart.add(player);
    this.pending.push({ name: "run.started", players: [player], unpaid: true });
  }

  count(player: number, event: string): number {
    return this.earn.count(player, event);
  }

  /** Live order: finished by place, then everyone else by progress (ties by id). */
  standings(): number[] {
    const ids = this.core.ids();
    return ids.sort((a, b) => {
      const pa = this.places.get(a);
      const pb = this.places.get(b);
      if (pa !== undefined || pb !== undefined) return (pa ?? 1e9) - (pb ?? 1e9);
      return this.core.progress(b) - this.core.progress(a) || a - b;
    });
  }

  /** Ticks until the round closes (the time limit, or the finish window once someone has finished), or null. */
  private leftTicks(): number | null {
    const ends = [this.limitTicks > 0 ? this.limitTicks : Infinity, this.closeAt >= 0 ? this.closeAt : Infinity];
    const end = Math.min(...ends);
    return Number.isFinite(end) ? end - this.runTick : null;
  }

  info(): RaceInfo {
    const rate = this.core.tickRate;
    const order = this.standings();
    const counts = (id: number) => {
      const out: Record<string, number> = {};
      for (const name of this.tracked) {
        const n = Math.max(this.achievements.count(id, name), this.missions.count(id, name));
        if (n > 0) out[name] = n;
      }
      return out;
    };
    return {
      run: this.runN,
      phase: this.phase,
      course: this.course,
      countdown: this.phase === "countdown" ? Math.max(0, Math.ceil((this.countdownTicks - this.phaseTicks) / rate)) : 0,
      seconds: Math.floor(this.runTick / rate),
      left: this.leftTicks() === null ? null : Math.max(0, Math.ceil((this.leftTicks() ?? 0) / rate)),
      players: order.map((id, i) => {
        const t = this.times.get(id);
        return {
          id,
          bot: isBot(id),
          place: this.places.get(id) ?? null,
          time: t === undefined ? null : Math.round(t * 100) / 100,
          progress: Math.round(this.core.progress(id) * 1000) / 1000,
          rank: i + 1,
          counts: counts(id),
          ready: this.ready.has(id),
        };
      }),
      announce: this.announcement,
      next: this.upcomingAt ? { label: this.upcomingAt.label, in: Math.max(0, Math.ceil((this.upcomingAt.tick - this.runTick) / rate)) } : null,
      nextRunIn: this.phase === "results" ? Math.max(0, Math.ceil((this.endTicks - this.phaseTicks) / rate)) : null,
      coins: [...this.coins].filter(([id]) => !isBot(id)).map(([id, m]) => ({ id, rules: [...m].map(([rule, units]) => ({ rule, units })) })),
    };
  }
}
