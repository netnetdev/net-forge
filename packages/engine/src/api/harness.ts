/**
 * Headless test harness (game-runtime.md §12): run a game on the server sim
 * with bot players and report what happened.
 *
 * When a game module has been declared (game(), prefabs, weapons, systems,
 * earn rules), it runs that game exactly as the room server does: compiled
 * content in engine-sim, the systems on the GameRunner, earn rules counted
 * per player. With no game declared it runs the week-2 engine-sim arena
 * (the built-in chaser spawner) with scripted bots.
 */

export interface HarnessAssertion {
  readonly name: string;
  readonly check: (report: HarnessReport) => boolean;
}

export interface HarnessOptions {
  readonly ticks: number;
  readonly bots: number;
  /** Arena: enemies the spawner keeps alive. Game: hold at least this many alive on top of the waves (stress). */
  readonly enemies?: number;
  readonly seed?: number;
  readonly tickRate?: number;
  readonly assert?: readonly HarnessAssertion[];
  /**
   * Who plays (survivor-style games): "basic" circles and never misses a
   * beat (the default, a stress player); "human" reacts 200 ms late, kites
   * in wide arcs, takes a second per card (the fun metrics' player).
   */
  readonly bot?: "basic" | "human";
  /** Human bots' card picks: "random" (default) or "greedy". */
  readonly picks?: "random" | "greedy";
  /** With `enemies`: hold a mix of every non-boss enemy type (all behaviours on) instead of type 0. */
  readonly enemyMix?: boolean;
}

/**
 * How fun the opening and the run felt to the bots, measured (GAME-DESIGN.md).
 * Horde games (survivor-like) are measured over the first run; arena games
 * over every life. Fields that do not apply to the genre are null.
 */
export interface FunMetrics {
  readonly genre: "horde" | "arena" | "race";
  /** Seconds until an enemy first came within 3 m of a player (horde) or a player first took damage (arena). */
  readonly firstThreatSeconds: number | null;
  /** Seconds until the first reward: the first level-up (horde) or the first kill (arena). */
  readonly firstRewardSeconds: number | null;
  /** Horde: highest player level at 1:00, 3:00, 6:00 and 9:00 of the first run (null when the run ended first). */
  readonly levelAt: { readonly "60": number | null; readonly "180": number | null; readonly "360": number | null; readonly "540": number | null };
  /** Horde: times a player went down before 1:00. */
  readonly deathsBeforeMinute: number | null;
  /** Horde: the most enemies on one player's screen at 0:30. */
  readonly onScreenAt30: number | null;
  /** Horde: contact hits each player took in the first minute. */
  readonly contactHitsFirstMinute: number | null;
  /** Horde: share of downs after 3:00 that a telegraphed attack caused (null with no such downs). */
  readonly telegraphedDeathShare: number | null;
  /** Horde: share of enemy spawns that appeared on a player's screen (should be 0). */
  readonly spawnsOnScreen: number | null;
  /** Horde: how long the first run lasted (the whole playtest when it never ended), s. */
  readonly survivalSeconds: number | null;
  /** Arena: median seconds from a (re)spawn to the first damage taken (spawn camping when short). */
  readonly spawnToDamageSeconds: number | null;
  /** Arena: share of deaths within 3 s of spawning. */
  readonly spawnDeathShare: number | null;
  /** Arena: best player's kills over the mean (1 is even; above 3 one player stomps). */
  readonly killSpread: number | null;
  /** Arena: times the lead changed hands, per round. */
  readonly leadChanges: number | null;
  /** Horde: bosses killed in the first run, with seconds from spawn to kill. */
  readonly bossKills: readonly { readonly prefab: string; readonly seconds: number }[];
  /** Horde: what last hit each player that went down in the first run ("contact", "charge", "blast", ...). */
  readonly downsBySource: Readonly<Record<string, number>>;
  /** Horde: seconds until a player first took damage of any kind (null if never). */
  readonly firstHitSeconds?: number | null;
  /** Horde: lowest health any player was left on by a hit before 2:00 (null if nobody was hit). */
  readonly lowestHealthBy120?: number | null;
  /** Horde: seconds until the first elite and the first boss (mini or final) appeared. */
  readonly firstEliteSeconds?: number | null;
  readonly firstBossSeconds?: number | null;
  /** Horde: share of player time in the first run spent downed or out (waiting, not playing). */
  readonly downTimeShare?: number | null;
  /** Race: median seconds from the start signal to a playtest player's first finish (null: nobody finished). */
  readonly finishSeconds?: number | null;
  /** Race: share of playtest player rounds that reached the finish. */
  readonly finishRate?: number | null;
  /** Race: falls (platformer) or wall hits (racer) per playtest player per round. */
  readonly mishapsPerRound?: number | null;
  /** Race: seconds until a playtest player first collected a coin. */
  readonly firstCoinSeconds?: number | null;
  /** Race: per course, whether the route planner (platformer) found a way to the finish, and its seconds. */
  readonly routes?: readonly { readonly course: number; readonly found: boolean; readonly seconds: number | null }[];
}

