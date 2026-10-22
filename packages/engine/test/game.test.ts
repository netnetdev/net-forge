import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initSim, quantizeInput } from "@netnetcapital/engine-sim";
import { GameDefinitionError, earn, game, prefab, system, upgrade, weapon } from "../src/index.js";
import { EarnTracker, F, GameRunner, collectManifest, compileGame, engineSimAdapter, resetRegistry } from "../src/game/index.js";
import { BitReader, BitWriter, decodeSnapshot, encodeSnapshot, quantizeEntity } from "../src/net/index.js";
import type { EntitySchema, QEntity } from "../src/net/index.js";

beforeAll(async () => {
  await initSim();
});
beforeEach(() => resetRegistry());

function declareMini(): void {
  game({
    template: "survivor",
    style: "lowpoly",
    places: { a: { chunks: "places/a", spawn: [0, 1, 0] } },
    players: { prefab: "style.lowpoly.hero", max: 4, weapon: "pulse" },
  });
  prefab("bat", { model: "style.lowpoly.bat", health: 10, speed: 4, drops: ["gem", "gem"] });
  prefab("gem", { model: "style.lowpoly.gem", health: 1, speed: 0, value: 3 });
  prefab("king", { model: "style.lowpoly.king", health: 500, speed: 2, radius: 1.5, boss: true, drops: ["gem"] });
  weapon("pulse", { kind: "nova", damage: 20, cooldown: 0.5, range: 4 });
  weapon("dart", { kind: "bolt", damage: 8, cooldown: 0.4, range: 12 });
  upgrade("boots", { stat: "speed", step: 0.1 });
  system("waves", ({ every, spawnRing, emit, on, end }) => {
    every(2, () => spawnRing("bat", { count: 30, radius: 6 }));
    every(5, () => emit("wave.cleared"));
    on("boss.killed", () => end("won"));
  });
  earn.rule("two_waves", { when: "wave.cleared", n: 2, pay: 10, oncePer: "run" });
  earn.rule("hunter", { when: "enemy.killed", n: 20, pay: 1, oncePer: "run" });
  earn.stake({ min: 1, max: 10, multiple: 2 });
}

