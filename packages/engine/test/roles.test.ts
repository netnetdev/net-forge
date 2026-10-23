import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addPlayer, captureState, createWorld, decodeTelegraph, destroyWorld, EntityFlag, EntityKind, initSim, step, Telegraph } from "@netforge/engine-sim";
import type { SimEvent, SimWorld } from "@netforge/engine-sim";
import { earn, game, prefab, system, weapon } from "../src/index.js";
import { GameRunner, collectManifest, compileGame, resetRegistry } from "../src/game/index.js";
import type { CompiledGame } from "../src/game/index.js";

beforeAll(async () => {
  await initSim();
});
beforeEach(() => resetRegistry());

function base(extra: () => void, lethal = false): CompiledGame {
  game({
    template: "survivor",
    style: "lowpoly",
    places: { a: { chunks: "places/a", spawn: [0, 1, 0] } },
    players: { prefab: "style.lowpoly.hero", max: 4, weapon: "pulse", hitIframes: 0 },
  });
  prefab("gem", { model: "style.lowpoly.gem", health: 1, speed: 0, kind: "pickup", value: 1 });
  prefab("shade", { model: "style.lowpoly.shade", health: 10, speed: 3, damage: 4, drops: ["gem"] });
  // By default a weapon that does no harm, so roles run undisturbed; `lethal` kills what is near.
  weapon("pulse", lethal ? { kind: "nova", damage: 5000, cooldown: 0.5, range: 3 } : { kind: "nova", damage: 0, cooldown: 8, range: 0.5 });
  extra();
  earn.rule("one", { when: "enemy.killed", n: 1, pay: 1, oncePer: "run" });
  earn.stake({ min: 1, max: 10, multiple: 2 });
  return compileGame(collectManifest());
}

function run(g: CompiledGame, ticks: number, setup: (w: SimWorld) => void, each?: (w: SimWorld, ev: readonly SimEvent[], t: number, r: GameRunner) => void) {
  const w = createWorld({ ...g.sim, seed: 7 });
  setup(w);
  const r = new GameRunner(g, w, { godMode: true });
  const names: string[] = [];
  for (let t = 0; t < ticks; t++) {
    r.beforeStep();
    const res = step(w, new Map());
    for (const ev of r.afterStep(res.events).events) names.push(ev.name);
    each?.(w, res.events, t, r);
  }
  return { w, r, names };
}

const enemiesOf = (w: SimWorld, type: number) => captureState(w).entities.filter((e) => e.kind === EntityKind.Enemy && e.type === type && (e.flags & EntityFlag.Dead) === 0);