export interface HarnessReport {
  readonly ticks: number;
  readonly bots: number;
  /** Arena: deaths. Game: times a player went down. */
  readonly deaths: number;
  readonly kills: number;
  /** Game mode: highest wave reached (1 + waves cleared), 0 in the arena. */
  readonly wave: number;
  /** Game mode: runs that ended, by outcome. */
  readonly runs: { readonly won: number; readonly lost: number };
  /** Game mode: highest player level reached. */
  readonly maxLevel: number;
  /** Game mode: most enemies alive at once. */
  readonly peakEnemies: number;
  /** Arena: the most kills one player scored in a round (0 for survivor games). */
  readonly topScore: number;
  /** Arena: players (bots included) who scored at least one kill. */
  readonly scorers: number;
  /** Game mode: earn awards by rule id (units). */
  readonly earned: Readonly<Record<string, number>>;
  /** Mean wall-clock milliseconds per sim tick: the FPS-equivalent server cost. */
  readonly msPerTick: number;
  readonly p99MsPerTick: number;
  readonly earnEmitted: number;
  /** True when nothing changed (no kills, no damage, no movement) for 30 s of sim time. */
  readonly softlock: boolean;
  /** Fun metrics (game mode only). */
  readonly fun?: FunMetrics;
  /**
   * Board genres (tower defense, idle, cards, collector): the genre's own
   * playtest checks (a failing check fails the gate) and how far the bots
   * got through its arc (0..1, the progression score).
   */
  readonly rules?: { readonly template: string; readonly checks: readonly { readonly ok: boolean; readonly line: string }[]; readonly progress: number };
  readonly failed: readonly string[];
}

