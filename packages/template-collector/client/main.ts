/**
 * MOSSBOUND client: pick a starter at camp, walk the marsh (WASD, arrows or
 * the left thumb), meet wild spirits in the tall grass, fight them turn by
 * turn, snare the ones worth keeping, and bring down the Fenwarden with
 * everyone else before dusk. Your keeper is predicted, so walking never
 * waits for the server; every roll is the room's.
 *
 * URL parameters: see @netforge/tabletop boot.ts (?room, ?server,
 * ?style, ?autopilot, ?preview, ?stats, ?shapes, ?webgl, Net Forge flags).
 */
import { AdditiveBlending, CanvasTexture, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, NearestFilter, PlaneGeometry, RingGeometry, SRGBColorSpace } from "three/webgpu";
import type { InterpolatedEntity } from "@netforge/engine/net";
import { CollectorAct, effectiveness, LogKind, MARSH_TILE, marshCenter, marshRoute, marshTile, RF, RulesKind, UNITS } from "@netforge/engine/rules";
import type { LogLine, RulesInput } from "@netforge/engine/rules";
import { bootBoard, cssColor, type BoardView, type Placed } from "@netforge/tabletop";
import { collectorAdapter, collectorGame, collectorManifest, COSMETICS, GAME_VERSION, PLACE, TEMPLATE } from "../src/manifest.js";
import { MOSSBOUND_COIN } from "../src/store.js";
import { FIRE_MODEL, MOUND_MODEL, REED_MODEL, ROCK_MODEL, SMALL_DECOR, TENT_MODEL, TREE_MODELS } from "./decor.js";
import { KEEPER_COLORS, RULE_NAMES, SKU_NAMES, TITLE, UPGRADE_NAMES, WEAPON_NAMES } from "./names.js";

interface MonView {
  readonly species: number;
  readonly level: number;
  readonly hp: number;
  readonly max: number;
  readonly xp: number;
  readonly next: number;
}

interface CollectorView extends BoardView {
  readonly dusk: number;
  readonly warden: { hp: number; max: number; down: boolean; fighting: number };
  readonly players: readonly { id: number; catches: number; level: number; battling: boolean }[];
  readonly team?: readonly MonView[];
  readonly active?: number;
  readonly box?: number;
  readonly snares?: number;
  readonly picked?: boolean;
  readonly battle?: { foe: MonView; warden: boolean; turn: number } | null;
  readonly log?: readonly LogLine[];
  readonly catches?: number;
}

const genre = collectorGame();
const g = genre.game;
const map = g.map;
const manifest = collectorManifest();
const W = map.w * MARSH_TILE;
const H = map.h * MARSH_TILE;
const ELEMENT_COLOR = [0x7bd96a, 0x4fb6ff, 0xffd84a, 0xb59a7a];
const ELEMENT_NAME = ["Root", "Tide", "Spark", "Stone"];
const FINISH = [0x6d5a3a, 0x7fa86a, 0xffb347];
const nameOf = (species: number) => {
  const c = g.creatures[species];
  return c ? (WEAPON_NAMES[c.id]?.name ?? c.id) : "?";
};
const moveName = (i: number) => (g.moves[i]?.id ?? "").split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
const m = (e: InterpolatedEntity, f: number) => (e.values[f] ?? 0) / UNITS;

