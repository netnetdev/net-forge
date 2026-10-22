/**
 * The tower defense genre (template "tower-defense"): a co-op board where
 * up to four players build and upgrade towers along one road while waves of
 * creeps walk it toward the spire. Shared lives, gold of your own, bounties
 * to the tower's builder and a share to everyone else.
 *
 * Fixed point: Q units per tile (a tile is 2 m), integer creep progress
 * along the road, integer ranges compared squared. Targeting is "first"
 * (the creep furthest along), ties to the lower id, so the run replays
 * exactly from its inputs.
 */
import type { GameManifest } from "../api/registry.js";
import { towerContent, type TowerDef } from "../api/tower.js";
import type { GameEvent } from "../game/earn.js";
import type { EntityState } from "../net/schema.js";
import { entity, RulesKind, UNITS } from "./kit.js";
import type { Avatar, RulesCheck, RulesContext, RulesGenre, RulesHarnessRun, RulesInput, RulesStats, RunOutcome } from "./kit.js";

/** Fixed-point units per tile. */
export const Q = 256;
/** Metres per tile. */
export const TILE_M = 2;

/** Actions (RulesInput.act). */
export const TowerAct = { Build: 1, Upgrade: 2, Sell: 3, Ready: 4 } as const;

/** Creep flags on the wire. */
export const CreepFlag = { Slowed: 1, Boss: 2, Dead: 4, Leaked: 8 } as const;

interface Creep {
  id: number;
  type: number;
  hp: number;
  maxHp: number;
  /** Progress along the road, Q units. */
  d: number;
  /** Q units a tick at full speed. */
  speed: number;
  slowTicks: number;
  slow: number;
  value: number;
  dmg: number;
  boss: boolean;
  /** Ticks left as a corpse (dead or leaked); 0 while alive. */
  gone: number;
  flags: number;
  /** Who dealt the killing blow (tower owner), for the feed. */
  by: number;
}

interface Tower {
  id: number;
  type: number;
  owner: number;
  tx: number;
  ty: number;
  level: number;
  cd: number;
  spent: number;
  /** Shots fired (u16 wrap): the client draws a tracer when it changes. */
  shots: number;
  /** Local id of the last creep shot. */
  target: number;
  yaw: number;
  kills: number;
}

interface TowerPlayer {
  gold: number;
  kills: number;
  ready: boolean;
  built: number;
}

interface Spawn {
  tick: number;
  type: number;
}

export interface TowerState {
  rng: { s: number };
  ctx: RulesContext;
  tick: number;
  wave: number;
  phase: "build" | "wave";
  countdown: number;
  lives: number;
  livesMax: number;
  /** Lives the team bought (maxHealth upgrades) already added. */
  livesBought: Map<number, number>;
  queue: Spawn[];
  waveTick: number;
  creeps: Creep[];
  towers: Tower[];
  players: Map<number, TowerPlayer>;
  nextId: number;
  kills: number;
  leaks: number;
  peak: number;
  won: boolean;
  /** Bumped whenever anything happens (softlock detector). */
  activity: number;
}

interface TowerStats {
  damage: number;
  rate: number;
  range: number;
  radius: number;
  slow: number;
  slowSeconds: number;
  chains: number;
}

export interface CompiledTower {
  readonly id: string;
  readonly def: TowerDef;
  /** Stats at each level (0 = built). */
  readonly levels: readonly TowerStats[];
  /** Cost of each upgrade (index 0 buys level 1). */
  readonly upgradeCost: readonly number[];
}

export interface CompiledBoard {
  readonly w: number;
  readonly h: number;
  /** Waypoints, tile coords. */
  readonly path: readonly (readonly [number, number])[];
  /** Cumulative road length at each waypoint, Q units. */
  readonly cum: readonly number[];
  readonly length: number;
  readonly road: ReadonlySet<number>;
  readonly blocked: ReadonlySet<number>;
}

/** Tile key. */
export const tileKey = (x: number, y: number): number => y * 64 + x;