export async function runHarness(opts: HarnessOptions): Promise<HarnessReport> {
  const { collectManifest } = await import("./registry.js");
  let manifest: import("./registry.js").GameManifest | null = null;
  try {
    manifest = collectManifest();
  } catch {
    manifest = null;
  }
  if (manifest && (manifest.game.template === "platformer" || manifest.game.template === "racer")) {
    const { runRaceHarness } = await import("./race-harness.js");
    return runRaceHarness(manifest, opts);
  }
  if (manifest) {
    // Board genres (tower defense, idle, cards, collector) play on their own rules module.
    const rules = await import("../rules/genres.js");
    if (rules.isRulesTemplate(manifest.game.template)) {
      const { playRules } = await import("../rules/harness.js");
      return playRules(rules.genreFor(manifest), manifest, opts).report;
    }
  }
  if (manifest && manifest.weapons.size > 0) return runGame(manifest, opts);
  const sim = await import("@netnetcapital/engine-sim");
  await sim.initSim();
  const tickRate = opts.tickRate ?? sim.DEFAULT_TICK_RATE;
  const world = sim.createWorld({ tickRate, seed: opts.seed ?? 1, enemies: { target: opts.enemies ?? 500 } });
  const bots = Math.max(0, Math.min(100, Math.floor(opts.bots)));
  for (let i = 1; i <= bots; i++) sim.addPlayer(world, i, [i * 1.5 - bots * 0.75, 1, 0]);

  let s = (opts.seed ?? 1) >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const yaw = new Float64Array(bots + 1);
  const times: number[] = [];
  let deaths = 0;
  let kills = 0;
  let quiet = 0;
  let softlock = false;
  // performance exists in browsers, Node and Bun, but not in lib ES2022's types.
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  const now = () => (perf ? perf.now() : Date.now());
  for (let t = 0; t < opts.ticks; t++) {
    const inputs = new Map<number, import("@netnetcapital/engine-sim").InputCommand>();
    for (let p = 1; p <= bots; p++) {
      yaw[p] = (yaw[p] ?? 0) + (rnd() - 0.5) * 0.4;
      inputs.set(p, {
        seq: t + 1,
        tick: world.tick,
        moveX: rnd() * 2 - 1,
        moveZ: rnd() * 2 - 0.5,
        yaw: yaw[p] ?? 0,
        buttons: (rnd() < 0.3 ? sim.Button.Fire : 0) | (rnd() < 0.03 ? sim.Button.Jump : 0),
      });
    }
    const a = now();
    const r = sim.step(world, inputs);
    times.push(now() - a);
    let active = false;
    for (const e of r.events) {
      if (e.type === "player.died") deaths++;
      if (e.type === "enemy.killed") kills++;
      if (e.type === "enemy.killed" || e.type === "player.hit") active = true;
    }
    quiet = active || bots > 0 ? 0 : quiet + 1;
    if (quiet >= 30 * tickRate) softlock = true;
  }
  sim.destroyWorld(world);
  const sorted = [...times].sort((x, y) => x - y);
  const base = {
    ticks: opts.ticks,
    bots,
    deaths,
    kills,
    msPerTick: times.reduce((x, y) => x + y, 0) / Math.max(1, times.length),
    p99MsPerTick: sorted[Math.floor(0.99 * Math.max(0, sorted.length - 1))] ?? 0,
    earnEmitted: 0,
    softlock,
    wave: 0,
    runs: { won: 0, lost: 0 },
    maxLevel: 0,
    peakEnemies: 0,
    topScore: 0,
    scorers: 0,
    earned: {},
  };
  const failed = (opts.assert ?? []).filter((a) => !a.check({ ...base, failed: [] })).map((a) => a.name);
  return { ...base, failed };
}

