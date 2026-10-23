/**
 * Arena bots: they fill empty seats in arena rooms (server side, through
 * the GameRunner) and play the headless playtests. A bot is a pure function
 * of what it sees, its small memory and the tick, so a room's run replays
 * exactly (run verification) and bots never draw from the sim's PRNG.
 */
import { Button } from "@netforge/engine-sim";
import type { InputCommand } from "@netforge/engine-sim";

/** One opponent as an arena bot sees it. */
export interface ArenaBotOpponent {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  /** How sharply the bot plays against this opponent (overrides the view's skill): seat bots go easy on a newcomer. */
  readonly skill?: number;
  /** Other bots are already on this one: pick it only when nobody else is around. */
  readonly crowded?: boolean;
}

export interface ArenaBotWeapon {
  readonly kind: string;
  readonly range: number;
  readonly count: number;
}

/** What an arena bot knows this tick (server side: the present). */
export interface ArenaBotView {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly up: boolean;
  /** The selected loadout slot (0..3). */
  readonly slot: number;
  /** The loadout by slot. */
  readonly loadout: readonly ArenaBotWeapon[];
  /** Living opponents. */
  readonly opponents: readonly ArenaBotOpponent[];
  readonly pickups: readonly { readonly x: number; readonly z: number }[];
  readonly pillars: readonly { readonly x: number; readonly z: number; readonly radius: number }[];
  /** Arena half extent, m. */
  readonly half: number;
  /** Varies how bots strafe and miss between worlds (the world seed); default 0. */
  readonly seed?: number;
  /** 1 plays sharp; lower misses more, reacts later and fires in shorter bursts. Default 1. */
  readonly skill?: number;
}

/** A bot's memory between ticks (the caller keeps one per bot). */
export interface ArenaBotMemory {
  target: number;
  since: number;
  aimError: number;
  lastHealth: number;
  /** Tick the current target came into clear sight (-1: not in sight). The bot reacts after a delay. */
  sightSince?: number;
}

export function arenaBotMemory(): ArenaBotMemory {
  return { target: 0, since: 0, aimError: 0, lastHealth: 0, sightSince: -1 };
}

/** A fixed integer hash to 0..1. */
function h01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x6d2b79f5, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Does the segment from (x0, z0) to (x1, z1) pass through a pillar? */
export function sightBlocked(x0: number, z0: number, x1: number, z1: number, pillars: ArenaBotView["pillars"]): boolean {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-9) return false;
  for (const p of pillars) {
    const t = Math.max(0, Math.min(1, ((p.x - x0) * dx + (p.z - z0) * dz) / len2));
    const cx = x0 + dx * t - p.x;
    const cz = z0 + dz * t - p.z;
    if (cx * cx + cz * cz < (p.radius + 0.15) ** 2) return true;
  }
  return false;
}

/**
 * One tick of an arena bot: pick the nearest opponent it can see (sticky
 * for a while), keep a weapon-appropriate distance while strafing, go for a
 * heal cell when hurt, switch to the right weapon for the range, and fire
 * when the shot is clear. Aim carries a per-bot error, so bots are beatable.
 * `tickRate` scales its timers.
 */
