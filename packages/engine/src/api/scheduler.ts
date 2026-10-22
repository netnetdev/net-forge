import { GameDefinitionError } from "./schemas.js";
import type { GameManifest, PlayerView, SpawnEdgeOptions, SpawnRingOptions, SystemContext } from "./registry.js";

/** What the scheduler needs from the simulation it drives. */
export interface SystemHost {
  readonly tickRate: number;
  tick(): number;
  players(): readonly PlayerView[];
  spawn(prefab: string, at: readonly [number, number, number], opts?: { readonly elite?: boolean }): void;
  random(): number;
  emit(event: string, players?: readonly number[]): void;
  /** Living enemies of a prefab (or all). Hosts that do not simulate enemies may omit it. */
  alive?(prefab?: string): number;
  respawnDead?(): void;
  end?(outcome: "won" | "lost"): void;
  /**
   * A ring point around (cx, cz) inside the arena and clear of obstacles,
   * or null. Hosts without one get plain ring math.
   */
  ringPoint?(cx: number, cz: number, radius: number, prefab: string): readonly [number, number] | null;
  /** Spawn just off screen (the host knows the camera). Hosts without one fall back to a ring at 24 m. */
  spawnEdge?(prefab: string, opts: SpawnEdgeOptions): number;
  spawnPickup?(prefab: string, at: readonly [number, number, number]): void;
  announce?(text: string, tone: "info" | "danger" | "reward"): void;
  upcoming?(label: string, seconds: number): void;
  bossAlive?(): boolean;
  pauseDirector?(seconds: number): void;
  surge?(multiplier: number, seconds: number): void;
  xpBoost?(multiplier: number, seconds: number): void;
  scatter?(prefab: string, count: number): number;
  clear?(prefab: string): number;
  onScreen?(x: number, z: number): boolean;
}

interface Timer {
  due: number;
  period: number;
  n: number;
  fn: (n: number) => void;
  repeat: boolean;
}

/**
 * Runs the declared systems' schedules against a host, one fixed tick at a
 * time. Timers are tick-based (seconds are rounded to whole ticks at
 * declaration), so the schedule is identical on the server and in client
 * prediction. Timers fire in declaration order within a tick.
 */
export class SystemScheduler {
  private readonly timers: Timer[] = [];
  private readonly perTick: (() => void)[] = [];
  private readonly listeners = new Map<string, ((players: readonly number[]) => void)[]>();
  private started = false;

  constructor(
    private readonly manifest: GameManifest,
    private readonly host: SystemHost,
  ) {}

  private toTicks(seconds: number, what: string): number {
    if (!(Number.isFinite(seconds) && seconds > 0)) {
      throw new GameDefinitionError(what, [`seconds must be a positive number, got ${seconds}`]);
    }
    return Math.max(1, Math.round(seconds * this.host.tickRate));
  }

