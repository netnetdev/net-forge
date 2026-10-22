/**
 * Earn rules as source text: read and rewrite the `earn.rule(...)` lines of a
 * game's src/game.ts (cabinet-launcher.md §0.2, §8).
 *
 * game.ts is the single source of truth for what a game pays. The room
 * server's referee pays the compiled module's `pay`, and the launch
 * registers one RewardVault rule per `earn.rule`, in declaration order
 * (vault rule ids 1, 2, 3...; apps/rooms `earnRulesFromManifest`). So the
 * Launch panel never keeps its own copy of a payout: an edit there is a
 * rewrite of game.ts, which goes through the same gate and build as any
 * other change, and what launches is what the build declares.
 *
 * Pure, no imports: apps/generator (server), apps/launcher (browser, by
 * relative path) and the tests share it.
 */

export type OncePer = "run" | "day" | "lifetime";

/** One `earn.rule(id, { when, n, pay, oncePer })` declaration. */
export interface SourceEarnRule {
  readonly id: string;
  /** The game event it counts, e.g. "wave.cleared". */
  readonly when: string;
  /** Pays when the event's count reaches n in a run. */
  readonly n: number;
  /** Whole coins (1 coin = 1 token), up to 6 decimals. */
  readonly pay: number;
  readonly oncePer: OncePer;
}

/** The engine's id rule (api/schemas.ts idSchema). */
export const EARN_RULE_ID = /^[a-z][a-z0-9_]{0,47}$/;
/** The engine's event-name rule (api/schemas.ts earnRuleSchema.when). */
export const EARN_EVENT = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
/** Most rules one game declares (the Launch panel's limit too). */
export const MAX_EARN_RULES = 8;
/** Highest count a rule may wait for. */
export const MAX_EARN_N = 100_000;
/** Highest payout one rule may make in one run, in coins. */
export const MAX_EARN_PAY = 1_000_000;

/**
 * Events the sim raises by itself that may pay, per template (engine
 * registry `on(...)` docs). A game's own `emit("...")` events are added from
 * its source. Player-state events (downed, died, revived, levelup) are left
 * out on purpose: they are cheap to farm.
 */
export const SIM_EARN_EVENTS: Readonly<Record<string, readonly string[]>> = {
  survivor: ["enemy.killed", "boss.killed"],
  arena: ["opponent.killed", "round.top"],
  // Board genres (rules/): what each genre's rules raise.
  collector: ["creature.caught", "creature.defeated", "creature.levelup", "level.five", "level.ten", "warden.defeated", "run.won"],
  "tower-defense": ["enemy.killed", "boss.killed", "wave.cleared", "run.won", "tower.built", "tower.upgraded"],
  idle: ["salt.packed", "crystal.cut", "crystal.shipped", "contract.filled", "plant.built", "plant.upgraded", "shift.ended"],
  platformer: ["player.finished", "race.won", "race.podium", "coin.collected", "checkpoint.reached"],
  cards: ["duel.won", "ai.beaten", "run.won"],
  racer: ["player.finished", "race.won", "race.podium", "coin.collected", "lap.completed", "drift.boosted", "drift.ultra"],
};