// The browser's autopilot (?autopilot=1): the genre's own playtest habits over what this page can see.
let lastView: CollectorView | null = null;
let selfPos = { x: 0, z: 0 };
let route: { goal: number; path: number[]; until: number } | null = null;
const autopilot = (tick: number): RulesInput | null => {
  const v = lastView;
  const idle: RulesInput = { mx: 0, mz: 0, cx: 0, cz: 0, act: 0, a: 0, b: 0, c: 0 };
  if (!v) return null;
  if (!v.picked) return tick % 30 === 0 ? { ...idle, act: CollectorAct.Pick, a: tick % g.starters.length } : idle;
  const b = v.battle;
  const team = v.team ?? [];
  if (b) {
    if (tick % 20 !== 0) return idle;
    const mine = team[v.active ?? 0];
    const c = mine ? g.creatures[mine.species] : undefined;
    if (!mine || !c) return idle;
    if (!b.warden && (v.snares ?? 0) > 0 && b.foe.hp < b.foe.max * 0.5) return { ...idle, act: CollectorAct.Snare };
    let best = 0;
    let score = -1;
    c.moveIdx.forEach((mi, j) => {
      const mv = g.moves[mi];
      const foe = g.creatures[b.foe.species];
      if (!mv || !foe) return;
      const eff = effectiveness(mv.el, foe.el);
      const val = mv.effect === "heal" ? (mine.hp < mine.max * 0.4 ? 999 : 0) : mv.power * (eff > 0 ? 1.5 : eff < 0 ? 0.67 : 1);
      if (val > score) {
        score = val;
        best = j;
      }
    });
    return { ...idle, act: CollectorAct.Move, a: best };
  }
  const here = marshTile(map, selfPos.x * UNITS, selfPos.z * UNITS);
  const level = team.reduce((a, x) => Math.max(a, x.level), 0);
  const hurt = team.reduce((a, x) => a + x.hp, 0) < team.reduce((a, x) => a + x.max, 0) * 0.45;
  let goal: number;
  const wardenGoal = map.warden[1] * map.w + map.warden[0];
  if (!v.warden.down && level >= g.marsh.warden.level - 1 && !hurt) {
    goal = wardenGoal;
    const wc = marshCenter(map, map.warden[0], map.warden[1]);
    if (Math.hypot(wc.x / UNITS - selfPos.x, wc.z / UNITS - selfPos.z) < 4.5 && tick % 15 === 0) return { ...idle, act: CollectorAct.Challenge };
  } else if (hurt) goal = map.camp[1] * map.w + map.camp[0];
  else {
    const tiles: number[] = [];
    for (let t = 0; t < map.grass.length; t++) if (map.grass[t] && !map.blocked[t]) tiles.push(t);
    goal = tiles[(Math.floor(tick / 120) * 2654435761) % Math.max(1, tiles.length)] ?? here;
  }
  if (!route || route.goal !== goal || tick >= route.until || route.path.length === 0) route = { goal, path: here >= 0 ? marshRoute(map, here, goal) : [], until: tick + 90 };
  while (route.path.length > 0 && route.path[0] === here) route.path.shift();
  const next = route.path[0] ?? goal;
  const c = marshCenter(map, next % map.w, Math.floor(next / map.w));
  const dx = c.x / UNITS - selfPos.x;
  const dz = c.z / UNITS - selfPos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.1) return idle;
  return { ...idle, mx: Math.round((dx / d) * 127), mz: Math.round((dz / d) * 127) };
};