async function runGame(manifest: import("./registry.js").GameManifest, opts: HarnessOptions): Promise<HarnessReport> {
  const sim = await import("@netnetcapital/engine-sim");
  const { compileGame } = await import("../game/compile.js");
  const { GameRunner } = await import("../game/runner.js");
  const { botInput, HumanBot } = await import("../game/bot.js");
  const { insideView } = await import("../game/view.js");
  const { threatOf } = await import("../game/threats.js");
  await sim.initSim();
  const compiled = compileGame(manifest);
  const world = sim.createWorld({ ...compiled.sim, seed: opts.seed ?? 1 });
  const runner = new GameRunner(compiled, world, opts.enemies ? { holdEnemies: opts.enemies, ...(opts.enemyMix ? { holdMix: true } : {}) } : {});
  const bots = Math.max(0, Math.min(100, Math.floor(opts.bots)));
  const arena = compiled.mode === "arena";
  for (let i = 1; i <= bots; i++) {
    if (arena) {
      const [x, z] = sim.arenaSpawn(world, i);
      sim.addPlayer(world, i, [x, world.config.arena.spawn[1], z]);
    } else sim.addPlayer(world, i, [i * 1.5 - bots * 0.75, 1, 0]);
  }
  const half = world.config.arena.halfExtent;
  let topScore = 0;
  const scorers = new Set<number>();
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  const now = () => (perf ? perf.now() : Date.now());
  const times: number[] = [];
  let deaths = 0;
  let kills = 0;
  let earnEmitted = 0;
  const earned: Record<string, number> = {};
  let wave = 0;
  let maxLevel = 0;
  let peakEnemies = 0;
  const runs = { won: 0, lost: 0 };
  let quiet = 0;
  let softlock = false;
  let nearby: [number, number][] = [];
  let gems: [number, number][] = [];
  let dangers: import("../game/bot.js").BotDanger[] = [];
  let bossesAt: [number, number][] = [];
  const enemyTypes = world.config.content.enemyTypes;
  let me = new Map<number, { x: number; z: number; choices: number; weapons: number; up: boolean }>();
  let downedAt: [number, number, number][] = [];
  // How far a player's weapons reach (the human bot orbits about there).
  const weaponDefs = world.config.content.weapons;
  const reachOf = (packed: number): number => {
    let r = 0;
    for (let s = 0; s < 4; s++) {
      const wi = (((packed >>> (s * 8)) & 0x0f) - 1);
      const lvl = (packed >>> (s * 8 + 4)) & 0x0f;
      const d = wi >= 0 ? weaponDefs[wi] : undefined;
      if (!d) continue;
      r = Math.max(r, d.kind === "nova" ? d.range * (1 + 0.08 * Math.max(0, lvl - 1)) : d.kind === "orbit" ? d.range + 0.5 : d.range * 0.7);
    }
    return r || 5;
  };
  const human = !arena && opts.bot === "human";
  const humans = new Map<number, InstanceType<typeof HumanBot>>();
  if (human) {
    for (let p = 1; p <= bots; p++) {
      const ws = compiled.sim.content?.weapons ?? [];
      const evolved = ws.flatMap((w, i) => (w.evolved ? [i] : []));
      const pairs = ws.flatMap((w, i) => (w.evolve ? [[i, ws.length + w.evolve.requires] as const] : []));
      humans.set(p, new HumanBot({ picks: opts.picks ?? "random", weaponCount: compiled.weaponIds.length, evolved, pairs, seed: (opts.seed ?? 1) * 97 + p }));
    }
  }
  const pillars = world.config.arena.pillars;
  const rate = world.tickRate;
  const fun = new FunTracker(arena, rate);
  const view = compiled.view;
  const bossSeen = new Map<number, number>();
  for (let t = 0; t < opts.ticks; t++) {
    if (!arena && t % (human ? 2 : 5) === 0) {
      const st = sim.captureState(world);
      nearby = [];
      gems = [];
      dangers = [];
      bossesAt = [];
      downedAt = [];
      me = new Map();
      for (const e of st.entities) {
        if (human && (e.level !== 0 || e.kind === sim.EntityKind.Projectile)) {
          const th = threatOf(enemyTypes, e.kind, e.flags, e.type, e.level, e.px / 1024, e.pz / 1024, e.vx / 1024, e.vz / 1024);
          if (th && th.kind !== "aura") dangers.push(th);
        }
        // Props (urns, braziers) are scenery: never a threat, never something to kite.
        if (e.kind === sim.EntityKind.Enemy && (e.flags & sim.EntityFlag.Dead) === 0 && !enemyTypes[e.type]?.prop) {
          nearby.push([e.px / 1024, e.pz / 1024]);
          if (enemyTypes[e.type]?.boss) bossesAt.push([e.px / 1024, e.pz / 1024]);
        }
        else if (e.kind === sim.EntityKind.Pickup) gems.push([e.px / 1024, e.pz / 1024]);
        else if (e.kind === sim.EntityKind.Player) {
          const up = (e.flags & (sim.EntityFlag.Dead | sim.EntityFlag.Downed)) === 0;
          me.set(e.owner, { x: e.px / 1024, z: e.pz / 1024, choices: e.choices, weapons: e.weapons, up });
          if ((e.flags & sim.EntityFlag.Downed) !== 0) downedAt.push([e.owner, e.px / 1024, e.pz / 1024]);
        }
      }
      if (runner.runNumber === 1) {
        fun.sample(runner.info().seconds, nearby, [...me.values()].filter((m) => m.up), view, insideView);
        const elite = st.entities.some((e) => e.kind === sim.EntityKind.Enemy && (e.flags & (sim.EntityFlag.Elite | sim.EntityFlag.Dead)) === sim.EntityFlag.Elite);
        fun.field(runner.info().seconds, elite, bossesAt.length > 0, [...me.values()].map((m) => m.up));
      }
    }
    const inputs = new Map<number, import("@netnetcapital/engine-sim").InputCommand>();
    for (let p = 1; p <= bots; p++) {
      if (arena) {
        // Arena: playtest players play like the seat bots (the runner's autopilot).
        inputs.set(p, runner.autopilot(p));
        continue;
      }
      const m = me.get(p) ?? { x: 0, z: 0, choices: 0, weapons: 0, up: true };
      const hb = humans.get(p);
      if (hb) {
        const onScreen = (q: readonly [number, number]) => insideView(view, q[0] - m.x, q[1] - m.z);
        inputs.set(p, hb.input({ ...m, half, pillars, reach: reachOf(m.weapons), bosses: bossesAt.filter(onScreen), downed: downedAt.filter((d) => d[0] !== p).map((d) => [d[1], d[2]] as const), enemies: nearby.filter(onScreen), gems: gems.filter(onScreen), dangers: dangers.filter((d) => onScreen([d.x, d.z])) }, t));
        continue;
      }
      const close = nearby.filter(([x, z]) => Math.abs(x - m.x) < 6 && Math.abs(z - m.z) < 6);
      inputs.set(p, botInput({ ...m, half }, close, t, p));
    }
    const a = now();
    runner.beforeStep(inputs);
    const r = sim.step(world, inputs);
    const out = runner.afterStep(r.events);
    times.push(now() - a);
    let active = false;
    const firstRun = runner.runNumber === 1 && !out.reset;
    const secs = runner.info().seconds;
    if (!arena) for (const id of runner.bossIds()) if (!bossSeen.has(id)) bossSeen.set(id, t);
    for (const e of r.events) {
      if (e.type === "player.downed") deaths++;
      if (e.type === "enemy.killed") kills++;
      if (arena && e.type === "player.killed") {
        deaths++;
        if (e.by > 0 && e.by !== e.playerId) {
          kills++;
          scorers.add(e.by);
        }
      }
      if (e.type === "enemy.killed" || e.type === "player.hit" || e.type === "entity.spawned") active = true;
      if (e.type === "player.levelup") maxLevel = Math.max(maxLevel, e.level);
      if (!arena && firstRun && e.type === "enemy.killed" && e.boss) {
        const born = bossSeen.get(e.netId);
        if (born !== undefined) fun.bossKilled(compiled.enemyPrefabs[e.enemyType] ?? "", (t - born) / rate);
      }
      if (arena) fun.arenaEvent(e, t);
      else if (firstRun) {
        let onScreen = false;
        if (e.type === "entity.spawned" && e.kind === sim.EntityKind.Enemy && !e.from) {
          const pos = sim.entityPosition(world, e.netId);
          // Props (urns, lanterns) are scenery, not threats: they may sit anywhere.
          const t = sim.enemyTypeOf(world, e.netId);
          onScreen = pos !== undefined && !world.config.content.enemyTypes[t]?.prop && sim.isOnScreen(world, pos[0], pos[1]);
        }
        fun.hordeEvent(e, secs, onScreen);
      }
    }
    if (arena) fun.leader(runner.info().players.map((p) => [p.id, p.kills] as const));
    else if (runner.runNumber === 1) fun.levels(secs, runner.info().players.map((p) => p.level));
    for (const ev of out.events) {
      if (ev.name === "run.won") runs.won++;
      if (ev.name === "run.lost") runs.lost++;
      if ((ev.name === "run.won" || ev.name === "run.lost") && runner.runNumber === 1) fun.runEnded(secs);
      if (arena && ev.name === "run.won") fun.roundEnded();
    }
    for (const aw of out.awards) {
      earnEmitted += aw.units;
      earned[aw.rule] = (earned[aw.rule] ?? 0) + aw.units;
    }
    const info = runner.info();
    wave = Math.max(wave, info.wave);
    peakEnemies = Math.max(peakEnemies, info.enemies);
    for (const p of info.players) topScore = Math.max(topScore, p.kills);
    quiet = active ? 0 : quiet + 1;
    if (quiet >= 30 * world.tickRate) softlock = true;
  }
  sim.destroyWorld(world);
  const sorted = [...times].sort((x, y) => x - y);
  const base = {
    ticks: opts.ticks,
    bots,
    deaths,
    kills,
    msPerTick: times.reduce((x, y) => x + y, 0) / Math.max(1, times.length),
    p99MsPerTick: sorted[Math.floor(0.99 * Math.max(0, sorted.length - 1))] ?? 0,
    earnEmitted,
    softlock,
    wave,
    runs,
    maxLevel,
    peakEnemies,
    topScore: arena ? topScore : 0,
    scorers: scorers.size,
    earned,
    fun: fun.report(opts.ticks / rate, bots),
  };
  const failed = (opts.assert ?? []).filter((x) => !x.check({ ...base, failed: [] })).map((x) => x.name);
  return { ...base, failed };
}

