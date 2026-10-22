import { beforeAll, describe, expect, it } from "vitest";
import {
  addPlayer,
  applyBeamHit,
  applyState,
  arenaHitboxes,
  ARENA_SPAWN_CLEAR,
  arenaSpawn,
  beamRange,
  beamShot,
  BOT_PLAYER_BASE,
  Button,
  captureState,
  createWorld,
  EntityFlag,
  EntityKind,
  grantUpgrade,
  initSim,
  listPickups,
  listPlayers,
  resolveConfig,
  selectedSlot,
  slotWeapon,
  step,
} from "../src/index.js";
import type { InputCommand, SimConfig, SimEvent, SimWorld } from "../src/index.js";

beforeAll(async () => {
  await initSim();
});

const SPAWNS: [number, number][] = [
  [-15, -15],
  [15, 15],
  [15, -15],
  [-15, 15],
];

/** A small arena shooter content set: a rifle, a scatter gun and a beam, two passives. */
function arenaConfig(over: { authority?: boolean; externalHitscan?: boolean } = {}): SimConfig {
  return {
    seed: 9,
    tickRate: 60,
    enemies: { target: 0 },
    arena: { halfExtent: 20, wallHeight: 3, pillars: [{ x: 6, z: -3, radius: 1.5, height: 3 }], spawn: [0, 1, 0] },
    content: {
      weapons: [
        { kind: "blaster", damage: 20, cooldownTicks: 10, range: 25, count: 1, speed: 40, pierce: 0, knockback: 0, maxLevel: 1 },
        { kind: "blaster", damage: 8, cooldownTicks: 40, range: 10, count: 5, speed: 30, pierce: 0, knockback: 0, maxLevel: 1, spread: 0.4 },
        { kind: "beam", damage: 50, cooldownTicks: 60, range: 30, count: 1, speed: 0, pierce: 0, knockback: 0, maxLevel: 1 },
      ],
      stats: [
        { stat: "maxHealth", step: 25, maxLevel: 1 },
        { stat: "speed", step: 0.1, maxLevel: 1 },
      ],
      progression: { startWeapon: 0, loadout: [0, 1, 2] },
      arena: { enabled: true, respawnTicks: 60, spawnIframeTicks: 30, spawns: SPAWNS, dropHeal: 25, ...over },
    },
  };
}

const cmd = (over: Partial<InputCommand> = {}): InputCommand => ({ seq: 0, tick: 0, moveX: 0, moveZ: 0, yaw: 0, buttons: 0, ...over });

function run(world: SimWorld, ticks: number, inputs: (t: number) => Map<number, InputCommand>): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) events.push(...step(world, inputs(t)).events);
  return events;
}