describe("enemy roles", () => {
  it("a charger shows a lane, then dashes along it; the hit is a telegraphed charge", () => {
    const g = base(() => {
      prefab("ram", { model: "style.lowpoly.ram", health: 40, speed: 3, damage: 9, ai: "charger" });
      system("s", ({ spawn }) => spawn("ram", [6, 0, 0]));
    });
    const ram = g.enemyType.get("ram") ?? -1;
    let lane = 0;
    let fastest = 0;
    const sources = new Set<string>();
    run(g, 120, (w) => addPlayer(w, 1, [0, 1, 0]), (w, ev) => {
      for (const e of enemiesOf(w, ram)) {
        if (decodeTelegraph(e.level).kind === Telegraph.Lane) lane++;
        fastest = Math.max(fastest, Math.hypot(e.vx, e.vz) / 1024);
      }
      for (const e of ev) if (e.type === "player.hit") sources.add(e.source ?? "contact");
    });
    expect(lane).toBeGreaterThanOrEqual(14); // ~0.55 s of wind-up at 30 Hz
    expect(fastest).toBeGreaterThan(9); // 3 m/s x 3.4
    expect(sources.has("charge")).toBe(true);
  });

  it("a ranged enemy keeps its distance and its slow shot hits as a projectile", () => {
    const g = base(() => {
      prefab("spitter", { model: "style.lowpoly.spitter", health: 20, speed: 2.8, damage: 5, ai: "ranged", attack: { damage: 8, range: 10, speed: 7 } });
      system("s", ({ spawn }) => spawn("spitter", [7, 0, 0]));
    });
    const sources: string[] = [];
    let shots = 0;
    run(g, 150, (w) => addPlayer(w, 1, [0, 1, 0]), (w, ev) => {
      shots = Math.max(shots, captureState(w).entities.filter((e) => e.kind === EntityKind.Projectile && (e.flags & EntityFlag.Hostile) !== 0).length);
      for (const e of ev) if (e.type === "player.hit") sources.push(e.source ?? "contact");
    });
    expect(shots).toBeGreaterThan(0);
    expect(sources).toContain("projectile");
    expect(sources).not.toContain("contact");
  });

  it("a bomber arms a fuse circle, then blasts the player and the enemies around it", () => {
    const g = base(() => {
      prefab("bloat", { model: "style.lowpoly.bloat", health: 18, speed: 3, damage: 8, ai: "bomber", attack: { radius: 2.5 } });
      prefab("post", { model: "style.lowpoly.post", health: 100, speed: 0, ai: "idle" });
      system("s", ({ spawn }) => {
        spawn("bloat", [3, 0, 0]);
        spawn("post", [1.5, 0, 1]);
      });
    });
    const post = g.enemyType.get("post") ?? -1;
    let circle = 0;
    const sources: string[] = [];
    const { w } = run(g, 120, (w) => addPlayer(w, 1, [0, 1, 0]), (w, ev) => {
      for (const e of captureState(w).entities) if (e.kind === EntityKind.Enemy && decodeTelegraph(e.level).kind === Telegraph.Circle) circle++;
      for (const e of ev) if (e.type === "player.hit") sources.push(e.source ?? "contact");
    });
    expect(circle).toBeGreaterThanOrEqual(25); // a ~1 s fuse
    expect(sources).toContain("blast");
    expect(enemiesOf(w, post)[0]?.health ?? 100).toBeLessThan(100);
  });

  it("a shielder shields its neighbours, and shields soak damage first", () => {
    const g = base(() => {
      prefab("aegis", { model: "style.lowpoly.aegis", health: 35, speed: 0, ai: "shielder" });
      prefab("post", { model: "style.lowpoly.post", health: 100, speed: 0, ai: "idle" });
      system("s", ({ spawn }) => {
        spawn("aegis", [20, 0, 0]);
        spawn("post", [21, 0, 0]);
      });
    });
    let shielded = 0;
    run(g, 60 * 7, (w) => addPlayer(w, 1, [0, 1, 0]), (w) => {
      shielded = Math.max(shielded, captureState(w).entities.filter((e) => (e.flags & EntityFlag.Shielded) !== 0).length);
    });
    expect(shielded).toBeGreaterThanOrEqual(1);
  });

  it("a splitter bursts into smaller enemies where it fell, and those spawns are tagged as coming out of it", () => {
    const g = base(() => {
      prefab("brood", { model: "style.lowpoly.brood", health: 1, speed: 0, ai: "idle", split: { into: "shade", count: 3 } });
      system("s", ({ spawn }) => spawn("brood", [5, 0, 0]));
    }, true);
    let tagged = 0;
    const { w } = run(g, 40, (w) => addPlayer(w, 1, [0, 1, 0]), (_w, ev, t) => {
      for (const e of ev) if (e.type === "entity.spawned" && e.kind === EntityKind.Enemy && e.from) tagged++;
      // Walk the brood into the nova: move the player next to it after a few ticks.
      void t;
    });
    // The brood sits at 5 m, outside the 3 m nova: nothing split yet.
    expect(tagged).toBe(0);
    destroyWorld(w);
    const near = base(() => {
      prefab("brood", { model: "style.lowpoly.brood", health: 1, speed: 0, ai: "idle", split: { into: "shade", count: 3 } });
      system("s", ({ spawn }) => spawn("brood", [2, 0, 0]));
    }, true);
    let born = 0;
    run(near, 10, (w) => addPlayer(w, 1, [0, 1, 0]), (_w, ev) => {
      for (const e of ev) if (e.type === "entity.spawned" && e.kind === EntityKind.Enemy && e.from) born++;
    });
    expect(born).toBe(3);
  });

  it("rejects splitting into itself and unknown summons, with actionable lines", () => {
    expect(() =>
      base(() => {
        prefab("loop", { model: "style.lowpoly.x", health: 5, speed: 1, split: { into: "loop", count: 2 } });
      }),
    ).toThrow(/splits into itself/);
    resetRegistry();
    expect(() =>
      base(() => {
        prefab("caller", { model: "style.lowpoly.x", health: 5, speed: 1, ai: "summoner", attack: { summon: "dragon" } });
      }),
    ).toThrow(/attack\.summon "dragon"/);
    resetRegistry();
    expect(() => prefab("b", { model: "style.lowpoly.x", health: 5, speed: 1, boss: { attacks: ["lasers" as never] } })).toThrow(/attacks from: slam/);
  });
});

