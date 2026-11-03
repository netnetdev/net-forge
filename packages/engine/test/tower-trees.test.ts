import { describe, expect, it } from "vitest";
import { applyTiers, branchAllowed, type TowerStats } from "../src/rules/tower.js";

const base: TowerStats = { damage: 10, rate: 1, range: 3, radius: 1, slow: 0, slowSeconds: 1.5, chains: 3 };
const tiers = [
  { cost: 10, damage: 20 },
  { cost: 20, range: 4, damage: 30 },
];

describe("tower upgrade trees: applyTiers", () => {
  it("returns the base at tier 0", () => {
    expect(applyTiers(base, tiers, 0)).toEqual(base);
  });
  it("applies one tier (set-if-defined)", () => {
    expect(applyTiers(base, tiers, 1)).toEqual({ ...base, damage: 20 });
  });
  it("applies successive tiers in order", () => {
    expect(applyTiers(base, tiers, 2)).toEqual({ ...base, damage: 30, range: 4 });
  });
  it("caps at the number of tiers", () => {
    expect(applyTiers(base, tiers, 9)).toEqual(applyTiers(base, tiers, 2));
  });
});

describe("tower upgrade trees: branchAllowed (commit to one line)", () => {
  it("lets a fresh tower start any branch", () => {
    expect(branchAllowed(2, -1, 0, 0, 3)).toBe(true);
    expect(branchAllowed(2, -1, 1, 0, 3)).toBe(true);
  });
  it("locks a tower to the branch it started", () => {
    expect(branchAllowed(2, 0, 1, 1, 3)).toBe(false); // committed to 0, wants 1
    expect(branchAllowed(2, 0, 0, 1, 3)).toBe(true); // same branch continues
  });
  it("runs out at the last tier", () => {
    expect(branchAllowed(2, 0, 0, 3, 3)).toBe(false); // level == tierCount
  });
  it("rejects a branch index that does not exist", () => {
    expect(branchAllowed(2, -1, 2, 0, 3)).toBe(false);
  });
});
