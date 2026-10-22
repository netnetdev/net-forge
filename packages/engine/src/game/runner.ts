/**
 * Runs a compiled game on an engine-sim world on the authoritative side
 * (room server, headless harness): the declared systems on a run clock,
 * sim events turned into named game events, earn awards, and the run's
 * phases (playing, then won or lost, then a fresh run).
 *
 * Arena games add the shooter machinery here: the round clock and frag
 * limit (a round is a run), kills and deaths per player, a kill feed, and
 * server bots that fill empty seats (they play, they never earn, and
 * killing one, or topping a board of them, pays no earn rule).
 *
 * Clients never run this: they predict only their own character, and the
 * world's enemies, waves, bosses and bots arrive in snapshots.
 */
import {
  addPlayer,
  arenaSpawn,
  BOT_PLAYER_BASE,
  Button,
  enemyTypeOf,
  grantLevels,
  playerBuild,
  edgeSpawnPoint,
  enemyCount,
  enemyMaxHealth,
  entityHealth,
  entityHeadroom,
  listPickups,
  listPlayers,
  removePlayer,
  resetRun,
  respawnDead,
  revivePlayer,
  entityPosition,
  isOnScreen,
  removeEnemies,
  ringSpawnPoint,
  scatterEnemies,
  setXpBoost,
  simPaused,
  spawnPickupAt,
  simRandom,
  spawnEnemy,
  spawnEnemyScaled,
  spawnRingPoint,
} from "@netnetcapital/engine-sim";
import type { HitSource, InputCommand, PlayerSummary, SimEvent, SimWorld } from "@netnetcapital/engine-sim";
import { SystemScheduler } from "../api/scheduler.js";
import type { PlayerView, SpawnEdgeOptions } from "../api/registry.js";
import { Director } from "./director.js";
import { GameDefinitionError } from "../api/schemas.js";
import { arenaBotInput, arenaBotMemory } from "./arena-bot.js";
import type { ArenaBotMemory, ArenaBotWeapon } from "./arena-bot.js";
import type { CompiledGame } from "./compile.js";
import { EarnTracker } from "./earn.js";
import type { EarnAward, GameEvent } from "./earn.js";
import type { RunProgress } from "./profile.js";

export type RunPhase = "playing" | "won" | "lost";

export interface RunnerOptions {
  /**
   * Measurement only: keep this many enemies alive (topped up on rings,
   * up to 64 a tick) on top of the game's own waves. Default 0 (off).
   */
  readonly holdEnemies?: number;
  /** Measurement only: downed players stand straight back up. */
  readonly godMode?: boolean;
  /** Measurement only: the held crowd cycles through every non-boss enemy type (all behaviours on), not type 0. */
  readonly holdMix?: boolean;
  /** Seconds every player may be down before the run is lost. Default 5. */
  readonly loseGraceSeconds?: number;
  /** Seconds the end screen shows before a fresh run. Default 10 (arena 8). */
  readonly endSeconds?: number;
}

export interface RunPlayerInfo {
  readonly id: number;
  readonly level: number;
  readonly kills: number;
  readonly downed: boolean;
  readonly dead: boolean;
  /** Times this player died this run. */
  readonly deaths: number;
  /** A server bot filling a seat. */
  readonly bot: boolean;
  /** Keeper id (null when the game declares none). */
  readonly keeper: string | null;
  /** A revive buff is running. */
  readonly buffed: boolean;
  /** This run's counts of the events the game's missions and achievements key on. */
  readonly counts: Readonly<Record<string, number>>;
  /** Achievement ids reached this run. */
  readonly achievements: readonly string[];
  /** Voted to play again (end screen). */
  readonly ready: boolean;
}

/** One player's line on the end screen. Everything is data: names are declared ids, titles are declared text. */
export interface RunSummaryPlayer {
  readonly id: number;
  readonly keeper: string | null;
  /** Weapons with their level and the damage each dealt this run. */
  readonly weapons: readonly { readonly id: string; readonly level: number; readonly damage: number }[];
  readonly passives: readonly { readonly id: string; readonly level: number }[];
  readonly level: number;
  readonly kills: number;
  readonly damage: number;
  readonly revives: number;
  readonly downs: number;
  readonly pickups: number;
  /** What put this player down last (enemy prefab id and how), or null. */
  readonly downedBy: { readonly prefab: string; readonly source: HitSource } | null;
  /** Coins earned this run by earn rule (units of each rule's pay). */
  readonly coins: readonly { readonly rule: string; readonly units: number }[];
  /** Declared titles this player took. */
  readonly titles: readonly string[];
  readonly achievements: readonly string[];
}

export interface RunSummary {
  /** Most enemies alive at once this run. */
  readonly peak: number;
  readonly seconds: number;
  readonly players: readonly RunSummaryPlayer[];
}

/** Arena: one kill, newest last. `ago` is seconds since it happened. */
export interface KillFeedEntry {
  readonly by: number;
  readonly victim: number;
  readonly ago: number;
}