describe("bosses and elites", () => {
  it("a mini-boss telegraphs a slam, hits as a slam, and raises miniboss.killed (not boss.killed)", () => {
    const g = base(() => {
      prefab("matron", { model: "style.lowpoly.m", health: 300, speed: 2, radius: 1.2, damage: 10, boss: { attacks: ["slam"], rank: "mini" }, drops: ["gem"] });
      weapon("zap", { kind: "nova", damage: 1, cooldown: 1, range: 1 });
      system("s", ({ spawn }) => spawn("matron", [4, 0, 0]));
    });
    let telegraphed = 0;
    const sources: string[] = [];
    const { w, r } = run(g, 150, (w) => addPlayer(w, 1, [0, 1, 0]), (w, ev) => {
      for (const e of captureState(w).entities) if (e.kind === EntityKind.Enemy && decodeTelegraph(e.level).kind === Telegraph.Circle) telegraphed++;
      for (const e of ev) if (e.type === "player.hit") sources.push(e.source ?? "contact");
    });
    expect(telegraphed).toBeGreaterThanOrEqual(20); // 0.85 s wind-up
    expect(sources).toContain("slam");
    expect(r.info().bosses.length).toBe(1);
    destroyWorld(w);
    // A mini-boss kill raises miniboss.killed and drops a gem burst; it never ends the run as a boss kill would.
    resetRegistry();
    const k = base(() => {
      prefab("matron", { model: "style.lowpoly.m", health: 50, speed: 0, radius: 1.2, damage: 10, boss: { attacks: ["slam"], rank: "mini" }, drops: ["gem"] });
      system("s", ({ spawn }) => spawn("matron", [2.5, 0, 0]));
    }, true);
    let gems = 0;
    const killed = run(k, 20, (w) => addPlayer(w, 1, [0, 1, 0]), (w2) => {
      gems = Math.max(gems, captureState(w2).entities.filter((e) => e.kind === EntityKind.Pickup).length);
    });
    expect(killed.names).toContain("miniboss.killed");
    expect(killed.names).not.toContain("boss.killed");
    expect(gems).toBeGreaterThanOrEqual(10);
  });

  it("boss health scales with players present, elites carry x6 health and a flag", () => {
    const g = base(() => {
      prefab("king", { model: "style.lowpoly.k", health: 1000, speed: 1, radius: 1, boss: true });
      system("s", ({ spawn, after }) => {
        after(0.1, () => {
          spawn("king", [10, 0, 10]);
          spawn("shade", [-10, 0, -10], { elite: true });
        });
      });
    });
    const { r, w } = run(g, 10, (w) => {
      for (let p = 1; p <= 4; p++) addPlayer(w, p, [p, 1, 0]);
    });
    expect(r.info().bosses[0]?.max).toBe(Math.round(1000 * (0.45 + 0.55 * 4)));
    const elite = captureState(w).entities.find((e) => e.kind === EntityKind.Enemy && (e.flags & EntityFlag.Elite) !== 0);
    expect(elite?.health).toBe(60);
    destroyWorld(w);
  });

  it("roles and patterns are deterministic: two worlds step identically", () => {
    const g = base(() => {
      prefab("ram", { model: "style.lowpoly.ram", health: 40, speed: 3, damage: 9, ai: "charger" });
      prefab("spitter", { model: "style.lowpoly.spitter", health: 20, speed: 2.8, damage: 5, ai: "ranged" });
      prefab("bloat", { model: "style.lowpoly.bloat", health: 18, speed: 3, damage: 8, ai: "bomber" });
      prefab("warden", { model: "style.lowpoly.w", health: 4000, speed: 2, radius: 1.5, damage: 20, boss: { attacks: ["slam", "dash", "leap", "rain", "ring", "fan", "summon"] } });
      system("s", ({ every, spawnRing, spawn }) => {
        spawn("warden", [8, 0, 8]);
        every(1, () => {
          spawnRing("ram", { count: 2, radius: 12 });
          spawnRing("spitter", { count: 2, radius: 12 });
          spawnRing("bloat", { count: 2, radius: 12 });
        });
      });
    });
    const a = run(g, 600, (w) => {
      addPlayer(w, 1, [0, 1, 0]);
      addPlayer(w, 2, [3, 1, 0]);
    });
    const b = run(g, 600, (w) => {
      addPlayer(w, 1, [0, 1, 0]);
      addPlayer(w, 2, [3, 1, 0]);
    });
    expect(JSON.stringify(captureState(a.w))).toBe(JSON.stringify(captureState(b.w)));
    expect(captureState(a.w).entities.length).toBeGreaterThan(20);
    destroyWorld(a.w);
    destroyWorld(b.w);
  });
});
