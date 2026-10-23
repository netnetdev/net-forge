/**
 * A playtest bot that plays a survivor-style game reasonably: circles the
 * arena, steers away from nearby enemies, dashes out of crowds and takes an
 * upgrade whenever one is offered. Used by the headless harness and by the
 * networked load bots (which see only their area of interest).
 */
import { Button } from "@netforge/engine-sim";
import type { InputCommand } from "@netforge/engine-sim";

export interface BotView {
  readonly x: number;
  readonly z: number;
  /** The player's packed `choices` field (offers pending when non-zero). */
  readonly choices: number;
  /** Arena half extent, m. */
  readonly half: number;
}

/** One tick of input. `enemies` are nearby enemy positions [x, z]; `id` varies the bot's path. */
export function botInput(me: BotView, enemies: Iterable<readonly [number, number]>, tick: number, id: number): InputCommand {
  const ring = Math.min(me.half * 0.5, 22) + (id % 4) * 3;
  const r = Math.hypot(me.x, me.z) || 1;
  const dir = id % 2 === 0 ? 1 : -1;
  // Tangent around the centre plus a pull back onto the ring.
  let dx = (-me.z / r) * dir + (me.x / r) * ((ring - r) / ring) * 2;
  let dz = (me.x / r) * dir + (me.z / r) * ((ring - r) / ring) * 2;
  let crowd = 0;
  for (const [ex, ez] of enemies) {
    const ox = me.x - ex;
    const oz = me.z - ez;
    const d2 = ox * ox + oz * oz;
    if (d2 > 36 || d2 < 1e-6) continue;
    const w = 3 / d2;
    dx += ox * w;
    dz += oz * w;
    if (d2 < 4) crowd++;
  }
  const len = Math.hypot(dx, dz) || 1;
  let buttons = 0;
  if ((me.choices & 0xff) !== 0 && tick % 2 === 0) buttons |= Button.Choice1 << ((id + (tick >> 1)) % 3);
  if (crowd >= 6 && tick % 8 === 0) buttons |= Button.Sprint;
  // yaw 0: moveX is +x, moveZ is -z.
  return { seq: 0, tick, moveX: dx / len, moveZ: -dz / len, yaw: 0, buttons };
}

// ------------------------------------------------------------------ human-like bot

/** A danger the bot can see coming: a telegraphed area that lands soon (circle, or a lane from (x, z) along (dx, dz)). */
export interface BotDanger {
  readonly x: number;
  readonly z: number;
  /** Circle radius, or lane half width, m. */
  readonly r: number;
  /** Lane: unit direction and length; omit for a circle. */
  readonly dx?: number;
  readonly dz?: number;
  readonly len?: number;
}

/** What a human-like bot sees this tick (the caller passes the present; the bot reacts to it late). */
export interface HumanBotView {
  readonly x: number;
  readonly z: number;
  readonly up: boolean;
  /** The player's packed `choices` field. */
  readonly choices: number;
  /** The player's packed weapon slots (to pick upgrades greedily). */
  readonly weapons: number;
  /** Arena half extent, m. */
  readonly half: number;
  /** Living enemies on (or just off) screen. */
  readonly enemies: readonly (readonly [number, number])[];
  /** Gems and pickups on screen. */
  readonly gems: readonly (readonly [number, number])[];
  readonly pillars: readonly { readonly x: number; readonly z: number; readonly radius: number }[];
  /** Telegraphed attacks about to land. */
  readonly dangers?: readonly BotDanger[];
  /** How far the player's weapons reach, m (the bot orbits about there; default 5). */
  readonly reach?: number;
  /** Bosses on screen: players focus them, circling at their weapons' reach. */
  readonly bosses?: readonly (readonly [number, number])[];
  /** Teammates who are down: players go and stand next to them to revive. */
  readonly downed?: readonly (readonly [number, number])[];
}

export interface HumanBotOptions {
  /** Ticks between seeing something and acting on it (6 ticks = 200 ms at 30 Hz). */
  readonly reactionTicks?: number;
  /** "random": any offer; "greedy": level owned weapons, then new weapons, then passives. */
  readonly picks?: "random" | "greedy";
  /** Number of weapons the game declares (offer indices below it are weapons). */
  readonly weaponCount?: number;
  /** Weapon indices that are evolutions (greedy picks always take them). */
  readonly evolved?: readonly number[];
  /** Evolution pairings: [weapon index, offer index of the passive it needs]. Greedy picks value a passive an owned weapon needs. */
  readonly pairs?: readonly (readonly [number, number])[];
  /** Varies the bot's path and picks. */
  readonly seed?: number;
}