async function main(): Promise<void> {
  const app = await bootBoard({
    adapter: collectorAdapter(),
    manifest,
    template: TEMPLATE,
    place: PLACE,
    version: GAME_VERSION,
    labels: {
      title: TITLE,
      rules: RULE_NAMES,
      skus: SKU_NAMES,
      upgrades: UPGRADE_NAMES,
      loading: "Lighting the reed lanterns",
      help: "WASD walk · in battle 1-4 moves, S snare, F flee, Tab swap · E challenge the warden · ` stats",
    },
    theme: {
      accent: "#9de07a",
      gold: "#ffd76a",
      ink: "#eef6e4",
      dim: "#a6b79a",
      panel: "rgba(18, 32, 22, 0.86)",
      bg: "#101a12",
      font: '"Gill Sans", "Trebuchet MS", system-ui, sans-serif',
      display: '"Palatino Linotype", Georgia, serif',
      radius: 10,
    },
    coin: MOSSBOUND_COIN,
    cosmetics: COSMETICS,
    swatch: (c) => `linear-gradient(135deg, ${cssColor(FINISH[c] ?? 0x6d5a3a)}, #1c2a18)`,
    ground: { w: 26, h: 16 },
    preset: "day",
    theme3d: "meadow",
    groundColor: 0x3d5a2e,
    pitch: 0.95,
    autopilot,
    soundKey: "mossbound:sound",
  });
  const { stage, hud, clock, sfx } = app;
  sfx.define("snare", { wave: "triangle", f0: 520, f1: 1560, ms: 320, gain: 0.6 }, { minGapMs: 200, voices: 1, pitchVar: 0 });
  sfx.define("slip", { wave: "sawtooth", f0: 600, f1: 200, ms: 220, gain: 0.4 }, { minGapMs: 150, voices: 1 });
  sfx.define("rustle", { wave: "noise", f0: 1800, f1: 600, ms: 260, gain: 0.35 }, { minGapMs: 300, voices: 1 });

  // ---- The marsh: one painted plate (meadow, tall grass, mud), water, reeds, rocks and trees, the camp, the mound.
  const plate = new Mesh(new PlaneGeometry(W, H, map.w * 2, map.h * 2), new MeshStandardMaterial({ map: marshTexture(), roughness: 0.95, metalness: 0 }));
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = stage.groundAt(0, 0) + 0.03;
  plate.receiveShadow = true;
  stage.add(plate);
  const waterMat = new MeshStandardMaterial({ color: 0x3b7fa8, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.85 });
  for (const [x, y, w, h] of g.marsh.water) {
    const water = new Mesh(new PlaneGeometry(w * MARSH_TILE, h * MARSH_TILE), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set((x + w / 2 - map.w / 2) * MARSH_TILE, plate.position.y + 0.06, (y + h / 2 - map.h / 2) * MARSH_TILE);
    stage.add(water);
  }
  const at = (tx: number, ty: number) => ({ x: (tx + 0.5 - map.w / 2) * MARSH_TILE, z: (ty + 0.5 - map.h / 2) * MARSH_TILE });
  // Reeds over the tall grass, rocks and trees on the blocked tiles: instanced, one draw a model.
  const reeds: { x: number; z: number; yaw: number; s: number }[] = [];
  const rocks: { x: number; z: number; yaw: number; s: number }[] = [];
  const trees: { x: number; z: number; yaw: number; s: number }[][] = TREE_MODELS.map(() => []);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let t = 0; t < map.w * map.h; t++) {
    const p = at(t % map.w, Math.floor(t / map.w));
    if (map.grass[t]) for (let k = 0; k < 2; k++) reeds.push({ x: p.x + (rnd() - 0.5) * 1.6, z: p.z + (rnd() - 0.5) * 1.6, yaw: rnd() * 6.28, s: 0.5 + rnd() * 0.35 });
    if (map.blocked[t] && !map.water[t]) {
      if (rnd() < 0.5) rocks.push({ x: p.x, z: p.z, yaw: rnd() * 6.28, s: 0.8 + rnd() * 0.4 });
      else trees[Math.floor(rnd() * trees.length)]?.push({ x: p.x, z: p.z, yaw: rnd() * 6.28, s: 0.8 + rnd() * 0.4 });
    }
  }
  // The land past the marsh's edge: a ring of trees and small things.
  const small: { x: number; z: number; yaw: number; s: number }[][] = SMALL_DECOR.map(() => []);
  for (let i = 0; i < 90; i++) {
    const side = rnd() * 4;
    const t = rnd() * 2 - 1;
    const out = 1.5 + rnd() * 8;
    const x = side < 1 ? -W / 2 - out : side < 2 ? W / 2 + out : t * (W / 2 + 8);
    const z = side < 2 ? t * (H / 2 + 8) : side < 3 ? -H / 2 - out : H / 2 + out;
    (i % 3 === 0 ? small[i % small.length] : trees[i % trees.length])?.push({ x, z, yaw: rnd() * 6.28, s: 0.8 + rnd() * 0.5 });
  }
  const scatter = [
    { crowd: stage.crowd(REED_MODEL, 0.7, reeds.length, 0x6f9a4a), at: reeds },
    { crowd: stage.crowd(ROCK_MODEL, 1.6, Math.max(1, rocks.length), 0x8a8478), at: rocks },
    ...TREE_MODELS.map((id, i) => ({ crowd: stage.crowd(id, 4, Math.max(1, trees[i]?.length ?? 1), 0x3f6a34), at: trees[i] ?? [] })),
    ...SMALL_DECOR.map((id, i) => ({ crowd: stage.crowd(id, 0.6, Math.max(1, small[i]?.length ?? 1), 0x9a6a4a), at: small[i] ?? [] })),
  ];
  const camp = at(map.camp[0], map.camp[1]);
  const tent = stage.model(TENT_MODEL, 2.2, 0xa0805a);
  tent.root.position.set(camp.x - 1.6, 0, camp.z - 1.4);
  const fire = stage.model(FIRE_MODEL, 0.7, 0xff9a3c);
  fire.root.position.set(camp.x + 0.6, 0, camp.z - 0.4);
  stage.add(tent.root, fire.root);
  const glow = new Mesh(new CylinderGeometry(1, 1, 0.04, 24), new MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false }));
  glow.position.set(camp.x, 0.08, camp.z);
  glow.scale.setScalar(3);
  stage.add(glow);
  const wardenAt = at(map.warden[0], map.warden[1]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const stone = stage.model(MOUND_MODEL, 1.8, 0x8a8478);
    stone.root.position.set(wardenAt.x + Math.cos(a) * 3.2, 0, wardenAt.z + Math.sin(a) * 3.2);
    stone.root.rotation.y = a;
    stage.add(stone.root);
  }
  stage.frameRect(camp.x + 6, camp.z, 26, 16);

  // ---- Keepers (one character each) and creatures (one model each: companions, wild foes, the warden).
  const keepers = new Map<number, { root: Group; ring: Mesh }>();
  const keeperFor = (owner: number) => {
    let k = keepers.get(owner);
    if (k) return k;
    const root = new Group();
    const model = stage.model(manifest.game.players.prefab, 1.7, KEEPER_COLORS[(owner - 1) % KEEPER_COLORS.length]);
    root.add(model.root);
    const ring = new Mesh(new RingGeometry(0.45, 0.62, 24), new MeshBasicMaterial({ color: KEEPER_COLORS[(owner - 1) % KEEPER_COLORS.length] ?? 0xffffff, side: DoubleSide, transparent: true, opacity: 0.85 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    root.add(ring);
    stage.add(root);
    k = { root, ring };
    keepers.set(owner, k);
    return k;
  };
  const creatures = new Map<number, { species: number; placed: Placed; hp: number; x: number; z: number }>();
  const creatureFor = (id: number, species: number) => {
    let c = creatures.get(id);
    if (c && c.species === species) return c;
    if (c) stage.scene.remove(c.placed.root);
    const def = g.creatures[species];
    const placed = stage.model(def?.model ?? "style.lowpoly.frog", (def?.size ?? 1) * 0.8, ELEMENT_COLOR[def?.el ?? 0], (def?.size ?? 1) * 1.1);
    stage.add(placed.root);
    stage.burst("magic", 0, 0, 0, 0, 0);
    c = { species, placed, hp: -1, x: 0, z: 0 };
    creatures.set(id, c);
    return c;
  };

  // ---- HUD: the team, the battle panel, the starter pick, the warden's call.
  const style = document.createElement("style");
  style.textContent = `
#team { left: 12px; bottom: max(12px, env(safe-area-inset-bottom)); display: flex; gap: 6px; }
#team .mon { width: 128px; padding: 6px 8px; border-radius: var(--r); background: var(--panel); border: 1px solid rgba(255,255,255,0.08); font-size: 12px; }
#team .mon.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
#team .mon.out { opacity: 0.45; }
#team .mon b { display: block; font-size: 13px; }
.hp { height: 6px; border-radius: 3px; background: rgba(0,0,0,0.45); overflow: hidden; margin-top: 4px; }
.hp > i { display: block; height: 100%; background: linear-gradient(90deg, #7bd96a, #c6f27a); transform-origin: left; }
.hp.low > i { background: linear-gradient(90deg, #ff5a3c, #ffb347); }
.xp { height: 3px; margin-top: 3px; background: rgba(255,255,255,0.08); }
.xp > i { display: block; height: 100%; background: var(--gold); transform-origin: left; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
#battle { left: 50%; bottom: max(12px, env(safe-area-inset-bottom)); transform: translateX(-50%); width: min(560px, 94vw); display: none; pointer-events: auto; background: var(--panel); border: 1px solid var(--line); border-radius: calc(var(--r) * 1.4); padding: 10px 12px; }
#battle.show { display: block; }
#battle .foe { display: flex; justify-content: space-between; align-items: baseline; font: 700 15px var(--display, inherit); }
#battle .log { margin: 8px 0; min-height: 50px; font-size: 13px; color: var(--dim); display: grid; gap: 2px; }
#battle .log div:last-child { color: var(--ink); }
#battle .moves { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
#battle .moves button { text-align: left; }
#battle .moves small { color: var(--dim); margin-left: 6px; }
#battle .row { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
#pick { inset: 0; display: none; place-items: center; background: rgba(6, 12, 8, 0.6); pointer-events: auto; z-index: 7; }
#pick.show { display: grid; }
#pick .box { text-align: center; }
#pick h2 { font: 900 24px var(--display, inherit); letter-spacing: 0.12em; color: var(--accent); margin: 0 0 12px; }
#pick .cards { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
#pick button { width: 160px; padding: 14px 10px; display: grid; gap: 4px; }
#pick button b { font-size: 16px; }
#pick button small { color: var(--dim); }
#call { left: 50%; bottom: max(120px, calc(env(safe-area-inset-bottom) + 110px)); transform: translateX(-50%); display: none; }
#call.show { display: block; }
#wardenbar { top: max(12px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%); width: min(340px, 44vw); text-align: center; font: 800 11px var(--display, inherit); letter-spacing: 0.2em; color: #ffd0a0; }
#wardenbar > div { height: 8px; margin-top: 4px; background: rgba(0,0,0,0.5); border-radius: 3px; overflow: hidden; }
#wardenbar > div > i { display: block; height: 100%; background: linear-gradient(90deg, #b56a3c, #ffd76a); transform-origin: left; }
#stickzone { position: fixed; left: 0; top: 30%; bottom: 0; width: 45%; z-index: 3; touch-action: none; display: none; }
@media (pointer: coarse) { #stickzone { display: block; } }
@media (max-height: 500px) { #team .mon { width: 104px; padding: 4px 6px; } #battle { padding: 6px 8px; } #battle .log { min-height: 0; } #battle .log div:not(:last-child) { display: none; } }
`;
  document.head.append(style);
  const el = (id: string, cls = "hud") => {
    const d = document.createElement("div");
    d.id = id;
    d.className = cls;
    document.body.append(d);
    return d;
  };
  const teamEl = el("team");
  const battleEl = el("battle");
  const pickEl = el("pick");
  const callEl = el("call");
  const wardenEl = el("wardenbar");
  const stickZone = el("stickzone", "");
  wardenEl.innerHTML = `<span>${(WEAPON_NAMES[g.marsh.warden.creature]?.name ?? "Warden").toUpperCase()}</span><div><i></i></div>`;
  const callBtn = document.createElement("button");
  callBtn.className = "go";
  callBtn.textContent = `Challenge the ${WEAPON_NAMES[g.marsh.warden.creature]?.name ?? "warden"}`;
  callBtn.addEventListener("click", () => clock.act(CollectorAct.Challenge));
  callEl.append(callBtn);
  pickEl.innerHTML = `<div class="box"><h2>CHOOSE YOUR FIRST SPIRIT</h2><div class="cards"></div></div>`;
  g.starters.forEach((species, i) => {
    const c = g.creatures[species];
    const b = document.createElement("button");
    b.innerHTML = `<b></b><span></span><small></small>`;
    (b.querySelector("b") as HTMLElement).textContent = nameOf(species);
    (b.querySelector("span") as HTMLElement).innerHTML = `<i class="dot" style="background:${cssColor(ELEMENT_COLOR[c?.el ?? 0] ?? 0)}"></i>${ELEMENT_NAME[c?.el ?? 0] ?? ""}`;
    (b.querySelector("small") as HTMLElement).textContent = WEAPON_NAMES[c?.id ?? ""]?.line ?? "";
    b.addEventListener("click", () => {
      sfx.unlock();
      clock.act(CollectorAct.Pick, i);
      sfx.play("pick");
    });
    pickEl.querySelector(".cards")?.append(b);
  });

  // ---- Walking: keys, or the left thumb on a phone.
  const keys = new Set<string>();
  addEventListener("keydown", (e) => {
    keys.add(e.code);
    const v = lastView;
    if (v?.battle) {
      const n = Number(e.key);
      if (n >= 1 && n <= 4) clock.act(CollectorAct.Move, n - 1);
      if (e.code === "KeyS") clock.act(CollectorAct.Snare);
      if (e.code === "KeyF") clock.act(CollectorAct.Flee);
      if (e.code === "Tab") {
        e.preventDefault();
        const team = v.team ?? [];
        const next = team.findIndex((x, i) => i !== v.active && x.hp > 0);
        if (next >= 0) clock.act(CollectorAct.Swap, next);
      }
    } else if (e.code === "KeyE") clock.act(CollectorAct.Challenge);
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());
  let thumb: { id: number; x: number; y: number; dx: number; dy: number } | null = null;
  stickZone.addEventListener("pointerdown", (e) => {
    sfx.unlock();
    thumb = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
    stickZone.setPointerCapture(e.pointerId);
  });
  stickZone.addEventListener("pointermove", (e) => {
    if (!thumb || e.pointerId !== thumb.id) return;
    thumb.dx = Math.max(-1, Math.min(1, (e.clientX - thumb.x) / 50));
    thumb.dy = Math.max(-1, Math.min(1, (e.clientY - thumb.y) / 50));
  });
  const endThumb = () => (thumb = null);
  stickZone.addEventListener("pointerup", endThumb);
  stickZone.addEventListener("pointercancel", endThumb);

  // ---- Every frame.
  let seenLog = 0;
  let seenFoe = false;
  const hpBar = (hp: number, max: number) => `<div class="hp${hp < max * 0.3 ? " low" : ""}"><i style="transform:scaleX(${Math.max(0, Math.min(1, hp / Math.max(1, max)))})"></i></div>`;
  app.loop((dt, now) => {
    const conn = app.conn();
    const v = app.view<CollectorView>();
    lastView = v;
    const view = conn.net.render(now);
    const t = now / 1000;
    const inBattle = !!v?.battle;
    // The stick: keys or thumb, never in a battle (the room ignores walking there and so does the prediction).
    let sx = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    let sz = (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);
    if (thumb) {
      sx = thumb.dx;
      sz = thumb.dy;
    }
    if (inBattle || !v?.picked) {
      sx = 0;
      sz = 0;
    }
    const len = Math.hypot(sx, sz);
    clock.stick(len > 1 ? sx / len : sx, len > 1 ? sz / len : sz);

    // Keepers: ours predicted, the others interpolated.
    const seen = new Set<number>();
    const place = (e: InterpolatedEntity | undefined, owner: number) => {
      if (!e) return;
      seen.add(owner);
      const k = keeperFor(owner);
      const x = m(e, RF.x);
      const z = m(e, RF.z);
      k.root.position.set(x, stage.groundAt(x, z) + 0.03, z);
      k.root.rotation.y = e.values[RF.yaw] ?? 0;
      if (owner === app.self) selfPos = { x, z };
    };
    place(view.self, app.self);
    for (const e of view.others) if (e.kind === RulesKind.Avatar) place(e, e.owner);
    for (const [owner, k] of keepers) {
      if (seen.has(owner)) continue;
      stage.scene.remove(k.root);
      keepers.delete(owner);
    }
    // Creatures: companions, foes beside battling keepers, the warden on its mound.
    const live = new Set<number>();
    let foePos: { x: number; z: number } | null = null;
    let minePos: { x: number; z: number } | null = null;
    for (const e of view.others) {
      if (e.kind !== RulesKind.Unit && e.kind !== RulesKind.Structure) continue;
      live.add(e.id);
      const species = Math.round(e.values[RF.type] ?? 0);
      const c = creatureFor(e.id, species);
      const x = m(e, RF.x);
      const z = m(e, RF.z);
      const flags = Math.round(e.values[RF.flags] ?? 0);
      const hp = e.values[RF.hp] ?? 0;
      const fainted = e.kind === RulesKind.Unit ? (flags & 1) !== 0 : (flags & 1) !== 0;
      if (c.hp >= 0 && hp < c.hp && e.kind === RulesKind.Structure) stage.burst("hitSpark", x, 2, z, 0xffd76a, 8);
      c.hp = hp;
      c.x = x;
      c.z = z;
      const bob = fainted ? 0 : Math.abs(Math.sin(t * 5 + e.id)) * 0.12;
      c.placed.root.position.set(x, stage.groundAt(x, z) + 0.04 + bob, z);
      c.placed.root.rotation.y = e.values[RF.yaw] ?? 0;
      c.placed.root.rotation.z = fainted ? Math.PI / 2 : 0;
      if (e.owner === app.self && (flags & 2) !== 0) foePos = { x, z };
      if (e.owner === app.self && (flags & 2) === 0 && e.kind === RulesKind.Unit) minePos = { x, z };
    }
    for (const [id, c] of creatures) {
      if (live.has(id)) continue;
      stage.burst("magic", c.x, 0.6, c.z, 0xc6f27a, 10);
      stage.scene.remove(c.placed.root);
      creatures.delete(id);
    }
    for (const s of scatter) {
      s.crowd.begin();
      for (const p of s.at) s.crowd.push(p.x, stage.groundAt(p.x, p.z), p.z, p.yaw, (p.x * 0.13) % 1, 0, 0, 0, p.s);
      s.crowd.end(t);
    }
    glow.scale.setScalar(3 + Math.sin(t * 3) * 0.2);
    // The camera: our keeper, closer in a battle.
    if (v?.battle && (v.battle.warden || foePos)) stage.frameRect(selfPos.x, selfPos.z, 14, 9);
    else if (!app.preview) stage.frameRect(selfPos.x, selfPos.z, 26, 16);

    if (!v) return;
    // Battle log: new lines become effects and sounds.
    const log = v.log ?? [];
    if (inBattle && !seenFoe) {
      sfx.play("rustle");
      stage.ring(selfPos.x, selfPos.z, 3, 0xc6f27a);
    }
    seenFoe = inBattle;
    const wardenPos = at(map.warden[0], map.warden[1]);
    for (const line of log) {
      if (line.n <= seenLog) continue;
      seenLog = line.n;
      const target = line.who === 0 ? (v.battle?.warden ? wardenPos : (foePos ?? selfPos)) : (minePos ?? selfPos);
      if (line.kind === LogKind.Hit) {
        stage.burst(line.eff && line.eff > 0 ? "sparks" : "hitSpark", target.x, 0.8, target.z, ELEMENT_COLOR[g.moves[line.move ?? 0]?.el ?? 0], line.eff && line.eff > 0 ? 18 : 8);
        sfx.play(line.who === 0 ? "hit" : "hurt", { gain: line.who === 0 ? 0.8 : 0.5 });
        if (line.who === 1) stage.kick(0.25);
      } else if (line.kind === LogKind.Snared) {
        stage.burst("magic", target.x, 0.8, target.z, 0xffd76a, 30);
        sfx.play("snare");
        hud.toast(`${nameOf(line.value ?? 0)} snared`);
      } else if (line.kind === LogKind.Slipped) sfx.play("slip");
      else if (line.kind === LogKind.Won) {
        stage.burst("kill", target.x, 0.6, target.z, 0xc6f27a, 16);
        sfx.play("kill");
      } else if (line.kind === LogKind.Level) {
        sfx.play("levelUp");
        hud.toast(`Level ${line.value}`);
      } else if (line.kind === LogKind.Wiped) {
        stage.kick(0.6);
        sfx.play("bigKill");
        hud.toast("Your team fainted. Back to camp");
      } else if (line.kind === LogKind.Heal) sfx.play("pick");
    }

    // HUD chips and panels.
    const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    hud.status([
      ["DUSK IN", mmss(v.dusk)],
      ["SNARES", `${v.snares ?? 0}`],
      ["CAUGHT", `${v.catches ?? 0}${v.box ? ` (${v.box} in lantern)` : ""}`],
    ]);
    ((wardenEl.lastChild as HTMLElement).firstChild as HTMLElement).style.transform = `scaleX(${Math.max(0, v.warden.hp / Math.max(1, v.warden.max))})`;
    (wardenEl.firstChild as HTMLElement).textContent = `${(WEAPON_NAMES[g.marsh.warden.creature]?.name ?? "Warden").toUpperCase()}${v.warden.fighting ? ` · ${v.warden.fighting} FIGHTING` : ""}`;
    pickEl.classList.toggle("show", !v.picked && v.phase !== "ended" && !app.preview);
    const near = Math.hypot(wardenPos.x - selfPos.x, wardenPos.z - selfPos.z) < 5.5;
    callEl.classList.toggle("show", near && !inBattle && !v.warden.down && !!v.picked && !app.preview);
    const team = v.team ?? [];
    const teamKey = JSON.stringify([team, v.active]);
    if (teamEl.dataset.k !== teamKey) {
      teamEl.dataset.k = teamKey;
      teamEl.innerHTML = team
        .map((x, i) => {
          const c = g.creatures[x.species];
          return `<div class="mon${i === v.active ? " on" : ""}${x.hp <= 0 ? " out" : ""}"><b><i class="dot" style="background:${cssColor(ELEMENT_COLOR[c?.el ?? 0] ?? 0)}"></i>${nameOf(x.species)}</b>Lv ${x.level} · ${x.hp}/${x.max}${hpBar(x.hp, x.max)}<div class="xp"><i style="transform:scaleX(${Math.min(1, x.xp / Math.max(1, x.next))})"></i></div></div>`;
        })
        .join("");
    }
    const b = v.battle;
    battleEl.classList.toggle("show", !!b && !app.preview);
    if (b) {
      const mine = team[v.active ?? 0];
      const key = JSON.stringify([b, mine, v.snares, log.at(-1)?.n, team.map((x) => x.hp)]);
      if (battleEl.dataset.k !== key) {
        battleEl.dataset.k = key;
        const foe = g.creatures[b.foe.species];
        const lines = log.slice(-3).map((l) => `<div>${sentence(l)}</div>`).join("");
        const c = mine ? g.creatures[mine.species] : undefined;
        battleEl.innerHTML = `<div class="foe"><span><i class="dot" style="background:${cssColor(ELEMENT_COLOR[foe?.el ?? 0] ?? 0)}"></i>${b.warden ? "THE " : "Wild "}${nameOf(b.foe.species)} Lv ${b.foe.level}</span><small>${b.foe.hp}/${b.foe.max}</small></div>${hpBar(b.foe.hp, b.foe.max)}<div class="log">${lines}</div><div class="moves"></div><div class="row"></div>`;
        const movesEl = battleEl.querySelector(".moves") as HTMLElement;
        c?.moveIdx.forEach((mi, j) => {
          const mv = g.moves[mi];
          const btn = document.createElement("button");
          const eff = mv && foe ? effectiveness(mv.el, foe.el) : 0;
          btn.innerHTML = `<i class="dot" style="background:${cssColor(ELEMENT_COLOR[mv?.el ?? 0] ?? 0)}"></i>${j + 1} ${moveName(mi)}<small>${mv?.power ? `${mv.power}${eff > 0 ? " · strong" : eff < 0 ? " · weak" : ""}` : (mv?.effect ?? "")}</small>`;
          btn.addEventListener("click", () => clock.act(CollectorAct.Move, j));
          movesEl.append(btn);
        });
        const row = battleEl.querySelector(".row") as HTMLElement;
        if (!b.warden) {
          const snare = document.createElement("button");
          snare.className = "go";
          snare.textContent = `Snare (${v.snares ?? 0})`;
          snare.disabled = (v.snares ?? 0) <= 0;
          snare.addEventListener("click", () => clock.act(CollectorAct.Snare));
          row.append(snare);
        }
        team.forEach((x, i) => {
          if (i === v.active || x.hp <= 0) return;
          const sw = document.createElement("button");
          sw.textContent = `Swap to ${nameOf(x.species)}`;
          sw.addEventListener("click", () => clock.act(CollectorAct.Swap, i));
          row.append(sw);
        });
        const flee = document.createElement("button");
        flee.textContent = "Flee";
        flee.addEventListener("click", () => clock.act(CollectorAct.Flee));
        row.append(flee);
      }
    }
    hud.end(v.phase === "ended", v.outcome === "won" ? "THE WARDEN FELL" : "DUSK", v.outcome === "won" ? "The marsh is quiet" : "The fen floods at dusk", v.endsIn ?? null);
  });
  app.extraStats(() => ({ creatures: creatures.size, keepers: keepers.size, battle: lastView?.battle ? 1 : 0, catches: lastView?.catches ?? 0, team: lastView?.team?.length ?? 0 }));

  function sentence(l: LogLine): string {
    const who = l.who === 0 ? "Yours" : "Foe";
    switch (l.kind) {
      case LogKind.Hit:
        return `${who}: ${moveName(l.move ?? 0)} for ${l.dmg}${l.eff && l.eff > 0 ? ", strong" : l.eff && l.eff < 0 ? ", weak" : ""}`;
      case LogKind.Miss:
        return `${who}: ${moveName(l.move ?? 0)} missed`;
      case LogKind.Heal:
        return `${who}: ${moveName(l.move ?? 0)}, +${l.value} health`;
      case LogKind.Guard:
        return `${who}: ${moveName(l.move ?? 0)}, guarding`;
      case LogKind.Swap:
        return `${nameOf(l.value ?? 0)} steps in`;
      case LogKind.Snared:
        return `Snared ${nameOf(l.value ?? 0)}`;
      case LogKind.Slipped:
        return `${nameOf(l.value ?? 0)} slipped the snare`;
      case LogKind.Fled:
        return "You ran";
      case LogKind.Won:
        return `${nameOf(l.value ?? 0)} is beaten`;
      case LogKind.Fainted:
        return `${nameOf(l.value ?? 0)} fainted`;
      case LogKind.Wiped:
        return "Your team fainted";
      case LogKind.Level:
        return `Level ${l.value}`;
      case LogKind.Met:
        return `A wild ${nameOf(l.value ?? 0)} rises from the reeds`;
      case LogKind.Warden:
        return `The ${nameOf(l.value ?? 0)} wakes`;
      default:
        return "";
    }
  }

  /** The marsh plate: meadow, tall grass, mud under rocks, drawn once on a canvas. */
  function marshTexture(): CanvasTexture {
    const px = 32;
    const c = document.createElement("canvas");
    c.width = map.w * px;
    c.height = map.h * px;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas");
    let s = 5;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) {
        const t = y * map.w + x;
        ctx.fillStyle = map.water[t] ? "#2c5a70" : map.blocked[t] ? "#5a5040" : map.grass[t] ? ((x + y) % 2 ? "#36602c" : "#3a6630") : (x + y) % 2 ? "#6e8a4a" : "#729050";
        ctx.fillRect(x * px, y * px, px, px);
        for (let i = 0; i < (map.grass[t] ? 10 : 4); i++) {
          ctx.fillStyle = map.grass[t] ? `rgba(150, 200, 90, ${0.3 + r() * 0.3})` : `rgba(60, 80, 40, ${0.15 + r() * 0.2})`;
          ctx.fillRect(x * px + r() * px, y * px + r() * px, 2, map.grass[t] ? 5 : 2);
        }
      }
    // A trodden path from camp to the warden's mound.
    ctx.fillStyle = "rgba(150, 120, 80, 0.55)";
    const cy = (map.camp[1] + 0.5) * px;
    ctx.fillRect((map.camp[0] + 0.5) * px, cy - 6, (map.warden[0] - map.camp[0]) * px, 12);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    tex.magFilter = NearestFilter;
    return tex;
  }
}

main().catch((e: unknown) => {
  const t = document.getElementById("banner-text");
  if (t) t.textContent = `Could not start: ${e instanceof Error ? e.message : String(e)}`;
  console.error(e);
});
