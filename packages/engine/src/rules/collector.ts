/**
 * The monster collector genre (template "collector"): a shared marsh where
 * each player walks their keeper, meets wild creatures in tall grass,
 * fights them turn by turn with a team of three, snares the ones worth
 * keeping and levels them up, while the whole room wears down one warden
 * before dusk.
 *
 * Every roll (encounters, accuracy, damage spread, snares, the foe's move)
 * comes from the state's own PRNG, so a run replays exactly from its
 * inputs. Battles are private: a player's view shows their own battle and
 * team; the others see only the creature beside them.
 */
import type { GameManifest } from "../api/registry.js";
import { collectorContent, ELEMENTS, type CreatureDef, type Element, type MarshDef, type MoveDef } from "../api/collector.js";
import type { GameEvent } from "../game/earn.js";
import type { EntityState } from "../net/schema.js";
import { entity, rand, randInt, RulesKind, UNITS } from "./kit.js";
import type { Avatar, RulesCheck, RulesContext, RulesGenre, RulesHarnessRun, RulesInput, RulesStats, RunOutcome } from "./kit.js";

/** Metres per tile. */
export const MARSH_TILE = 2;
/** Fixed units per tile. */
const TU = MARSH_TILE * UNITS;
/** Avatar radius, fixed units (0.4 m). */
const R = Math.round(0.4 * UNITS);

/** Actions (RulesInput.act). */
export const CollectorAct = { Pick: 1, Move: 2, Swap: 3, Snare: 4, Flee: 5, Challenge: 6 } as const;

/** What a battle log line says happened. */
export const LogKind = { Hit: 1, Miss: 2, Heal: 3, Guard: 4, Swap: 5, Snared: 6, Slipped: 7, Fled: 8, Won: 9, Fainted: 10, Wiped: 11, Level: 12, Met: 13, Warden: 14 } as const;

export interface Mon {
  species: number;
  level: number;
  hp: number;
  xp: number;
  guard: boolean;
}

export interface LogLine {
  readonly n: number;
  readonly kind: number;
  /** 0: yours, 1: the foe. */
  readonly who: 0 | 1;
  readonly move?: number;
  readonly dmg?: number;
  /** 1 strong, -1 weak, 0 plain. */
  readonly eff?: number;
  readonly value?: number;
}

interface Battle {
  foe: Mon;
  warden: boolean;
  turn: number;
}

interface Keeper {
  team: Mon[];
  active: number;
  box: number;
  snares: number;
  snaresBought: number;
  battle: Battle | null;
  log: LogLine[];
  logN: number;
  lastTile: number;
  cooldown: number;
  toCamp: boolean;
  catches: number;
  wins: number;
  wipes: number;
  wardenDamage: number;
  x: number;
  z: number;
  yaw: number;
  joinedTick: number;
}

export interface CollectorState {
  rng: { s: number };
  ctx: RulesContext;
  tick: number;
  dusk: number;
  wardenHp: number;
  wardenMax: number;
  wardenDown: boolean;
  /** Players who hurt the warden (they share its fall). */
  wardenHurt: Set<number>;
  keepers: Map<number, Keeper>;
  activity: number;
  battlesWon: number;
  catches: number;
  wipes: number;
  peakBattles: number;
}

export interface CompiledMarsh {
  readonly w: number;
  readonly h: number;
  readonly blocked: Uint8Array;
  readonly water: Uint8Array;
  /** Grass zone index + 1 per tile, 0 for none. */
  readonly grass: Uint8Array;
  readonly camp: readonly [number, number];
  readonly warden: readonly [number, number];
}

export interface CompiledCollector {
  readonly marsh: MarshDef;
  readonly map: CompiledMarsh;
  readonly creatures: readonly (CreatureDef & { id: string; el: number; moveIdx: number[] })[];
  readonly moves: readonly (MoveDef & { id: string; el: number })[];
  readonly starters: readonly number[];
  readonly wardenSpecies: number;
  readonly pools: readonly { rate: number; pool: { species: number; weight: number; level: readonly [number, number] }[] }[];
}