/** What the room broadcasts about the run (a few times a second, a few hundred bytes). */
export interface RunInfo {
  readonly run: number;
  readonly phase: RunPhase;
  /** Seconds since the run started. */
  readonly seconds: number;
  /** 1 + waves cleared (a dungeon's rooms cleared count as waves). */
  readonly wave: number;
  readonly kills: number;
  readonly enemies: number;
  /** The first living boss (kept for older clients; see `bosses`). */
  readonly boss: { readonly prefab: string; readonly health: number; readonly max: number } | null;
  /** Every living boss, oldest first: each gets a HUD bar, and an edge arrow when off screen (x, z in m). */
  readonly bosses: readonly { readonly prefab: string; readonly health: number; readonly max: number; readonly x: number; readonly z: number }[];
  /** True while the sim is paused for a solo player's upgrade cards. */
  readonly paused: boolean;
  /** The latest announcement (id increases with each new one), for the HUD's banner. */
  readonly announce: { readonly id: number; readonly text: string; readonly tone: "info" | "danger" | "reward" } | null;
  readonly players: readonly RunPlayerInfo[];
  /** Seconds until a fresh run while the end screen shows. */
  readonly nextRunIn: number | null;
  /** Arena: the round clock and frag limit; null for survivor runs. */
  readonly round: { readonly seconds: number; readonly left: number; readonly frags: number | null } | null;
  /** Arena: the last few kills. */
  readonly feed: readonly KillFeedEntry[];
  /** The HUD countdown a system set with `upcoming` ("THE BELL WARDEN" in 42 s), or null. */
  readonly next: { readonly label: string; readonly in: number } | null;
  /** The end screen's data while the run is over (null while playing). */
  readonly summary: RunSummary | null;
}

export interface RunnerStep {
  readonly events: readonly GameEvent[];
  readonly awards: readonly EarnAward[];
  /** True when this tick started a fresh run (players reset, counts cleared). */
  readonly reset: boolean;
}