type SimEventLike = import("@netnetcapital/engine-sim").SimEvent;

/** Collects FunMetrics while the harness plays. */
class FunTracker {
  private firstThreat: number | null = null;
  private firstReward: number | null = null;
  private readonly levelAt: Record<"60" | "180" | "360" | "540", number | null> = { "60": null, "180": null, "360": null, "540": null };
  private downsEarly = 0;
  private onScreen30: number | null = null;
  private hitsEarly = 0;
  private lastSource = new Map<number, string>();
  private lateDowns = 0;
  private lateTelegraphed = 0;
  private spawns = 0;
  private spawnsSeen = 0;
  private survival: number | null = null;
  // arena
  private spawnTick = new Map<number, number>();
  private firstDamageGaps: number[] = [];
  private damagedSinceSpawn = new Set<number>();
  private arenaDeaths = 0;
  private spawnDeaths = 0;
  private kills = new Map<number, number>();
  private lead = 0;
  private leadChanges = 0;
  private rounds = 1;
  private readonly bosses: { prefab: string; seconds: number }[] = [];
  private firstHit: number | null = null;
  private lowest120: number | null = null;
  private firstElite: number | null = null;
  private firstBoss: number | null = null;
  private playerSamples = 0;
  private downSamples = 0;

  /** One sample of the first run: elites and bosses on the field, and players up or not. */
  field(secs: number, elite: boolean, boss: boolean, upFlags: readonly boolean[]): void {
    if (elite && this.firstElite === null) this.firstElite = Math.round(secs);
    if (boss && this.firstBoss === null) this.firstBoss = Math.round(secs);
    for (const up of upFlags) {
      this.playerSamples++;
      if (!up) this.downSamples++;
    }
  }
  private readonly downSources: Record<string, number> = {};