/** The plain trigger a player reads, from the rule's event and count. */
export function earnRuleLabel(when: string, n: number): string {
  switch (when) {
    case "wave.cleared":
      return `Clear wave ${n}`;
    case "boss.killed":
      return n > 1 ? `Beat ${n} bosses` : "Beat the boss";
    case "enemy.killed":
      return `${n.toLocaleString("en-US")} kills in a run`;
    case "opponent.killed":
      return `${n} eliminations in a round`;
    case "streak.five":
      return n > 1 ? `${n} streaks of five` : "Five eliminations in a row";
    case "round.top":
      return n > 1 ? `Top the board ${n} times` : "Top the board in a round";
    case "player.finished":
      return n > 1 ? `Finish ${n} courses` : "Reach the flag";
    case "race.won":
      return n > 1 ? `Win ${n} races` : "First to the flag";
    case "race.podium":
      return n > 1 ? `Top three ${n} times` : "Finish in the top three";
    case "coin.collected":
      return `${n} coins in a round`;
    case "checkpoint.reached":
      return n > 1 ? `Reach ${n} checkpoints` : "Reach a checkpoint";
    case "lap.completed":
      return n > 1 ? `Complete ${n} laps` : "Complete a lap";
    case "drift.boosted":
      return n > 1 ? `${n} drift boosts in a race` : "Land a drift boost";
    case "drift.ultra":
      return "Land a full-charge drift";
    case "race.clean":
      return "Finish without hitting a wall";
    case "climb.clean":
      return "Reach the flag without a fall";
    case "tide.survived":
      return n > 1 ? `Survive ${n} tides` : "Survive a tide";
    case "salt.packed":
      return `Pack ${n.toLocaleString("en-US")} crate${n > 1 ? "s" : ""} in a shift`;
    case "crystal.cut":
      return `Cut ${n} crystal${n > 1 ? "s" : ""} in a shift`;
    case "contract.filled":
      return "Fill the contract";
    case "duel.won":
      return n > 1 ? `Win ${n} duels against people` : "Win a duel against a person";
    case "ai.beaten":
      return n > 1 ? `Beat ${n} gauntlet opponents` : "Beat a gauntlet opponent";
    case "creature.caught":
      return n > 1 ? `Catch ${n} creatures` : "Catch a creature";
    case "creature.defeated":
      return `Win ${n} battle${n > 1 ? "s" : ""}`;
    case "warden.defeated":
      return "Bring down the warden";
    case "level.five":
      return "Raise a creature to level 5";
    case "level.ten":
      return "Raise a creature to level 10";
    case "run.won":
      return n > 1 ? `Win ${n} runs` : "Win the run";
    case "tower.built":
      return `Build ${n} tower${n > 1 ? "s" : ""}`;
    case "tower.upgraded":
      return `${n} tower upgrade${n > 1 ? "s" : ""}`;
    default:
      return `${when.replace(/[._]/g, " ")}${n > 1 ? ` x${n}` : ""}`;
  }
}

/** The source with comments blanked to spaces (same length, so indices line up). Strings are kept. */
function maskComments(src: string): string {
  const out = src.split("");
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") i++;
        else if (c !== "`" && src[i] === "\n") break;
        i++;
      }
      i++;
    } else if (c === "/" && d === "/") {
      while (i < src.length && src[i] !== "\n") out[i++] = " ";
    } else if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      for (; i < stop; i++) if (src[i] !== "\n") out[i] = " ";
    } else i++;
  }
  return out.join("");
}

interface Statement {
  /** Start of the line the statement is on. */
  readonly lineStart: number;
  /** End of the statement's line, including its newline. */
  readonly lineEnd: number;
  readonly rule: SourceEarnRule | null;
  readonly id: string | null;
  /** Why the panel cannot edit this one (null: it can). */
  readonly problem: string | null;
}

const CALL = /earn\s*\.\s*rule\s*\(/g;
const FULL = /^earn\.rule\(\s*"([^"\n]*)"\s*,\s*\{([^{}]*)\}\s*\)\s*;?\s*$/;

function field(body: string, name: string): string | null {
  return new RegExp(`(?:^|[,{\\s])${name}\\s*:\\s*([^,]+?)\\s*(?:,|$)`).exec(body.trim())?.[1] ?? null;
}

function parseBody(id: string, body: string): { rule: SourceEarnRule | null; problem: string | null } {
  const when = /^"([^"]+)"$/.exec(field(body, "when") ?? "")?.[1];
  const nRaw = field(body, "n");
  const payRaw = field(body, "pay");
  const once = /^"(run|day|lifetime)"$/.exec(field(body, "oncePer") ?? "")?.[1] as OncePer | undefined;
  const n = nRaw === null ? 1 : /^\d+$/.test(nRaw) ? Number(nRaw) : NaN;
  const pay = payRaw !== null && /^\d+(\.\d+)?$/.test(payRaw) ? Number(payRaw) : NaN;
  const known = body
    .split(",")
    .map((p) => p.split(":")[0]?.trim() ?? "")
    .filter(Boolean);
  if (known.some((k) => !["when", "n", "pay", "oncePer"].includes(k))) return { rule: null, problem: `earn rule "${id}" has a field the panel does not know` };
  if (!when || !Number.isFinite(n) || !Number.isFinite(pay) || !once) return { rule: null, problem: `earn rule "${id}" is not written with plain values` };
  return { rule: { id, when, n, pay, oncePer: once }, problem: null };
}

