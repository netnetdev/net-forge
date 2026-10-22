/**
 * The spawn director (game-runtime.md §12, GAME-DESIGN.md): the engine's
 * answer to "top the crowd up to N". It runs on the authoritative side next
 * to the systems, on the run clock, and is fully deterministic (the sim's
 * PRNG, tick counts, netId-ordered loops in the sim).
 *
 *  - Spawns from a weighted pool at a curve-driven rate, up to a
 *    curve-driven number alive, scaled by players present.
 *  - Spawns just outside each player's screen (engine-sim edge points):
 *    never on it, never clamped to a wall.
 *  - Bodies the cap held back become "crowded" multipliers on later spawns.
 *  - Recycles stragglers far off screen to the edge ahead of a moving player.
 */
import { edgeSpawnPoint, enemyCount, entityHeadroom, listPlayers, recycleEnemies, setEnemySpeed, simRandom, spawnEnemyScaled } from "@netnetcapital/engine-sim";
import type { SimWorld, SpawnScale } from "@netnetcapital/engine-sim";
import type { Curve, DirectorDef } from "../api/schemas.js";

/** Value of a curve at `t` seconds: linear between keyframes, held outside them. */
export function curveAt(c: Curve, t: number): number {
  if (typeof c === "number") return c;
  const first = c[0];
  if (!first) return 0;
  if (t <= first[0]) return first[1];
  for (let i = 1; i < c.length; i++) {
    const b = c[i] as readonly [number, number];
    if (t <= b[0]) {
      const a = c[i - 1] as readonly [number, number];
      return a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]);
    }
  }
  return (c[c.length - 1] as readonly [number, number])[1];
}

/** Ticks between straggler sweeps. */
const RECYCLE_PERIOD = 15;

export interface DirectorHooks {
  /** Engine enemy type index of a prefab (undefined for pickups). */
  readonly typeOf: (prefab: string) => number | undefined;
  /** Prefab radius, m. */
  readonly radiusOf: (prefab: string) => number;
  /** Called for each spawn (the runner tracks bosses). */
  readonly spawned?: (prefab: string, netId: number) => void;
  /** True while a boss is alive. */
  readonly bossAlive: () => boolean;
}

export class Director {
  private budget: number;
  /** Bodies the cap held back, owed as toughness. */
  private pressure = 0;
  /** Spawn-rate multiplier set by systems (events), and until when. */
  private boost = 1;
  private boostUntil = 0;
  private pausedUntil = 0;
  /** Run tick of the next elite (-1: none planned). */
  private nextElite = -1;

  constructor(
    private readonly def: DirectorDef,
    private readonly world: SimWorld,
    private readonly hooks: DirectorHooks,
  ) {
    this.budget = def.start;
    if (def.elites) this.nextElite = Math.round(def.elites.from * world.tickRate);
  }