describe("compileGame", () => {
  it("turns prefabs, weapons and upgrades into sim content", () => {
    declareMini();
    const g = compileGame(collectManifest());
    expect(g.enemyPrefabs).toEqual(["bat", "king"]);
    expect(g.sim.content?.enemyTypes?.[0]).toMatchObject({ health: 10, speed: 4, xp: 6, mass: 1 });
    expect(g.sim.content?.enemyTypes?.[1]).toMatchObject({ boss: true, mass: 20, radius: 1.5, xp: 3 });
    expect(g.sim.content?.weapons?.[0]).toMatchObject({ kind: "nova", cooldownTicks: 15 });
    expect(g.sim.content?.weapons?.[1]).toMatchObject({ kind: "bolt", speed: 20 });
    expect(g.sim.content?.progression?.startWeapon).toBe(0);
    expect(g.weaponIds).toEqual(["pulse", "dart"]);
    expect(g.upgradeIds).toEqual(["boots"]);
  });

  it("a survivor game without weapons or a start weapon fails with actionable lines", () => {
    game({ template: "survivor", style: "toon", places: { a: { chunks: "p", spawn: [0, 0, 0] } }, players: { prefab: "style.toon.x", max: 4 } });
    prefab("bat", { model: "style.toon.bat", health: 1, speed: 1 });
    earn.rule("x", { when: "wave.cleared", pay: 1, oncePer: "run" });
    earn.stake({ min: 1, max: 10, multiple: 2 });
    expect(() => compileGame(collectManifest())).toThrow(GameDefinitionError);
    expect(() => compileGame(collectManifest())).toThrow(/weapon\(/);
  });

  it("rejects an undeclared start weapon at collect time", () => {
    game({ template: "survivor", style: "toon", places: { a: { chunks: "p", spawn: [0, 0, 0] } }, players: { prefab: "style.toon.x", max: 4, weapon: "nope" } });
    earn.rule("x", { when: "wave.cleared", pay: 1, oncePer: "run" });
    earn.stake({ min: 1, max: 10, multiple: 2 });
    expect(() => collectManifest()).toThrow(/players\.weapon/);
  });
});

describe("GameRunner", () => {
  it("runs the systems: waves spawn, kills happen, wave.cleared fires, earn rules pay once per run", async () => {
    declareMini();
    const g = compileGame(collectManifest());
    const { createWorld, addPlayer, step } = await import("@netnetcapital/engine-sim");
    const w = createWorld({ ...g.sim, seed: 2 });
    addPlayer(w, 1);
    const r = new GameRunner(g, w, { godMode: true });
    const awards: string[] = [];
    let kills = 0;
    for (let t = 0; t < 30 * 12; t++) {
      r.beforeStep();
      // A solo player's open cards pause the run, so this player picks the first card as soon as it shows.
      const res = step(w, new Map([[1, { seq: t + 1, tick: t, moveX: 0, moveZ: 0, yaw: 0, buttons: t % 2 === 0 ? 1 << 5 : 0 }]]));
      const out = r.afterStep(res.events);
      kills += out.events.filter((e) => e.name === "enemy.killed").length;
      for (const a of out.awards) awards.push(`${a.player}:${a.rule}`);
    }
    expect(kills).toBeGreaterThan(20);
    expect(r.info().wave).toBe(3);
    expect(awards.sort()).toEqual(["1:hunter", "1:two_waves"]);
  });
});

describe("EarnTracker", () => {
  it("pays when a player's count reaches n, once per run, and starts over on reset", () => {
    const t = new EarnTracker(new Map([["three", { when: "wave.cleared", n: 3, pay: 1, oncePer: "run" as const }]]));
    const ev = { name: "wave.cleared", players: [1, 2] };
    expect(t.record(ev)).toEqual([]);
    expect(t.record(ev)).toEqual([]);
    expect(t.record(ev)).toEqual([
      { player: 1, rule: "three", units: 1 },
      { player: 2, rule: "three", units: 1 },
    ]);
    expect(t.record(ev)).toEqual([]);
    t.resetRun();
    t.record(ev);
    t.record(ev);
    expect(t.record({ name: "wave.cleared", players: [2] })).toEqual([{ player: 2, rule: "three", units: 1 }]);
  });
});

describe("engine SimAdapter", () => {
  it("input codec round-trips to the sim's quantized command in 6 bytes", () => {
    const sim = engineSimAdapter({ name: "t", version: "1", arena: {} });
    const cmd = { seq: 0, tick: 0, moveX: 0.31, moveZ: -0.77, yaw: 2.5, buttons: 0x13 };
    const w = new BitWriter(8);
    sim.input.write(w, cmd);
    const bytes = w.finish();
    expect(bytes.length).toBe(6);
    const back = sim.input.read(new BitReader(bytes));
    expect(quantizeInput(back)).toEqual(quantizeInput(cmd));
  });

  it("a player's state survives snapshot → applySnapshot exactly (what prediction reconciles to)", () => {
    declareMini();
    const sim = engineSimAdapter({ name: "t", version: "1", game: compileGame(collectManifest()) });
    const server = sim.createWorld(1, "server");
    sim.addPlayer(server, 1);
    for (let t = 0; t < 200; t++) sim.step(server, new Map([[1, [{ seq: 0, tick: 0, moveX: Math.cos(t / 9), moveZ: 0.5, yaw: 0, buttons: t % 50 === 0 ? 16 : 0 }]]]));
    const me = sim.snapshot(server).find((e) => e.kind === 1);
    if (!me) throw new Error("no player");
    const wire = quantizeEntity(sim.schema, me);
    const client = sim.createWorld(1, "client");
    sim.applySnapshot(client, [{ ...me, values: wire.map((q, i) => (sim.schema.fields[i]?.kind === "angle16" ? (q / 65536) * Math.PI * 2 : q)) }]);
    const back = sim.snapshot(client)[0];
    expect(back?.values.slice(0, F.dash + 1)).toEqual(me.values.slice(0, F.dash + 1));
  });
});

describe("snapshot codec: per-kind fields and repeated masks", () => {
  const schema: EntitySchema = {
    fields: [
      { name: "x", kind: "int", bits: 16, deltaBits: 6 },
      { name: "z", kind: "int", bits: 16, deltaBits: 6 },
      { name: "hp", kind: "uint", bits: 10, interp: "step" },
      { name: "big", kind: "uint", bits: 32, interp: "step" },
    ],
    xField: 0,
    yField: 1,
    unitsPerWorld: 1,
    kindFields: { 2: [0, 1, 2] },
  };
  it("crowd entities carry only their fields; a delta costs about two bytes per moving entity", () => {
    const base: QEntity[] = [];
    for (let i = 1; i <= 200; i++) base.push({ id: i * 3, kind: 2, owner: 0, q: [i, -i, 50, 0] });
    base.push({ id: 1000, kind: 1, owner: 1, q: [5, 5, 100, 123456] });
    const baseMap = new Map(base.map((e) => [e.id, e]));
    const full = encodeSnapshot(schema, { tick: 1, baselineTick: 0, ackSeq: 0, self: 1000 }, base, null);
    const cur = base.map((e) => (e.kind === 2 ? { ...e, q: [(e.q[0] ?? 0) + 3, (e.q[1] ?? 0) - 2, e.id === 30 ? 40 : 50, 0] } : e));
    cur.push({ id: 2000, kind: 2, owner: 0, q: [1, 2, 3, 0] });
    const delta = encodeSnapshot(schema, { tick: 2, baselineTick: 1, ackSeq: 0, self: 1000 }, cur, baseMap);
    const d = decodeSnapshot(schema, delta, () => baseMap);
    expect([...d.entities.values()].sort((a, b) => a.id - b.id)).toEqual([...cur].sort((a, b) => a.id - b.id));
    expect(delta.length).toBeLessThan(200 * 2.2);
    expect(delta.length).toBeLessThan(full.length / 3);
  });
});

describe("engine SimAdapter crowd positions", () => {
  it("enemy x/z go on the wire at 1/16 m and come back within 1/32 m", async () => {
    const { spawnEnemy } = await import("@netnetcapital/engine-sim");
    const sim = engineSimAdapter({ name: "t", version: "1", arena: {} });
    const w = sim.createWorld(1, "server");
    spawnEnemy(w.sim, 0, 12.34, -7.89);
    const e = sim.snapshot(w).find((x) => x.kind === 2);
    expect((e?.values[F.ex] ?? 0) / 16).toBeCloseTo(12.34, 1);
    expect((e?.values[F.ez] ?? 0) / 16).toBeCloseTo(-7.89, 1);
  });
});