export function compileCollector(m: GameManifest): CompiledCollector {
  const c = collectorContent(m);
  const mm = c.marsh;
  const moves = c.moves.map(([id, d]) => ({ ...d, id, el: ELEMENTS.indexOf(d.element) }));
  const moveIdx = new Map(moves.map((mv, i) => [mv.id, i]));
  const creatures = c.creatures.map(([id, d]) => ({ ...d, id, el: ELEMENTS.indexOf(d.element), moveIdx: d.moves.map((x) => moveIdx.get(x) ?? 0) }));
  const cIdx = new Map(creatures.map((x, i) => [x.id, i]));
  const [w, h] = mm.size;
  const blocked = new Uint8Array(w * h);
  const water = new Uint8Array(w * h);
  const grass = new Uint8Array(w * h);
  const fill = (arr: Uint8Array, [x, y, rw, rh]: readonly [number, number, number, number], v: number) => {
    for (let j = y; j < y + rh && j < h; j++) for (let i = x; i < x + rw && i < w; i++) arr[j * w + i] = v;
  };
  for (const r of mm.blocked) fill(blocked, r, 1);
  for (const r of mm.water) {
    fill(water, r, 1);
    fill(blocked, r, 1);
  }
  mm.grass.forEach((g, gi) => fill(grass, g.at, gi + 1));
  return {
    marsh: mm,
    map: { w, h, blocked, water, grass, camp: mm.camp, warden: mm.warden.at },
    creatures,
    moves,
    starters: mm.starters.map((s) => cIdx.get(s) ?? 0),
    wardenSpecies: cIdx.get(mm.warden.creature) ?? 0,
    pools: mm.grass.map((g) => ({ rate: g.rate, pool: g.pool.map((p) => ({ species: cIdx.get(p.creature) ?? 0, weight: p.weight, level: p.level })) })),
  };
}

/** Strong (1), weak (-1) or plain (0): each element beats the next in the cycle. */
export function effectiveness(attack: number, defend: number): number {
  if ((attack + 1) % 4 === defend) return 1;
  if ((defend + 1) % 4 === attack) return -1;
  return 0;
}

/** A stat at a level: +12% a level. */
export const statAt = (base: number, level: number): number => Math.floor(base * (1 + 0.12 * (level - 1)));
/** Max health at a level. */
export const hpAt = (base: number, level: number): number => statAt(base, level) + level * 2;
/** XP to the next level. */
export const xpNeed = (level: number): number => level * 15 + 10;

/** The tile at a fixed-unit point (marsh centred on the origin), or -1 off the map. */
export function marshTile(map: Pick<CompiledMarsh, "w" | "h">, x: number, z: number): number {
  const tx = Math.floor(x / TU + map.w / 2);
  const ty = Math.floor(z / TU + map.h / 2);
  return tx >= 0 && ty >= 0 && tx < map.w && ty < map.h ? ty * map.w + tx : -1;
}

/** A tile's centre in fixed units. */
export function marshCenter(map: Pick<CompiledMarsh, "w" | "h">, tx: number, ty: number): { x: number; z: number } {
  return { x: Math.round((tx + 0.5 - map.w / 2) * TU), z: Math.round((ty + 0.5 - map.h / 2) * TU) };
}

/** Tiles from `from` to `goal` (excluding `from`), around blocked tiles; empty when there is no way. */
export function marshRoute(map: CompiledMarsh, from: number, goal: number): number[] {
  const prev = new Int32Array(map.w * map.h).fill(-2);
  const q = [from];
  prev[from] = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi] as number;
    if (c === goal) break;
    const cx = c % map.w;
    const cy = Math.floor(c / map.w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
      const n = ny * map.w + nx;
      if (prev[n] !== -2 || (map.blocked[n] && n !== goal)) continue;
      prev[n] = c;
      q.push(n);
    }
  }
  if (prev[goal] === -2) return [];
  const out: number[] = [];
  for (let c = goal; c !== from && c >= 0; c = prev[c] as number) out.push(c);
  return out.reverse();
}

const TICK = 30;

