/**
 * Earn rules from the game module, counted per player from authoritative
 * game events (cabinet-launcher.md §0.2, §8; game-runtime.md §11). The room
 * server turns each award into an EarnEvent for its referee, which signs.
 *
 * A rule `{ when, n, oncePer }` pays once when a player's count of `when`
 * reaches `n` in a run. "day" and "lifetime" rules are also paid at most
 * once per run here; RewardVault's per-wallet caps enforce the longer windows.
 */
import type { EarnRuleDef } from "../api/schemas.js";

/** Something that happened in a run, and the players it credits. */
export interface GameEvent {
  readonly name: string;
  readonly players: readonly number[];
  /**
   * Counts for score, the kill feed, systems, achievements and missions, but
   * never for earn rules: a kill of a seat bot, a "round.top" with no other
   * person in the round, and anything a system emits while handling one.
   */
  readonly unpaid?: true;
  /**
   * The event credits each of its players for something that player did
   * themselves (a kill, a pickup, a revive). Every other event is world or
   * fight progress (a boss down, a wave cleared, a round topped, a run won,
   * anything a system emits): it never pays a player whose earning run
   * started after this world began (GameRunner.startRun), since the
   * progress was made before the run existed (S-2, review 7).
   */
  readonly own?: true;
}

export interface EarnAward {
  readonly player: number;
  /** The earn rule id as declared (`earn.rule(id, ...)`). */
  readonly rule: string;
  readonly units: number;
}

export class EarnTracker {
  private readonly counts = new Map<number, Map<string, number>>();
  private readonly paid = new Map<number, Set<string>>();
  private readonly byEvent = new Map<string, [string, EarnRuleDef][]>();

  constructor(rules: ReadonlyMap<string, EarnRuleDef>) {
    for (const [id, r] of rules) {
      const list = this.byEvent.get(r.when) ?? [];
      list.push([id, r]);
      this.byEvent.set(r.when, list);
    }
  }

  record(e: GameEvent): EarnAward[] {
    const rules = this.byEvent.get(e.name);
    if (!rules) return [];
    const out: EarnAward[] = [];
    for (const p of e.players) {
      let c = this.counts.get(p);
      if (!c) {
        c = new Map();
        this.counts.set(p, c);
      }
      const n = (c.get(e.name) ?? 0) + 1;
      c.set(e.name, n);
      for (const [id, r] of rules) {
        if (n < r.n) continue;
        let paid = this.paid.get(p);
        if (!paid) {
          paid = new Set();
          this.paid.set(p, paid);
        }
        if (paid.has(id)) continue;
        paid.add(id);
        out.push({ player: p, rule: id, units: 1 });
      }
    }
    return out;
  }

  /** A new run: every count and every once-per-run payout starts over. */
  resetRun(): void {
    this.counts.clear();
    this.paid.clear();
  }

  /** A player left, or their referee run started over: forget their counts and payouts. */
  forget(player: number): void {
    this.counts.delete(player);
    this.paid.delete(player);
  }

  /** Count of an event for a player this run (HUD and tests). */
  count(player: number, event: string): number {
    return this.counts.get(player)?.get(event) ?? 0;
  }
}
