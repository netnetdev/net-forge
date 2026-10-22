import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkEarnRules, earnEvents, EarnSourceError, newEarnRuleId, readEarnRules, sameEarnRules, writeEarnRules, type SourceEarnRule } from "../src/game/earn-source.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const survivor = readFileSync(join(root, "packages/template-survivor/src/game.ts"), "utf8");
const arena = readFileSync(join(root, "packages/template-arena/src/game.ts"), "utf8");
const platformer = readFileSync(join(root, "packages/template-platformer/src/game.ts"), "utf8");
const racer = readFileSync(join(root, "packages/template-racer/src/game.ts"), "utf8");

describe("earn rules in game.ts", () => {
  it("reads both templates' rules in declaration order, with nothing it cannot edit", () => {
    const s = readEarnRules(survivor);
    expect(s.problems).toEqual([]);
    expect(s.rules.map((r) => [r.id, r.when, r.n, r.pay])).toEqual([
      ["first_light", "wave.cleared", 2, 5],
      ["night_watch", "wave.cleared", 7, 20],
      ["bell_breaker", "boss.killed", 1, 50],
      ["swarm_breaker", "enemy.killed", 500, 5],
    ]);
    const a = readEarnRules(arena);
    expect(a.problems).toEqual([]);
    expect(a.rules.map((r) => r.id)).toEqual(["live_wire", "long_shift", "overload", "top_of_the_yard"]);
  });

  it("lists the events each template can pay on", () => {
    expect(earnEvents(survivor).sort()).toEqual(["boss.killed", "enemy.killed", "tide.survived", "wave.cleared"]);
    expect(earnEvents(arena).sort()).toEqual(["opponent.killed", "round.top", "streak.five"]);
    expect(earnEvents(platformer).sort()).toEqual(["checkpoint.reached", "climb.clean", "coin.collected", "player.finished", "race.podium", "race.won"]);
    expect(readEarnRules(platformer).problems).toEqual([]);
    expect(checkEarnRules(readEarnRules(platformer).rules, earnEvents(platformer))).toEqual([]);
    expect(earnEvents(racer)).toEqual(expect.arrayContaining(["player.finished", "race.won", "lap.completed", "drift.boosted", "race.clean"]));
    expect(checkEarnRules(readEarnRules(racer).rules, earnEvents(racer))).toEqual([]);
  });

  it("rewrites a payout in place and leaves the rest of the file alone", () => {
    const rules = readEarnRules(survivor).rules.map((r) => (r.id === "bell_breaker" ? { ...r, pay: 75 } : r));
    const out = writeEarnRules(survivor, rules);
    expect(readEarnRules(out).rules).toEqual(rules);
    const strip = (s: string) => s.split("\n").filter((l) => !l.startsWith("earn.rule("));
    expect(strip(out)).toEqual(strip(survivor));
    expect(out).toContain('earn.rule("bell_breaker", { when: "boss.killed", n: 1, pay: 75, oncePer: "run" });');
  });

  it("adds, removes and reorders: the file's order is the order given", () => {
    const [a, b, c, d] = readEarnRules(survivor).rules as [SourceEarnRule, SourceEarnRule, SourceEarnRule, SourceEarnRule];
    const added: SourceEarnRule = { id: newEarnRuleId("tide.survived", 1, [a.id, b.id, c.id, d.id]), when: "tide.survived", n: 1, pay: 2.5, oncePer: "run" };
    const next = [c, a, added];
    const out = writeEarnRules(survivor, next);
    expect(readEarnRules(out).rules).toEqual(next);
    expect(sameEarnRules(readEarnRules(out).rules, next)).toBe(true);
    expect(added.id).toBe("tide_survived_1");
  });

  it("ignores commented-out rules and refuses rules it cannot rewrite safely", () => {
    const commented = `${survivor}\n// earn.rule("ghost", { when: "wave.cleared", n: 1, pay: 999, oncePer: "run" });\n/* earn.rule("ghost2", { when: "wave.cleared", n: 1, pay: 999, oncePer: "run" }); */\n`;
    expect(readEarnRules(commented).rules.map((r) => r.id)).not.toContain("ghost");
    expect(readEarnRules(commented).rules.map((r) => r.id)).not.toContain("ghost2");
    const nested = `${survivor}\nif (true) {\n  earn.rule("inner", { when: "wave.cleared", n: 1, pay: 1, oncePer: "run" });\n}\n`;
    expect(readEarnRules(nested).problems.length).toBe(1);
    expect(() => writeEarnRules(nested, [])).toThrow(EarnSourceError);
    const computed = `const P = 5;\nearn.rule("x", { when: "wave.cleared", n: 1, pay: P, oncePer: "run" });\n`;
    expect(readEarnRules(computed).problems.length).toBe(1);
  });

  it("checks a rule set against the game's events and the limits", () => {
    const events = earnEvents(survivor);
    const ok = readEarnRules(survivor).rules;
    expect(checkEarnRules(ok, events)).toEqual([]);
    expect(checkEarnRules([], events)).toEqual(["A game needs at least one earn rule."]);
    const bad = [{ ...ok[0]!, when: "player.downed" }, { ...ok[1]!, pay: 0 }, { ...ok[2]!, n: 0 }, { ...ok[3]!, id: ok[0]!.id }];
    expect(checkEarnRules(bad, events)).toHaveLength(4);
  });
});

describe("the buy-in run (earn.stake) in game.ts", () => {
  it("reads both templates' stake terms", async () => {
    const { readEarnStake } = await import("../src/game/earn-source.js");
    expect(readEarnStake(survivor)).toEqual({ stake: { min: 20, max: 200, multiple: 2 }, problems: [] });
    expect(readEarnStake(arena)).toEqual({ stake: { min: 10, max: 100, multiple: 2 }, problems: [] });
  });

  it("rewrites the line in place, adds one after the rules when missing, and refuses what it cannot read", async () => {
    const { readEarnStake, writeEarnStake, checkEarnStake, earnStakeLine } = await import("../src/game/earn-source.js");
    const next = writeEarnStake(survivor, { min: 5, max: 50, multiple: 1.5 });
    expect(readEarnStake(next).stake).toEqual({ min: 5, max: 50, multiple: 1.5 });
    expect(next.split("\n").length).toBe(survivor.split("\n").length);
    expect(readEarnRules(next).rules).toEqual(readEarnRules(survivor).rules);
    const bare = 'game({ template: "survivor" });\nearn.rule("a", { when: "wave.cleared", n: 1, pay: 1, oncePer: "run" });\nstore.sku("x", { coins: 1 });\n';
    expect(readEarnStake(bare).problems[0]).toMatch(/no buy-in run/);
    const added = writeEarnStake(bare, { min: 1, max: 2, multiple: 2 });
    expect(added.split("\n")[2]).toBe(earnStakeLine({ min: 1, max: 2, multiple: 2 }));
    expect(() => writeEarnStake("if (x) {\n  earn.stake({ min: 1, max: 2, multiple: 2 });\n}\n", { min: 1, max: 2, multiple: 2 })).toThrow(EarnSourceError);
    expect(readEarnStake("earn.stake({ min: lo, max: 2, multiple: 2 });\n").problems[0]).toMatch(/plain values/);
    expect(checkEarnStake({ min: 10, max: 5, multiple: 3 })).toHaveLength(2);
    expect(checkEarnStake({ min: 10, max: 50, multiple: 2 })).toEqual([]);
  });
});