/** A tile's centre in metres, board centred on the origin. */
export function tileCenter(b: Pick<CompiledBoard, "w" | "h">, tx: number, ty: number): { x: number; z: number } {
  return { x: (tx + 0.5 - b.w / 2) * TILE_M, z: (ty + 0.5 - b.h / 2) * TILE_M };
}

/** The tile under a point in metres, or null off the board. */
export function tileAt(b: Pick<CompiledBoard, "w" | "h">, x: number, z: number): { tx: number; ty: number } | null {
  const tx = Math.floor(x / TILE_M + b.w / 2);
  const ty = Math.floor(z / TILE_M + b.h / 2);
  return tx >= 0 && ty >= 0 && tx < b.w && ty < b.h ? { tx, ty } : null;
}

export function compileBoard(def: { size: readonly [number, number]; path: readonly (readonly [number, number])[]; blocked: readonly (readonly [number, number])[] }): CompiledBoard {
  const [w, h] = def.size;
  const road = new Set<number>();
  const cum: number[] = [0];
  for (let i = 1; i < def.path.length; i++) {
    const a = def.path[i - 1] as readonly [number, number];
    const b = def.path[i] as readonly [number, number];
    const len = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
    cum.push((cum[i - 1] ?? 0) + len * Q);
    const sx = Math.sign(b[0] - a[0]);
    const sy = Math.sign(b[1] - a[1]);
    for (let k = 0; k <= len; k++) road.add(tileKey(a[0] + sx * k, a[1] + sy * k));
  }
  if (def.path.length === 1) {
    const p = def.path[0] as readonly [number, number];
    road.add(tileKey(p[0], p[1]));
  }
  const blocked = new Set(def.blocked.map(([x, y]) => tileKey(x, y)));
  return { w, h, path: def.path, cum, length: cum[cum.length - 1] ?? 0, road, blocked };
}

/** Position on the road at progress `d` (Q units), in Q units with the board's corner at 0, and the heading (u16 turn). */
export function roadPoint(b: CompiledBoard, d: number): { qx: number; qy: number; yaw: number } {
  let i = 1;
  while (i < b.cum.length - 1 && d > (b.cum[i] ?? 0)) i++;
  const a = b.path[i - 1] as readonly [number, number];
  const c = b.path[i] ?? a;
  const t = Math.max(0, d - (b.cum[i - 1] ?? 0));
  const sx = Math.sign(c[0] - a[0]);
  const sy = Math.sign(c[1] - a[1]);
  const qx = a[0] * Q + Q / 2 + sx * t;
  const qy = a[1] * Q + Q / 2 + sy * t;
  // Facing along the road: yaw 0 looks toward -z (the engine's convention).
  const yaw = sx > 0 ? 49152 : sx < 0 ? 16384 : sy > 0 ? 32768 : 0;
  return { qx, qy, yaw };
}

function statsAt(def: TowerDef, level: number): TowerStats {
  const s: TowerStats = { damage: def.damage, rate: def.rate, range: def.range, radius: def.radius, slow: def.slow, slowSeconds: def.slowSeconds, chains: def.chains };
  for (let i = 0; i < level && i < def.levels.length; i++) {
    const l = def.levels[i];
    if (!l) continue;
    if (l.damage !== undefined) s.damage = l.damage;
    if (l.rate !== undefined) s.rate = l.rate;
    if (l.range !== undefined) s.range = l.range;
    if (l.radius !== undefined) s.radius = l.radius;
    if (l.slow !== undefined) s.slow = l.slow;
    if (l.chains !== undefined) s.chains = l.chains;
  }
  return s;
}

/** Everything a tower defense game declared, compiled (shared by the room, the harness and the client). */
export interface CompiledTowerGame {
  readonly board: CompiledBoard;
  readonly towers: readonly CompiledTower[];
  readonly creeps: readonly { id: string; model: string; health: number; speed: number; value: number; damage: number; boss: boolean }[];
  readonly lives: number;
  readonly gold: number;
  readonly prep: number;
  readonly breather: number;
  readonly share: number;
  readonly waveGold: { base: number; perWave: number };
  readonly refund: number;
  readonly totalWaves: number;
  readonly healthGrowth: number;
  readonly groups: readonly { type: number; from: number; until: number; every: number; count: number; grow: number; gap: number; delay: number }[];
}

