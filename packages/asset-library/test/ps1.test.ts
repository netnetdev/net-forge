import { describe, expect, it } from "vitest";
import { assetById, idsForStyle, library } from "../src/library.js";
import { restyleId } from "../src/restyle.js";

describe("ps1 style", () => {
  it("restocks the low-poly names, so a game drawn in ps1 finds its models", () => {
    expect(restyleId("style.lowpoly.goblin", "ps1")).toBe("style.ps1.goblin");
    expect(restyleId("style.lowpoly.goblin", null)).toBe("style.lowpoly.goblin");
    expect(restyleId("style.lowpoly.goblin", "lowpoly")).toBe("style.lowpoly.goblin");
    // A name the style does not stock keeps the original model.
    expect(restyleId("style.lowpoly.no_such_thing", "ps1")).toBe("style.lowpoly.no_such_thing");
  });

  it("ships ten CC0 surface textures, each pinned by sha256 to a listed pack", () => {
    const lib = library();
    const surfaces = idsForStyle("ps1").filter((id) => id.includes(".surface_"));
    expect(surfaces).toHaveLength(10);
    for (const id of surfaces) {
      const a = assetById(id);
      const src = a?.source as { pack?: string; sha256?: string } | undefined;
      expect(src?.sha256, id).toMatch(/^[0-9a-f]{64}$/);
      const pack = lib.packs.get(src?.pack ?? "");
      expect(pack?.license, id).toBe("CC0-1.0");
    }
  });
});