function statements(src: string): Statement[] {
  const masked = maskComments(src);
  const out: Statement[] = [];
  CALL.lastIndex = 0;
  for (let m = CALL.exec(masked); m; m = CALL.exec(masked)) {
    const lineStart = masked.lastIndexOf("\n", m.index) + 1;
    const nl = masked.indexOf("\n", m.index);
    const lineEnd = nl < 0 ? src.length : nl + 1;
    const line = src.slice(m.index, nl < 0 ? src.length : nl).replace(/\/\/.*$/, "").trim();
    const indent = src.slice(lineStart, m.index);
    const full = FULL.exec(line);
    if (indent.length > 0) {
      out.push({ lineStart, lineEnd, rule: null, id: full?.[1] ?? null, problem: "an earn rule is declared inside a block; declare every earn.rule at the top level, one per line" });
      continue;
    }
    if (!full) {
      out.push({ lineStart, lineEnd, rule: null, id: null, problem: "an earn rule is not written on one line as earn.rule(\"id\", { when, n, pay, oncePer })" });
      continue;
    }
    const id = full[1] ?? "";
    const { rule, problem } = parseBody(id, full[2] ?? "");
    out.push({ lineStart, lineEnd, rule, id, problem });
  }
  return out;
}

export interface ReadEarnRules {
  /** Every rule the panel can read, in declaration order (the vault's id order). */
  readonly rules: readonly SourceEarnRule[];
  /** Why some declaration cannot be read or rewritten; empty when the panel can edit them all. */
  readonly problems: readonly string[];
}

/** The game's earn rules, in declaration order. */
export function readEarnRules(source: string): ReadEarnRules {
  const st = statements(source);
  return { rules: st.flatMap((s) => (s.rule ? [s.rule] : [])), problems: st.flatMap((s) => (s.problem ? [s.problem] : [])) };
}

/** Events a game may pay on: the template's sim events and every `emit("...")` in its source. */
export function earnEvents(source: string): string[] {
  const masked = maskComments(source);
  const template = /\btemplate\s*:\s*"([a-z-]+)"/.exec(masked)?.[1] ?? "";
  const out = new Set<string>(SIM_EARN_EVENTS[template] ?? []);
  const re = /\bemit\(\s*"([^"]+)"/g;
  for (let m = re.exec(masked); m; m = re.exec(masked)) if (m[1] && EARN_EVENT.test(m[1])) out.add(m[1]);
  return [...out];
}

/** Every problem with a rule set, as one plain line each; empty when it can be written. */
export function checkEarnRules(rules: readonly SourceEarnRule[], events: readonly string[]): string[] {
  const out: string[] = [];
  if (rules.length === 0) out.push("A game needs at least one earn rule.");
  if (rules.length > MAX_EARN_RULES) out.push(`A game has at most ${MAX_EARN_RULES} earn rules.`);
  const seen = new Set<string>();
  rules.forEach((r, i) => {
    const what = `Earn rule ${i + 1}`;
    if (!EARN_RULE_ID.test(r.id)) out.push(`${what} has an id that is not lower_snake_case.`);
    if (seen.has(r.id)) out.push(`${what} repeats the id "${r.id}".`);
    seen.add(r.id);
    if (!events.includes(r.when)) out.push(`${what} counts "${r.when}", which this game never raises.`);
    if (!Number.isInteger(r.n) || r.n < 1 || r.n > MAX_EARN_N) out.push(`${what}: the count is a whole number from 1 to ${MAX_EARN_N.toLocaleString("en-US")}.`);
    if (!(r.pay > 0) || r.pay > MAX_EARN_PAY || Math.round(r.pay * 1e6) / 1e6 !== r.pay) out.push(`${what}: the payout is above 0, at most ${MAX_EARN_PAY.toLocaleString("en-US")}, with up to 6 decimals.`);
  });
  return out;
}

/** A fresh rule id for an event and count, unique among `taken`. */
export function newEarnRuleId(when: string, n: number, taken: readonly string[]): string {
  const base = `${when.replace(/[^a-z0-9]+/g, "_")}_${n}`.replace(/^[^a-z]+/, "r_").slice(0, 40);
  let id = base;
  for (let k = 2; taken.includes(id); k++) id = `${base}_${k}`;
  return id;
}

function payText(p: number): string {
  // Up to 6 decimals, never an exponent.
  return String(Math.round(p * 1e6) / 1e6);
}

/** The one line a rule is written as. */
export function earnRuleLine(r: SourceEarnRule): string {
  return `earn.rule(${JSON.stringify(r.id)}, { when: ${JSON.stringify(r.when)}, n: ${r.n}, pay: ${payText(r.pay)}, oncePer: ${JSON.stringify(r.oncePer)} });`;
}