export function compileTowerGame(m: GameManifest): CompiledTowerGame {
  const c = towerContent(m);
  const creepIds = [...m.prefabs].filter(([, p]) => p.kind !== "pickup").map(([id]) => id);
  const creeps = creepIds.map((id) => {
    const p = m.prefabs.get(id);
    if (!p) throw new Error(id);
    return { id, model: p.model, health: p.health, speed: p.speed, value: p.value ?? 1, damage: p.damage ?? 1, boss: p.boss !== undefined && p.boss !== false };
  });
  return {
    board: compileBoard(c.board),
    towers: c.towers.map(([id, def]) => ({
      id,
      def,
      levels: Array.from({ length: def.levels.length + 1 }, (_, i) => statsAt(def, i)),
      upgradeCost: def.levels.map((l) => l.cost),
    })),
    creeps,
    lives: c.board.lives,
    gold: c.board.gold,
    prep: c.board.prep,
    breather: c.board.breather,
    share: c.board.share,
    waveGold: c.board.waveGold,
    refund: c.board.refund,
    totalWaves: c.waves.total,
    healthGrowth: c.waves.health,
    groups: c.waves.groups.map((g) => ({ type: creepIds.indexOf(g.prefab), from: g.from, until: g.until ?? c.waves.total, every: g.every, count: g.count, grow: g.grow, gap: g.gap, delay: g.delay })),
  };
}

/** The spawns of wave `n` (1-based), by tick offset into the wave. */
export function waveSpawns(g: CompiledTowerGame, n: number, tickRate: number): Spawn[] {
  const out: (Spawn & { order: number })[] = [];
  g.groups.forEach((grp, gi) => {
    if (n < grp.from || n > grp.until || (n - grp.from) % grp.every !== 0) return;
    const k = (n - grp.from) / grp.every;
    const count = Math.max(1, Math.floor(grp.count + grp.grow * k));
    for (let i = 0; i < count; i++) out.push({ tick: Math.round((grp.delay + i * grp.gap) * tickRate), type: grp.type, order: gi * 10000 + i });
  });
  out.sort((a, b) => a.tick - b.tick || a.order - b.order);
  return out.map(({ tick, type }) => ({ tick, type }));
}

/** What the next wave brings, by creep type (the HUD's preview). */
export function wavePreview(g: CompiledTowerGame, n: number): { type: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const s of waveSpawns(g, n, 1)) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
  return [...counts].map(([type, count]) => ({ type, count }));
}

const TICK = 30;
/** Alive and on the road: not a corpse, not leaked. */
const alive = (c: Creep): boolean => c.gone === 0 && c.hp > 0 && (c.flags & CreepFlag.Leaked) === 0;

/** Road tiles within reach of each tile, per board and range (the bots' placement score), cached. */
const coverageCache = new WeakMap<CompiledBoard, Map<number, Int32Array>>();
export function roadCoverage(b: CompiledBoard, rangeQ: number): Int32Array {
  let byRange = coverageCache.get(b);
  if (!byRange) coverageCache.set(b, (byRange = new Map()));
  let c = byRange.get(rangeQ);
  if (c) return c;
  c = new Int32Array(64 * 64);
  const r2 = rangeQ * rangeQ;
  const roadTiles = [...b.road].map((k) => [k % 64, Math.floor(k / 64)] as const);
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      let n = 0;
      for (const [rx, ry] of roadTiles) {
        const dx = (rx - x) * Q;
        const dy = (ry - y) * Q;
        if (dx * dx + dy * dy <= r2) n++;
      }
      c[tileKey(x, y)] = n;
    }
  byRange.set(rangeQ, c);
  return c;
}

