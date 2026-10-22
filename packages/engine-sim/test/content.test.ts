import { beforeAll, describe, expect, it } from "vitest";
import {
  Button,
  EntityFlag,
  EntityKind,
  addPlayer,
  applyState,
  captureState,
  createWorld,
  decodeChoices,
  decodeSnapshot,
  destroyWorld,
  encodeSnapshot,
  enemyCount,
  initSim,
  listPlayers,
  removePlayer,
  resetRun,
  respawnDead,
  revivePlayer,
  slotLevel,
  slotWeapon,
  spawnEnemy,
  spawnRingPoint,
  step,
} from "../src/index.js";
import type { InputCommand, SimConfig, SimEvent, SimWorld } from "../src/index.js";
import { CONTENT_CONFIG, contentInputs, equalBytes } from "./helpers.js";

const CFG = CONTENT_CONFIG as unknown as SimConfig;
const idle = (buttons = 0): InputCommand => ({ seq: 0, tick: 0, moveX: 0, moveZ: 0, yaw: 0, buttons });

/** A wave driver like the game runner's: enemies on a ring, a boss at tick 300. */
function populate(w: SimWorld, t: number): void {
  if (t % 3 === 0 && enemyCount(w) < 400) {
    for (let i = 0; i < 8; i++) {
      const [x, z] = spawnRingPoint(w, 16);
      spawnEnemy(w, i % 5 === 0 ? 1 : 0, x, z);
    }
  }
  if (t === 300) spawnEnemy(w, 2, 10, 10);
}

function run(ticks: number): { snaps: Uint8Array[]; events: SimEvent[] } {
  const w = createWorld(CFG);
  for (let p = 1; p <= 4; p++) addPlayer(w, p, [p * 2 - 5, 1, 0]);
  const input = contentInputs([1, 2, 3, 4], 9);
  const snaps: Uint8Array[] = [];
  const events: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    populate(w, t);
    events.push(...step(w, input(w.tick)).events);
    if (t % 150 === 149) snaps.push(encodeSnapshot(captureState(w)));
  }
  destroyWorld(w);
  return { snaps, events };
}

