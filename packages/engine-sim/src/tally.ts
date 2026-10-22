/**
 * Run tally (authority only, never in snapshots): damage each player dealt
 * with each weapon this run, for end screens. The weapon loop names the
 * weapon about to hit (`tallyWeapon`); every enemy hit adds what it took.
 */
import type { PlayerId } from "./api.js";
import type { InternalWorld } from "./world.js";

interface Tally {
  weapon: number;
  damage: Map<PlayerId, number[]>;
}

const tallies = new WeakMap<InternalWorld, Tally>();

function tallyOf(w: InternalWorld): Tally {
  let t = tallies.get(w);
  if (!t) {
    t = { weapon: -1, damage: new Map() };
    tallies.set(w, t);
  }
  return t;
}

/** The weapon index the next hits come from (-1: not a weapon, e.g. a bomb or a blast). */
export function tallyWeapon(w: InternalWorld, weapon: number): void {
  tallyOf(w).weapon = weapon;
}

export function tallyDamage(w: InternalWorld, by: PlayerId, amount: number): void {
  if (by <= 0 || amount <= 0) return;
  const t = tallyOf(w);
  if (t.weapon < 0) return;
  let row = t.damage.get(by);
  if (!row) {
    row = [];
    t.damage.set(by, row);
  }
  row[t.weapon] = (row[t.weapon] ?? 0) + amount;
}

export function resetTally(w: InternalWorld): void {
  const t = tallyOf(w);
  t.damage.clear();
  t.weapon = -1;
}

/** Damage per weapon index for one player this run (sparse: missing entries are 0). */
export function tallyFor(w: InternalWorld, by: PlayerId): readonly number[] {
  return tallyOf(w).damage.get(by) ?? [];
}
