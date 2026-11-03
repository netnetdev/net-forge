import { describe, expect, it } from "vitest";
import { creepDefense, regenHeal } from "../src/rules/tower.js";

/** Enemy defenses: a hit is cut by resist (per the tower's school), then armor (flat, min 1 lands), then the shield absorbs. */
const bare = { resPhys: 0, resMag: 0, armor: 0, shield: 0 };

describe("tower enemy traits: creepDefense", () => {
  it("passes damage through when there are no defenses", () => {
    expect(creepDefense(10, bare, "physical")).toEqual({ hp: 10, shield: 0 });
  });

  it("applies the matching resist and ignores the other school", () => {
    expect(creepDefense(10, { ...bare, resPhys: 0.5 }, "physical")).toEqual({ hp: 5, shield: 0 });
    expect(creepDefense(10, { ...bare, resMag: 0.9 }, "physical")).toEqual({ hp: 10, shield: 0 }); // magic resist, physical hit
    expect(creepDefense(10, { ...bare, resMag: 0.9 }, "magic")).toEqual({ hp: 1, shield: 0 });
  });

  it("removes armor flat but always lets at least 1 through", () => {
    expect(creepDefense(10, { ...bare, armor: 4 }, "physical")).toEqual({ hp: 6, shield: 0 });
    expect(creepDefense(10, { ...bare, armor: 100 }, "physical")).toEqual({ hp: 1, shield: 0 }); // armor can't make it invincible
  });

  it("absorbs with the shield before hit points", () => {
    expect(creepDefense(10, { ...bare, shield: 8 }, "physical")).toEqual({ hp: 2, shield: 0 }); // 8 absorbed, 2 through
    expect(creepDefense(10, { ...bare, shield: 50 }, "physical")).toEqual({ hp: 0, shield: 40 }); // fully blocked
  });

  it("stacks resist, then armor, then shield", () => {
    // 20 dmg, 50% resist -> 10, armor 2 -> 8, shield 1 absorbs -> 7 through, shield gone
    expect(creepDefense(20, { resPhys: 0.5, resMag: 0, armor: 2, shield: 1 }, "physical")).toEqual({ hp: 7, shield: 0 });
  });
});

describe("tower enemy traits: regenHeal", () => {
  it("does nothing with no regen or at full health", () => {
    expect(regenHeal(50, 100, 0, 0)).toEqual({ hp: 50, acc: 0 });
    expect(regenHeal(100, 100, 5, 0)).toEqual({ hp: 100, acc: 0 });
  });
  it("accrues fractional healing until a whole hit point lands", () => {
    let r = { hp: 50, acc: 0 };
    for (let i = 0; i < 4; i++) r = regenHeal(r.hp, 100, 0.2, r.acc); // 0.8 accrued, no heal yet
    expect(r.hp).toBe(50);
    r = regenHeal(r.hp, 100, 0.2, r.acc); // crosses 1.0
    expect(r.hp).toBe(51);
  });
  it("heals whole points and keeps the remainder", () => {
    expect(regenHeal(50, 100, 1.5, 0)).toEqual({ hp: 51, acc: 0.5 });
  });
  it("never exceeds max health", () => {
    expect(regenHeal(99, 100, 10, 0)).toEqual({ hp: 100, acc: 0 });
  });
});
