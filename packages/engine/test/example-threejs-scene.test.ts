import { beforeAll, describe, expect, it } from "vitest";
import { initSim } from "@netforge/engine-sim";
import { connect, intent, metres, sim } from "../examples/threejs-scene/room.js";

beforeAll(async () => {
  await initSim();
});

describe("examples/threejs-scene", () => {
  it("two clients send only intentions over a 60 ms link; the server moves them and each prediction lands where the server says", () => {
    const { room, net, clients } = connect(2);
    const tickMs = 1000 / sim.tickHz;
    let now = 0;
    // Three seconds: player 1 walks one way, player 2 the other.
    for (let t = 0; t < sim.tickHz * 3; t++) {
      clients[0]?.tick(intent(t + 1, t, 1, 0), now);
      clients[1]?.tick(intent(t + 1, t, 0, 1), now);
      now += tickMs;
      net.advanceTo(now);
      room.step();
    }
    // Then stand still for a second so the server catches up with every input.
    for (let t = 0; t < sim.tickHz; t++) {
      for (const c of clients) c.tick(intent(0, 0, 0, 0), now);
      now += tickMs;
      net.advanceTo(now);
      room.step();
    }
    for (const c of clients) {
      const predicted = c.predicted();
      const server = c.authoritativeSelf();
      expect(predicted && server).toBeTruthy();
      if (!predicted || !server) continue;
      const p = metres(predicted);
      const s = metres(server);
      expect(Math.hypot(p.x - s.x, p.z - s.z)).toBeLessThan(0.05);
    }
    const one = clients[0]?.authoritativeSelf();
    const two = clients[1]?.authoritativeSelf();
    expect(one && two).toBeTruthy();
    if (one && two) expect(Math.hypot(metres(one).x - metres(two).x, metres(one).z - metres(two).z)).toBeGreaterThan(3);
  });
});
