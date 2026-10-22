import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { fetchLibrary } from "../scripts/fetch.js";
import {
  assetById,
  assetPath,
  buildLibrary,
  clipFor,
  galleryFor,
  idsForStyle,
  library,
  libraryIdsIn,
  modelGuide,
  referenceableIds,
  resolveLook,
  RIGS,
  search,
  soundBank,
  soundById,
  soundPath,
} from "../src/index.js";

const lib = library();

describe("manifest", () => {
  it("validates, and every pack is CC0 with an official page and a recorded verification", () => {
    expect(lib.packs.size).toBeGreaterThanOrEqual(12);
    for (const p of lib.packs.values()) {
      expect(p.license).toBe("CC0-1.0");
      expect(p.page).toMatch(/^https:\/\//);
      expect(p.verified.how.length).toBeGreaterThan(20);
      if (p.download.kind === "zip") expect(p.download.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("stocks the two styles the templates need", () => {
    expect(idsForStyle("lowpoly").length).toBeGreaterThanOrEqual(200);
    expect(idsForStyle("pixel").length).toBeGreaterThanOrEqual(40);
    expect(idsForStyle("toon")).toEqual([]);
  });

  it("every file-backed asset names its pack and pins its bytes when it is a per-file download", () => {
    for (const style of lib.styles.values()) {
      for (const a of style.assets) {
        const src = a.source;
        if ("url" in src) {
          expect(src.sha256, a.id).toMatch(/^[0-9a-f]{64}$/);
          expect(src.page, a.id).toMatch(/^https:\/\/poly\.pizza\/m\//);
        }
        if ("pack" in src) expect(lib.packs.has(src.pack), a.id).toBe(true);
      }
    }
  });

  it("keeps the template's original ids as aliases", () => {
    for (const old of ["shade", "gnat", "husk", "brute", "bell_warden", "keeper_01", "ember_small", "wirejack", "bruiser", "volt_cell", "drone", "scrap_mite"]) {
      expect(assetById(`style.lowpoly.${old}`), old).toBeDefined();
      expect(referenceableIds("lowpoly").has(`style.lowpoly.${old}`)).toBe(true);
    }
  });

  it("refuses a broken manifest: unknown pack, unknown base, duplicate id", () => {
    const packs = JSON.parse(readFileSync(new URL("../manifest/packs.json", import.meta.url), "utf8")) as unknown[];
    const style = (assets: unknown[]) => ({ style: "lowpoly", dimension: "3d", palette: ["#000000", "#111111", "#222222", "#333333"], assets });
    const a = { id: "style.lowpoly.thing", kind: "prop", plan: "static", source: { pack: "nope", path: "x.glb" }, height: 1, line: "a thing", tags: ["thing"] };
    expect(() => buildLibrary({ packs, styles: [style([a])], gallery: {} })).toThrow(/unknown pack/);
    const v = { ...a, source: { base: "style.lowpoly.missing", appearance: {} } };
    expect(() => buildLibrary({ packs, styles: [style([v])], gallery: {} })).toThrow(/unknown style.lowpoly.missing/);
    const ok = { ...a, source: { procedural: "gem_small" } };
    expect(() => buildLibrary({ packs, styles: [style([ok, ok])], gallery: {} })).toThrow(/twice/);
  });

  it("never names a franchise in an id, line or tag", () => {
    const banned = /pokemon|pikachu|mario|luigi|zelda|sonic|disney|marvel|minecraft|fortnite|halo|nintendo|kirby|yoshi|link\b/i;
    for (const style of lib.styles.values()) for (const a of style.assets) expect(`${a.id} ${a.line} ${a.tags.join(" ")}`, a.id).not.toMatch(banned);
  });
});

describe("search: words resolve to library ids", () => {
  const top = (q: string) => search("lowpoly", q)[0]?.asset.id;
  it("finds what creators ask for", () => {
    expect(top("add a monster truck")).toBe("style.lowpoly.monster_truck");
    expect(top("slimes")).toMatch(/^style\.lowpoly\.slime_/);
    expect(top("a tank")).toMatch(/^style\.lowpoly\.tank/);
    expect(top("dragon")).toMatch(/dragon/);
    expect(top("pizza")).toBe("style.lowpoly.pizza");
    expect(search("pixel", "knight")[0]?.asset.id).toBe("style.pixel.knight");
    expect(search("lowpoly", "")).toEqual([]);
  });
});

describe("looks", () => {
  it("resolve deterministically, and identical looks share a key", () => {
    const a = resolveLook("style.lowpoly.shiba", { tint: "#5ec8ff", parts: ["antenna", "tail_bolt"] });
    const b = resolveLook("style.lowpoly.shiba", { tint: "#5ec8ff", parts: ["antenna", "tail_bolt"] });
    expect(a.key).toBe(b.key);
    expect(a.tint).toBe(0x5ec8ff);
    expect(a.parts.map((p) => p.part)).toEqual(["antenna", "tail_bolt"]);
    expect(resolveLook("style.lowpoly.shiba").key).not.toBe(a.key);
  });

  it("a variant draws its base with its built-in look, and the game's look stacks on top", () => {
    const r = resolveLook("style.lowpoly.monster_truck", { tint: "#ff0000", parts: [] });
    expect(r.asset.id).toBe("style.lowpoly.truck");
    expect(r.parts.map((p) => p.part)).toContain("big_wheels");
    expect(r.scale).toBeCloseTo(1.3);
    expect(r.tint).toBe(0xff0000);
  });

  it("drops parts a body plan has no place for", () => {
    const r = resolveLook("style.lowpoly.truck", { parts: ["mustache", "big_wheels"] });
    expect(r.dropped).toEqual(["mustache"]);
    expect(r.parts.map((p) => p.part)).toEqual(["big_wheels"]);
  });

  it("aliases resolve to their asset", () => {
    expect(resolveLook("style.lowpoly.shade").asset.id).toBe("style.lowpoly.ghost");
    expect(() => resolveLook("style.lowpoly.nope")).toThrow(/unknown library id/);
  });
});

describe("shared rigs", () => {
  const q = RIGS.quaternius;
  it("map the canonical clips across Quaternius naming families", () => {
    expect(clipFor(q, "idle", ["CharacterArmature|Idle", "CharacterArmature|Walk"])).toBe("CharacterArmature|Idle");
    expect(clipFor(q, "walk", ["Armature|TRex_Idle", "Armature|TRex_Walk"])).toBe("Armature|TRex_Walk");
    expect(clipFor(q, "idle", ["BatArmature|Bat_Flying", "BatArmature|Bat_Death"])).toBe("BatArmature|Bat_Flying");
    expect(clipFor(q, "hit", ["MonsterArmature|HitRecieve"])).toBe("MonsterArmature|HitRecieve");
    expect(clipFor(q, "die", ["CharacterArmature|Dead"])).toBe("CharacterArmature|Dead");
    expect(clipFor(q, "run", ["TankArmature|Tank_Forward"])).toBe("TankArmature|Tank_Forward");
  });
  it("fall back along the clip chain, then to procedural (null)", () => {
    expect(clipFor(q, "run", ["CharacterArmature|Walk"])).toBe("CharacterArmature|Walk");
    expect(clipFor(RIGS.kenney_humanoid, "hit", ["idle", "die"])).toBeNull();
    expect(clipFor(RIGS.kenney_humanoid, "shoot", ["holding-right-shoot"])).toBe("holding-right-shoot");
    expect(clipFor(undefined, "idle", ["Idle"])).toBeNull();
  });
});

describe("paths, ids and the model's guide", () => {
  it("files live at <style>/<name>.glb|png; procedural and variant entries have none", () => {
    expect(assetPath(assetById("style.lowpoly.truck")!)).toBe("lowpoly/truck.glb");
    expect(assetPath(assetById("style.pixel.slime")!)).toBe("pixel/slime.png");
    expect(assetPath(assetById("style.lowpoly.gem_small")!)).toBeNull();
    expect(assetPath(assetById("style.lowpoly.monster_truck")!)).toBeNull();
  });
  it("finds library ids in a game.ts", () => {
    expect(libraryIdsIn('prefab("a", { model: "style.lowpoly.ghost" }); prefab("b", { model: "style.lowpoly.ghost" }); "style.pixel.knight"')).toEqual(["style.lowpoly.ghost", "style.pixel.knight"]);
  });
  it("the guide lists every id and teaches looks", () => {
    const g = modelGuide("lowpoly");
    for (const id of idsForStyle("lowpoly")) expect(g).toContain(id);
    expect(g).toContain("monster truck");
    expect(g).toContain("big_wheels");
  });
  it("gallery entries use real ids and have thumbnails", () => {
    expect(galleryFor("lowpoly").length).toBeGreaterThanOrEqual(12);
    expect(galleryFor("pixel").length).toBeGreaterThanOrEqual(6);
    for (const e of galleryFor("lowpoly")) expect(assetById(e.model), e.id).toBeDefined();
  });
});

describe("fixture subset", () => {
  it("ships optimized samples: a static prop, an animated creature and a sprite", () => {
    const glb = readFileSync(new URL("../fixtures/library/lowpoly/slime_drop.glb", import.meta.url));
    expect(glb.readUInt32LE(0)).toBe(0x46546c67);
    const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString()) as { extensionsUsed?: string[]; animations?: { name: string }[] };
    expect(json.extensionsUsed).toContain("EXT_meshopt_compression");
    const names = (json.animations ?? []).map((a) => a.name);
    expect(clipFor(RIGS.quaternius, "walk", names)).not.toBeNull();
    expect(existsSync(new URL("../fixtures/library/pixel/slime.png", import.meta.url))).toBe(true);
  });
});

describe("fetch", () => {
  const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  const gltf = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, images: [{ uri: "Textures/colormap.png" }], buffers: [{ uri: "data:application/octet-stream;base64,AAAA" }] }));
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const glb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);

  function testLibrary(zipSha: string, fileSha: string) {
    const packs = [
      { id: "zip_pack", title: "Zip", author: "A", page: "https://example.test/zip", license: "CC0-1.0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", verified: { on: "2026-10-16", how: "stated on the pack page" }, download: { kind: "zip", url: "https://example.test/pack.zip", sha256: zipSha } },
      { id: "file_pack", title: "Files", author: "B", page: "https://example.test/files", license: "CC0-1.0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", verified: { on: "2026-10-16", how: "stated on each model page" }, download: { kind: "files", host: "https://example.test/", note: "per-model files from the host" } },
    ];
    const assets = [
      { id: "style.lowpoly.box", kind: "prop", plan: "static", source: { pack: "zip_pack", path: "Models/box.gltf" }, height: 1, line: "a box", tags: ["box"] },
      { id: "style.lowpoly.blob", kind: "creature", plan: "blob", source: { pack: "file_pack", url: "https://example.test/blob.glb", page: "https://example.test/m/blob", sha256: fileSha }, height: 1, line: "a blob", tags: ["blob"] },
    ];
    return buildLibrary({ packs, styles: [{ style: "lowpoly", dimension: "3d", palette: ["#000000", "#111111", "#222222", "#333333"], assets }], gallery: {} });
  }

  it("downloads once, verifies sha256, pulls a model's textures out with it, and works offline after", async () => {
    const zip = zipSync({ "Models/box.gltf": gltf, "Models/Textures/colormap.png": png, "Other/unused.png": png });
    const calls: string[] = [];
    const fake = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(String(url).endsWith(".zip") ? zip : glb, { status: 200 });
    }) as typeof fetch;
    const dir = mkdtempSync(join(tmpdir(), "asset-lib-"));
    try {
      const l = testLibrary(sha(zip), sha(glb));
      const entries = await fetchLibrary({ library: l, cacheDir: dir, fetch: fake });
      expect(entries.map((e) => e.id).sort()).toEqual(["style.lowpoly.blob", "style.lowpoly.box"]);
      expect(existsSync(join(dir, "raw/lowpoly/box/Textures/colormap.png"))).toBe(true);
      expect(existsSync(join(dir, "raw/lowpoly/box/unused.png"))).toBe(false);
      expect(calls.length).toBe(2);
      const again = await fetchLibrary({ library: l, cacheDir: dir, offline: true, fetch: fake });
      expect(again.length).toBe(2);
      expect(calls.length).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stops on a sha256 mismatch (a pack changed upstream)", async () => {
    const zip = zipSync({ "Models/box.gltf": gltf, "Models/Textures/colormap.png": png });
    const fake = (async (url: string | URL | Request) => new Response(String(url).endsWith(".zip") ? zip : glb)) as typeof fetch;
    const dir = mkdtempSync(join(tmpdir(), "asset-lib-"));
    try {
      await expect(fetchLibrary({ library: testLibrary("0".repeat(64), sha(glb)), cacheDir: dir, fetch: fake })).rejects.toThrow(/changed upstream/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fetches the audio section: effects out of an archive and a pinned music file, offline after", async () => {
    const ogg = new TextEncoder().encode("OggS-fake");
    const mp3 = new TextEncoder().encode("ID3-fake");
    const zip = zipSync({ "Audio/hit.ogg": ogg });
    const calls: string[] = [];
    const fake = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(String(url).endsWith(".zip") ? zip : mp3);
    }) as typeof fetch;
    const packs = [
      { id: "sfx_pack", title: "Sfx", author: "A", page: "https://example.test/sfx", license: "CC0-1.0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", verified: { on: "2026-10-16", how: "stated on the pack page" }, download: { kind: "zip", url: "https://example.test/sfx.zip", sha256: sha(zip) } },
      { id: "music_pack", title: "Music", author: "B", page: "https://example.test/music", license: "CC0-1.0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", verified: { on: "2026-10-16", how: "stated on each track page" }, download: { kind: "files", host: "https://example.test/", note: "per-track files from the host" } },
    ];
    const audio = {
      sounds: [
        { id: "audio.sfx.hit", kind: "sfx", cue: "hit", line: "a hit", tags: ["hit"], source: { pack: "sfx_pack", path: "Audio/hit.ogg", sha256: sha(ogg) } },
        { id: "audio.music.loop", kind: "music", line: "a loop", tags: ["music"], source: { pack: "music_pack", url: "https://example.test/loop.mp3", page: "https://example.test/t/loop", sha256: sha(mp3) } },
      ],
    };
    const l = buildLibrary({ packs, styles: [], gallery: {}, audio });
    const dir = mkdtempSync(join(tmpdir(), "asset-lib-"));
    try {
      const entries = await fetchLibrary({ library: l, cacheDir: dir, fetch: fake });
      expect(entries.map((e) => [e.id, e.main, e.format])).toEqual([
        ["audio.sfx.hit", "audio/sfx/hit.ogg", "ogg"],
        ["audio.music.loop", "audio/music/loop.mp3", "mp3"],
      ]);
      expect(readFileSync(join(dir, "raw/audio/sfx/hit.ogg"))).toEqual(Buffer.from(ogg));
      expect(existsSync(join(dir, "raw/audio/music/loop.mp3"))).toBe(true);
      expect(calls.length).toBe(2);
      await fetchLibrary({ library: l, cacheDir: dir, offline: true, fetch: fake });
      expect(calls.length).toBe(2);
      const bad = buildLibrary({ packs, styles: [], gallery: {}, audio: { sounds: [{ ...audio.sounds[0], source: { pack: "sfx_pack", path: "Audio/hit.ogg", sha256: "0".repeat(64) } }] } });
      await expect(fetchLibrary({ library: bad, cacheDir: dir, fetch: fake })).rejects.toThrow(/changed upstream/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("audio section", () => {
  it("every sound is CC0 from a verified pack, pinned by sha256, and every cue has one sound", () => {
    expect(lib.sounds.size).toBeGreaterThanOrEqual(16);
    for (const s of lib.sounds.values()) {
      const pack = lib.packs.get(s.source.pack);
      expect(pack?.license, s.id).toBe("CC0-1.0");
      expect(s.source.sha256, s.id).toMatch(/^[0-9a-f]{64}$/);
      if ("url" in s.source) expect(s.source.page, s.id).toMatch(/^https:\/\/opengameart\.org\/content\//);
    }
    for (const cue of ["hit", "impact", "kill", "bigKill", "hurt", "levelUp", "gem", "coin", "dash", "step", "boss", "ui", "pick", "downed", "revive", "shoot"]) {
      expect([...lib.sounds.values()].some((s) => s.cue === cue), cue).toBe(true);
    }
  });

  it("ships one music loop and builds a bank of URLs and gains", () => {
    expect(soundById("audio.music.battle_theme_a")?.kind).toBe("music");
    expect(soundPath(soundById("audio.sfx.hit")!)).toBe("audio/sfx/hit.ogg");
    const bank = soundBank("./library/");
    expect(bank.cues.hit?.url).toBe("./library/audio/sfx/hit.ogg");
    expect(bank.cues.levelUp?.gain).toBeGreaterThan(0);
    expect(bank.music?.url).toBe("./library/audio/music/battle_theme_a.mp3");
    expect(soundBank("x", { music: null }).music).toBeNull();
    expect(soundBank("x", { cues: { kill: "audio.sfx.big_kill" } }).cues.kill?.url).toBe("x/audio/sfx/big_kill.ogg");
    expect(() => soundBank("x", { music: "audio.sfx.hit" })).toThrow(/not a music loop/);
  });

  it("refuses a broken audio section: unknown pack, a second sound for one cue, a bad format", () => {
    const packs = JSON.parse(readFileSync(new URL("../manifest/packs.json", import.meta.url), "utf8")) as unknown[];
    const s = { id: "audio.sfx.a", kind: "sfx", cue: "hit", line: "a hit", tags: ["hit"], source: { pack: "kenney_impact_sounds", path: "Audio/a.ogg", sha256: "0".repeat(64) } };
    expect(() => buildLibrary({ packs, styles: [], gallery: {}, audio: { sounds: [{ ...s, source: { ...s.source, pack: "nope" } }] } })).toThrow(/unknown pack/);
    expect(() => buildLibrary({ packs, styles: [], gallery: {}, audio: { sounds: [s, { ...s, id: "audio.sfx.b" }] } })).toThrow(/already has a sound/);
    expect(() => buildLibrary({ packs, styles: [], gallery: {}, audio: { sounds: [{ ...s, source: { ...s.source, path: "Audio/a.wav" } }] } })).toThrow();
    expect(() => buildLibrary({ packs, styles: [], gallery: {}, audio: { sounds: [{ ...s, kind: "music" }] } })).toThrow();
  });
});