  /** Systems: stop spawning for `ticks` from `now` (events, set pieces). */
  pause(now: number, ticks: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, now + ticks);
  }

  /** Systems: multiply the spawn rate by `k` for `ticks` from `now`. */
  surge(now: number, k: number, ticks: number): void {
    this.boost = k;
    this.boostUntil = now + ticks;
  }

  /** Players present (at least 1), for the per-player scaling. */
  private players(): number {
    return Math.max(1, listPlayers(this.world).length);
  }

  /** The living-enemy target at run tick `tick` (scaled by players). */
  aliveTarget(tick: number): number {
    const t = tick / this.world.tickRate;
    const mult = 1 + this.def.perPlayer * (this.players() - 1);
    return Math.min(this.def.max, Math.round(curveAt(this.def.alive, t) * mult));
  }

  /** One run tick. */
  tick(tick: number): void {
    const w = this.world;
    const rate = w.tickRate;
    const def = this.def;
    if (def.recycle !== false && tick % RECYCLE_PERIOD === 0 && tick > 0) {
      const r = def.recycle === true ? { seconds: 2.5, margin: 8 } : def.recycle;
      recycleEnemies(w, RECYCLE_PERIOD, Math.round(r.seconds * rate), r.margin);
    }
    const t = tick / rate;
    setEnemySpeed(w, curveAt(def.speed, t));
    if (tick < this.pausedUntil) return;
    if (this.nextElite >= 0 && tick >= this.nextElite && def.elites) {
      const e = this.pick(t);
      if (e && this.spawnGroup(e.prefab, 1, t, true) > 0) {
        const [lo, hi] = def.elites.every;
        this.nextElite = tick + Math.round((lo + simRandom(w) * (hi - lo)) * rate);
      }
    }
    const n = this.players();
    const mult = 1 + def.perPlayer * (n - 1);
    let perSecond = curveAt(def.rate, t) * mult * (this.hooks.bossAlive() ? def.whileBoss : 1);
    if (tick < this.boostUntil) perSecond *= this.boost;
    this.budget = Math.min(this.budget + perSecond / rate, Math.max(this.budget, perSecond * 2 + 1));
    const cap = Math.min(def.max, Math.round(curveAt(def.alive, t) * mult));
    let alive = enemyCount(w);
    let guard = 64;
    while (this.budget >= 1 && guard-- > 0) {
      if (alive >= cap) {
        // The cap holds the body back; it comes back as toughness instead.
        this.budget -= 1;
        this.pressure = Math.min(this.pressure + 1, cap);
        continue;
      }
      const entry = this.pick(t);
      if (!entry) {
        this.budget = 0;
        break;
      }
      const g = entry.group;
      const size = Array.isArray(g) ? g[0] + Math.floor(simRandom(w) * (g[1] - g[0] + 1)) : g;
      const spawned = this.spawnGroup(entry.prefab, Math.min(size, cap - alive), t);
      this.budget -= Math.max(1, size);
      alive += spawned;
      if (spawned === 0) break;
    }
  }

  private pick(t: number): DirectorDef["pool"][number] | null {
    const def = this.def;
    let total = 0;
    const weights: number[] = [];
    for (const e of def.pool) {
      let wgt = 0;
      if (t >= e.from && (e.until === undefined || t < e.until)) {
        wgt = e.weight;
        if (def.fade && t - e.from > def.fade.after) wgt *= def.fade.weight;
      }
      weights.push(wgt);
      total += wgt;
    }
    if (total <= 0) return null;
    let r = simRandom(this.world) * total;
    for (let i = 0; i < def.pool.length; i++) {
      r -= weights[i] ?? 0;
      if (r < 0) return def.pool[i] ?? null;
    }
    return def.pool[def.pool.length - 1] ?? null;
  }

  /** Spawn up to `count` of a prefab from one heading off one player's screen. */
  private spawnGroup(prefab: string, count: number, t: number, elite = false): number {
    const w = this.world;
    const type = this.hooks.typeOf(prefab);
    if (type === undefined || count <= 0) return 0;
    const radius = this.hooks.radiusOf(prefab);
    const def = this.def;
    const base: SpawnScale = { health: curveAt(def.health, t), damage: curveAt(def.damage, t), xp: curveAt(def.xp, t) };
    // A group shares a heading: one stream from one direction.
    const heading = count > 1 ? simRandom(w) * Math.PI * 2 : undefined;
    const ahead = heading === undefined && simRandom(w) < def.ahead;
    let n = 0;
    for (let i = 0; i < count; i++) {
      if (entityHeadroom(w) <= 64) break;
      const at = edgeSpawnPoint(
        w,
        undefined,
        heading !== undefined ? { heading, spread: 0.45, radius } : ahead ? { relative: "ahead", spread: 2, radius } : { radius },
      );
      if (!at) break;
      let scale = base;
      if (this.pressure > 0) {
        this.pressure--;
        scale = { health: (base.health ?? 1) * def.crowded.health, damage: (base.damage ?? 1) * def.crowded.damage, xp: (base.xp ?? 1) * def.crowded.xp };
      }
      const id = spawnEnemyScaled(w, type, at[0], at[1], elite ? { ...scale, elite: true } : scale);
      this.hooks.spawned?.(prefab, id);
      n++;
    }
    return n;
  }
}