export function collectorGenre(m: GameManifest): RulesGenre<CollectorState> & { readonly game: CompiledCollector } {
  const g = compileCollector(m);
  const map = g.map;
  const mm = g.marsh;
  const tickRate = TICK;
  const step = Math.max(1, Math.round((mm.walk * UNITS) / tickRate));
  const halfW = (map.w * TU) / 2;
  const halfH = (map.h * TU) / 2;

  /** True when a circle at (x, z) touches a blocked tile or the marsh's edge. */
  const solid = (x: number, z: number): boolean => {
    if (x - R < -halfW || x + R > halfW || z - R < -halfH || z + R > halfH) return true;
    const x0 = Math.floor((x - R + halfW) / TU);
    const x1 = Math.floor((x + R - 1 + halfW) / TU);
    const z0 = Math.floor((z - R + halfH) / TU);
    const z1 = Math.floor((z + R - 1 + halfH) / TU);
    for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) if (i >= 0 && j >= 0 && i < map.w && j < map.h && map.blocked[j * map.w + i]) return true;
    return false;
  };

  const humans = (s: CollectorState) => [...s.keepers.keys()].filter((p) => !s.ctx.isBot(p));
  const sp = (mon: Mon) => g.creatures[mon.species] ?? g.creatures[0]!;
  const maxHp = (s: CollectorState, p: number, mon: Mon, foe = false) => Math.max(1, Math.floor(hpAt(sp(mon).hp, mon.level) * (foe ? 1 : 1 + s.ctx.bonus(p, "maxHealth"))));
  const atk = (s: CollectorState, p: number, mon: Mon, foe = false) => statAt(sp(mon).atk, mon.level) * (foe ? 1 : 1 + s.ctx.bonus(p, "might"));
  const def = (s: CollectorState, p: number, mon: Mon, foe = false) => statAt(sp(mon).def, mon.level) * (foe ? 1 : 1 + s.ctx.bonus(p, "armor"));
  const spd = (mon: Mon) => statAt(sp(mon).spd, mon.level);

  const newMon = (species: number, level: number): Mon => {
    const c = g.creatures[species] ?? g.creatures[0]!;
    return { species, level, hp: hpAt(c.hp, level), xp: 0, guard: false };
  };

  const log = (k: Keeper, line: Omit<LogLine, "n">) => {
    k.logN++;
    k.log.push({ n: k.logN, ...line });
    if (k.log.length > 12) k.log.shift();
  };

  /** One strike. Returns the damage dealt. */
  const strike = (s: CollectorState, p: number, k: Keeper, user: Mon, target: Mon, moveI: number, who: 0 | 1, foeSide: boolean): number => {
    const mv = g.moves[moveI];
    if (!mv) return 0;
    if (mv.effect === "heal") {
      const max = foeSide ? maxHp(s, p, user, true) : maxHp(s, p, user);
      const heal = Math.max(1, Math.floor(max * mv.amount));
      user.hp = Math.min(max, user.hp + heal);
      log(k, { kind: LogKind.Heal, who, move: moveI, value: heal });
      return 0;
    }
    if (mv.effect === "guard") user.guard = true;
    if (mv.power <= 0) {
      log(k, { kind: LogKind.Guard, who, move: moveI });
      return 0;
    }
    if (rand(s.rng) > mv.accuracy) {
      log(k, { kind: LogKind.Miss, who, move: moveI });
      return 0;
    }
    // Wild creatures hit at 80%: a fair fight is one a keeper usually wins (the warden hits at full strength).
    const wild = foeSide && !(k.battle?.warden ?? false);
    const a = (foeSide ? atk(s, p, user, true) : atk(s, p, user)) * (wild ? 0.8 : 1);
    const d = who === 0 ? def(s, p, target, true) : def(s, p, target);
    const eff = effectiveness(mv.el, sp(target).el);
    let dmg = Math.floor((((2 * user.level) / 5 + 2) * mv.power * a) / Math.max(1, d) / 8) + 2;
    dmg = Math.floor(dmg * (eff > 0 ? 1.5 : eff < 0 ? 0.67 : 1) * (0.85 + rand(s.rng) * 0.15));
    if (target.guard) {
      dmg = Math.floor(dmg / 2);
      target.guard = false;
    }
    dmg = Math.max(1, dmg);
    target.hp = Math.max(0, target.hp - dmg);
    if (mv.effect === "drain") {
      const max = foeSide ? maxHp(s, p, user, true) : maxHp(s, p, user);
      user.hp = Math.min(max, user.hp + Math.floor(dmg / 2));
    }
    log(k, { kind: LogKind.Hit, who, move: moveI, dmg, eff });
    s.activity++;
    return dmg;
  };

  /** The foe's move: the strongest it has against your creature, with a little chance. */
  const foePick = (s: CollectorState, foe: Mon, mine: Mon): number => {
    const moves = sp(foe).moveIdx;
    let best = moves[0] ?? 0;
    let score = -1;
    for (const mi of moves) {
      const mv = g.moves[mi];
      if (!mv) continue;
      const eff = effectiveness(mv.el, sp(mine).el);
      const v = (mv.power || 15) * (eff > 0 ? 1.5 : eff < 0 ? 0.67 : 1) * mv.accuracy * (0.7 + rand(s.rng) * 0.6);
      if (v > score) {
        score = v;
        best = mi;
      }
    }
    return best;
  };

  const endBattle = (k: Keeper) => {
    k.battle = null;
    k.cooldown = Math.round(3 * tickRate);
    for (const mon of k.team) mon.guard = false;
  };

  const gainXp = (s: CollectorState, p: number, k: Keeper, foe: Mon, emit: (e: GameEvent) => void) => {
    const xp = foe.level * 10;
    k.team.forEach((mon, i) => {
      if (mon.hp <= 0) return;
      mon.xp += i === k.active ? xp : Math.floor(xp / 2);
      while (mon.xp >= xpNeed(mon.level) && mon.level < 50) {
        mon.xp -= xpNeed(mon.level);
        const before = maxHp(s, p, mon);
        mon.level++;
        mon.hp += maxHp(s, p, mon) - before;
        log(k, { kind: LogKind.Level, who: 0, value: mon.level });
        emit({ name: "creature.levelup", players: [p], own: true });
        if (mon.level === 5) emit({ name: "level.five", players: [p], own: true });
        if (mon.level === 10) emit({ name: "level.ten", players: [p], own: true });
      }
    });
  };

  /** Your creature fainted: the next one steps in, or the whole team is down and goes home. */
  const afterFaint = (s: CollectorState, p: number, k: Keeper, emit: (e: GameEvent) => void): boolean => {
    const mine = k.team[k.active];
    if (!mine || mine.hp > 0) return false;
    log(k, { kind: LogKind.Fainted, who: 0, value: mine.species });
    const next = k.team.findIndex((x) => x.hp > 0);
    if (next >= 0) {
      k.active = next;
      log(k, { kind: LogKind.Swap, who: 0, value: k.team[next]?.species ?? 0 });
      return false;
    }
    k.wipes++;
    s.wipes++;
    log(k, { kind: LogKind.Wiped, who: 0 });
    emit({ name: "team.fainted", players: [p], own: true, unpaid: true });
    for (const x of k.team) x.hp = Math.max(1, Math.floor(maxHp(s, p, x) / 2));
    k.active = 0;
    k.toCamp = true;
    endBattle(k);
    s.activity++;
    return true;
  };

  /** The foe strikes back (it is alive, you are too). */
  const foeTurn = (s: CollectorState, p: number, k: Keeper, emit: (e: GameEvent) => void) => {
    const b = k.battle;
    const mine = k.team[k.active];
    if (!b || !mine) return;
    const foe = b.foe;
    strike(s, p, k, foe, mine, foePick(s, foe, mine), 1, true);
    afterFaint(s, p, k, emit);
  };

  /** The foe is down: XP, the win, and for the warden the whole marsh's win. */
  const foeDown = (s: CollectorState, p: number, k: Keeper, emit: (e: GameEvent) => void) => {
    const b = k.battle;
    if (!b) return;
    if (b.warden) return; // the warden's fall is settled in step for everyone at once
    k.wins++;
    s.battlesWon++;
    log(k, { kind: LogKind.Won, who: 0, value: b.foe.species });
    gainXp(s, p, k, b.foe, emit);
    emit({ name: "creature.defeated", players: [p], own: true });
    endBattle(k);
  };

  const startBattle = (s: CollectorState, k: Keeper, foe: Mon, warden: boolean) => {
    k.battle = { foe, warden, turn: 0 };
    k.log = [];
    log(k, { kind: warden ? LogKind.Warden : LogKind.Met, who: 1, value: foe.species });
    s.activity++;
    if (k.team[k.active]?.hp === 0) k.active = Math.max(0, k.team.findIndex((x) => x.hp > 0));
  };

  /** A wild creature from the grass zone's pool. */
  const roll = (s: CollectorState, zone: number): Mon | null => {
    const z = g.pools[zone];
    if (!z) return null;
    const total = z.pool.reduce((a, x) => a + x.weight, 0);
    let r = rand(s.rng) * total;
    for (const x of z.pool) {
      r -= x.weight;
      if (r <= 0) return newMon(x.species, x.level[0] + randInt(s.rng, x.level[1] - x.level[0] + 1));
    }
    const last = z.pool[z.pool.length - 1];
    return last ? newMon(last.species, last.level[0]) : null;
  };

  const wardenFoe = (s: CollectorState): Mon => ({ species: g.wardenSpecies, level: mm.warden.level, hp: Math.max(0, s.wardenHp), xp: 0, guard: false });
  const campC = marshCenter(map, map.camp[0], map.camp[1]);
  const wardenC = marshCenter(map, map.warden[0], map.warden[1]);

  // Bot memory: the path each playtest player follows (harness only; seat bots are not used here).
  const paths = new Map<number, { goal: number; path: number[]; until: number }>();
  const bfs = (from: number, goal: number): number[] => marshRoute(map, from, goal);

  return {
    template: "collector",
    tickRate,
    endSeconds: 8,
    infoEveryTicks: 3,
    game: g,

    create(seed, ctx) {
      return {
        rng: { s: seed | 0 },
        ctx,
        tick: 0,
        dusk: Math.round(mm.dusk * tickRate),
        wardenHp: mm.warden.hp,
        wardenMax: mm.warden.hp,
        wardenDown: false,
        wardenHurt: new Set(),
        keepers: new Map(),
        activity: 0,
        battlesWon: 0,
        catches: 0,
        wipes: 0,
        peakBattles: 0,
      };
    },

    spawn(_s, player) {
      const k = player % 5;
      return { x: campC.x + (k - 2) * Math.round(0.5 * UNITS), z: campC.z + Math.round(0.6 * UNITS) };
    },

    moveAvatar(a: Avatar, i: RulesInput) {
      let mx = Math.max(-127, Math.min(127, i.mx));
      let mz = Math.max(-127, Math.min(127, i.mz));
      if (mx === 0 && mz === 0) return;
      const len2 = mx * mx + mz * mz;
      if (len2 > 127 * 127) {
        const k = 127 / Math.sqrt(len2);
        mx = Math.round(mx * k);
        mz = Math.round(mz * k);
      }
      const dx = Math.round((mx * step) / 127);
      const dz = Math.round((mz * step) / 127);
      if (dx !== 0 && !solid(a.x + dx, a.z)) a.x += dx;
      if (dz !== 0 && !solid(a.x, a.z + dz)) a.z += dz;
      a.yaw = Math.round((Math.atan2(-mx, -mz) / (Math.PI * 2)) * 65536) & 0xffff;
    },

    join(s, player) {
      s.keepers.set(player, {
        team: [],
        active: 0,
        box: 0,
        snares: mm.snares,
        snaresBought: 0,
        battle: null,
        log: [],
        logN: 0,
        lastTile: -1,
        cooldown: 0,
        toCamp: false,
        catches: 0,
        wins: 0,
        wipes: 0,
        wardenDamage: 0,
        x: campC.x,
        z: campC.z,
        yaw: 0,
        joinedTick: s.tick,
      });
      // The warden grows with the marsh's crowd: +50% health a player past the first.
      if (!s.ctx.isBot(player) && humans(s).length > 1 && !s.wardenDown) {
        const add = Math.floor(mm.warden.hp * 0.5);
        s.wardenMax += add;
        s.wardenHp += add;
      }
      s.activity++;
    },

    leave(s, player) {
      s.keepers.delete(player);
      paths.delete(player);
    },

    act(s, player, i, _a, emit) {
      const k = s.keepers.get(player);
      if (!k) return;
      if (i.act === CollectorAct.Pick) {
        if (k.team.length > 0) return;
        const species = g.starters[i.a];
        if (species === undefined) return;
        k.team.push(newMon(species, mm.starterLevel));
        s.activity++;
        emit({ name: "starter.picked", players: [player], own: true, unpaid: true });
        return;
      }
      if (i.act === CollectorAct.Challenge) {
        if (k.battle || k.team.length === 0 || s.wardenDown || !k.team.some((x) => x.hp > 0)) return;
        const d2 = (k.x - wardenC.x) ** 2 + (k.z - wardenC.z) ** 2;
        if (d2 > (3 * TU) ** 2) return;
        startBattle(s, k, wardenFoe(s), true);
        return;
      }
      const b = k.battle;
      const mine = k.team[k.active];
      if (!b || !mine) return;
      b.turn++;
      if (b.warden) b.foe.hp = Math.max(0, s.wardenHp);
      if (i.act === CollectorAct.Flee) {
        log(k, { kind: LogKind.Fled, who: 0 });
        endBattle(k);
        s.activity++;
        return;
      }
      if (i.act === CollectorAct.Swap) {
        const to = k.team[i.a];
        if (!to || to.hp <= 0 || i.a === k.active) return;
        k.active = i.a;
        log(k, { kind: LogKind.Swap, who: 0, value: to.species });
        foeTurn(s, player, k, emit);
        return;
      }
      if (i.act === CollectorAct.Snare) {
        if (b.warden || k.snares <= 0) return;
        k.snares--;
        const foe = b.foe;
        const max = maxHp(s, player, foe, true);
        const chance = Math.min(0.95, sp(foe).catchRate * (0.25 + 0.75 * (1 - foe.hp / max)));
        s.activity++;
        if (rand(s.rng) < chance) {
          k.catches++;
          s.catches++;
          log(k, { kind: LogKind.Snared, who: 0, value: foe.species });
          if (k.team.length < 3) k.team.push({ ...foe, guard: false });
          else k.box++;
          emit({ name: "creature.caught", players: [player], own: true });
          endBattle(k);
          return;
        }
        log(k, { kind: LogKind.Slipped, who: 0, value: foe.species });
        foeTurn(s, player, k, emit);
        return;
      }
      if (i.act === CollectorAct.Move) {
        const mi = sp(mine).moveIdx[i.a];
        if (mi === undefined) return;
        const foe = b.foe;
        const meFirst = spd(mine) >= spd(foe);
        const mineGo = () => {
          const dmg = strike(s, player, k, mine, foe, mi, 0, false);
          if (b.warden && dmg > 0) {
            s.wardenHp = Math.max(0, s.wardenHp - dmg);
            k.wardenDamage += dmg;
            s.wardenHurt.add(player);
            foe.hp = s.wardenHp;
          }
        };
        if (meFirst) {
          mineGo();
          if (foe.hp <= 0) return foeDown(s, player, k, emit);
          foeTurn(s, player, k, emit);
        } else {
          foeTurn(s, player, k, emit);
          if (!k.battle || mine.hp <= 0) return;
          mineGo();
          if (foe.hp <= 0) foeDown(s, player, k, emit);
        }
      }
    },

    tend(s, player, a, emit) {
      const k = s.keepers.get(player);
      if (!k) return;
      if (k.toCamp) {
        k.toCamp = false;
        a.x = campC.x;
        a.z = campC.z;
      }
      k.x = a.x;
      k.z = a.z;
      k.yaw = a.yaw;
      if (k.cooldown > 0) k.cooldown--;
      // Snares bought in the store (the "amount" upgrade): added once.
      const want = Math.floor(s.ctx.bonus(player, "amount"));
      if (want > k.snaresBought) {
        k.snares += want - k.snaresBought;
        k.snaresBought = want;
      }
      if (k.battle || k.team.length === 0) return;
      const tile = marshTile(map, a.x, a.z);
      // Rest at camp, and the regen upgrade anywhere out of battle: once a second.
      if (s.tick % tickRate === 0) {
        const atCamp = Math.abs(a.x - campC.x) <= TU * 1.5 && Math.abs(a.z - campC.z) <= TU * 1.5;
        const regen = s.ctx.bonus(player, "regen");
        for (const mon of k.team) {
          const max = maxHp(s, player, mon);
          const heal = Math.floor(max * ((atCamp ? 0.2 : 0) + regen));
          if (heal > 0 && mon.hp < max) {
            mon.hp = Math.min(max, mon.hp + heal);
            s.activity++;
          }
        }
      }
      if (tile === k.lastTile) return;
      k.lastTile = tile;
      s.activity++;
      const zone = tile >= 0 ? (map.grass[tile] ?? 0) : 0;
      if (zone === 0 || k.cooldown > 0 || !k.team.some((x) => x.hp > 0)) return;
      const z = g.pools[zone - 1];
      if (!z || rand(s.rng) >= z.rate) return;
      const foe = roll(s, zone - 1);
      if (foe) startBattle(s, k, foe, false);
      void emit;
    },

    step(s, emit) {
      s.tick++;
      if (s.dusk > 0) s.dusk--;
      let battles = 0;
      for (const k of s.keepers.values()) if (k.battle) battles++;
      s.peakBattles = Math.max(s.peakBattles, battles);
      if (!s.wardenDown && s.wardenHp <= 0) {
        s.wardenDown = true;
        s.activity++;
        const hurt = [...s.wardenHurt].filter((p) => s.keepers.has(p));
        for (const p of hurt) {
          const k = s.keepers.get(p);
          if (!k) continue;
          if (k.battle?.warden) {
            k.wins++;
            log(k, { kind: LogKind.Won, who: 0, value: g.wardenSpecies });
            gainXp(s, p, k, wardenFoe(s), emit);
            endBattle(k);
          }
        }
        for (const k of s.keepers.values()) if (k.battle?.warden) endBattle(k);
        // Everyone who hurt the warden shares its fall; the run is won for the whole marsh.
        if (hurt.length > 0) emit({ name: "warden.defeated", players: hurt, own: true });
        emit({ name: "run.won", players: humans(s) });
      }
    },

    outcome(s): RunOutcome | null {
      if (s.wardenDown) return "won";
      return s.dusk <= 0 ? "lost" : null;
    },

    view(s, player) {
      const k = player !== null ? s.keepers.get(player) : undefined;
      const pub = {
        genre: "collector",
        dusk: Math.ceil(s.dusk / tickRate),
        warden: { hp: Math.max(0, s.wardenHp), max: s.wardenMax, down: s.wardenDown, fighting: [...s.keepers.values()].filter((x) => x.battle?.warden).length },
        players: [...s.keepers].map(([id, x]) => ({ id, catches: x.catches, level: x.team.reduce((a, m) => Math.max(a, m.level), 0), battling: x.battle !== null })),
      };
      if (!k || player === null) return pub;
      const mon = (x: Mon, foe = false) => ({ species: x.species, level: x.level, hp: x.hp, max: maxHp(s, player, x, foe), xp: x.xp, next: xpNeed(x.level) });
      return {
        ...pub,
        team: k.team.map((x) => mon(x)),
        active: k.active,
        box: k.box,
        snares: k.snares,
        picked: k.team.length > 0,
        battle: k.battle ? { foe: mon(k.battle.foe, true), warden: k.battle.warden, turn: k.battle.turn } : null,
        log: k.log,
        catches: k.catches,
        wins: k.wins,
      };
    },

    entities(s, out: EntityState[]) {
      let id = 1;
      for (const [p, k] of s.keepers) {
        const mine = k.team[k.active];
        // The active creature walks a step behind its keeper; in battle it faces the foe beside them.
        const yaw = (k.yaw / 65536) * Math.PI * 2;
        const bx = -Math.sin(yaw);
        const bz = -Math.cos(yaw);
        if (mine) {
          const off = k.battle ? 0.9 : -1.1;
          out.push(entity(id, RulesKind.Unit, p, Math.round(k.x + bx * off * UNITS + bz * 0.7 * UNITS), Math.round(k.z + bz * off * UNITS - bx * 0.7 * UNITS), k.yaw, mine.species, mine.hp, mine.hp > 0 ? 0 : 1, mine.level, 0));
        }
        id++;
        if (k.battle && !k.battle.warden) {
          const foe = k.battle.foe;
          out.push(entity(id, RulesKind.Unit, p, Math.round(k.x + bx * 2.6 * UNITS), Math.round(k.z + bz * 2.6 * UNITS), (k.yaw + 32768) & 0xffff, foe.species, foe.hp, 2, foe.level, 0));
        }
        id++;
      }
      // The warden at its lair: hp in the pool, a down flag once it falls.
      out.push(entity(4000, RulesKind.Structure, 0, wardenC.x, wardenC.z, 32768, g.wardenSpecies, Math.max(0, s.wardenHp), s.wardenDown ? 1 : 0, Math.round((Math.max(0, s.wardenHp) / Math.max(1, s.wardenMax)) * 1000), 0));
    },

    bot(s, player, a, tick, skill) {
      const k = s.keepers.get(player);
      const idle: RulesInput = { mx: 0, mz: 0, cx: 0, cz: 0, act: 0, a: 0, b: 0, c: 0 };
      if (!k) return idle;
      if (k.team.length === 0) return { ...idle, act: CollectorAct.Pick, a: player % g.starters.length };
      const b = k.battle;
      const period = Math.max(2, Math.round(tickRate * (skill >= 1 ? 0.4 : 1.1)));
      if (b) {
        if ((tick + player) % period !== 0) return idle;
        const mine = k.team[k.active];
        if (!mine) return idle;
        const max = maxHp(s, player, mine);
        const healthier = k.team.findIndex((x, i) => i !== k.active && x.hp > maxHp(s, player, x) * 0.6);
        if (mine.hp < max * 0.25 && healthier >= 0) return { ...idle, act: CollectorAct.Swap, a: healthier };
        const total = k.team.reduce((x, m) => x + m.hp, 0);
        const totalMax = k.team.reduce((x, m) => x + maxHp(s, player, m), 0);
        // A keeper on their last legs runs from a wild fight (the warden's is worth staying in).
        if (!b.warden && total < totalMax * 0.3 && mine.hp < max * 0.4 && skill >= 0.5) return { ...idle, act: CollectorAct.Flee };
        const foeMax = maxHp(s, player, b.foe, true);
        if (!b.warden && k.snares > 0 && b.foe.hp < foeMax * 0.5) return { ...idle, act: CollectorAct.Snare };
        const moves = sp(mine).moveIdx;
        let best = 0;
        let score = -1;
        moves.forEach((mi, j) => {
          const mv = g.moves[mi];
          if (!mv) return;
          const eff = effectiveness(mv.el, sp(b.foe).el);
          const v = mv.effect === "heal" ? (mine.hp < max * 0.4 ? 999 : 0) : mv.power * (eff > 0 ? 1.5 : eff < 0 ? 0.67 : 1) * mv.accuracy;
          if (v > score) {
            score = v;
            best = j;
          }
        });
        return { ...idle, act: CollectorAct.Move, a: best };
      }
      // Out of battle: the warden once the team is ready or dusk is close, home when hurt, else the grass.
      const here = marshTile(map, a.x, a.z);
      const lvl = k.team.reduce((x, m) => Math.max(x, m.level), 0);
      const hurt = k.team.reduce((x, m) => x + m.hp, 0) < k.team.reduce((x, m) => x + maxHp(s, player, m), 0) * 0.45;
      const late = s.dusk < mm.dusk * tickRate * 0.45;
      let goal: number;
      if (!s.wardenDown && (lvl >= mm.warden.level - 1 || late) && !hurt) {
        goal = map.warden[1] * map.w + map.warden[0];
        const d2 = (a.x - wardenC.x) ** 2 + (a.z - wardenC.z) ** 2;
        if (d2 <= (2.5 * TU) ** 2) return { ...idle, act: CollectorAct.Challenge };
      } else if (hurt) {
        goal = map.camp[1] * map.w + map.camp[0];
      } else {
        // A grass tile, a new one every few seconds so the walk crosses many tiles.
        const tiles: number[] = [];
        for (let t = 0; t < map.grass.length; t++) if (map.grass[t] && !map.blocked[t]) tiles.push(t);
        const pick = ((Math.floor(tick / (tickRate * 4)) * 2654435761) ^ (player * 40503)) >>> 0;
        goal = tiles[pick % Math.max(1, tiles.length)] ?? here;
      }
      let mem = paths.get(player);
      if (!mem || mem.goal !== goal || tick >= mem.until || mem.path.length === 0) {
        mem = { goal, path: here >= 0 ? bfs(here, goal) : [], until: tick + tickRate * 3 };
        paths.set(player, mem);
      }
      while (mem.path.length > 0 && mem.path[0] === here) mem.path.shift();
      const next = mem.path[0] ?? goal;
      const c = marshCenter(map, next % map.w, Math.floor(next / map.w));
      const dx = c.x - a.x;
      const dz = c.z - a.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 4) return idle;
      return { ...idle, mx: Math.round((dx / d) * 127), mz: Math.round((dz / d) * 127) };
    },

    stats(s): RulesStats {
      let top = 0;
      let scorers = 0;
      let level = 0;
      for (const k of s.keepers.values()) {
        top = Math.max(top, k.catches);
        if (k.catches > 0) scorers++;
        for (const mon of k.team) level = Math.max(level, mon.level);
      }
      return { kills: s.battlesWon + s.catches, wave: 1 + s.catches, level, deaths: s.wipes, peakUnits: s.peakBattles, scorers, topScore: top };
    },

    activity(s) {
      return s.activity;
    },

    checks(run: RulesHarnessRun): RulesCheck[] {
      const min = Math.round(run.seconds / 6) / 10;
      return [
        { ok: run.stats.kills > 0, line: `in ${min} minutes of ${run.players}-player play nobody won a battle: check the grass rates, that the starters' moves have power, and that wild levels are near the starters' level` },
        { ok: run.stats.wave > 1 || run.seconds < 150, line: `nobody caught a creature in ${min} minutes: raise the grass rates or catchRate, or start players with more snares` },
        { ok: run.stats.deaths <= run.players * 2, line: `${run.players} playtest players lost their whole team ${run.stats.deaths} times in ${min} minutes: wild creatures are too strong for the starters (lower their levels or stats)` },
      ];
    },

    progress(run) {
      const p = Math.max(1, run.players);
      return Math.min(1, (run.stats.wave - 1) / (p * 2)) * 0.4 + Math.min(1, run.stats.level / 8) * 0.3 + Math.min(1, run.stats.kills / (p * 6)) * 0.3;
    },
  };
}