  private context(system: string): SystemContext {
    const h = this.host;
    const prefabs = this.manifest.prefabs;
    const checkPrefab = (id: string) => {
      if (!prefabs.has(id)) throw new GameDefinitionError(`system("${system}")`, [`spawns "${id}", which is not a declared prefab`]);
    };
    return {
      tick: () => h.tick(),
      time: () => h.tick() / h.tickRate,
      players: () => h.players(),
      every: (seconds, fn) => {
        const period = this.toTicks(seconds, `system("${system}").every`);
        this.timers.push({ due: h.tick() + period, period, n: 0, fn, repeat: true });
      },
      after: (seconds, fn) => {
        const period = this.toTicks(seconds, `system("${system}").after`);
        this.timers.push({ due: h.tick() + period, period, n: 0, fn: () => fn(), repeat: false });
      },
      onTick: (fn) => {
        this.perTick.push(fn);
      },
      spawn: (id, at, opts) => {
        checkPrefab(id);
        h.spawn(id, at, opts);
      },
      spawnRing: (id, opts: SpawnRingOptions) => {
        checkPrefab(id);
        const all = h.players().filter((p) => p.alive);
        const centre = opts.around !== undefined ? all.filter((p) => p.id === opts.around) : all;
        const count = Math.max(0, Math.floor(opts.count));
        for (let i = 0; i < count; i++) {
          const p = centre.length > 0 ? centre[Math.floor(h.random() * centre.length)] : undefined;
          const [cx, cy, cz] = p ? p.position : [0, 0, 0];
          if (h.ringPoint) {
            const at = h.ringPoint(cx, cz, opts.radius, id);
            if (at) h.spawn(id, [at[0], cy, at[1]]);
            continue;
          }
          const a = h.random() * Math.PI * 2;
          h.spawn(id, [cx + Math.cos(a) * opts.radius, cy, cz + Math.sin(a) * opts.radius]);
        }
      },
      spawnEdge: (id, opts: SpawnEdgeOptions) => {
        checkPrefab(id);
        const count = Math.max(0, Math.floor(opts.count));
        if (count === 0) return 0;
        if (h.spawnEdge) return h.spawnEdge(id, { ...opts, count });
        const all = h.players().filter((p) => p.alive);
        let n = 0;
        for (let i = 0; i < count; i++) {
          const p = all.length > 0 ? all[Math.floor(h.random() * all.length)] : undefined;
          const [cx, cy, cz] = p ? p.position : [0, 0, 0];
          const a = h.random() * Math.PI * 2;
          h.spawn(id, [cx + Math.cos(a) * 24, cy, cz + Math.sin(a) * 24]);
          n++;
        }
        return n;
      },
      emit: (event, players) => h.emit(event, players),
      random: () => h.random(),
      alive: (id) => {
        if (id !== undefined) checkPrefab(id);
        return h.alive ? h.alive(id) : 0;
      },
      on: (event, fn) => {
        const list = this.listeners.get(event) ?? [];
        list.push(fn);
        this.listeners.set(event, list);
      },
      respawnDead: () => h.respawnDead?.(),
      spawnPickup: (id, at) => {
        checkPrefab(id);
        h.spawnPickup?.(id, at);
      },
      announce: (text, opts) => {
        const t = String(text).slice(0, 60);
        if (t) h.announce?.(t, opts?.tone ?? "info");
      },
      upcoming: (label, seconds) => {
        const t = String(label).slice(0, 40);
        if (t) h.upcoming?.(t, this.toTicks(seconds, `system("${system}").upcoming`) / h.tickRate);
      },
      bossAlive: () => h.bossAlive?.() ?? false,
      pauseDirector: (seconds) => h.pauseDirector?.(this.toTicks(seconds, `system("${system}").pauseDirector`) / h.tickRate),
      surge: (multiplier, seconds) => h.surge?.(Math.max(0, Math.min(10, multiplier)), this.toTicks(seconds, `system("${system}").surge`) / h.tickRate),
      xpBoost: (multiplier, seconds) => h.xpBoost?.(Math.max(0, Math.min(10, multiplier)), this.toTicks(seconds, `system("${system}").xpBoost`) / h.tickRate),
      scatter: (id, count) => {
        checkPrefab(id);
        return h.scatter?.(id, Math.max(0, Math.min(200, Math.floor(count)))) ?? 0;
      },
      clear: (id) => {
        checkPrefab(id);
        return h.clear?.(id) ?? 0;
      },
      end: (outcome) => h.end?.(outcome),
      onScreen: (x, z) => h.onScreen?.(x, z) ?? false,
    };
  }

  /** Run every system's setup once. Call at the start of a run, before the first `tick`. */
  start(): void {
    if (this.started) return;
    this.started = true;
    for (const [name, setup] of this.manifest.systems) setup(this.context(name));
  }

  /** Deliver a game event to the systems that subscribed with `on`. */
  dispatch(event: string, players: readonly number[]): void {
    for (const fn of this.listeners.get(event) ?? []) fn(players);
  }

  /** Fire everything due at the host's current tick. Call once per fixed tick. */
  tick(): void {
    const now = this.host.tick();
    for (const fn of this.perTick) fn();
    for (let i = 0; i < this.timers.length; i++) {
      const t = this.timers[i];
      if (!t || t.due > now) continue;
      t.n++;
      t.fn(t.n);
      if (t.repeat) t.due += t.period;
      else this.timers.splice(i--, 1);
    }
  }
}