/**
 * The best free tile for a tower of `type` (the most road in reach), with a
 * per-player tie-break and `jitter` (0 for the sharpest choice). Null when
 * no free tile reaches the road. Used by the playtest bots and the
 * client's autopilot alike.
 */
export function bestTowerTile(g: CompiledTowerGame, occupied: ReadonlySet<number>, type: number, salt: number, jitter = 0): { tx: number; ty: number } | null {
  const b = g.board;
  const tt = g.towers[type];
  if (!tt) return null;
  const cov = roadCoverage(b, Math.round((tt.levels[0]?.range ?? 1) * Q));
  let best = -1;
  let bx = 0;
  let by = 0;
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      const k = tileKey(x, y);
      if (b.road.has(k) || b.blocked.has(k) || occupied.has(k)) continue;
      const h = ((x * 73856093) ^ (y * 19349663) ^ (salt * 83492791)) >>> 0;
      const score = (cov[k] ?? 0) * 8 + (h % (1 + jitter * 8));
      if (score > best) {
        best = score;
        bx = x;
        by = y;
      }
    }
  return best > 8 ? { tx: bx, ty: by } : null;
}

export function towerGenre(m: GameManifest): RulesGenre<TowerState> & { readonly game: CompiledTowerGame } {
  const g = compileTowerGame(m);
  const b = g.board;
  const tickRate = TICK;
  const halfW = (b.w * TILE_M) / 2;
  const halfH = (b.h * TILE_M) / 2;
  /** Avatar speed, fixed units a tick (24 m/s). */
  const AVATAR_STEP = Math.round((24 * UNITS) / tickRate);
  const humans = (s: TowerState): number[] => [...s.players.keys()].filter((p) => !s.ctx.isBot(p));

  const buildable = (s: TowerState, tx: number, ty: number): boolean =>
    tx >= 0 && ty >= 0 && tx < b.w && ty < b.h && !b.road.has(tileKey(tx, ty)) && !b.blocked.has(tileKey(tx, ty)) && !s.towers.some((t) => t.tx === tx && t.ty === ty);

  const effective = (s: TowerState, t: Tower): TowerStats => {
    const base = g.towers[t.type]?.levels[t.level] ?? g.towers[0]!.levels[0]!;
    const might = s.ctx.bonus(t.owner, "might");
    const haste = s.ctx.bonus(t.owner, "haste");
    const area = s.ctx.bonus(t.owner, "area");
    return { ...base, damage: base.damage * (1 + might), rate: base.rate * (1 + haste), range: base.range * (1 + area) };
  };

  const startWave = (s: TowerState): void => {
    s.wave++;
    s.phase = "wave";
    s.queue = waveSpawns(g, s.wave, tickRate);
    s.waveTick = 0;
    for (const p of s.players.values()) p.ready = false;
    s.activity++;
  };

  const kill = (s: TowerState, c: Creep, owner: number, emit: (e: GameEvent) => void): void => {
    c.hp = 0;
    c.gone = 8;
    c.flags |= CreepFlag.Dead;
    c.by = owner;
    s.kills++;
    s.activity++;
    const pay = c.value;
    const own = s.players.get(owner);
    if (own) {
      own.gold += pay;
      own.kills++;
      emit({ name: "enemy.killed", players: [owner], own: true });
    }
    const share = Math.floor(pay * g.share);
    if (share > 0) for (const [p, pl] of s.players) if (p !== owner) pl.gold += share;
    if (c.boss) emit({ name: "boss.killed", players: humans(s) });
  };

  const hit = (s: TowerState, c: Creep, dmg: number, owner: number, emit: (e: GameEvent) => void): void => {
    if (!alive(c)) return;
    c.hp -= Math.max(1, Math.round(dmg));
    if (c.hp <= 0) kill(s, c, owner, emit);
  };

  const creepQ = (c: Creep) => roadPoint(b, c.d);

  const fire = (s: TowerState, t: Tower, emit: (e: GameEvent) => void): void => {
    const st = effective(s, t);
    if (t.cd > 0) {
      t.cd--;
      return;
    }
    const cx = t.tx * Q + Q / 2;
    const cy = t.ty * Q + Q / 2;
    const r = Math.round(st.range * Q);
    const r2 = r * r;
    let best: Creep | null = null;
    for (const c of s.creeps) {
      if (!alive(c)) continue;
      const p = creepQ(c);
      const dx = p.qx - cx;
      const dy = p.qy - cy;
      if (dx * dx + dy * dy > r2) continue;
      if (!best || c.d > best.d) best = c;
    }
    if (!best) return;
    const kind = g.towers[t.type]?.def.kind ?? "bolt";
    const p = creepQ(best);
    t.yaw = Math.round((Math.atan2(-(p.qx - cx), -(p.qy - cy)) / (Math.PI * 2)) * 65536) & 0xffff;
    t.cd = Math.max(1, Math.round(tickRate / Math.max(0.1, st.rate))) - 1;
    t.shots = (t.shots + 1) & 0xffff;
    t.target = best.id;
    s.activity++;
    const before = s.kills;
    if (kind === "splash") {
      const rr = Math.round(st.radius * Q);
      for (const c of s.creeps) {
        if (!alive(c)) continue;
        const q = creepQ(c);
        const dx = q.qx - p.qx;
        const dy = q.qy - p.qy;
        if (dx * dx + dy * dy <= rr * rr) hit(s, c, st.damage, t.owner, emit);
      }
    } else if (kind === "chain") {
      let at: Creep | null = best;
      const hitIds = new Set<number>();
      let dmg = st.damage;
      for (let j = 0; j < st.chains && at; j++) {
        hitIds.add(at.id);
        hit(s, at, dmg, t.owner, emit);
        dmg *= 0.7;
        const from = creepQ(at);
        let next: Creep | null = null;
        let nd = (Q * 1.6) ** 2;
        for (const c of s.creeps) {
          if (!alive(c) || hitIds.has(c.id)) continue;
          const q = creepQ(c);
          const d2 = (q.qx - from.qx) ** 2 + (q.qy - from.qy) ** 2;
          if (d2 < nd) {
            nd = d2;
            next = c;
          }
        }
        at = next;
      }
    } else {
      hit(s, best, st.damage, t.owner, emit);
      if (kind === "frost" && alive(best) && st.slow > 0) {
        best.slow = Math.max(best.slow, st.slow);
        best.slowTicks = Math.round(st.slowSeconds * tickRate);
      }
    }
    t.kills += s.kills - before;
  };

  return {
    template: "tower-defense",
    tickRate,
    endSeconds: 8,
    infoEveryTicks: 3,
    game: g,

    create(seed, ctx) {
      return {
        rng: { s: seed | 0 },
        ctx,
        tick: 0,
        wave: 0,
        phase: "build",
        countdown: Math.round(g.prep * tickRate),
        lives: g.lives,
        livesMax: g.lives,
        livesBought: new Map(),
        queue: [],
        waveTick: 0,
        creeps: [],
        towers: [],
        players: new Map(),
        nextId: 1,
        kills: 0,
        leaks: 0,
        peak: 0,
        won: false,
        activity: 0,
      };
    },

    spawn(_s, player) {
      const end = b.path[b.path.length - 1] ?? [0, 0];
      const c = tileCenter(b, end[0], end[1]);
      const k = (player % 8) - 4;
      return { x: Math.round((c.x + k * 0.6) * UNITS), z: Math.round((c.z - 1) * UNITS) };
    },

    moveAvatar(a: Avatar, i: RulesInput) {
      const tx = Math.max(-halfW - 2, Math.min(halfW + 2, i.cx / 16)) * UNITS;
      const tz = Math.max(-halfH - 2, Math.min(halfH + 2, i.cz / 16)) * UNITS;
      if (i.cx === 0 && i.cz === 0 && i.act === 0) return;
      const dx = Math.round(tx) - a.x;
      const dz = Math.round(tz) - a.z;
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
      // A late joiner gets the gold the waves so far would have paid a builder.
      const gold = g.gold + Math.max(0, s.wave - 1) * (g.waveGold.base + g.waveGold.perWave * s.wave);
      s.players.set(player, { gold, kills: 0, ready: false, built: 0 });
      s.activity++;
    },

    leave(s, player) {
      s.players.delete(player);
      // Their towers keep standing for the team; their kills credit nobody.
      for (const t of s.towers) if (t.owner === player) t.owner = 0;
    },

    act(s, player, i, a, emit) {
      const pl = s.players.get(player);
      if (!pl) return;
      if (i.act === TowerAct.Ready) {
        if (s.phase === "build") pl.ready = i.a !== 0;
        a.flags = pl.ready ? a.flags | 1 : a.flags & ~1;
        s.activity++;
        return;
      }
      const tx = i.b;
      const ty = i.c;
      if (i.act === TowerAct.Build) {
        const tt = g.towers[i.a];
        if (!tt || !buildable(s, tx, ty) || pl.gold < tt.def.cost) return;
        pl.gold -= tt.def.cost;
        pl.built++;
        s.towers.push({ id: s.nextId++, type: i.a, owner: player, tx, ty, level: 0, cd: 0, spent: tt.def.cost, shots: 0, target: 0, yaw: 0, kills: 0 });
        s.activity++;
        emit({ name: "tower.built", players: [player], own: true });
        return;
      }
      const t = s.towers.find((x) => x.tx === tx && x.ty === ty);
      if (!t) return;
      if (i.act === TowerAct.Upgrade) {
        const cost = g.towers[t.type]?.upgradeCost[t.level];
        if (cost === undefined || pl.gold < cost) return;
        pl.gold -= cost;
        t.level++;
        if (t.owner === player) t.spent += cost;
        s.activity++;
        emit({ name: "tower.upgraded", players: [player], own: true });
        return;
      }
      if (i.act === TowerAct.Sell) {
        if (t.owner !== player) return;
        pl.gold += Math.floor(t.spent * g.refund);
        s.towers = s.towers.filter((x) => x !== t);
        s.activity++;
      }
    },

    step(s, emit) {
      s.tick++;
      // Team lives bought in the store (maxHealth upgrades): each player's bonus counts once.
      for (const p of s.players.keys()) {
        const want = Math.floor(s.ctx.bonus(p, "maxHealth"));
        const had = s.livesBought.get(p) ?? 0;
        if (want > had) {
          s.lives += want - had;
          s.livesMax += want - had;
          s.livesBought.set(p, want);
          s.activity++;
        }
      }
      if (s.phase === "build") {
        const people = humans(s);
        const allReady = people.length > 0 && people.every((p) => s.players.get(p)?.ready);
        if (allReady && s.countdown > 0) {
          // Calling the wave early pays a little gold for the seconds skipped.
          const bonus = Math.floor(s.countdown / tickRate);
          for (const pl of s.players.values()) pl.gold += bonus;
          s.countdown = 0;
        }
        if (s.countdown > 0) s.countdown--;
        else if (s.players.size > 0) startWave(s);
      } else {
        // Spawns due this tick.
        while (s.queue.length > 0 && (s.queue[0]?.tick ?? 0) <= s.waveTick) {
          const sp = s.queue.shift() as Spawn;
          const ct = g.creeps[sp.type];
          if (!ct) continue;
          // Creeps toughen each wave, and with every extra builder on the board (more towers): +30% a player past the first.
          const team = 1 + 0.3 * Math.max(0, humans(s).length - 1);
          const hp = Math.max(1, Math.round(ct.health * (1 + g.healthGrowth * (s.wave - 1)) * team));
          s.creeps.push({
            id: s.nextId++,
            type: sp.type,
            hp,
            maxHp: hp,
            d: 0,
            speed: Math.max(1, Math.round(((ct.speed / TILE_M) * Q) / tickRate)),
            slowTicks: 0,
            slow: 0,
            value: ct.value,
            dmg: ct.damage,
            boss: ct.boss,
            gone: 0,
            flags: ct.boss ? CreepFlag.Boss : 0,
            by: 0,
          });
          s.activity++;
        }
        s.waveTick++;
      }
      // Creeps walk.
      for (const c of s.creeps) {
        if (c.gone > 0) {
          c.gone--;
          continue;
        }
        const slowed = c.slowTicks > 0;
        if (slowed) c.slowTicks--;
        c.flags = slowed ? c.flags | CreepFlag.Slowed : c.flags & ~CreepFlag.Slowed;
        c.d += slowed ? Math.max(1, Math.round(c.speed * (1 - c.slow))) : c.speed;
        if (!slowed) c.slow = 0;
        if (c.d >= b.length) {
          c.d = b.length;
          c.gone = 3;
          c.flags |= CreepFlag.Leaked;
          s.lives = Math.max(0, s.lives - c.dmg);
          s.leaks += c.dmg;
          s.activity++;
        }
      }
      // Corpses and leaks stay a few ticks (clients see them fall or reach the spire), then go.
      s.creeps = s.creeps.filter((c) => c.gone > 0 || alive(c));
      // Towers fire, in build order.
      for (const t of s.towers) fire(s, t, emit);
      const living = s.creeps.filter(alive).length;
      s.peak = Math.max(s.peak, living);
      if (s.lives <= 0) return;
      if (s.phase === "wave" && s.queue.length === 0 && living === 0) {
        emit({ name: "wave.cleared", players: humans(s) });
        const pay = g.waveGold.base + g.waveGold.perWave * s.wave;
        for (const pl of s.players.values()) pl.gold += pay;
        s.activity++;
        if (s.wave >= g.totalWaves) {
          s.won = true;
          emit({ name: "run.won", players: humans(s) });
          return;
        }
        s.phase = "build";
        s.countdown = Math.round(g.breather * tickRate);
      }
    },

    outcome(s): RunOutcome | null {
      if (s.lives <= 0) return "lost";
      return s.won ? "won" : null;
    },

    view(s, player) {
      const boss = s.creeps.find((c) => c.boss && alive(c));
      const me = player !== null ? s.players.get(player) : undefined;
      return {
        genre: "tower",
        wave: s.wave,
        waves: g.totalWaves,
        stage: s.phase,
        countdown: Math.ceil(s.countdown / tickRate),
        lives: s.lives,
        livesMax: s.livesMax,
        left: s.queue.length + s.creeps.filter(alive).length,
        next: wavePreview(g, Math.min(g.totalWaves, s.wave + (s.phase === "build" ? 1 : 0) || 1)),
        boss: boss ? { type: boss.type, hp: boss.hp, maxHp: boss.maxHp } : null,
        players: [...s.players].map(([id, p]) => ({ id, gold: p.gold, kills: p.kills, ready: p.ready, built: p.built })),
        ...(me ? { gold: me.gold, ready: me.ready } : {}),
      };
    },

    entities(s, out: EntityState[]) {
      const toUnits = (q: number) => Math.round((q * TILE_M * UNITS) / Q);
      const ox = (b.w * Q) / 2;
      const oy = (b.h * Q) / 2;
      for (const c of s.creeps) {
        const p = roadPoint(b, c.d);
        out.push(entity(c.id, RulesKind.Unit, c.by, toUnits(p.qx - ox), toUnits(p.qy - oy), p.yaw, c.type, Math.max(0, c.hp), c.flags, Math.min(0xffff, Math.round((c.hp / Math.max(1, c.maxHp)) * 1000)), Math.min(0xffff, c.maxHp)));
      }
      for (const t of s.towers) {
        out.push(entity(t.id, RulesKind.Structure, t.owner, toUnits(t.tx * Q + Q / 2 - ox), toUnits(t.ty * Q + Q / 2 - oy), t.yaw, t.type, t.target, 0, t.level, t.shots));
      }
    },

    bot(s, player, a, tick, skill) {
      const pl = s.players.get(player);
      const idle: RulesInput = { mx: 0, mz: 0, cx: Math.round((a.x / UNITS) * 16), cz: Math.round((a.z / UNITS) * 16), act: 0, a: 0, b: 0, c: 0 };
      if (!pl) return idle;
      const period = Math.max(3, Math.round(tickRate * (skill >= 1 ? 0.5 : 1.4)));
      if ((tick + player * 7) % period !== 0) return idle;
      const at = (tx: number, ty: number, act: number, aa = 0): RulesInput => {
        const c = tileCenter(b, tx, ty);
        return { mx: 0, mz: 0, cx: Math.round(c.x * 16), cz: Math.round(c.z * 16), act, a: aa, b: tx, c: ty };
      };
      const mine = s.towers.filter((t) => t.owner === player);
      const order = g.towers.map((t, i) => i).sort((x, y) => (g.towers[x]?.def.cost ?? 0) - (g.towers[y]?.def.cost ?? 0));
      const want = order[(mine.length + player) % order.length] ?? 0;
      const pick = g.towers[want] && pl.gold >= (g.towers[want]?.def.cost ?? Infinity) ? want : order.find((i) => (g.towers[i]?.def.cost ?? Infinity) <= pl.gold);
      // Build while there is a good tile and gold; a weaker player builds less often and less well.
      const upgradeable = mine.filter((t) => (g.towers[t.type]?.upgradeCost[t.level] ?? Infinity) <= pl.gold).sort((x, y) => x.level - y.level || x.id - y.id);
      const preferUpgrade = mine.length >= 6 && upgradeable.length > 0;
      if (pick !== undefined && !preferUpgrade) {
        const occupied = new Set(s.towers.map((t) => tileKey(t.tx, t.ty)));
        const tile = bestTowerTile(g, occupied, pick, player, skill >= 1 ? 0 : 3);
        if (tile) return at(tile.tx, tile.ty, 1, pick);
      }
      const up = upgradeable[0];
      if (up) return at(up.tx, up.ty, 2);
      if (s.phase === "build" && !pl.ready && skill >= 0.5) return { ...idle, act: 4, a: 1 };
      return idle;
    },

    stats(s): RulesStats {
      let top = 0;
      let scorers = 0;
      for (const p of s.players.values()) {
        top = Math.max(top, p.kills);
        if (p.kills > 0) scorers++;
      }
      return {
        kills: s.kills,
        wave: Math.max(1, s.wave),
        level: s.towers.reduce((m, t) => Math.max(m, t.level + 1), 0),
        deaths: s.leaks,
        peakUnits: s.peak,
        scorers,
        topScore: top,
      };
    },

    activity(s) {
      return s.activity;
    },

    checks(run: RulesHarnessRun): RulesCheck[] {
      const min = Math.round(run.seconds / 6) / 10;
      const waveDone = run.stats.wave;
      const out: RulesCheck[] = [];
      out.push({
        ok: run.stats.kills > 0,
        line: `in ${min} minutes of ${run.players}-player play no creep was killed: check that the towers' damage, rate and range reach the road, and that waves() spawns creeps`,
      });
      out.push({
        ok: run.runs.lost === 0 || waveDone >= 4,
        line: `${run.players} playtest players lost the spire before wave 4: the opening is too punishing (fewer or slower first creeps, more starting gold or lives)`,
      });
      out.push({
        ok: waveDone >= 3 || run.seconds < 150,
        line: `only ${waveDone} wave(s) started in ${min} minutes: shorten prep and breather, or the gaps between creeps`,
      });
      return out;
    },

    progress(run) {
      return Math.min(1, run.stats.wave / Math.max(1, Math.min(g.totalWaves, 8))) * 0.6 + (run.stats.level >= 2 ? 0.2 : 0) + Math.min(0.2, run.stats.kills / 500);
    },
  };
}
