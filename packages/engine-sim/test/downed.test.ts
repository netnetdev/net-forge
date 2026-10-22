// Round 1 playtest: going down is short. A downed keeper crawls, spends one
// free self-revive (Sprint, or by itself when the timer runs out), and an
// out keeper comes back beside a teammate after a short delay. Boss chests
// ripen an evolution the player holds the passive for; the director's speed
// curve scales non-boss enemies.
import { beforeAll, describe, expect, it } from "vitest";
import { addPlayer, applyState, Button, captureState, createWorld, destroyWorld, EntityKind, initSim, listPlayers, setEnemySpeed, spawnEnemy, step } from "../src/index.js";
import type { InputCommand, SimConfig, SimWorld } from "../src/index.js";
import { CONTENT_CONFIG } from "./helpers.js";

const CFG = CONTENT_CONFIG as unknown as SimConfig;
const cmd = (moveX = 0, buttons = 0): InputCommand => ({ seq: 0, tick: 0, moveX, moveZ: 0, yaw: 0, buttons });
const coop = { downedTicks: 300, reviveTicks: 30, iframeTicks: 30, crawlSpeed: 0.35, selfRevives: 1, selfReviveDelayTicks: 15, respawnTicks: 150, risePulseRadius: 4 };

function onlyPlayers(w: SimWorld): void {
  const s = captureState(w);
  applyState(w, { ...s, entities: s.entities.filter((e) => e.kind === EntityKind.Player) });
}

/** Park a boss on a player until they go down, then clear every enemy. */
function downPlayer(w: SimWorld, p: number): void {
  const me = listPlayers(w).find((x) => x.playerId === p);
  spawnEnemy(w, 2, (me?.x ?? 0) + 0.4, me?.z ?? 0);
  for (let t = 0; t < 900 && !listPlayers(w).find((x) => x.playerId === p)?.downed; t++) step(w, new Map());
  onlyPlayers(w);
}

describe("downed, self-revive and respawn", () => {
  beforeAll(async () => {
    await initSim();
  });
  const who = (w: SimWorld, p: number) => listPlayers(w).find((x) => x.playerId === p);

  it("a downed keeper crawls at a fraction of run speed, then Sprint spends the one free get-up", () => {
    const w = createWorld({ ...CFG, content: { ...CFG.content, coop } });
    addPlayer(w, 1, [0, 1, 0]);
    addPlayer(w, 2, [20, 1, 20]);
    downPlayer(w, 1);
    expect(who(w, 1)?.downed).toBe(true);
    expect(who(w, 1)?.selfRevives).toBe(1);
    const x0 = who(w, 1)?.x ?? 0;
    for (let t = 0; t < 30; t++) step(w, new Map([[1, cmd(1)]]));
    const crawled = (who(w, 1)?.x ?? 0) - x0;
    expect(crawled).toBeGreaterThan(0.5);
    expect(crawled).toBeLessThan(7 * 0.5);
    step(w, new Map([[1, cmd(0, Button.Sprint)]]));
    expect(who(w, 1)?.up).toBe(true);
    expect(who(w, 1)?.selfRevives).toBe(0);
    // Down again: no get-up left, so Sprint does nothing; the timer runs out and they are out.
    downPlayer(w, 1);
    step(w, new Map([[1, cmd(0, 0)]]));
    for (let t = 0; t < 20; t++) step(w, new Map([[1, cmd(0, t % 2 ? Button.Sprint : 0)]]));
    expect(who(w, 1)?.downed).toBe(true);
    for (let t = 0; t < 320 && !who(w, 1)?.dead; t++) step(w, new Map());
    expect(who(w, 1)?.dead).toBe(true);
    // Out for respawnTicks, then back beside player 2, who is up.
    for (let t = 0; t < 160 && !who(w, 1)?.up; t++) step(w, new Map());
    const me = who(w, 1);
    const mate = who(w, 2);
    expect(me?.up).toBe(true);
    expect(Math.hypot((me?.x ?? 0) - (mate?.x ?? 0), (me?.z ?? 0) - (mate?.z ?? 0))).toBeLessThan(2);
    destroyWorld(w);
  });

  it("an unused free get-up is spent by itself when the timer runs out, never wasted", () => {
    const w = createWorld({ ...CFG, content: { ...CFG.content, coop } });
    addPlayer(w, 1, [0, 1, 0]);
    downPlayer(w, 1);
    for (let t = 0; t < 320 && who(w, 1)?.downed; t++) step(w, new Map());
    expect(who(w, 1)?.up).toBe(true);
    expect(who(w, 1)?.selfRevives).toBe(0);
    destroyWorld(w);
  });

  it("with nobody else up, an out keeper stays out (the run is lost, not respawned)", () => {
    const w = createWorld({ ...CFG, content: { ...CFG.content, coop: { ...coop, selfRevives: 0 } } });
    addPlayer(w, 1, [0, 1, 0]);
    downPlayer(w, 1);
    for (let t = 0; t < 700; t++) step(w, new Map());
    expect(who(w, 1)?.dead).toBe(true);
    destroyWorld(w);
  });

  it("the director's speed multiplier moves chasers faster, never bosses", () => {
    const run = (k: number, type: number) => {
      const w = createWorld(CFG);
      addPlayer(w, 1, [0, 1, 0]);
      setEnemySpeed(w, k);
      spawnEnemy(w, type, 20, 0);
      for (let t = 0; t < 30; t++) step(w, new Map());
      const e = captureState(w).entities.find((x) => x.kind === EntityKind.Enemy);
      destroyWorld(w);
      return e?.px ?? 0;
    };
    expect(run(1.5, 0)).toBeLessThan(run(1, 0) - 512);
    expect(run(1.5, 2)).toBe(run(1, 2));
  });
});