/** Does the segment (x0, z0)-(x1, z1) pass through the circle? */
function segmentHitsCircle(x0: number, z0: number, x1: number, z1: number, cx: number, cz: number, r: number): boolean {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const t = Math.max(0, Math.min(1, ((cx - x0) * dx + (cz - z0) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x0 + dx * t - cx, z0 + dz * t - cz) < r;
}

const player = (world: SimWorld, id: number) => {
  const p = listPlayers(world).find((x) => x.playerId === id);
  if (!p) throw new Error(`no player ${id}`);
  return p;
};
const entity = (world: SimWorld, owner: number) => {
  const e = captureState(world).entities.find((x) => x.kind === EntityKind.Player && x.owner === owner);
  if (!e) throw new Error(`no entity for ${owner}`);
  return e;
};

describe("arena mode (shooter template machinery)", () => {
  it("every player carries the loadout; Choice and Alt pick the slot", () => {
    const w = createWorld(arenaConfig());
    addPlayer(w, 1, [0, 1, 0]);
    const e = entity(w, 1);
    expect([0, 1, 2, 3].map((s) => slotWeapon(e.weapons, s))).toEqual([0, 1, 2, -1]);
    step(w, new Map([[1, cmd({ buttons: Button.Choice3 })]]));
    expect(selectedSlot(entity(w, 1).choices)).toBe(2);
    step(w, new Map([[1, cmd()]]));
    step(w, new Map([[1, cmd({ buttons: Button.Alt })]]));
    expect(selectedSlot(entity(w, 1).choices)).toBe(0);
  });

  it("moves in the world frame and aims with yaw", () => {
    const w = createWorld(arenaConfig());
    addPlayer(w, 1, [0, 1, 0]);
    run(w, 30, () => new Map([[1, cmd({ moveX: 1, yaw: Math.PI / 2 })]]));
    const p = player(w, 1);
    expect(p.x).toBeGreaterThan(2);
    expect(Math.abs(p.z)).toBeLessThan(0.05);
    expect(entity(w, 1).yaw).toBeGreaterThan(16000);
  });

  it("a blaster kills an opponent in front: kill credit, a heal cell drops, respawn far from the killer", () => {
    const w = createWorld(arenaConfig());
    addPlayer(w, 1, [0, 1, 0]);
    addPlayer(w, 2, [0, 1, -8]);
    // yaw 0 aims down -z, at player 2.
    const events = run(w, 90, () => new Map([[1, cmd({ buttons: Button.Fire })]]));
    const hits = events.filter((e) => e.type === "player.hit" && e.playerId === 2);
    expect(hits.length).toBeGreaterThanOrEqual(5);
    const kill = events.find((e) => e.type === "player.killed");
    expect(kill).toMatchObject({ type: "player.killed", playerId: 2, by: 1 });
    expect(events.filter((e) => e.type === "player.shot").length).toBeGreaterThan(5);
    expect(listPickups(w).some((g) => g.value === 25)).toBe(true);
    // Respawn after respawnTicks, at a spawn point player 1 cannot see and at least ARENA_SPAWN_CLEAR m away, protected.
    run(w, 70, () => new Map());
    const p2 = player(w, 2);
    expect(p2.up).toBe(true);
    expect(p2.health).toBe(100);
    const p1 = player(w, 1);
    expect(Math.hypot(p2.x - p1.x, p2.z - p1.z)).toBeGreaterThanOrEqual(ARENA_SPAWN_CLEAR);
    // Every declared spawn is in plain sight of player 1 here, so the floor point picked hides behind the pillar (6, -3).
    expect(segmentHitsCircle(p1.x, p1.z, p2.x, p2.z, 6, -3, 1.5)).toBe(true);
  });

  it("joining is protected like a respawn, and firing ends it", () => {
    const w = createWorld(arenaConfig());
    addPlayer(w, 1, [0, 1, 0]);
    addPlayer(w, 2, [0, 1, -8]);
    expect(entity(w, 2).iframes).toBe(30);
    // Player 1 shoots at once: player 2 takes nothing while protected, and player 1's own protection is gone.
    const early = run(w, 20, () => new Map([[1, cmd({ buttons: Button.Fire })]]));
    expect(early.some((e) => e.type === "player.hit" && e.playerId === 2)).toBe(false);
    expect(entity(w, 1).iframes).toBe(0);
    const later = run(w, 40, () => new Map([[1, cmd({ buttons: Button.Fire })]]));
    expect(later.some((e) => e.type === "player.hit" && e.playerId === 2)).toBe(true);
  });

  it("respawns out of every opponent's sight: a pillar between them counts as cover", () => {
    // Pillar at (6, -3), radius 1.5. Opponents watch three spawns; the fourth (15, -15) is hidden from both behind the pillar or too far.
    const w = createWorld(arenaConfig());
    addPlayer(w, 2, [0, 1, 0]);
    addPlayer(w, 3, [0, 1, 8]);
    const [x, z] = arenaSpawn(w, 1);
    for (const p of [player(w, 2), player(w, 3)]) expect(Math.hypot(x - p.x, z - p.z)).toBeGreaterThanOrEqual(ARENA_SPAWN_CLEAR);
    // A lone opponent standing right at a spawn pushes everyone elsewhere.
    const w2 = createWorld(arenaConfig());
    addPlayer(w2, 2, [15, 1, 15]);
    const [x2, z2] = arenaSpawn(w2, 1);
    expect(x2 === 15 && z2 === 15).toBe(false);
    expect(Math.hypot(x2 - 15, z2 - 15)).toBeGreaterThanOrEqual(ARENA_SPAWN_CLEAR);
  });

  it("projectiles stop at pillars and never hurt their owner", () => {
    const w = createWorld(arenaConfig());
    addPlayer(w, 1, [6, 1, 3]);
    addPlayer(w, 2, [6, 1, -9]);
    // Pillar at (6, -3) sits between them.
    const events = run(w, 60, () => new Map([[1, cmd({ buttons: Button.Fire })]]));
    expect(events.some((e) => e.type === "player.hit")).toBe(false);
    expect(player(w, 1).health).toBe(100);
  });

  it("a beam in the sim (harness, bots) hits at once; beamRange stops at the pillar", () => {
    const w = createWorld(arenaConfig());
    addPlayer(w, 1, [0, 1, 0]);
    addPlayer(w, 2, [0, 1, -12]);
    run(w, 30, () => new Map()); // spawn protection runs out
    step(w, new Map([[1, cmd({ buttons: Button.Choice3 })]]));
    step(w, new Map([[1, cmd()]]));
    const ev = step(w, new Map([[1, cmd({ buttons: Button.Fire })]])).events;
    expect(ev.find((e) => e.type === "player.hit")).toMatchObject({ playerId: 2, damage: 50 });
    const cfg = resolveConfig(arenaConfig());
    expect(beamRange(cfg, 6, 3, 0, -1, 30)).toBeCloseTo(4.5, 3);
    expect(beamRange(cfg, 0, 0, 1, 0, 30)).toBeCloseTo(20, 3);
  });

  it("on a room server human beams wait for the lag-compensated hit; bots resolve in the sim", () => {
    const w = createWorld(arenaConfig({ externalHitscan: true }));
    addPlayer(w, 1, [0, 1, 0]);
    addPlayer(w, 2, [0, 1, -12]);
    addPlayer(w, BOT_PLAYER_BASE, [8, 1, 0]);
    run(w, 30, () => new Map()); // spawn protection runs out
    step(w, new Map([[1, cmd({ buttons: Button.Choice3 })], [BOT_PLAYER_BASE, cmd({ buttons: Button.Choice3 })]]));
    step(w, new Map());
    const fire = cmd({ buttons: Button.Fire });
    const shot = beamShot(w, 1, fire);
    expect(shot).toMatchObject({ shooter: 1, damage: 50 });
    expect(beamShot(w, BOT_PLAYER_BASE, fire)).toBeNull();
    // The step fires (cooldown, shot event) but does not resolve the human's beam itself.
    const botAim = cmd({ buttons: Button.Fire, yaw: Math.PI / 2 }); // bot at x=8 aims -x, at player 1
    const ev = step(w, new Map([[1, fire], [BOT_PLAYER_BASE, botAim]])).events;
    expect(ev.some((e) => e.type === "player.shot" && e.playerId === 1)).toBe(true);
    expect(ev.some((e) => e.type === "player.hit" && e.playerId === 2)).toBe(false);
    expect(ev.find((e) => e.type === "player.hit" && e.playerId === 1)).toMatchObject({ damage: 50 });
    // The room's rewind found player 2: apply it; the events come out of the next step.
    const target = arenaHitboxes(w).find((h) => h.owner === 2);
    expect(target).toBeDefined();
    if (!shot || !target) return;
    applyBeamHit(w, shot, target.netId);
    const after = step(w, new Map()).events;
    expect(after.find((e) => e.type === "player.hit" && e.playerId === 2)).toMatchObject({ damage: 50 });
    // Cooldown: the same input does not fire again at once.
    expect(beamShot(w, 1, fire)).toBeNull();
  });

  it("a predicting client (no authority) reproduces its own movement, aim, weapon and cooldowns exactly", () => {
    const server = createWorld(arenaConfig({ externalHitscan: true }));
    const client = createWorld(arenaConfig({ authority: false }));
    addPlayer(server, 1, [0, 1, 0]);
    addPlayer(server, 2, [5, 1, -5]);
    addPlayer(client, 1, [0, 1, 0]);
    const input = (t: number) =>
      cmd({
        moveX: Math.cos(t / 20),
        moveZ: Math.sin(t / 31),
        yaw: t / 15,
        buttons: Button.Fire | (t % 50 === 0 ? Button.Alt : 0) | (t % 70 === 0 ? Button.Sprint : 0),
      });
    for (let t = 0; t < 300; t++) {
      step(server, new Map([[1, input(t)], [2, cmd()]]));
      step(client, new Map([[1, input(t)]]));
    }
    const a = entity(server, 1);
    const b = entity(client, 1);
    for (const k of ["px", "pz", "yaw", "wcd", "choices", "dash", "weapons"] as const) expect(b[k]).toBe(a[k]);
    expect(captureState(client).entities.filter((e) => e.kind === EntityKind.Projectile)).toHaveLength(0);
  });

  it("restoring a snapshot mid-fight continues identically", () => {
    const inputs = (t: number) =>
      new Map([
        [1, cmd({ moveX: Math.sin(t / 13), moveZ: Math.cos(t / 17), yaw: Math.PI + Math.sin(t / 40), buttons: Button.Fire | (t % 90 === 0 ? Button.Alt : 0) })],
        [2, cmd({ moveX: Math.cos(t / 11), moveZ: -Math.sin(t / 19), yaw: Math.sin(t / 30), buttons: Button.Fire })],
      ]);
    const a = createWorld(arenaConfig());
    addPlayer(a, 1, [0, 1, -6]);
    addPlayer(a, 2, [0, 1, 6]);
    run(a, 200, inputs);
    const b = createWorld(arenaConfig());
    applyState(b, captureState(a));
    for (let t = 200; t < 500; t++) {
      step(a, inputs(t));
      step(b, inputs(t));
    }
    expect(JSON.stringify(captureState(b))).toBe(JSON.stringify(captureState(a)));
  });

  it("store upgrades grant a passive level for the run; spawn points avoid opponents", () => {
    const w = createWorld(arenaConfig());
    addPlayer(w, 1, [14, 1, 14]);
    expect(grantUpgrade(w, 1, 0)).toBe(true);
    expect(player(w, 1).maxHealth).toBe(125);
    expect(player(w, 1).health).toBe(125);
    expect(grantUpgrade(w, 1, 0)).toBe(false);
    const [x, z] = arenaSpawn(w, 2);
    expect([x, z]).toEqual([-15, -15]);
    expect((captureState(w).entities[0]?.flags ?? 0) & EntityFlag.Dead).toBe(0);
  });
});