const FEED_LENGTH = 6;
/** The end screen shows at least this long before a unanimous "Play again" starts the next run. */
const MIN_END_SECONDS = 2;
/** A player who joins after this many seconds catches up to the team (players.lateJoinBehind). */
const LATE_JOIN_SECONDS = 10;
const bump = (m: Map<number, number>, k: number, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
/** How sharp seat bots play against each other (1 is the playtest players' level). */
const SEAT_BOT_SKILL = 0.6;
/** Per kill a seat bot is ahead of the best person, its skill against people drops by this much (down to the floor). */
const LEADER_EASE_STEP = 0.25;
const LEADER_EASE_FLOOR = 0.3;
/**
 * How sharp seat bots play against a person, from that person's record this
 * round: a newcomer (no kills yet) faces loose bots, and they sharpen as
 * the person wins (GAME-DESIGN.md "Bots that ramp").
 */
export function seatBotSkillVs(kills: number, deaths: number): number {
  const kd = (kills + 1) / (deaths + 1);
  return Math.max(0.15, Math.min(0.8, 0.15 + 0.22 * (kd - 0.5) + 0.01 * kills));
}
const isBot = (id: number) => id >= BOT_PLAYER_BASE;
/** A prefab's `boss` declares a boss when it is true or a pattern. */
const isBoss = (b: unknown): boolean => b !== undefined && b !== false;

export class GameRunner {
  private scheduler!: SystemScheduler;
  private runTick = 0;
  private runN = 0;
  private phase: RunPhase = "playing";
  private phaseTicks = 0;
  private allDownTicks = 0;
  private pending: GameEvent[] = [];
  /** Players whose referee run started after this world (round) began: world and fight progress never pays them (record). */
  private readonly lateStart = new Set<number>();
  /** Systems are handling an unpaid event: what they emit now is unpaid too. */
  private dispatchingUnpaid = false;
  private readonly earn: EarnTracker;
  private readonly kills = new Map<number, number>();
  private readonly deaths = new Map<number, number>();
  private readonly emitted = new Map<string, number>();
  private teamKills = 0;
  private bosses = new Map<number, number>();
  private feed: { by: number; victim: number; tick: number }[] = [];
  private readonly endTicks: number;
  private readonly graceTicks: number;
  private readonly arena: boolean;
  private readonly roundTicks: number;
  private readonly botMemory = new Map<number, ArenaBotMemory>();
  private readonly loadout: readonly ArenaBotWeapon[];
  private clock = 0;
  private director: Director | null = null;
  private holdNext = 0;
  private announcement: RunInfo["announce"] = null;
  private announceN = 0;
  /** Run tick when an XP boost ends (0: none). */
  private boostEnds = 0;
  /** The sim was paused for a solo pick at the start of this step: the run clock stands still. */
  private pausedStep = false;
  private readonly ready = new Set<number>();
  private upcomingAt: { label: string; tick: number } | null = null;
  private readonly achievements: EarnTracker;
  private readonly missions: EarnTracker;
  /** Event names the missions and achievements count (their per-player counts go to the HUD). */
  private readonly tracked: readonly string[];
  /** Per enemy type: the "<prefab>.killed" event to raise, when something counts it. */
  private readonly killNames: readonly (string | null)[];
  private readonly unlocked = new Map<number, string[]>();
  /** Achievements, goals and titles reached since the room last took them (it writes them to profiles). */
  private reached: RunProgress[] = [];
  private readonly revives = new Map<number, number>();
  private readonly downs = new Map<number, number>();
  private readonly pickups = new Map<number, number>();
  private readonly lastHit = new Map<number, { prefab: string; source: HitSource }>();
  private readonly downedBy = new Map<number, { prefab: string; source: HitSource }>();
  private readonly coins = new Map<number, Map<string, number>>();
  private peak = 0;
  private viewTick = -1;
  private view: { players: PlayerSummary[]; pickups: { x: number; z: number }[] } = { players: [], pickups: [] };

  constructor(
    readonly compiled: CompiledGame,
    readonly world: SimWorld,
    private readonly opts: RunnerOptions = {},
  ) {
    this.arena = compiled.mode === "arena";
    this.earn = new EarnTracker(compiled.manifest.earnRules);
    // Achievements and missions count like earn rules but pay nothing.
    const asRules = (m: ReadonlyMap<string, { when: string; n: number }>) =>
      new Map([...m].map(([id, d]) => [id, { when: d.when, n: d.n, pay: 0, oncePer: "run" as const }]));
    this.achievements = new EarnTracker(asRules(compiled.manifest.achievements));
    this.missions = new EarnTracker(asRules(compiled.manifest.missions));
    this.tracked = [...new Set([...compiled.manifest.achievements.values(), ...compiled.manifest.missions.values()].map((d) => d.when))];
    const counted = new Set([...this.tracked, ...[...compiled.manifest.earnRules.values()].map((r) => r.when)]);
    this.killNames = compiled.enemyPrefabs.map((p) => (counted.has(`${p}.killed`) ? `${p}.killed` : null));
    this.endTicks = Math.round((opts.endSeconds ?? (this.arena ? 8 : 10)) * world.tickRate);
    this.graceTicks = Math.round((opts.loseGraceSeconds ?? 5) * world.tickRate);
    this.roundTicks = compiled.round ? Math.round(compiled.round.seconds * world.tickRate) : 0;
    const weapons = world.config.content.weapons;
    this.loadout = compiled.loadout.map((wi) => {
      const w = weapons[wi];
      return { kind: w?.kind ?? "blaster", range: w?.range ?? 10, count: w?.count ?? 1 };
    });
    this.newRun();
  }

  private newRun(): void {
    this.runN++;
    this.runTick = 0;
    this.phase = "playing";
    this.phaseTicks = 0;
    this.allDownTicks = 0;
    this.kills.clear();
    this.deaths.clear();
    this.emitted.clear();
    this.teamKills = 0;
    this.bosses.clear();
    this.feed = [];
    this.announcement = null;
    this.boostEnds = 0;
    this.ready.clear();
    this.upcomingAt = null;
    this.achievements.resetRun();
    this.missions.resetRun();
    this.unlocked.clear();
    // Nobody took them (a harness, not a room): do not let them pile up.
    if (this.reached.length > 1024) this.reached = [];
    this.revives.clear();
    this.downs.clear();
    this.pickups.clear();
    this.lastHit.clear();
    this.downedBy.clear();
    this.coins.clear();
    this.peak = 0;
    setXpBoost(this.world, 1);
    this.earn.resetRun();
    this.lateStart.clear();
    this.scheduler = new SystemScheduler(this.compiled.manifest, {
      tickRate: this.world.tickRate,
      tick: () => this.runTick,
      players: () => this.playerViews(),
      spawn: (prefab, at, opts) => this.spawn(prefab, at, opts?.elite === true),
      random: () => simRandom(this.world),
      emit: (event, players) => {
        const ev = { name: event, players: players ? [...players] : this.presentPlayers() };
        this.pending.push(this.dispatchingUnpaid ? { ...ev, unpaid: true } : ev);
      },
      alive: (prefab) => {
        if (prefab === undefined) return enemyCount(this.world);
        const t = this.compiled.enemyType.get(prefab);
        return t === undefined ? 0 : enemyCount(this.world, t);
      },
      respawnDead: () => {
        respawnDead(this.world);
      },
      end: (outcome) => this.finish(outcome),
      ringPoint: (cx, cz, radius, prefab) => ringSpawnPoint(this.world, cx, cz, radius, this.radiusOf(prefab)),
      spawnEdge: (prefab, opts) => this.spawnEdge(prefab, opts),
      spawnPickup: (prefab, at) => {
        const i = this.compiled.specialPickups.indexOf(prefab);
        if (i >= 0) spawnPickupAt(this.world, i, at[0], at[2]);
      },
      announce: (text, tone) => {
        this.announcement = { id: ++this.announceN, text, tone };
      },
      upcoming: (label, seconds) => {
        this.upcomingAt = { label, tick: this.runTick + Math.round(seconds * this.world.tickRate) };
      },
      bossAlive: () => this.bosses.size > 0,
      pauseDirector: (seconds) => this.director?.pause(this.runTick, Math.round(seconds * this.world.tickRate)),
      surge: (k, seconds) => this.director?.surge(this.runTick, k, Math.round(seconds * this.world.tickRate)),
      xpBoost: (k, seconds) => {
        setXpBoost(this.world, k);
        this.boostEnds = this.runTick + Math.round(seconds * this.world.tickRate);
      },
      scatter: (prefab, count) => {
        const t = this.compiled.enemyType.get(prefab);
        return t === undefined ? 0 : scatterEnemies(this.world, t, count);
      },
      clear: (prefab) => {
        const t = this.compiled.enemyType.get(prefab);
        return t === undefined ? 0 : removeEnemies(this.world, t);
      },
      onScreen: (x, z) => isOnScreen(this.world, x, z),
    });
    const d = this.compiled.manifest.director;
    this.director = d
      ? new Director(d, this.world, {
          typeOf: (p) => this.compiled.enemyType.get(p),
          radiusOf: (p) => this.radiusOf(p),
          spawned: (p, id) => {
            const t = this.compiled.enemyType.get(p);
            if (t !== undefined && this.compiled.manifest.prefabs.get(p)?.boss) this.bosses.set(id, t);
          },
          bossAlive: () => this.bosses.size > 0,
        })
      : null;
    this.scheduler.start();
  }

  private radiusOf(prefab: string): number {
    return this.compiled.manifest.prefabs.get(prefab)?.radius ?? 0.35;
  }

  /** Bosses are tougher with more players: health x (1 - k + k x players), k = players.bossHealthPerPlayer (0.55). */
  private bossScale(): number {
    const k = this.compiled.manifest.game.players.bossHealthPerPlayer ?? 0.55;
    const n = Math.max(1, listPlayers(this.world).length);
    return 1 - k + k * n;
  }

  private spawnEdge(prefab: string, opts: SpawnEdgeOptions): number {
    const t = this.compiled.enemyType.get(prefab);
    if (t === undefined) {
      throw new GameDefinitionError(`spawnEdge("${prefab}")`, [`"${prefab}" is a pickup; spawnEdge spawns enemies`]);
    }
    const boss = isBoss(this.compiled.manifest.prefabs.get(prefab)?.boss);
    const radius = this.radiusOf(prefab);
    const side = opts.side ?? "any";
    const spread = side === "any" ? Math.PI * 2 : (Math.max(1, Math.min(360, opts.spread ?? 50)) * Math.PI) / 180;
    const compass: Record<string, number> = { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 };
    // One heading for the whole call when a side is named: a tide comes from one direction.
    const fixed = compass[side];
    let n = 0;
    for (let i = 0; i < opts.count; i++) {
      if (entityHeadroom(this.world) <= 64) break;
      const at = edgeSpawnPoint(this.world, opts.around, {
        radius,
        spread,
        ...(fixed !== undefined ? { heading: fixed } : {}),
        ...(side === "ahead" || side === "behind" ? { relative: side } : {}),
      });
      if (!at) continue;
      const s = opts.scale ?? {};
      const id = spawnEnemyScaled(this.world, t, at[0], at[1], { health: (s.health ?? 1) * (boss ? this.bossScale() : 1), damage: s.damage ?? 1, xp: s.xp ?? 1, elite: opts.elite === true });
      if (boss) this.bosses.set(id, t);
      n++;
    }
    return n;
  }

  private playerViews(): PlayerView[] {
    return listPlayers(this.world).map((p) => ({
      id: p.playerId,
      position: [p.x, p.y, p.z] as const,
      health: p.health,
      alive: p.up,
      kills: this.kills.get(p.playerId) ?? 0,
      deaths: this.deaths.get(p.playerId) ?? 0,
      bot: isBot(p.playerId),
    }));
  }

  private presentPlayers(): number[] {
    return listPlayers(this.world).map((p) => p.playerId);
  }

  private spawn(prefab: string, at: readonly [number, number, number], elite = false): void {
    const t = this.compiled.enemyType.get(prefab);
    if (t === undefined) {
      throw new GameDefinitionError(`spawn("${prefab}")`, [`"${prefab}" is a pickup; pickups come from enemy drops, spawn enemies only`]);
    }
    if (entityHeadroom(this.world) <= 64) return; // keep room for gems and projectiles
    const boss = isBoss(this.compiled.manifest.prefabs.get(prefab)?.boss);
    const id = boss || elite ? spawnEnemyScaled(this.world, t, at[0], at[2], { health: boss ? this.bossScale() : 1, elite }) : spawnEnemy(this.world, t, at[0], at[2]);
    if (boss) this.bosses.set(id, t);
  }

  private finish(outcome: "won" | "lost"): void {
    if (this.phase !== "playing") return;
    this.phase = outcome;
    this.phaseTicks = 0;
    this.pending.push({ name: outcome === "won" ? "run.won" : "run.lost", players: this.presentPlayers() });
    // The end screen's titles go to the takers' profiles.
    for (const [player, ids] of this.titleIds(this.summaryRows())) for (const id of ids) this.reached.push({ player, kind: "title", id });
  }

  /**
   * Profile progress since the last call: achievements and mission goals
   * reached (humans only) and titles taken at the end of a run. The room
   * server writes these to the players' profiles; the browser never does.
   */
  takeProgress(): RunProgress[] {
    if (this.reached.length === 0) return [];
    const out = this.reached;
    this.reached = [];
    return out;
  }

  /**
   * Arena: the round is over. "round.top" credits the top fragger(s) (with at
   * least one kill), "round.finished" everyone present. Topping a board of
   * seat bots pays nothing: "round.top" is unpaid unless another person was
   * in the round at the end.
   */
  private finishRound(): void {
    if (this.phase !== "playing") return;
    const present = this.presentPlayers();
    let best = 0;
    for (const id of present) best = Math.max(best, this.kills.get(id) ?? 0);
    if (best > 0) {
      const top = present.filter((id) => (this.kills.get(id) ?? 0) === best);
      const humans = present.filter((id) => !isBot(id)).length;
      // (A player whose run started mid-round is not paid it: record() drops late starters from world events.)
      this.pending.push(humans >= 2 ? { name: "round.top", players: top } : { name: "round.top", players: top, unpaid: true });
    }
    this.pending.push({ name: "round.finished", players: present });
    this.finish("won");
  }

  get phaseNow(): RunPhase {
    return this.phase;
  }

  get runNumber(): number {
    return this.runN;
  }

  /**
   * Call once before each sim step: fills empty arena seats with bots,
   * runs the systems' timers (waves) and the round clock while playing, and,
   * given the step's input map, adds every bot's input to it.
   */
  beforeStep(inputs?: Map<number, InputCommand>): void {
    this.clock++;
    if (this.arena) this.fillSeats();
    // Solo upgrade cards pause the sim; the run clock, systems and director wait too.
    this.pausedStep = !this.arena && simPaused(this.world);
    if (this.phase === "playing" && !this.pausedStep) {
      this.scheduler.tick();
      this.director?.tick(this.runTick);
      if (this.boostEnds > 0 && this.runTick >= this.boostEnds) {
        setXpBoost(this.world, 1);
        this.boostEnds = 0;
      }
      this.hold();
      if (this.arena && this.roundTicks > 0 && this.runTick + 1 >= this.roundTicks) this.finishRound();
    }
    if (inputs && this.arena) {
      for (const p of listPlayers(this.world)) if (isBot(p.playerId)) inputs.set(p.playerId, this.autopilot(p.playerId));
    }
    // The end screen's vote: Button.Ready from anyone present.
    if (inputs && this.phase !== "playing") {
      for (const [pid, cmd] of inputs) if ((cmd.buttons & Button.Ready) !== 0) this.ready.add(pid);
    }
  }

  /** Every human present voted to play again (bots always agree), after the end screen had a moment. */
  private allReady(): boolean {
    if (this.phaseTicks < MIN_END_SECONDS * this.world.tickRate) return false;
    const humans = this.presentPlayers().filter((id) => !isBot(id));
    return humans.length > 0 && humans.every((id) => this.ready.has(id));
  }

  /** A player joining a run in progress starts players.lateJoinBehind levels below the team's average, cards waiting. */
  private catchUp(playerId: number): void {
    if (this.arena || this.phase !== "playing" || this.runTick < LATE_JOIN_SECONDS * this.world.tickRate) return;
    const others = listPlayers(this.world).filter((p) => p.playerId !== playerId);
    if (others.length === 0) return;
    const avg = others.reduce((s, p) => s + p.level, 0) / others.length;
    const behind = this.compiled.manifest.game.players.lateJoinBehind ?? 2;
    const target = Math.max(1, Math.round(avg) - behind);
    grantLevels(this.world, playerId, target - 1);
  }

  private prefabOfEnemy(netId: number): string {
    const t = enemyTypeOf(this.world, netId);
    return t >= 0 ? (this.compiled.enemyPrefabs[t] ?? "") : "";
  }

  /** Seats bots fill up to, with at least one human present; bots leave as humans join. One change a tick. */
  private fillSeats(): void {
    const players = listPlayers(this.world);
    const humans = players.filter((p) => !isBot(p.playerId)).length;
    const bots = players.filter((p) => isBot(p.playerId)).map((p) => p.playerId);
    const want = humans > 0 ? Math.max(0, this.compiled.bots - humans) : 0;
    if (bots.length < want) {
      let id = BOT_PLAYER_BASE;
      while (bots.includes(id)) id++;
      const [x, z] = arenaSpawn(this.world, id);
      addPlayer(this.world, id, [x, this.world.config.arena.spawn[1], z]);
      this.botMemory.set(id, arenaBotMemory());
    } else if (bots.length > want) {
      const id = Math.max(...bots);
      removePlayer(this.world, id);
      this.botMemory.delete(id);
    }
  }

  /**
   * Arena: what a bot (or a playtest player) does this tick, from the
   * present state. Deterministic, so a room's run replays exactly.
   */
  autopilot(id: number): InputCommand {
    if (this.viewTick !== this.clock) {
      this.viewTick = this.clock;
      this.view = { players: listPlayers(this.world), pickups: listPickups(this.world) };
    }
    let mem = this.botMemory.get(id);
    if (!mem) {
      mem = arenaBotMemory();
      this.botMemory.set(id, mem);
    }
    const me = this.view.players.find((p) => p.playerId === id);
    if (!me) return { seq: 0, tick: this.clock, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 };
    const seat = isBot(id);
    // A seat bot ahead of the best person in the room eases off people: looser against them, and it
    // would rather fight another bot. It never stops shooting.
    let topHuman = 0;
    for (const p of this.view.players) if (!isBot(p.playerId)) topHuman = Math.max(topHuman, this.kills.get(p.playerId) ?? 0);
    const ahead = Math.max(0, (this.kills.get(id) ?? 0) - topHuman + 1);
    const ease = seat ? Math.max(LEADER_EASE_FLOOR, 1 - LEADER_EASE_STEP * ahead) : 1;
    // A person another seat bot is already fighting counts as crowded, so bots do not gang up on one person.
    const chasing = new Map<number, number>();
    if (seat) for (const [bid, m] of this.botMemory) if (bid !== id && isBot(bid) && m.target > 0) chasing.set(m.target, (chasing.get(m.target) ?? 0) + 1);
    return arenaBotInput(
      {
        id,
        x: me.x,
        z: me.z,
        health: me.health,
        maxHealth: me.maxHealth,
        up: me.up && this.phase === "playing",
        slot: me.slot,
        loadout: this.loadout,
        opponents: this.view.players
          .filter((p) => p.playerId !== id && p.up)
          .map((p) =>
            seat && !isBot(p.playerId)
              ? {
                  id: p.playerId,
                  x: p.x,
                  z: p.z,
                  skill: seatBotSkillVs(this.kills.get(p.playerId) ?? 0, this.deaths.get(p.playerId) ?? 0) * ease,
                  crowded: (chasing.get(p.playerId) ?? 0) > 0 || ahead > 0,
                }
              : { id: p.playerId, x: p.x, z: p.z },
          ),
        pickups: this.view.pickups,
        pillars: this.world.config.arena.pillars,
        half: this.world.config.arena.halfExtent,
        seed: this.world.config.seed,
        // Seat bots play loose against each other, and against people by their record (seatBotSkillVs).
        skill: seat ? SEAT_BOT_SKILL * Math.max(0.4, 1 - 0.2 * Math.max(0, ahead - 1)) : 1,
      },
      mem,
      this.clock,
      this.world.tickRate,
    );
  }

  private hold(): void {
    const n = this.opts.holdEnemies ?? 0;
    if (n <= 0) return;
    // holdMix: the director pool by weight (the game's own late-run mix), else every non-boss type once.
    const pool = this.compiled.manifest.director?.pool ?? [];
    const weighted = pool.flatMap((e) => Array.from({ length: Math.max(1, Math.round(e.weight)) }, () => this.compiled.enemyType.get(e.prefab) ?? 0));
    const mix = !this.opts.holdMix
      ? [0]
      : weighted.length > 0
        ? weighted
        : this.compiled.enemyPrefabs.map((p, i) => [p, i] as const).filter(([p]) => !isBoss(this.compiled.manifest.prefabs.get(p)?.boss)).map(([, i]) => i);
    let budget = 64;
    while (budget-- > 0 && enemyCount(this.world) < n && entityHeadroom(this.world) > 64) {
      const [x, z] = spawnRingPoint(this.world, 16 + simRandom(this.world) * 14);
      spawnEnemy(this.world, mix[this.holdNext++ % mix.length] ?? 0, x, z);
    }
  }

  /** Earn credits humans only: bots fill seats, they never earn, and an unpaid event (a bot's death, a board of bots topped) pays no one. */
  private record(ev: GameEvent): EarnAward[] {
    if (ev.unpaid) return [];
    // World or fight progress (anything not the player's own act) never pays a run that started after this world began (S-2).
    const late = ev.own === true || this.lateStart.size === 0 ? null : this.lateStart;
    const paid = ev.players.filter((p) => !isBot(p) && !(late?.has(p) ?? false));
    return paid.length === ev.players.length ? this.earn.record(ev) : this.earn.record({ name: ev.name, players: paid });
  }

  /** Call once after each sim step with its events. */
  afterStep(simEvents: readonly SimEvent[]): RunnerStep {
    const events: GameEvent[] = this.pending;
    this.pending = [];
    // Arena: the round is over once it ends; nothing scores on the end screen.
    const scoring = !this.arena || this.phase === "playing";
    for (const e of simEvents) {
      if (e.type === "enemy.killed") {
        this.teamKills++;
        if (e.by > 0) this.kills.set(e.by, (this.kills.get(e.by) ?? 0) + 1);
        const credit = e.by > 0 ? [e.by] : [];
        events.push({ name: "enemy.killed", players: credit, own: true });
        if (e.elite) events.push({ name: "elite.killed", players: this.presentPlayers() });
        // "<prefab>.killed" ("lantern_thief.killed"), only for names a rule, achievement or mission counts.
        const named = this.killNames[e.enemyType];
        if (named) events.push({ name: named, players: this.presentPlayers() });
        if (e.boss) {
          this.bosses.delete(e.netId);
          // A mini-boss raises "miniboss.killed"; only a final boss raises "boss.killed" (earn rules and the win key on it).
          const b = this.compiled.manifest.prefabs.get(this.compiled.enemyPrefabs[e.enemyType] ?? "")?.boss;
          const mini = typeof b === "object" && b.rank === "mini";
          events.push({ name: mini ? "miniboss.killed" : "boss.killed", players: this.presentPlayers() });
        }
      } else if (e.type === "player.killed") {
        if (!scoring) continue;
        this.deaths.set(e.playerId, (this.deaths.get(e.playerId) ?? 0) + 1);
        if (e.by > 0 && e.by !== e.playerId) {
          this.teamKills++;
          this.kills.set(e.by, (this.kills.get(e.by) ?? 0) + 1);
          // A seat bot's death scores and feeds like any kill, but earn rules never count it.
          events.push(isBot(e.playerId) ? { name: "opponent.killed", players: [e.by], unpaid: true } : { name: "opponent.killed", players: [e.by], own: true });
          this.feed.push({ by: e.by, victim: e.playerId, tick: this.runTick });
          if (this.feed.length > FEED_LENGTH) this.feed.shift();
        }
      } else if (e.type === "player.died") {
        if (!scoring) continue;
        if (!this.arena) this.deaths.set(e.playerId, (this.deaths.get(e.playerId) ?? 0) + 1);
        events.push({ name: "player.died", players: [e.playerId], own: true });
      } else if (e.type === "player.joined") {
        this.catchUp(e.playerId);
      } else if (e.type === "player.hit") {
        const prefab = e.enemyType !== undefined ? (this.compiled.enemyPrefabs[e.enemyType] ?? "") : this.prefabOfEnemy(e.by);
        this.lastHit.set(e.playerId, { prefab, source: e.source ?? "contact" });
      } else if (e.type === "player.downed") {
        bump(this.downs, e.playerId);
        const hit = this.lastHit.get(e.playerId);
        if (hit) this.downedBy.set(e.playerId, hit);
        events.push({ name: "player.downed", players: [e.playerId], own: true });
        if (this.opts.godMode) revivePlayer(this.world, e.playerId);
      } else if (e.type === "player.revived") {
        if (e.by !== e.playerId) bump(this.revives, e.by);
        events.push({ name: "player.revived", players: e.by !== e.playerId ? [e.by] : [], own: true });
      } else if (e.type === "player.levelup") {
        events.push({ name: "player.levelup", players: [e.playerId] });
      } else if (e.type === "player.upgraded" && e.evolved) {
        events.push({ name: "player.evolved", players: [e.playerId] });
      } else if (e.type === "player.collected") {
        bump(this.pickups, e.playerId);
        // "chest.collected", "heal.collected", ...: systems and earn rules can key on them.
        events.push({ name: `${e.effect}.collected`, players: [e.playerId], own: true });
      } else if (e.type === "player.left") {
        this.kills.delete(e.playerId);
        this.deaths.delete(e.playerId);
        this.botMemory.delete(e.playerId);
        this.earn.forget(e.playerId);
      }
    }
    const awards: EarnAward[] = [];
    for (const ev of events) {
      this.emitted.set(ev.name, (this.emitted.get(ev.name) ?? 0) + 1);
      this.dispatchingUnpaid = ev.unpaid === true;
      try {
        this.scheduler.dispatch(ev.name, ev.players);
      } finally {
        this.dispatchingUnpaid = false;
      }
      awards.push(...this.record(ev));
    }
    // Arena: the frag limit ends the round, reached by a person (a seat bot never takes the round).
    const limit = this.compiled.round?.frags ?? null;
    if (this.arena && limit !== null && this.phase === "playing") {
      for (const [id, n] of this.kills) {
        if (n >= limit && !isBot(id)) {
          this.finishRound();
          break;
        }
      }
    }
    // Systems may have emitted or ended the run from their handlers.
    for (const ev of this.pending) {
      this.emitted.set(ev.name, (this.emitted.get(ev.name) ?? 0) + 1);
      awards.push(...this.record(ev));
      events.push(ev);
    }
    this.pending = [];

    for (const ev of events) this.progress(ev);
    for (const a of awards) {
      let row = this.coins.get(a.player);
      if (!row) {
        row = new Map();
        this.coins.set(a.player, row);
      }
      row.set(a.rule, (row.get(a.rule) ?? 0) + a.units);
    }
    if (this.phase === "playing") this.peak = Math.max(this.peak, enemyCount(this.world));
    if (this.upcomingAt && this.runTick >= this.upcomingAt.tick) this.upcomingAt = null;

    let reset = false;
    const players = listPlayers(this.world);
    if (this.phase === "playing") {
      if (!this.pausedStep) this.runTick++;
      // A keeper with a free self-revive left can still stand up: the run waits for it.
      const anyUp = players.some((p) => p.up || (p.downed && p.selfRevives > 0));
      this.allDownTicks = !this.arena && players.length > 0 && !anyUp ? this.allDownTicks + 1 : 0;
      if (this.allDownTicks >= this.graceTicks) {
        this.finish("lost");
        const last = this.pending.splice(0);
        for (const ev of last) {
          awards.push(...this.record(ev));
          events.push(ev);
        }
      }
      if (players.length === 0 && this.runTick > 1) reset = true;
    } else if (++this.phaseTicks >= this.endTicks || this.allReady()) {
      reset = true;
    }
    if (reset) {
      resetRun(this.world);
      this.newRun();
    }
    return { events, awards, reset };
  }

  /** Achievements and missions count the run's events (humans only, like earn). */
  private progress(ev: GameEvent): void {
    if (this.tracked.length === 0 || !this.tracked.includes(ev.name)) return;
    const humans = ev.players.filter((p) => !isBot(p));
    const e = { name: ev.name, players: humans };
    for (const a of this.achievements.record(e)) {
      const list = this.unlocked.get(a.player) ?? [];
      list.push(a.rule);
      this.unlocked.set(a.player, list);
      this.reached.push({ player: a.player, kind: "achievement", id: a.rule });
    }
    for (const g of this.missions.record(e)) this.reached.push({ player: g.player, kind: "goal", id: g.rule });
  }

  private countsOf(playerId: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (const name of this.tracked) {
      const n = Math.max(this.achievements.count(playerId, name), this.missions.count(playerId, name));
      if (n > 0) out[name] = n;
    }
    return out;
  }

  private keeperId(index: number): string | null {
    return [...this.compiled.manifest.keepers.keys()][index] ?? null;
  }

  /** The end screen: each player's build, damage per weapon, what downed them, coins and titles. */
  summary(): RunSummary {
    const rows = this.summaryRows();
    const titles = this.titleIds(rows);
    const text = (id: string) => this.compiled.manifest.titles.get(id)?.text ?? id;
    return {
      peak: this.peak,
      seconds: Math.floor(this.runTick / this.world.tickRate),
      players: rows.map((r) => ({ ...r, titles: (titles.get(r.id) ?? []).map(text) })),
    };
  }

  /** Each human's end-screen row, without titles. */
  private summaryRows(): Omit<RunSummaryPlayer, "titles">[] {
    const c = this.compiled;
    return listPlayers(this.world)
      .filter((p) => !isBot(p.playerId))
      .map((p) => {
        const b = playerBuild(this.world, p.playerId);
        const weapons = (b?.weapons ?? []).map((w) => ({ id: c.weaponIds[w.index] ?? "", level: w.level, damage: Math.round(b?.damage[w.index] ?? 0) }));
        const damage = Math.round((b?.damage ?? []).reduce((s, d) => s + (d ?? 0), 0));
        return {
          id: p.playerId,
          keeper: c.manifest.keepers.size > 0 ? this.keeperId(b?.keeper ?? 0) : null,
          weapons,
          passives: (b?.stats ?? []).map((s) => ({ id: c.upgradeIds[s.index] ?? "", level: s.level })),
          level: p.level,
          kills: this.kills.get(p.playerId) ?? 0,
          damage,
          revives: this.revives.get(p.playerId) ?? 0,
          downs: this.downs.get(p.playerId) ?? 0,
          pickups: this.pickups.get(p.playerId) ?? 0,
          downedBy: this.downedBy.get(p.playerId) ?? null,
          coins: [...(this.coins.get(p.playerId) ?? new Map<string, number>())].map(([rule, units]) => ({ rule, units })),
          achievements: this.unlocked.get(p.playerId) ?? [],
        };
      });
  }

  /** Who took each declared title (by id): the most (or, with 2+ players, the least) of its stat. */
  private titleIds(rows: readonly Omit<RunSummaryPlayer, "titles">[]): Map<number, string[]> {
    const titles = new Map<number, string[]>();
    for (const [id, t] of this.compiled.manifest.titles) {
      const stat = t.most ?? t.least;
      if (!stat || rows.length === 0 || (t.least && rows.length < 2)) continue;
      const vals = rows.map((r) => [r.id, r[stat]] as const);
      const best = t.most ? Math.max(...vals.map(([, v]) => v)) : Math.min(...vals.map(([, v]) => v));
      if (t.most && best <= 0) continue;
      const [winner] = vals.find(([, v]) => v === best) ?? [];
      if (winner === undefined) continue;
      const list = titles.get(winner) ?? [];
      list.push(id);
      titles.set(winner, list);
    }
    return titles;
  }

  info(): RunInfo {
    const players = listPlayers(this.world);
    const bosses = [...this.bosses.entries()].map(([netId, type]) => {
      const prefab = this.compiled.enemyPrefabs[type] ?? "";
      const max = enemyMaxHealth(this.world, netId) ?? this.compiled.manifest.prefabs.get(prefab)?.health ?? 1;
      const [x, z] = entityPosition(this.world, netId) ?? [0, 0];
      return { prefab, health: this.bossHealth(netId), max, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 };
    });
    const first = bosses[0];
    const boss: RunInfo["boss"] = first ? { prefab: first.prefab, health: first.health, max: first.max } : null;
    const rate = this.world.tickRate;
    const round = this.compiled.round;
    return {
      run: this.runN,
      phase: this.phase,
      seconds: Math.floor(this.runTick / rate),
      // A dungeon's cleared rooms are its waves: the run's progress either way.
      wave: (this.emitted.get("wave.cleared") ?? 0) + (this.emitted.get("room.cleared") ?? 0) + 1,
      kills: this.teamKills,
      enemies: enemyCount(this.world),
      boss,
      bosses,
      paused: this.pausedStep,
      announce: this.announcement,
      players: players.map((p) => ({
        id: p.playerId,
        level: p.level,
        kills: this.kills.get(p.playerId) ?? 0,
        downed: p.downed,
        dead: p.dead,
        deaths: this.deaths.get(p.playerId) ?? 0,
        bot: isBot(p.playerId),
        keeper: this.compiled.manifest.keepers.size > 0 ? this.keeperId(p.keeper) : null,
        buffed: p.buffed,
        counts: this.countsOf(p.playerId),
        achievements: this.unlocked.get(p.playerId) ?? [],
        ready: this.ready.has(p.playerId),
      })),
      next: this.upcomingAt ? { label: this.upcomingAt.label, in: Math.max(0, Math.ceil((this.upcomingAt.tick - this.runTick) / rate)) } : null,
      summary: this.phase === "playing" ? null : this.summary(),
      nextRunIn: this.phase === "playing" ? null : Math.max(0, Math.ceil((this.endTicks - this.phaseTicks) / rate)),
      round: round ? { seconds: round.seconds, left: Math.max(0, Math.ceil((this.roundTicks - this.runTick) / rate)), frags: round.frags } : null,
      feed: this.feed.map((f) => ({ by: f.by, victim: f.victim, ago: Math.floor((this.runTick - f.tick) / rate) })),
    };
  }

  private bossHealth(netId: number): number {
    return entityHealth(this.world, netId) ?? 0;
  }

  /** Boss NetIds alive now. */
  bossIds(): number[] {
    return [...this.bosses.keys()];
  }

  /**
   * A referee run starts for this player (the room's sign-in or round start):
   * their earn counts and once-per-run payouts start over, and systems hear
   * "run.started" (unpaid) so their own counters can start over too (a kill
   * streak). A run started after this world began is never paid world or
   * fight progress (boss.killed, wave.cleared, round.top, run.won, system
   * emits: every event that is not the player's own act) until the next
   * world, since that progress predates the run.
   */
  startRun(player: number): void {
    this.earn.forget(player);
    if (this.runTick > 0) this.lateStart.add(player);
    this.pending.push({ name: "run.started", players: [player], unpaid: true });
  }

  /** Earn counts for one player this run (HUD and tests). */
  count(player: number, event: string): number {
    return this.earn.count(player, event);
  }

  /** Total number of times an event has fired this run. */
  emittedCount(event: string): number {
    return this.emitted.get(event) ?? 0;
  }

  /** Kills by one player this run (arena: opponents). */
  killsOf(player: number): number {
    return this.kills.get(player) ?? 0;
  }
}
