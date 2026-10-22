import { describe, expect, it } from "vitest";
import { PIXEL_PALETTE } from "@netnetcapital/engine/runtime";
import { library, restyleId } from "../src/index.js";
import { spriteMultiple } from "../src/three/index.js";

describe("pixel style", () => {
  it("snaps sprites to the palette the engine's pixel style draws with", () => {
    expect(library().styles.get("pixel")?.palette).toEqual(PIXEL_PALETTE);
  });

  it("has a twin for every model EMBERWATCH (written in low-poly names) draws", () => {
    const used = ["hooded_adventurer", "rogue", "monarch", "mini_female_c", "ghost", "bee", "mushroom_imp", "frog", "triceratops", "slime_pink", "mech", "blob_wizard", "orc_brute", "slime_green", "imp", "dragon", "trex", "mushroom_king", "fox", "stump", "campfire", "crystal", "grenade", "chest", "tree_pine", "tree_pine_tall", "tree_dark", "rock_large"];
    for (const n of used) expect(restyleId(`style.lowpoly.${n}`, "pixel"), n).toMatch(/^style\.pixel\./);
  });

  it("keeps ids a style does not stock, and ids already in the style", () => {
    expect(restyleId("style.lowpoly.skyscraper_a", "pixel")).toBe("style.lowpoly.skyscraper_a");
    expect(restyleId("style.pixel.ghost", "pixel")).toBe("style.pixel.ghost");
    expect(restyleId("style.lowpoly.ghost", undefined)).toBe("style.lowpoly.ghost");
  });

  it("draws sprites at their own pixels, doubling only the big ones", () => {
    expect(spriteMultiple(1.1, 1)).toBe(1);
    expect(spriteMultiple(2, 1)).toBe(1);
    expect(spriteMultiple(4.8, 1)).toBe(2);
  });
});