/**
 * A playtest bot that plays like a person, for fun metrics
 * (GAME-DESIGN.md "measure fun with bots"): it reacts about 200 ms late,
 * kites in wide arcs instead of circling the centre, walks over gems when
 * it is safe, dashes when something is about to touch it or a telegraph is
 * about to land under it, and takes a second or so to read each card.
 * Template-agnostic: it needs positions only. Deterministic for a given
 * input sequence (its own xorshift, never the sim's PRNG).
 */
export class HumanBot {
  private readonly delay: number;
  private readonly picks: "random" | "greedy";
  private readonly nWeapons: number;
  private readonly evolved: ReadonlySet<number>;
  private readonly pairs: readonly (readonly [number, number])[];
  private s: number;
  private readonly seen: HumanBotView[] = [];
  private arc: number;
  private heading = 0;
  private downSince = -1;
  private cardSince = -1;
  private cardWait = 30;
  private lastDash = -999;
  private lastTurn = 0;

  constructor(opts: HumanBotOptions = {}) {
    this.delay = Math.max(0, Math.floor(opts.reactionTicks ?? 6));
    this.picks = opts.picks ?? "random";
    this.nWeapons = opts.weaponCount ?? 0;
    this.evolved = new Set(opts.evolved ?? []);
    this.pairs = opts.pairs ?? [];
    this.s = ((opts.seed ?? 1) * 2654435761) >>> 0 || 1;
    this.arc = this.rnd() < 0.5 ? 1 : -1;
    this.heading = this.rnd() * Math.PI * 2;
  }

  private rnd(): number {
    let s = this.s;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.s = s >>> 0;
    return this.s / 4294967296;
  }