  bossKilled(prefab: string, seconds: number): void {
    this.bosses.push({ prefab, seconds: Math.round(seconds) });
  }

  constructor(
    private readonly arena: boolean,
    private readonly rate: number,
  ) {}

  sample(
    secs: number,
    enemies: readonly (readonly [number, number])[],
    players: readonly { x: number; z: number }[],
    view: readonly number[],
    inside: (radii: readonly number[], dx: number, dz: number) => boolean,
  ): void {
    if (this.firstThreat === null) {
      for (const p of players) {
        for (const e of enemies) {
          if ((e[0] - p.x) ** 2 + (e[1] - p.z) ** 2 < 9) {
            this.firstThreat = secs;
            break;
          }
        }
        if (this.firstThreat !== null) break;
      }
    }
    if (this.onScreen30 === null && secs >= 30) {
      let most = 0;
      for (const p of players) {
        let n = 0;
        for (const e of enemies) if (inside(view, e[0] - p.x, e[1] - p.z)) n++;
        most = Math.max(most, n);
      }
      this.onScreen30 = most;
    }
  }

  hordeEvent(e: SimEventLike, secs: number, spawnedOnScreen: boolean): void {
    if (e.type === "player.levelup" && this.firstReward === null) this.firstReward = secs;
    else if (e.type === "player.hit") {
      if (this.firstHit === null) this.firstHit = Math.round(secs * 10) / 10;
      if (secs < 120) this.lowest120 = Math.min(this.lowest120 ?? Infinity, e.health);
      const source = e.source ?? "contact";
      this.lastSource.set(e.playerId, source);
      if (source === "contact" && secs < 60) this.hitsEarly++;
    } else if (e.type === "player.downed") {
      const src = this.lastSource.get(e.playerId) ?? "contact";
      this.downSources[src] = (this.downSources[src] ?? 0) + 1;
      if (secs < 60) this.downsEarly++;
      if (secs >= 180) {
        this.lateDowns++;
        if ((this.lastSource.get(e.playerId) ?? "contact") !== "contact") this.lateTelegraphed++;
      }
    } else if (e.type === "entity.spawned" && e.kind === 2 && !e.from) {
      this.spawns++;
      if (spawnedOnScreen) this.spawnsSeen++;
    }
  }

  levels(secs: number, levels: readonly number[]): void {
    const best = levels.reduce((a, b) => Math.max(a, b), 0);
    for (const k of ["60", "180", "360", "540"] as const) if (this.levelAt[k] === null && secs >= Number(k)) this.levelAt[k] = best;
  }