export class EarnSourceError extends Error {}

/**
 * game.ts with its earn rules replaced by `rules`, in that order. The
 * declarations are written as one block where the first one was, so the
 * order in the file is the order given (the vault's rule ids). Throws
 * EarnSourceError when an existing declaration cannot be read safely
 * (nested, multi-line or computed): those games change their rules in chat.
 */
export function writeEarnRules(source: string, rules: readonly SourceEarnRule[]): string {
  const st = statements(source);
  const problem = st.find((s) => s.problem)?.problem;
  if (problem) throw new EarnSourceError(problem);
  const block = rules.map((r) => `${earnRuleLine(r)}\n`).join("");
  if (st.length === 0) return `${source.replace(/\n*$/, "\n")}${block}`;
  let out = "";
  let at = 0;
  st.forEach((s, i) => {
    out += source.slice(at, s.lineStart);
    if (i === 0) out += block;
    at = s.lineEnd;
  });
  return out + source.slice(at);
}

/** Same rules, same order, same values (labels and launch settings aside). */
export function sameEarnRules(a: readonly SourceEarnRule[], b: readonly SourceEarnRule[]): boolean {
  return a.length === b.length && a.every((r, i) => {
    const o = b[i];
    return !!o && o.id === r.id && o.when === r.when && o.n === r.n && o.pay === r.pay && o.oncePer === r.oncePer;
  });
}

/**
 * The buy-in run, `earn.stake({ min, max, multiple })` (the mandatory sink
 * loop, ruled 2026-10-19), read and rewritten the same way: one top-level
 * line in game.ts, so the Launch panel shows exactly what the build pays.
 */
export interface SourceEarnStake {
  /** Smallest stake a run takes, in coins. */
  readonly min: number;
  /** Largest stake a run takes, in coins. */
  readonly max: number;
  /** The stake's payout ceiling is stake x multiple. */
  readonly multiple: number;
}

/** PLACEHOLDER (Q148 a): the engine's cap on the multiple (api/schemas.ts STAKE_MAX_MULTIPLE). */
export const MAX_STAKE_MULTIPLE = 2;
/** The engine's cap on one stake, in coins (api/schemas.ts STAKE_MAX_COINS). */
export const MAX_STAKE_COINS = 1_000_000;