  /** One tick of input from what the player sees now. */
  input(now: HumanBotView, tick: number): InputCommand {
    this.seen.push(now);
    if (this.seen.length > this.delay + 1) this.seen.shift();
    // Perception is late; the bot's own position is not (you know where you are).
    const late = this.seen[0] ?? now;
    let buttons = 0;
    const pending = now.choices >>> 24;
    if (pending > 0 && now.up) {
      if (this.cardSince < 0) {
        this.cardSince = tick;
        this.cardWait = 24 + Math.floor(this.rnd() * 12);
      }
      if (tick - this.cardSince >= this.cardWait) {
        const k = this.choose(now.choices, now.weapons);
        if (k >= 0) buttons |= Button.Choice1 << k;
        this.cardSince = -1;
      }
    } else this.cardSince = -1;
    if (!now.up) {
      // Down: read the prompt for a beat, then press dash once (a free self-revive, if one is left).
      if (this.downSince < 0) this.downSince = tick;
      const press = tick - this.downSince === 45 ? Button.Sprint : 0;
      return { seq: 0, tick, moveX: 0, moveZ: 0, yaw: 0, buttons: press };
    }
    this.downSince = -1;

    // Threat: nearby enemies push, nearer ones much harder.
    let tx = 0;
    let tz = 0;
    let nearest = Infinity;
    let close = 0;
    for (const e of late.enemies) {
      const ox = now.x - e[0];
      const oz = now.z - e[1];
      const d2 = ox * ox + oz * oz;
      if (d2 > 100 || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      nearest = Math.min(nearest, d);
      if (d < 4) close++;
      const w = 1 / (d2 * d);
      tx += ox * w;
      tz += oz * w;
    }
    const threat = Math.hypot(tx, tz);
    let dx = Math.cos(this.heading);
    let dz = Math.sin(this.heading);
    let drift = false;
    const boss = late.bosses?.[0];
    let downedMate: readonly [number, number] | undefined;
    let dd = 25 * 25;
    for (const d of now.downed ?? []) {
      const d2 = (d[0] - now.x) ** 2 + (d[1] - now.z) ** 2;
      if (d2 < dd) {
        dd = d2;
        downedMate = d;
      }
    }
    if (downedMate && close < 6) {
      // A teammate is down nearby: go and stand by them (the revive needs 3 s within 2.5 m).
      dx = downedMate[0] - now.x;
      dz = downedMate[1] - now.z;
      if (dx * dx + dz * dz < 1.5) {
        dx = -dz * 0.2;
        dz = dx * 0.2;
      }
    } else if (boss && close < 5) {
      // A boss on screen: circle it at reach, so the weapons keep landing.
      const bx = now.x - boss[0];
      const bz = now.z - boss[1];
      const bd = Math.hypot(bx, bz) || 1;
      const reach = (now.reach ?? 5) * 0.85 + 1.5;
      const radial = bd < reach * 0.8 ? 1 : bd > reach * 1.1 ? -1 : 0;
      dx = (-bz / bd) * this.arc + (bx / bd) * radial;
      dz = (bx / bd) * this.arc + (bz / bd) * radial;
    } else if (threat > 0.004) {
      // Kite: circle the threat at about the weapons' reach. Too close: step out; too far: lean in.
      const ax = tx / threat;
      const az = tz / threat;
      const reach = now.reach ?? 5;
      const radial = close >= 5 ? 1.6 : nearest < reach * 0.55 ? 1 : nearest > reach * 0.95 ? -0.5 : 0.25;
      dx = -az * this.arc + ax * radial;
      dz = ax * this.arc + az * radial;
    } else {
      // Calm: go for the nearest gem, else wander on a slowly turning heading.
      let best = 81;
      for (const g of late.gems) {
        const gx = g[0] - now.x;
        const gz = g[1] - now.z;
        const d2 = gx * gx + gz * gz;
        if (d2 < best) {
          best = d2;
          dx = gx;
          dz = gz;
        }
      }
      if (best === 81) {
        // No gem near: close in on the nearest enemy on screen to about 6 m (players farm XP).
        let near = Infinity;
        for (const e of late.enemies) {
          const ex = e[0] - now.x;
          const ez = e[1] - now.z;
          const d2 = ex * ex + ez * ez;
          if (d2 < near) {
            near = d2;
            dx = ex;
            dz = ez;
          }
        }
        if (near !== Infinity && near > 36) best = 0;
      }
      if (best === 81) {
        // Nothing on screen: drift at half speed (players wait for the action, they do not sprint away from it).
        if (tick - this.lastTurn > 60) {
          this.lastTurn = tick;
          this.heading += (this.rnd() - 0.5) * 1.2;
        }
        dx = Math.cos(this.heading) * 0.5;
        dz = Math.sin(this.heading) * 0.5;
        drift = true;
      }
    }
    // Walls: turn back toward the middle before running into one.
    const lim = now.half - 10;
    if (Math.abs(now.x) > lim) dx += (-Math.sign(now.x) * (Math.abs(now.x) - lim)) / 3;
    if (Math.abs(now.z) > lim) dz += (-Math.sign(now.z) * (Math.abs(now.z) - lim)) / 3;
    // Pillars: slide around them.
    for (const p of now.pillars) {
      const ox = now.x - p.x;
      const oz = now.z - p.z;
      const d = Math.hypot(ox, oz);
      if (d < p.radius + 2 && d > 1e-6) {
        dx += (ox / d) * 1.5;
        dz += (oz / d) * 1.5;
      }
    }
    // Telegraphs: step out of anything about to land under you, and dash if it is close.
    let inDanger = false;
    for (const g of late.dangers ?? []) {
      const ox = now.x - g.x;
      const oz = now.z - g.z;
      if (g.dx !== undefined && g.dz !== undefined) {
        const along = ox * g.dx + oz * g.dz;
        const side = ox * -g.dz + oz * g.dx;
        if (along > -1 && along < (g.len ?? 0) + 1 && Math.abs(side) < g.r + 0.8) {
          inDanger = true;
          const s = side >= 0 ? 1 : -1;
          dx += -g.dz * s * 4;
          dz += g.dx * s * 4;
        }
      } else if (ox * ox + oz * oz < (g.r + 0.8) * (g.r + 0.8)) {
        inDanger = true;
        const d = Math.hypot(ox, oz) || 1;
        dx += (ox / d) * 4;
        dz += (oz / d) * 4;
      }
    }
    if ((inDanger || nearest < 1.1 || close >= 5) && tick - this.lastDash > 40) {
      buttons |= Button.Sprint;
      this.lastDash = tick;
    }
    const len = Math.hypot(dx, dz) || 1;
    this.heading = Math.atan2(dz, dx);
    const speed = drift ? 0.5 : 1;
    return { seq: 0, tick, moveX: (dx / len) * speed, moveZ: (-dz / len) * speed, yaw: 0, buttons };
  }

  private choose(choices: number, weapons: number): number {
    const offers = [(choices & 0xff) - 1, ((choices >>> 8) & 0xff) - 1, ((choices >>> 16) & 0xff) - 1];
    const valid: [number, number][] = [];
    offers.forEach((u, k) => {
      if (u >= 0) valid.push([u, k]);
    });
    if (valid.length === 0) return -1;
    if (this.picks === "random") return (valid[Math.floor(this.rnd() * valid.length)] as [number, number])[1];
    const owned = new Set<number>();
    for (let s = 0; s < 4; s++) {
      const wi = ((weapons >>> (s * 8)) & 0x0f) - 1;
      if (wi >= 0) owned.add(wi);
    }
    // A build with a goal: evolutions first, then the passive an owned weapon needs, then owned weapons, new weapons, other passives.
    const needed = new Set(this.pairs.filter(([wi]) => owned.has(wi)).map(([, u]) => u));
    const score = (u: number) => (this.evolved.has(u) ? 5 : needed.has(u) ? 3.5 : u < this.nWeapons ? (owned.has(u) ? 3 : 2) : 1);
    let best = valid[0] as [number, number];
    for (const v of valid) if (score(v[0]) > score(best[0])) best = v;
    return best[1];
  }
}