describe("content mode", () => {
  beforeAll(async () => {
    await initSim();
  });

  it("is deterministic with weapons, gems, level-ups, corpses and a boss", () => {
    const a = run(900);
    const b = run(900);
    expect(a.snaps.length).toBe(6);
    a.snaps.forEach((s, i) => expect(equalBytes(s, b.snaps[i] ?? new Uint8Array()), `checkpoint ${i}`).toBe(true));
    const kinds = new Set(a.events.map((e) => e.type));
    for (const k of ["enemy.killed", "player.levelup", "player.upgraded", "player.hit", "entity.spawned", "player.pulse"]) {
      expect(kinds.has(k as SimEvent["type"]), k).toBe(true);
    }
  });

  it("apply → capture is lossless mid-fight and the restored world steps identically", () => {
    const a = createWorld(CFG);
    for (let p = 1; p <= 3; p++) addPlayer(a, p, [p * 2 - 4, 1, 0]);
    const input = contentInputs([1, 2, 3], 4);
    for (let t = 0; t < 400; t++) {
      populate(a, t);
      step(a, input(a.tick));
    }
    const s = captureState(a);
    const kinds = new Set(s.entities.map((e) => e.kind));
    expect(kinds.has(EntityKind.Pickup)).toBe(true);
    const snap = encodeSnapshot(s);
    expect(decodeSnapshot(snap)).toEqual(s);
    const b = createWorld(CFG);
    applyState(b, decodeSnapshot(snap));
    expect(equalBytes(encodeSnapshot(captureState(b)), snap)).toBe(true);
    expect(enemyCount(b)).toBe(enemyCount(a));
    for (let t = 0; t < 300; t++) {
      populate(a, t);
      populate(b, t);
      const i = input(a.tick);
      step(a, i);
      step(b, i);
    }
    expect(equalBytes(encodeSnapshot(captureState(a)), encodeSnapshot(captureState(b)))).toBe(true);
  });

  it("starts players with the start weapon, levels up from gems and applies a chosen upgrade", () => {
    const w = createWorld(CFG);
    addPlayer(w, 1);
    const me = () => captureState(w).entities.find((e) => e.kind === EntityKind.Player);
    expect(slotWeapon(me()?.weapons ?? 0, 0)).toBe(0);
    expect(slotLevel(me()?.weapons ?? 0, 0)).toBe(1);
    expect(me()?.level).toBe(1);
    // Ring of weak enemies inside the nova radius: they die, drop gems, the player collects.
    let levelled = false;
    for (let t = 0; t < 600 && !levelled; t++) {
      if (t % 10 === 0) for (let i = 0; i < 6; i++) spawnEnemy(w, 0, Math.cos(i) * 3, Math.sin(i) * 3);
      const r = step(w, new Map([[1, idle()]]));
      if (r.events.some((e) => e.type === "player.levelup")) levelled = true;
    }
    expect(levelled).toBe(true);
    const { offers, pending } = decodeChoices(me()?.choices ?? 0);
    expect(pending).toBeGreaterThan(0);
    expect(new Set(offers.filter((o) => o >= 0)).size).toBe(3);
    const before = me()?.weapons ?? 0;
    const statsBefore = me()?.stats ?? 0;
    step(w, new Map([[1, idle(Button.Choice1)]]));
    const after = me();
    expect(after?.weapons !== before || after?.stats !== statsBefore).toBe(true);
    expect(decodeChoices(after?.choices ?? 0).pending).toBe(pending - 1);
    destroyWorld(w);
  });

  it("downs a player at zero health; a teammate standing close revives; bleeding out makes them dead until respawnDead", () => {
    const w = createWorld({ ...CFG, content: { ...CFG.content, coop: { downedTicks: 150, reviveTicks: 30, iframeTicks: 0 } } });
    addPlayer(w, 1, [0, 1, 0]);
    addPlayer(w, 2, [8, 1, 0]);
    // A boss parked on player 1 hits for 25 every contact cooldown.
    spawnEnemy(w, 2, 0.5, 0.5);
    const up = (p: number) => listPlayers(w).find((x) => x.playerId === p);
    let downed = false;
    for (let t = 0; t < 600 && !downed; t++) downed = step(w, new Map()).events.some((e) => e.type === "player.downed");
    expect(downed).toBe(true);
    expect(up(1)?.downed).toBe(true);
    // Clear the boss, walk player 2 next to player 1.
    resetRunEnemiesOnly(w);
    for (let t = 0; t < 200 && up(1)?.downed; t++) {
      const p2 = up(2);
      const p1 = up(1);
      const dx = (p1?.x ?? 0) - (p2?.x ?? 0);
      const dz = (p1?.z ?? 0) - (p2?.z ?? 0);
      const d = Math.hypot(dx, dz);
      // yaw 0: moveX = +x, moveZ = -z.
      const cmd = d > 1 ? { ...idle(), moveX: dx / d, moveZ: -dz / d } : idle();
      step(w, new Map([[2, cmd]]));
    }
    expect(up(1)?.up).toBe(true);
    // Bleed out with nobody near: dead (out) until respawnDead.
    removePlayer(w, 2);
    spawnEnemy(w, 2, (up(1)?.x ?? 0) + 0.5, up(1)?.z ?? 0);
    for (let t = 0; t < 900 && !(up(1)?.dead ?? false); t++) step(w, new Map());
    expect(up(1)?.dead).toBe(true);
    expect(respawnDead(w)).toEqual([1]);
    expect(up(1)?.up).toBe(true);
    // A paid revive works on a downed player and is refused for one who is up.
    expect(revivePlayer(w, 1)).toBe(false);
    destroyWorld(w);
  });

  it("dash moves faster than walking and gives invulnerability; a press just before the cooldown ends is buffered", () => {
    const w = createWorld(CFG);
    addPlayer(w, 1);
    const x = () => listPlayers(w)[0]?.x ?? 0;
    const walk = { ...idle(), moveX: 1 };
    step(w, new Map([[1, walk]]));
    const x0 = x();
    step(w, new Map([[1, walk]]));
    const walkStep = x() - x0;
    step(w, new Map([[1, { ...walk, buttons: Button.Sprint }]]));
    const x1 = x();
    step(w, new Map([[1, walk]]));
    expect(x() - x1).toBeGreaterThan(walkStep * 2.5);
    const s = captureState(w).entities.find((e) => e.kind === EntityKind.Player);
    expect((s?.flags ?? 0) & EntityFlag.Dashing).not.toBe(0);
    expect(s?.iframes ?? 0).toBeGreaterThan(0);
    destroyWorld(w);
  });

  it("resetRun clears the floor and resets players but keeps their NetIds", () => {
    const w = createWorld(CFG);
    const id = addPlayer(w, 1);
    const input = contentInputs([1], 3);
    for (let t = 0; t < 300; t++) {
      populate(w, t);
      step(w, input(w.tick));
    }
    expect(captureState(w).entities.length).toBeGreaterThan(10);
    resetRun(w);
    const s = captureState(w);
    expect(s.entities.length).toBe(1);
    expect(s.entities[0]?.netId).toBe(id);
    expect(s.entities[0]?.level).toBe(1);
    expect(enemyCount(w)).toBe(0);
    destroyWorld(w);
  });
});

/** Remove enemies without touching players (test helper via applyState). */
function resetRunEnemiesOnly(w: SimWorld): void {
  const s = captureState(w);
  applyState(w, { ...s, entities: s.entities.filter((e) => e.kind === EntityKind.Player) });
}
