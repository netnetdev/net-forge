import { describe, expect, it } from "vitest";
import { BOT_PLAYER_BASE, initSim } from "@netforge/engine-sim";
import type { InputCommand } from "@netforge/engine-sim";
import { routeFor } from "@netforge/engine/game";
import type { RaceInfo } from "@netforge/engine/game";
import type { SimEvent } from "@netforge/engine/net";
import { platformerAdapter, platformerGame } from "../src/manifest.js";

/** Step a server world with per-player inputs; returns every event. */
function run(sim: ReturnType<typeof platformerAdapter>, w: ReturnType<ReturnType<typeof platformerAdapter>["createWorld"]>, ticks: number, input: (id: number, t: number) => InputCommand | null): SimEvent[] {
  const out: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    const m = new Map<number, InputCommand[]>();
    for (const id of w.core.ids()) {
      if (id >= BOT_PLAYER_BASE) continue;
      const c = input(id, t);
      if (c) m.set(id, [c]);
    }
    out.push(...sim.step(w, m));
  }
  return out;
}

const info = (sim: ReturnType<typeof platformerAdapter>, w: Parameters<NonNullable<ReturnType<typeof platformerAdapter>["info"]>>[0]) => sim.info?.(w) as RaceInfo;

describe("SKYLEDGE race", () => {
  it("a solo climber with seat bots: reaching the flag pays, beating bots pays nothing extra, bots never earn", async () => {
    await initSim();
    const g = platformerGame();
    const sim = platformerAdapter({ countdownSeconds: 1, endSeconds: 2 });
    const w = sim.createWorld(6, "server");
    sim.addPlayer(w, 1);
    // Our climber runs the planned route from the start signal (exact on this sim), so it wins every race.
    const start = Math.round(1 * g.tickRate);
    const tape = routeFor(g.platformer.levels[0]!, g.tickRate, g.platformer.tuning, start);
    expect(tape).not.toBeNull();
    let seq = 0;
    const ev = run(sim, w, start + (tape?.length ?? 0) + 30, (_, t) => ({ ...(tape?.[t - start] ?? { seq: 0, tick: 0, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 }), seq: ++seq }));
    const earns = ev.filter((e) => e.type === "earn");
    expect(earns.map((e) => e.type === "earn" && e.rule)).toContain("summit");
    expect(earns.map((e) => e.type === "earn" && e.rule)).not.toContain("first_flag");
    for (const e of earns) if (e.type === "earn") expect(e.player).toBe(1);
    // Seat bots joined and ran.
    expect(w.core.ids().filter((id) => id >= BOT_PLAYER_BASE).length).toBe(2);
    expect(info(sim, w).players.find((p) => p.id === 1)?.place).toBe(1);
  });

  it("two people: the first to the flag takes first_flag; the round rolls to the next course with a run reset", async () => {
    await initSim();
    const g = platformerGame();
    const sim = platformerAdapter({ countdownSeconds: 1, endSeconds: 1, graceSeconds: 1 });
    const w = sim.createWorld(3, "server");
    sim.addPlayer(w, 1);
    sim.addPlayer(w, 2);
    const start = Math.round(g.tickRate);
    const tape = routeFor(g.platformer.levels[0]!, g.tickRate, g.platformer.tuning, start) ?? [];
    const late = routeFor(g.platformer.levels[0]!, g.tickRate, g.platformer.tuning, start + 30) ?? [];
    let seq = 0;
    const idle = { seq: 0, tick: 0, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 };
    const ev = run(sim, w, start + late.length + 30 + 60 * 4, (id, t) => ({ ...((id === 1 ? tape[t - start] : late[t - start - 30]) ?? idle), seq: ++seq }));
    const paid = ev.flatMap((e) => (e.type === "earn" ? [`${e.player}:${e.rule}`] : []));
    expect(paid).toContain("1:first_flag");
    expect(paid).toContain("1:summit");
    expect(paid).toContain("2:summit");
    expect(paid).not.toContain("2:first_flag");
    expect(ev.some((e) => e.type === "run.reset")).toBe(true);
    expect(info(sim, w).course).toBe(1);
  });

  it("a referee run started mid-race is never paid the win (world progress), only its own finish", async () => {
    await initSim();
    const g = platformerGame();
    const sim = platformerAdapter({ countdownSeconds: 1 });
    const w = sim.createWorld(9, "server");
    sim.addPlayer(w, 1);
    sim.addPlayer(w, 2);
    const start = Math.round(g.tickRate);
    const tape = routeFor(g.platformer.levels[0]!, g.tickRate, g.platformer.tuning, start) ?? [];
    let seq = 0;
    const idle = { seq: 0, tick: 0, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 };
    const ev: SimEvent[] = [];
    ev.push(...run(sim, w, start + 120, (id, t) => ({ ...(id === 1 ? (tape[t - start] ?? idle) : idle), seq: ++seq })));
    sim.startRun?.(w, 1);
    ev.push(...run(sim, w, tape.length, (id, t) => ({ ...(id === 1 ? (tape[t + 120] ?? idle) : idle), seq: ++seq })));
    const paid = ev.flatMap((e) => (e.type === "earn" ? [`${e.player}:${e.rule}`] : []));
    expect(paid).toContain("1:summit");
    expect(paid).not.toContain("1:first_flag");
  });

  it("client prediction replays exactly: a client world fed the server's state and the same inputs matches it", async () => {
    await initSim();
    const g = platformerGame();
    const sim = platformerAdapter({ countdownSeconds: 0.5 });
    const server = sim.createWorld(9, "server");
    sim.addPlayer(server, 1);
    const client = sim.createWorld(9, "client");
    sim.addPlayer(client, 1);
    const tape = routeFor(g.platformer.levels[0]!, g.tickRate, g.platformer.tuning, 30) ?? [];
    let seq = 0;
    const inputs: InputCommand[] = [];
    for (let t = 0; t < 600; t++) inputs.push({ ...(tape[t - 30] ?? { seq: 0, tick: 0, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 }), seq: ++seq });
    for (let t = 0; t < 300; t++) sim.step(server, new Map([[1, [inputs[t]!]]]));
    sim.applySnapshot(client, sim.snapshot(server).filter((e) => e.owner === 1));
    for (let t = 300; t < 600; t++) {
      sim.step(server, new Map([[1, [inputs[t]!]]]));
      sim.step(client, new Map([[1, [inputs[t]!]]]));
    }
    const a = sim.snapshot(server).find((e) => e.owner === 1)?.values;
    const b = sim.snapshot(client).find((e) => e.owner === 1)?.values;
    expect(b).toEqual(a);
  });
});