const STAKE_CALL = /earn\s*\.\s*stake\s*\(/g;
const STAKE_FULL = /^earn\.stake\(\s*\{([^{}]*)\}\s*\)\s*;?\s*$/;

export interface ReadEarnStake {
  /** The declaration, or null when there is none (or it cannot be read). */
  readonly stake: SourceEarnStake | null;
  /** Why the panel cannot read or rewrite it; empty when it can. */
  readonly problems: readonly string[];
}

interface StakeStatement {
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly stake: SourceEarnStake | null;
  readonly problem: string | null;
}

function stakeStatements(src: string): StakeStatement[] {
  const masked = maskComments(src);
  const out: StakeStatement[] = [];
  STAKE_CALL.lastIndex = 0;
  for (let m = STAKE_CALL.exec(masked); m; m = STAKE_CALL.exec(masked)) {
    const lineStart = masked.lastIndexOf("\n", m.index) + 1;
    const nl = masked.indexOf("\n", m.index);
    const lineEnd = nl < 0 ? src.length : nl + 1;
    const line = src.slice(m.index, nl < 0 ? src.length : nl).replace(/\/\/.*$/, "").trim();
    if (src.slice(lineStart, m.index).length > 0) {
      out.push({ lineStart, lineEnd, stake: null, problem: "earn.stake is declared inside a block; declare it at the top level, on one line" });
      continue;
    }
    const body = STAKE_FULL.exec(line)?.[1];
    if (body === undefined) {
      out.push({ lineStart, lineEnd, stake: null, problem: "earn.stake is not written on one line as earn.stake({ min, max, multiple })" });
      continue;
    }
    const num = (k: string) => {
      const v = field(body, k);
      return v !== null && /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
    };
    const keys = body.split(",").map((p) => p.split(":")[0]?.trim() ?? "").filter(Boolean);
    const stake = { min: num("min"), max: num("max"), multiple: num("multiple") };
    if (keys.some((k) => !["min", "max", "multiple"].includes(k))) out.push({ lineStart, lineEnd, stake: null, problem: "earn.stake has a field the panel does not know" });
    else if (![stake.min, stake.max, stake.multiple].every(Number.isFinite)) out.push({ lineStart, lineEnd, stake: null, problem: "earn.stake is not written with plain values" });
    else out.push({ lineStart, lineEnd, stake, problem: null });
  }
  return out;
}

/** The game's buy-in run terms. */
export function readEarnStake(source: string): ReadEarnStake {
  const st = stakeStatements(source);
  const problems = st.flatMap((s) => (s.problem ? [s.problem] : []));
  if (st.length > 1) problems.push("earn.stake is declared more than once");
  if (st.length === 0) problems.push("the game has no buy-in run: add earn.stake({ min, max, multiple })");
  return { stake: st.length === 1 ? (st[0]?.stake ?? null) : null, problems };
}

/** Every problem with stake terms, as one plain line each; empty when they can be written. */
export function checkEarnStake(s: SourceEarnStake): string[] {
  const out: string[] = [];
  const dec = (v: number) => Math.round(v * 1e6) / 1e6 === v;
  if (!(s.min > 0) || s.min > MAX_STAKE_COINS || !dec(s.min)) out.push(`The smallest stake is above 0 and at most ${MAX_STAKE_COINS.toLocaleString("en-US")} coins.`);
  if (!(s.max > 0) || s.max > MAX_STAKE_COINS || !dec(s.max)) out.push(`The largest stake is above 0 and at most ${MAX_STAKE_COINS.toLocaleString("en-US")} coins.`);
  if (s.min > s.max) out.push("The smallest stake is above the largest.");
  if (!(s.multiple >= 1) || s.multiple > MAX_STAKE_MULTIPLE || Math.round(s.multiple * 100) / 100 !== s.multiple) out.push(`The payout ceiling is 1x to ${MAX_STAKE_MULTIPLE}x the stake.`);
  return out;
}

/** The one line the stake is written as. */
export function earnStakeLine(s: SourceEarnStake): string {
  return `earn.stake({ min: ${payText(s.min)}, max: ${payText(s.max)}, multiple: ${payText(s.multiple)} });`;
}

/**
 * game.ts with its buy-in run set to `stake`: the declaration is rewritten
 * in place, or added after the last earn rule when there is none. Throws
 * EarnSourceError when an existing one cannot be read safely.
 */
export function writeEarnStake(source: string, stake: SourceEarnStake): string {
  const st = stakeStatements(source);
  const problem = st.find((s) => s.problem)?.problem;
  if (problem) throw new EarnSourceError(problem);
  if (st.length > 1) throw new EarnSourceError("earn.stake is declared more than once");
  const line = `${earnStakeLine(stake)}\n`;
  const one = st[0];
  if (one) return source.slice(0, one.lineStart) + line + source.slice(one.lineEnd);
  const rules = statements(source);
  const last = rules[rules.length - 1];
  if (last) return source.slice(0, last.lineEnd) + line + source.slice(last.lineEnd);
  return `${source.replace(/\n*$/, "\n")}${line}`;
}

/** Same terms. */
export function sameEarnStake(a: SourceEarnStake | null, b: SourceEarnStake | null): boolean {
  return a === b || (!!a && !!b && a.min === b.min && a.max === b.max && a.multiple === b.multiple);
}

/** A PvP pot, `earn.pot({ entry, recycle })` (optional; the arena template). */
export interface SourceEarnPot {
  /** Coins each entrant pays in. */
  readonly entry: number;
  /** Share of every pot that stays in the reward pool. */
  readonly recycle: number;
  /** Pots are off by default until the R-16 legal review: true only when the line says `enabled: true`. */
  readonly enabled?: boolean;
}

/** The game's PvP pot, read only (null when it has none or it is not written with plain values on one line). */
export function readEarnPot(source: string): SourceEarnPot | null {
  const masked = maskComments(source);
  const m = /^earn\.pot\(\s*\{([^{}\n]*)\}\s*\)\s*;?\s*$/m.exec(masked);
  if (!m?.[1]) return null;
  const num = (k: string) => {
    const v = field(m[1] ?? "", k);
    return v !== null && /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
  };
  const pot = { entry: num("entry"), recycle: num("recycle"), enabled: field(m[1] ?? "", "enabled") === "true" };
  return Number.isFinite(pot.entry) && Number.isFinite(pot.recycle) ? pot : null;
}
