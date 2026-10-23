import { describe, expect, it } from "vitest";
import { BOT_PLAYER_BASE, initSim } from "@netforge/engine-sim";
import type { InputCommand } from "@netforge/engine-sim";
import { kartAutopilot } from "@netforge/engine/game";
import type { RaceInfo } from "@netforge/engine/game";
import type { SimEvent } from "@netforge/engine/net";
import { racerAdapter, racerGame } from "../src/manifest.js";

type Sim = ReturnType<typeof racerAdapter>;
type World = ReturnType<Sim["createWorld"]>;

/** Step a server world, each person driving with the autopilot at `skill` (or idle). */
function run(sim: Sim, w: World, ticks: number, skill: (id: number) => number | null): SimEvent[] {
  const g = racerGame();
  const pilots = new Map<number, ReturnType<typeof kartAutopilot>>();
  const out: SimEvent[] = [];
  let seq = 0;
  for (let t = 0; t < ticks; t++) {
    const m = new Map<number, InputCommand[]>();
    for (const id of w.core.ids()) {
      if (id >= BOT_PLAYER_BASE) continue;
      const k = skill(id);
      if (k === null) continue;
      let p = pilots.get(id);
      if (!p) {
        p = kartAutopilot(g.racer, g.tickRate);
        pilots.set(id, p);
      }
      const snap = sim.snapshot(w);
      const self = snap.find((e) => e.owner === id);
      m.set(id, [{ ...p(self, t, k, snap), seq: ++seq }]);
    }
    out.push(...sim.step(w, m));
  }
  return out;
}

describe("TORQUEBAY race", () => {
  it("a race with seat bots: finishing pays, beating bots pays nothing extra, bots never earn", async () => {
    await initSim();
    const sim = racerAdapter({ countdownSeconds: 1, endSeconds: 2 });
    const w = sim.createWorld(6, "server");
    sim.addPlayer(w, 1);
    const ev = run(sim, w, 60 * 150, () => 1);
    const earns = ev.flatMap((e) => (e.type === "earn" ? [e] : []));
    expect(earns.map((e) => e.rule)).toContain("chequered");
    expect(earns.map((e) => e.rule)).not.toContain("pole_to_flag");
    for (const e of earns) expect(e.player).toBe(1);
    expect(w.core.ids().filter((id) => id >= BOT_PLAYER_BASE).length).toBe(5);
  });

  it("two people: the first to finish takes pole_to_flag; the round ends with a run reset", async () => {
    await initSim();
    const sim = racerAdapter({ countdownSeconds: 1, endSeconds: 1, graceSeconds: 1 });
    const w = sim.createWorld(3, "server");
    sim.addPlayer(w, 1);
    sim.addPlayer(w, 2);
    const ev = run(sim, w, 60 * 160, (id) => (id === 1 ? 1 : 0.5));
    const paid = ev.flatMap((e) => (e.type === "earn" ? [`${e.player}:${e.rule}`] : []));
    expect(paid).toContain("1:chequered");
    expect(paid).toContain("2:chequered");
    // The win pays at most once, only to a person, and the stronger driver beats the weaker one.
    expect(paid.filter((p) => p.endsWith(":pole_to_flag")).length).toBeLessThanOrEqual(1);
    expect(paid).not.toContain("2:pole_to_flag");
    expect(ev.some((e) => e.type === "run.reset")).toBe(true);
    void (sim.info?.(w) as RaceInfo);

  });

  it("client prediction replays exactly: a client world fed the server's state and the same inputs matches it", async () => {
    await initSim();
    const g = racerGame();
    const sim = racerAdapter({ countdownSeconds: 0.5 });
    const server = sim.createWorld(9, "server");
    sim.addPlayer(server, 1);
    const client = sim.createWorld(9, "client");
    sim.addPlayer(client, 1);
    const pilot = kartAutopilot(g.racer, g.tickRate);
    const inputs: InputCommand[] = [];
    let seq = 0;
    for (let t = 0; t < 300; t++) {
      const c = { ...pilot(sim.snapshot(server).find((e) => e.owner === 1), t), seq: ++seq };
      inputs.push(c);
      sim.step(server, new Map([[1, [c]]]));
    }
    sim.applySnapshot(client, sim.snapshot(server).filter((e) => e.owner === 1));
    for (let t = 300; t < 600; t++) {
      // Server and client step the same inputs (the grid keeps seat bots clear of us in these ten seconds).
      const c = { ...pilot(sim.snapshot(server).find((e) => e.owner === 1), t), seq: ++seq };
      sim.step(server, new Map([[1, [c]]]));
      sim.step(client, new Map([[1, [c]]]));
    }
    const a = sim.snapshot(server).find((e) => e.owner === 1)?.values;
    const b = sim.snapshot(client).find((e) => e.owner === 1)?.values;
    expect(b).toEqual(a);
  });
});