export function arenaBotInput(v: ArenaBotView, mem: ArenaBotMemory, tick: number, tickRate = 30): InputCommand {
  const sec = (s: number) => Math.max(1, Math.round(s * tickRate));
  const salt = Math.imul((v.seed ?? 0) >>> 0, 0x9e3779b1) >>> 16;
  const idle: InputCommand = { seq: 0, tick, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 };
  if (!v.up) {
    mem.target = 0;
    mem.lastHealth = v.maxHealth;
    return idle;
  }
  const seen = (o: ArenaBotOpponent) => !sightBlocked(v.x, v.z, o.x, o.z, v.pillars);
  // Target: keep the current one for up to 6 s while it lives and stays in sight, else the nearest visible (or nearest).
  let target = v.opponents.find((o) => o.id === mem.target);
  if (!target || tick - mem.since > sec(6) || (!seen(target) && tick - mem.since > sec(1.5))) {
    let best: ArenaBotOpponent | undefined;
    let bestScore = Infinity;
    for (const o of v.opponents) {
      const score = Math.hypot(o.x - v.x, o.z - v.z) + (seen(o) ? 0 : 25) + (o.crowded ? 18 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    if (best && best.id !== mem.target) {
      mem.target = best.id;
      mem.since = tick;
      mem.sightSince = -1;
    } else if (best) mem.since = tick;
    target = best;
  }

  let mx = 0;
  let mz = 0;
  let yaw = 0;
  let buttons = 0;
  let skill = Math.max(0.05, Math.min(1, v.skill ?? 1));
  /** Fraction of full speed: a loose bot strafes slowly in a fight, so it can be hit. */
  let pace = 1;
  if (target) {
    const dx = target.x - v.x;
    const dz = target.z - v.z;
    const dist = Math.hypot(dx, dz) || 1e-6;
    const clear = seen(target);
    // Skill against this target: aim, reaction and bursts all scale with it.
    skill = Math.max(0.05, Math.min(1, target.skill ?? skill));
    if (!clear) mem.sightSince = -1;
    else if ((mem.sightSince ?? -1) < 0) mem.sightSince = tick;
    // The weapon for the range: the spread gun up close, the beam far away, the rifle between.
    let want = v.slot;
    let wantScore = -Infinity;
    v.loadout.forEach((w, s) => {
      let score: number;
      if (w.kind === "beam") score = dist > 12 ? 3 : 0;
      else if (w.kind === "nova") score = dist < w.range * 0.9 ? 4 : -2;
      else if (w.count > 1) score = dist < 7 ? 3 : -1;
      else score = 2;
      if (dist > w.range) score -= 5;
      if (score > wantScore) {
        wantScore = score;
        want = s;
      }
    });
    if (want !== v.slot && want <= 2 && tick % 4 === 0) buttons |= Button.Choice1 << want;
    const weapon = v.loadout[v.slot];
    const range = weapon?.range ?? 12;
    // Keep distance (60% of the weapon's reach, 4 to 14 m) and strafe; flip direction every few seconds.
    // A loose bot fights closer, where it is easier to hit.
    const keep = Math.max(4, Math.min(14, range * 0.6)) * (0.55 + 0.45 * skill);
    const radial = Math.max(-1, Math.min(1, (dist - keep) / 4));
    const flip = h01(v.id ^ salt, Math.floor((tick + v.id * 37) / sec(3.5))) < 0.5 ? 1 : -1;
    const ux = dx / dist;
    const uz = dz / dist;
    mx += ux * radial - uz * flip * 0.85;
    mz += uz * radial + ux * flip * 0.85;
    if (!clear) {
      mx -= uz * flip;
      mz += ux * flip;
    } else pace = 0.4 + 0.6 * skill;
    // Aim with a per-bot error that drifts every third of a second; a loose bot misses by a lot more.
    const sloppy = 1 + (1 - skill) * (1 + 2.4 * (1 - skill));
    if (tick % sec(0.33) === 0) mem.aimError = (h01((v.id * 3 + 1) ^ salt, tick) - 0.5) * (0.06 + 0.16 * h01(v.id ^ salt, 7)) * sloppy;
    yaw = Math.atan2(-dx, -dz) + mem.aimError;
    // React: hold fire for a moment after the target comes into sight (0.2 s sharp, 0.8 s loose).
    const reacted = tick - (mem.sightSince ?? tick) >= sec(0.2 + 0.6 * (1 - skill));
    // Bursts: a loose bot pauses between them (sharp bots fire without a break).
    const cycle = sec(0.9 + 1.4 * (1 - skill));
    const burst = (tick + v.id * 29) % cycle < sec(0.9);
    if (clear && reacted && burst && dist <= range * 0.95) buttons |= Button.Fire;
  } else {
    // Nobody to fight: drift around the middle.
    const a = (tick / sec(8) + v.id) % (Math.PI * 2);
    mx = Math.cos(a) * 6 - v.x;
    mz = Math.sin(a) * 6 - v.z;
  }
  // Hurt: go for the nearest heal cell within 20 m.
  if (v.health < v.maxHealth * 0.45) {
    let cell: { x: number; z: number; d: number } | null = null;
    for (const p of v.pickups) {
      const d = Math.hypot(p.x - v.x, p.z - v.z);
      if (d < 20 && (!cell || d < cell.d)) cell = { x: p.x, z: p.z, d };
    }
    if (cell) {
      mx = ((cell.x - v.x) / Math.max(0.5, cell.d)) * 2 + mx * 0.2;
      mz = ((cell.z - v.z) / Math.max(0.5, cell.d)) * 2 + mz * 0.2;
    }
  }
  // Keep off pillars and walls.
  for (const p of v.pillars) {
    const ox = v.x - p.x;
    const oz = v.z - p.z;
    const d = Math.hypot(ox, oz);
    const reach = p.radius + 2;
    if (d < reach && d > 1e-6) {
      mx += (ox / d) * (reach - d);
      mz += (oz / d) * (reach - d);
    }
  }
  const edge = v.half - 3;
  if (v.x > edge) mx -= (v.x - edge) * 0.8;
  if (v.x < -edge) mx -= (v.x + edge) * 0.8;
  if (v.z > edge) mz -= (v.z - edge) * 0.8;
  if (v.z < -edge) mz -= (v.z + edge) * 0.8;
  // Dodge: dash when hit hard, and now and then (a loose bot rarely thinks to).
  if ((skill >= 0.4 && mem.lastHealth - v.health >= 25) || (skill >= 0.5 && (tick + v.id * 13) % sec(5.8) === 0)) buttons |= Button.Sprint;
  mem.lastHealth = v.health;
  const len = Math.hypot(mx, mz) || 1;
  // Input frame (yaw 0): moveX is +x, moveZ is -z.
  return { seq: 0, tick, moveX: (mx / len) * pace, moveZ: (-mz / len) * pace, yaw, buttons };
}