  runEnded(secs: number): void {
    if (this.survival === null) this.survival = secs;
  }

  arenaEvent(e: SimEventLike, tick: number): void {
    if (e.type === "player.joined" || e.type === "player.respawned") {
      this.spawnTick.set(e.playerId, tick);
      this.damagedSinceSpawn.delete(e.playerId);
    } else if (e.type === "player.hit") {
      if (this.firstThreat === null) this.firstThreat = tick / this.rate;
      if (!this.damagedSinceSpawn.has(e.playerId)) {
        this.damagedSinceSpawn.add(e.playerId);
        this.firstDamageGaps.push((tick - (this.spawnTick.get(e.playerId) ?? 0)) / this.rate);
      }
    } else if (e.type === "player.killed") {
      this.arenaDeaths++;
      if (tick - (this.spawnTick.get(e.playerId) ?? 0) <= 3 * this.rate) this.spawnDeaths++;
      if (e.by > 0 && e.by !== e.playerId) {
        if (this.firstReward === null) this.firstReward = tick / this.rate;
        this.kills.set(e.by, (this.kills.get(e.by) ?? 0) + 1);
      }
    }
  }

  leader(scores: readonly (readonly [number, number])[]): void {
    let best = 0;
    let who = 0;
    let tie = false;
    for (const [id, k] of scores) {
      if (k > best) {
        best = k;
        who = id;
        tie = false;
      } else if (k === best && k > 0) tie = true;
    }
    if (best > 0 && !tie && who !== this.lead) {
      if (this.lead !== 0) this.leadChanges++;
      this.lead = who;
    }
  }

  roundEnded(): void {
    this.rounds++;
    this.lead = 0;
  }

  report(seconds: number, players: number): FunMetrics {
    const r2 = (x: number) => Math.round(x * 100) / 100;
    if (this.arena) {
      const gaps = [...this.firstDamageGaps].sort((a, b) => a - b);
      const ks = [...this.kills.values()];
      const mean = ks.reduce((a, b) => a + b, 0) / Math.max(1, players);
      return {
        genre: "arena",
        firstThreatSeconds: this.firstThreat,
        firstRewardSeconds: this.firstReward,
        levelAt: { "60": null, "180": null, "360": null, "540": null },
        deathsBeforeMinute: null,
        onScreenAt30: null,
        contactHitsFirstMinute: null,
        telegraphedDeathShare: null,
        spawnsOnScreen: null,
        survivalSeconds: null,
        spawnToDamageSeconds: gaps.length ? r2(gaps[Math.floor(gaps.length / 2)] ?? 0) : null,
        spawnDeathShare: this.arenaDeaths ? r2(this.spawnDeaths / this.arenaDeaths) : null,
        killSpread: mean > 0 ? r2(Math.max(...ks) / mean) : null,
        leadChanges: r2(this.leadChanges / Math.max(1, this.rounds)),
        bossKills: [],
        downsBySource: {},
        firstHitSeconds: null,
        lowestHealthBy120: null,
        firstEliteSeconds: null,
        firstBossSeconds: null,
        downTimeShare: null,
      };
    }
    return {
      genre: "horde",
      firstThreatSeconds: this.firstThreat,
      firstRewardSeconds: this.firstReward,
      levelAt: { ...this.levelAt },
      deathsBeforeMinute: this.downsEarly,
      onScreenAt30: this.onScreen30,
      contactHitsFirstMinute: r2(this.hitsEarly / Math.max(1, players)),
      telegraphedDeathShare: this.lateDowns ? r2(this.lateTelegraphed / this.lateDowns) : null,
      spawnsOnScreen: this.spawns ? r2(this.spawnsSeen / this.spawns) : 0,
      survivalSeconds: this.survival ?? Math.floor(seconds),
      spawnToDamageSeconds: null,
      spawnDeathShare: null,
      killSpread: null,
      leadChanges: null,
      bossKills: [...this.bosses],
      downsBySource: { ...this.downSources },
      firstHitSeconds: this.firstHit,
      lowestHealthBy120: this.lowest120,
      firstEliteSeconds: this.firstElite,
      firstBossSeconds: this.firstBoss,
      downTimeShare: this.playerSamples ? r2(this.downSamples / this.playerSamples) : null,
    };
  }
}
