/**
 * COGSPIRE client: join a board by link, point to move your tinker, click
 * a tile to build the tower picked in the bar, click a tower to upgrade or
 * sell it, and call the next wave early when everyone is ready. The room
 * decides every shot, kill, bounty and leak; your tinker is predicted, so
 * the cursor never waits for the server.
 *
 * URL parameters: see @netforge/tabletop boot.ts (?room, ?server,
 * ?style, ?autopilot, ?preview, ?stats, ?shapes, ?webgl, Net Forge flags).
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SRGBColorSpace,
  Vector3,
} from "three/webgpu";
import type { InterpolatedEntity } from "@netforge/engine/net";
import { bestTowerTile, CreepFlag, ENTITY_BASE, RF, RulesKind, TILE_M, tileAt, tileCenter, tileKey, TowerAct, UNITS } from "@netforge/engine/rules";
import type { RulesInput } from "@netforge/engine/rules";
import { $, bootBoard, cssColor, type BoardView, type Placed } from "@netforge/tabletop";
import { COSMETICS, GAME_VERSION, PLACE, TEMPLATE, towerAdapter, towerGame, towerManifest } from "../src/manifest.js";
import { COGSPIRE_COIN } from "../src/store.js";
import { GATE_MODEL, ROCK_MODEL, SMALL_DECOR, SPIRE_MODEL, TREE_MODELS } from "./decor.js";
import { ENEMY_NAMES, KEEPER_COLORS, RULE_NAMES, SKU_NAMES, TITLE, UPGRADE_NAMES, WEAPON_NAMES } from "./names.js";

interface TowerView extends BoardView {
  readonly wave: number;
  readonly waves: number;
  readonly stage: "build" | "wave";
  readonly countdown: number;
  readonly lives: number;
  readonly livesMax: number;
  readonly left: number;
  readonly next: readonly { type: number; count: number }[];
  readonly boss: { type: number; hp: number; maxHp: number } | null;
  readonly players: readonly { id: number; gold: number; kills: number; ready: boolean; built: number }[];
  readonly gold?: number;
  readonly ready?: boolean;
}

const genre = towerGame();
const g = genre.game;
const b = g.board;
const manifest = towerManifest();
const W = b.w * TILE_M;
const H = b.h * TILE_M;
const FINISH = [0xc9a15a, 0x5fbfa0, 0xffd76a];
const CREEP_COLOR = [0xd9643a, 0x8fa3b8, 0xff9a3c, 0x9a7b5a, 0xb0a0ff, 0x77d06a];

/** The browser's autopilot (?autopilot=1): build the cheapest-first rotation on the best free tile, upgrade, ready up. */
let lastView: TowerView | null = null;
let towerTiles = new Set<number>();
let myTowers: { tx: number; ty: number; type: number; level: number }[] = [];
let selfId = 0;
const autopilot = (tick: number): RulesInput | null => {
  const v = lastView;
  if (!v || tick % 15 !== 0) return null;
  const gold = v.gold ?? 0;
  const order = g.towers.map((_, i) => i).sort((x, y) => (g.towers[x]?.def.cost ?? 0) - (g.towers[y]?.def.cost ?? 0));
  const want = order[(myTowers.length + selfId) % order.length] ?? 0;
  const type = (g.towers[want]?.def.cost ?? Infinity) <= gold ? want : (order.find((i) => (g.towers[i]?.def.cost ?? Infinity) <= gold) ?? want);
  const tt = g.towers[type];
  const at = (tx: number, ty: number, act: number, a = 0): RulesInput => {
    const c = tileCenter(b, tx, ty);
    return { mx: 0, mz: 0, cx: Math.round(c.x * 16), cz: Math.round(c.z * 16), act, a, b: tx, c: ty };
  };
  if (tt && gold >= tt.def.cost && myTowers.length < 7) {
    const tile = bestTowerTile(g, towerTiles, type, selfId, 0);
    if (tile) return at(tile.tx, tile.ty, TowerAct.Build, type);
  }
  const up = myTowers.filter((t) => (g.towers[t.type]?.upgradeCost[t.level] ?? Infinity) <= gold).sort((x, y) => x.level - y.level)[0];
  if (up) return at(up.tx, up.ty, TowerAct.Upgrade);
  if (v.stage === "build" && !v.ready) return { mx: 0, mz: 0, cx: 0, cz: 0, act: TowerAct.Ready, a: 1, b: 0, c: 0 };
  return null;
};

async function main(): Promise<void> {
  const app = await bootBoard({
    adapter: towerAdapter(),
    manifest,
    template: TEMPLATE,
    place: PLACE,
    version: GAME_VERSION,
    labels: {
      title: TITLE,
      rules: RULE_NAMES,
      skus: SKU_NAMES,
      upgrades: UPGRADE_NAMES,
      loading: "Winding the spire",
      help: "Click a tile to build · click a tower to upgrade · 1-4 pick a tower · Space call the wave · ` stats",
    },
    theme: {
      accent: "#f2b84b",
      gold: "#ffd76a",
      ink: "#f6ecd9",
      dim: "#b4a68c",
      panel: "rgba(34, 24, 14, 0.86)",
      bg: "#1d1710",
      font: '"Trebuchet MS", "Gill Sans", system-ui, sans-serif',
      display: 'Georgia, "Palatino Linotype", serif',
      radius: 4,
    },
    coin: COGSPIRE_COIN,
    cosmetics: COSMETICS,
    swatch: (c) => `linear-gradient(135deg, ${cssColor(FINISH[c] ?? 0xc9a15a)}, #3a2a14)`,
    ground: { w: W + 7, h: H + 2 },
    preset: "day",
    theme3d: "meadow",
    groundColor: 0x4a5a32,
    pitch: 1.0,
    autopilot,
    soundKey: "cogspire:sound",
  });
  selfId = app.self;
  const { stage, hud, clock, sfx } = app;
  sfx.define("shoot", { wave: "square", f0: 900, f1: 400, ms: 40, gain: 0.18 }, { minGapMs: 45, voices: 3 });
  sfx.define("thud", { wave: "noise", f0: 400, f1: 80, ms: 160, gain: 0.5 }, { minGapMs: 90, voices: 2 });
  sfx.define("bell", { wave: "triangle", f0: 880, f1: 660, ms: 380, gain: 0.6 }, { minGapMs: 200, voices: 1, pitchVar: 0 });

  // ---- The board: one textured plate (tiles, road, rocks), rails along the road, the spire and the gate.
  const plate = boardTexture();
  const board = new Mesh(new PlaneGeometry(W, H, b.w * 2, b.h * 2), new MeshStandardMaterial({ map: plate, roughness: 0.95, metalness: 0 }));
  board.rotation.x = -Math.PI / 2;
  board.position.y = stage.groundAt(0, 0) + 0.03;
  board.receiveShadow = true;
  stage.add(board);
  const railMat = new MeshStandardMaterial({ color: 0x8a7a66, roughness: 0.4, metalness: 0.8 });
  for (let i = 1; i < b.path.length; i++) {
    const a = b.path[i - 1] as readonly [number, number];
    const c = b.path[i] as readonly [number, number];
    const pa = tileCenter(b, a[0], a[1]);
    const pc = tileCenter(b, c[0], c[1]);
    const len = Math.hypot(pc.x - pa.x, pc.z - pa.z) + 0.3;
    for (const off of [-0.45, 0.45]) {
      const rail = new Mesh(new BoxGeometry(0.09, 0.08, len), railMat);
      const horiz = a[1] === c[1];
      rail.position.set((pa.x + pc.x) / 2 + (horiz ? 0 : off), board.position.y + 0.05, (pa.z + pc.z) / 2 + (horiz ? off : 0));
      if (horiz) rail.rotation.y = Math.PI / 2;
      stage.add(rail);
    }
  }
  const last = b.path[b.path.length - 1] as readonly [number, number];
  const prev = b.path[b.path.length - 2] ?? last;
  const first = b.path[0] as readonly [number, number];
  const endC = tileCenter(b, last[0], last[1]);
  const dirX = Math.sign(last[0] - prev[0]);
  const dirZ = Math.sign(last[1] - prev[1]);
  const spireAt = { x: endC.x + dirX * TILE_M * 1.2, z: endC.z + dirZ * TILE_M * 1.2 };
  const spire = stage.model(SPIRE_MODEL, 6, 0xc9a15a);
  spire.root.position.set(spireAt.x, stage.groundAt(spireAt.x, spireAt.z), spireAt.z);
  stage.add(spire.root);
  const bellGlow = new Mesh(new CylinderGeometry(0.6, 0.6, 0.05, 24), new MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false }));
  bellGlow.position.set(spireAt.x, 0.08, spireAt.z);
  bellGlow.scale.setScalar(2.4);
  stage.add(bellGlow);
  const startC = tileCenter(b, first[0], first[1]);
  // Frame the board with the spire and the gate in view.
  const minX = Math.min(-W / 2, spireAt.x - 3, startC.x - 3);
  const maxX = Math.max(W / 2, spireAt.x + 3, startC.x + 3);
  const minZ = Math.min(-H / 2, spireAt.z - 3);
  const maxZ = Math.max(H / 2, spireAt.z + 3);
  stage.frameRect((minX + maxX) / 2, (minZ + maxZ) / 2, maxX - minX, maxZ - minZ);
  for (const side of [-1, 1]) {
    const gate = stage.model(GATE_MODEL, 2.2, 0x8f8676);
    const horiz = first[0] === 0 || first[0] === b.w - 1;
    gate.root.position.set(startC.x + (horiz ? -TILE_M * 0.9 : side * 1.4), 0, startC.z + (horiz ? side * 1.4 : -TILE_M * 0.9));
    stage.add(gate.root);
  }
  for (const k of b.blocked) {
    const c = tileCenter(b, k % 64, Math.floor(k / 64));
    const rock = stage.model(ROCK_MODEL, 1.1, 0x7c7468, TILE_M * 0.95);
    rock.root.position.set(c.x, stage.groundAt(c.x, c.z), c.z);
    rock.root.rotation.y = (k * 1.7) % (Math.PI * 2);
    stage.add(rock.root);
  }
  // The moor past the board: trees and small things, scattered by a fixed hash, drawn as crowds (one draw a model).
  const scatter: { crowd: ReturnType<typeof stage.crowd>; at: { x: number; z: number; yaw: number; s: number }[] }[] = [];
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const [list, n, h, ring] of [
    [TREE_MODELS, 60, 3.2, 9],
    [SMALL_DECOR, 50, 0.6, 5],
  ] as const) {
    for (const id of list) {
      const at: { x: number; z: number; yaw: number; s: number }[] = [];
      for (let i = 0; i < Math.floor(n / list.length); i++) {
        const side = rnd() * 4;
        const t = rnd() * 2 - 1;
        const out = 1.5 + rnd() * ring;
        const x = side < 1 ? -W / 2 - out : side < 2 ? W / 2 + out : t * (W / 2 + ring);
        const z = side < 1 || side < 2 ? t * (H / 2 + ring) : side < 3 ? -H / 2 - out : H / 2 + out;
        if (Math.abs(x - spireAt.x) < 3 && Math.abs(z - spireAt.z) < 3) continue;
        at.push({ x, z, yaw: rnd() * 6.28, s: 0.75 + rnd() * 0.5 });
      }
      scatter.push({ crowd: stage.crowd(id, h, at.length, 0x557a3a), at });
    }
  }

  // ---- Pieces that move: towers (one model each), creeps (a crowd per kind), health bars, tracers, tinkers.
  const towers = new Map<number, { root: Group; model: Placed; type: number; level: number; shots: number; pips: Mesh[]; aim: number }>();
  const creepCrowds = g.creeps.map((c, i) => stage.crowd(c.model, c.boss ? 2.8 : 1.2, 240, CREEP_COLOR[i % CREEP_COLOR.length]));
  const BAR_CAP = 260;
  const barBack = new InstancedMesh(new BoxGeometry(1, 0.06, 0.12), new MeshBasicMaterial({ color: 0x1a120a }), BAR_CAP);
  const barFill = new InstancedMesh(new BoxGeometry(1, 0.07, 0.13), new MeshBasicMaterial({ color: 0x9dff7a }), BAR_CAP);
  barBack.frustumCulled = barFill.frustumCulled = false;
  stage.add(barBack, barFill);
  const tracers: { mesh: Mesh; life: number }[] = [];
  const tracerGeo = new CylinderGeometry(0.05, 0.05, 1, 5);
  tracerGeo.rotateX(Math.PI / 2);
  tracerGeo.translate(0, 0, 0.5);
  for (let i = 0; i < 48; i++) {
    const m = new Mesh(tracerGeo, new MeshBasicMaterial({ color: 0xffe0a0, transparent: true, blending: AdditiveBlending, depthWrite: false }));
    m.visible = false;
    stage.add(m);
    tracers.push({ mesh: m, life: 0 });
  }
  const tinkers = new Map<number, { root: Group; ring: Mesh }>();
  const tinkerFor = (owner: number): { root: Group; ring: Mesh } => {
    let t = tinkers.get(owner);
    if (t) return t;
    const root = new Group();
    const m = stage.model(manifest.game.players.prefab, 2.1, KEEPER_COLORS[(owner - 1) % KEEPER_COLORS.length]);
    root.add(m.root);
    const ring = new Mesh(new RingGeometry(0.45, 0.6, 24), new MeshBasicMaterial({ color: KEEPER_COLORS[(owner - 1) % KEEPER_COLORS.length] ?? 0xffffff, side: DoubleSide, transparent: true, opacity: 0.85 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    root.add(ring);
    stage.add(root);
    t = { root, ring };
    tinkers.set(owner, t);
    return t;
  };

  // ---- The cursor: a ghost of the picked tower with its range, green where it can go.
  let picked = 0;
  const ghost = new Group();
  const ghostBody = new Mesh(new CylinderGeometry(0.5, 0.65, 1.4, 10), new MeshStandardMaterial({ color: 0x9dff7a, transparent: true, opacity: 0.45, emissive: new Color(0x2a5a1a) }));
  ghostBody.position.y = 0.7;
  const rangeRing = new Mesh(new RingGeometry(0.96, 1, 64), new MeshBasicMaterial({ color: 0x9dff7a, side: DoubleSide, transparent: true, opacity: 0.7 }));
  rangeRing.rotation.x = -Math.PI / 2;
  rangeRing.position.y = 0.09;
  const tileMark = new Mesh(new PlaneGeometry(TILE_M * 0.94, TILE_M * 0.94), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }));
  tileMark.rotation.x = -Math.PI / 2;
  tileMark.position.y = 0.07;
  ghost.add(ghostBody, rangeRing, tileMark);
  ghost.visible = false;
  stage.add(ghost);
  let hover: { tx: number; ty: number } | null = null;
  const towerAt = (tx: number, ty: number) => [...towerEnts.values()].find((e) => e.tx === tx && e.ty === ty);
  let towerEnts = new Map<number, { tx: number; ty: number; type: number; level: number; owner: number }>();

  // ---- The bar: tower cards, the wave button; the tower panel.
  const bar = document.createElement("div");
  bar.id = "bar";
  bar.className = "hud";
  document.body.append(bar);
  const style = document.createElement("style");
  style.textContent = `
#bar { left: 50%; bottom: max(10px, env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex; gap: 6px; align-items: stretch; }
#bar .card { pointer-events: auto; width: min(118px, 19vw); padding: 7px 8px; text-align: left; display: grid; gap: 1px; border: 1px solid rgba(242,184,75,0.25); background: var(--panel); border-radius: var(--r); cursor: pointer; }
#bar .card.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), 0 6px 18px rgba(0,0,0,0.4); transform: translateY(-3px); }
#bar .card.poor { opacity: 0.55; }
#bar .card kbd { font: 700 10px ui-monospace, monospace; color: var(--accent); }
#bar .card b { font-size: 13px; }
#bar .card span { font-size: 11px; color: var(--dim); }
#bar .card i { font-style: normal; color: var(--gold); font-weight: 800; font-size: 12px; }
#wavebtn { pointer-events: auto; min-width: 104px; font-weight: 800; letter-spacing: 0.06em; }
#wavebtn.ready { background: #3f6b2a; border-color: #9dff7a; }
#panel { display: none; pointer-events: auto; position: fixed; z-index: 7; transform: translate(-50%, calc(-100% - 18px)); background: var(--panel); border: 1px solid var(--accent); border-radius: var(--r); padding: 8px 10px; min-width: 150px; font-size: 13px; }
#panel.show { display: block; }
#panel .row { display: flex; gap: 6px; margin-top: 6px; }
#panel small { color: var(--dim); }
#bossbar { top: max(12px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%); width: min(360px, 44vw); text-align: center; font: 800 11px var(--display, inherit); letter-spacing: 0.2em; color: #ffb0a0; display: none; }
#bossbar.show { display: block; }
#bossbar > div { height: 9px; margin-top: 4px; background: rgba(0,0,0,0.5); border-radius: 3px; overflow: hidden; }
#bossbar > div > i { display: block; height: 100%; background: linear-gradient(90deg, #ff5a3c, #ffb347); transform-origin: left; }
#wavebanner { left: 50%; top: 32%; transform: translate(-50%, -50%); font: 900 42px Georgia, serif; letter-spacing: 0.22em; color: var(--accent); text-shadow: 0 2px 0 #000, 0 0 24px rgba(242,184,75,0.6); opacity: 0; transition: opacity 300ms; }
#wavebanner.show { opacity: 1; }
#next { left: 12px; bottom: max(84px, calc(env(safe-area-inset-bottom) + 74px)); font-size: 11px; color: var(--dim); background: var(--panel); padding: 5px 8px; border-radius: var(--r); }
@media (max-width: 560px) { #bar .card span { display: none; } #bar .card { width: 21vw; padding: 5px 6px; } #next { display: none; } }
@media (max-height: 500px) { #bar .card span { display: none; } #bar .card { width: 92px; padding: 4px 6px; font-size: 11px; } #bar .card b { font-size: 11px; } #wavebtn { min-width: 80px; padding: 4px 8px; } #next { display: none; } }
`;
  document.head.append(style);
  const cards: HTMLButtonElement[] = [];
  g.towers.forEach((t, i) => {
    const c = document.createElement("button");
    c.className = "card";
    c.innerHTML = `<kbd>${i + 1}</kbd><b></b><span></span><i></i>`;
    (c.querySelector("b") as HTMLElement).textContent = WEAPON_NAMES[t.id]?.name ?? t.id;
    (c.querySelector("span") as HTMLElement).textContent = WEAPON_NAMES[t.id]?.line ?? t.def.kind;
    (c.querySelector("i") as HTMLElement).textContent = `${t.def.cost} gold`;
    c.addEventListener("click", (e) => {
      e.stopPropagation();
      pick(i);
    });
    bar.append(c);
    cards.push(c);
  });
  const waveBtn = document.createElement("button");
  waveBtn.id = "wavebtn";
  waveBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    callWave();
  });
  bar.append(waveBtn);
  const panel = document.createElement("div");
  panel.id = "panel";
  document.body.append(panel);
  const bossbar = document.createElement("div");
  bossbar.id = "bossbar";
  bossbar.className = "hud";
  bossbar.innerHTML = `<span></span><div><i></i></div>`;
  document.body.append(bossbar);
  const waveBanner = document.createElement("div");
  waveBanner.id = "wavebanner";
  waveBanner.className = "hud";
  document.body.append(waveBanner);
  const nextEl = document.createElement("div");
  nextEl.id = "next";
  nextEl.className = "hud";
  document.body.append(nextEl);

  const pick = (i: number) => {
    picked = i;
    cards.forEach((c, j) => c.classList.toggle("on", j === i));
    sfx.play("pick");
  };
  pick(0);
  const callWave = () => {
    const v = lastView;
    if (!v || v.stage !== "build") return;
    clock.act(TowerAct.Ready, v.ready ? 0 : 1);
    sfx.play("pick");
  };
  addEventListener("keydown", (e) => {
    const n = Number(e.key);
    if (n >= 1 && n <= g.towers.length) pick(n - 1);
    if (e.code === "Space") {
      e.preventDefault();
      callWave();
    }
    if (e.code === "Escape") panelFor = null;
  });

  // ---- Pointer: move the tinker, build, open a tower's panel. Touch: first tap aims, second builds.
  let panelFor: { tx: number; ty: number } | null = null;
  let armed: number | null = null;
  const toTile = (e: PointerEvent) => {
    const p = stage.pick(e.clientX, e.clientY, app.canvas.getBoundingClientRect());
    if (!p) return null;
    clock.cursor(p.x, p.z);
    return tileAt(b, p.x, p.z);
  };
  app.canvas.addEventListener("pointermove", (e) => {
    hover = toTile(e);
  });
  app.canvas.addEventListener("pointerdown", (e) => {
    sfx.unlock();
    const t = toTile(e);
    hover = t;
    if (!t) {
      panelFor = null;
      return;
    }
    const tw = towerAt(t.tx, t.ty);
    if (tw) {
      panelFor = { tx: t.tx, ty: t.ty };
      armed = null;
      return;
    }
    panelFor = null;
    const k = tileKey(t.tx, t.ty);
    if (e.pointerType === "touch" && armed !== k) {
      armed = k;
      return;
    }
    armed = null;
    if (!canBuild(t.tx, t.ty)) {
      sfx.play("thud");
      return;
    }
    const cost = g.towers[picked]?.def.cost ?? 0;
    if ((lastView?.gold ?? 0) < cost) {
      hud.toast("Not enough gold");
      return;
    }
    clock.act(TowerAct.Build, picked, t.tx, t.ty);
    sfx.play("land");
  });
  const canBuild = (tx: number, ty: number) => {
    const k = tileKey(tx, ty);
    return !b.road.has(k) && !b.blocked.has(k) && !towerTiles.has(k);
  };

  // ---- Every frame.
  const creeps = new Map<number, { flags: number; hp: number; x: number; z: number; type: number; hit: number; by: number }>();
  const tmp = new Matrix4();
  const q = new Quaternion();
  let knownWave = 0;
  let knownLives = -1;
  let bannerTimer = 0;
  const m = (e: InterpolatedEntity, f: number) => (e.values[f] ?? 0) / UNITS;
  app.loop((dt, now) => {
    const conn = app.conn();
    const v = app.view<TowerView>();
    lastView = v;
    const view = conn.net.render(now);
    const t = now / 1000;

    // Towers.
    const seenT = new Set<number>();
    const nextEnts = new Map<number, { tx: number; ty: number; type: number; level: number; owner: number }>();
    const nextTiles = new Set<number>();
    const mine: { tx: number; ty: number; type: number; level: number }[] = [];
    const creepNow = new Map<number, InterpolatedEntity>();
    for (const e of view.others) {
      if (e.kind === RulesKind.Structure) {
        seenT.add(e.id);
        const x = m(e, RF.x);
        const z = m(e, RF.z);
        const tile = tileAt(b, x, z);
        const type = Math.round(e.values[RF.type] ?? 0);
        const level = Math.round(e.values[RF.value] ?? 0);
        const shots = Math.round(e.values[RF.aux] ?? 0);
        if (tile) {
          nextEnts.set(e.id, { ...tile, type, level, owner: e.owner });
          nextTiles.add(tileKey(tile.tx, tile.ty));
          if (e.owner === app.self) mine.push({ ...tile, type, level });
        }
        let tw = towers.get(e.id);
        if (!tw) {
          const root = new Group();
          const model = stage.model(g.towers[type]?.def.model ?? "style.lowpoly.turret", 1.7, 0xc9a15a);
          root.add(model.root);
          const base = new Mesh(new CylinderGeometry(0.85, 0.95, 0.16, 16), new MeshStandardMaterial({ color: KEEPER_COLORS[(e.owner - 1) % KEEPER_COLORS.length] ?? 0x888888, roughness: 0.6, metalness: 0.3 }));
          base.position.y = 0.08;
          root.add(base);
          root.position.set(x, stage.groundAt(x, z) + 0.03, z);
          stage.add(root);
          tw = { root, model, type, level: -1, shots, pips: [], aim: e.values[RF.yaw] ?? 0 };
          towers.set(e.id, tw);
          stage.burst("dust", x, 0.3, z, 0xd8c8a0, 14);
          if (e.owner === app.self) sfx.play("land");
        }
        if (tw.level !== level) {
          if (tw.level >= 0 && level > tw.level) {
            stage.burst("magic", x, 1.6, z, 0xffd76a, 18);
            sfx.play("levelUp");
          }
          tw.level = level;
          for (const p of tw.pips) tw.root.remove(p);
          tw.pips = [];
          for (let i = 0; i < level; i++) {
            const pip = new Mesh(new BoxGeometry(0.18, 0.18, 0.18), new MeshStandardMaterial({ color: 0xffd76a, emissive: new Color(0x7a5a10) }));
            pip.position.set(-0.45 + i * 0.3, 0.22, 0.75);
            tw.root.add(pip);
            tw.pips.push(pip);
          }
          tw.model.root.scale.setScalar(1 + level * 0.12);
        }
        // Face the target, turning smoothly.
        const want = e.values[RF.yaw] ?? 0;
        let d = want - tw.aim;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        tw.aim += d * Math.min(1, dt * 14);
        tw.model.root.rotation.y = tw.aim;
        if (shots !== tw.shots) {
          tw.shots = shots;
          const target = view.others.find((o) => o.id === ENTITY_BASE + Math.round(e.values[RF.hp] ?? 0));
          if (target) fireFx(type, x, z, m(target, RF.x), m(target, RF.z), e.owner === app.self);
        }
      } else if (e.kind === RulesKind.Unit) creepNow.set(e.id, e);
    }
    for (const [id, tw] of towers) {
      if (seenT.has(id)) continue;
      stage.burst("dust", tw.root.position.x, 0.4, tw.root.position.z, 0x9a8a6a, 18);
      stage.scene.remove(tw.root);
      towers.delete(id);
    }
    towerEnts = nextEnts;
    towerTiles = nextTiles;
    myTowers = mine;

    // Creeps: crowds, bars, deaths and leaks.
    for (const c of creepCrowds) c.begin();
    let bars = 0;
    for (const [id, e] of creepNow) {
      const x = m(e, RF.x);
      const z = m(e, RF.z);
      const type = Math.round(e.values[RF.type] ?? 0);
      const flags = Math.round(e.values[RF.flags] ?? 0);
      const hp = e.values[RF.hp] ?? 0;
      const known = creeps.get(id);
      let hit = known ? Math.max(0, known.hit - dt * 5) : 0;
      if (known && hp < known.hp) hit = 1;
      if ((flags & CreepFlag.Dead) !== 0 && (!known || (known.flags & CreepFlag.Dead) === 0)) {
        const boss = (flags & CreepFlag.Boss) !== 0;
        stage.burst(boss ? "bigKill" : "kill", x, 0.6, z, CREEP_COLOR[type % CREEP_COLOR.length], boss ? 60 : 16);
        if (boss) {
          stage.kick(0.7);
          sfx.play("bigKill");
        } else sfx.play("kill", { gain: e.owner === app.self ? 1 : 0.35 });
      }
      if ((flags & CreepFlag.Leaked) !== 0 && (!known || (known.flags & CreepFlag.Leaked) === 0)) {
        stage.ring(spireAt.x, spireAt.z, 4, 0xff5a3c);
        stage.burst("sparks", spireAt.x, 3, spireAt.z, 0xff8a5c, 24);
        stage.kick(0.5);
        sfx.play("bell");
      }
      creeps.set(id, { flags, hp, x, z, type, hit, by: e.owner });
      if ((flags & (CreepFlag.Dead | CreepFlag.Leaked)) !== 0) continue;
      const slowed = (flags & CreepFlag.Slowed) !== 0;
      const speed = (g.creeps[type]?.speed ?? 1) * (slowed ? 0.5 : 1);
      creepCrowds[type]?.push(x, stage.groundAt(x, z) + 0.05, z, e.values[RF.yaw] ?? 0, ((id * 0.618) % 1 + 1) % 1, speed, hit, hit * 0.8 + (slowed ? 0.25 : 0), 1);
      // A health bar over every hurt creep.
      const frac = (e.values[RF.value] ?? 1000) / 1000;
      if (frac < 0.999 && bars < BAR_CAP) {
        const h = (g.creeps[type]?.boss ? 3.1 : 1.35) + stage.groundAt(x, z);
        const wbar = g.creeps[type]?.boss ? 2.4 : 0.9;
        tmp.compose(new Vector3(x, h, z), q.identity(), new Vector3(wbar, 1, 1));
        barBack.setMatrixAt(bars, tmp);
        tmp.compose(new Vector3(x - (wbar * (1 - frac)) / 2, h + 0.005, z), q.identity(), new Vector3(Math.max(0.001, wbar * frac), 1, 1));
        barFill.setMatrixAt(bars, tmp);
        bars++;
      }
    }
    for (const id of [...creeps.keys()]) if (!creepNow.has(id)) creeps.delete(id);
    barBack.count = barFill.count = bars;
    barBack.instanceMatrix.needsUpdate = barFill.instanceMatrix.needsUpdate = true;
    for (const c of creepCrowds) c.end(t);
    for (const s of scatter) {
      s.crowd.begin();
      for (const p of s.at) s.crowd.push(p.x, stage.groundAt(p.x, p.z), p.z, p.yaw, (p.x * 0.13) % 1, 0, 0, 0, p.s);
      s.crowd.end(t);
    }

    // Tracers fade.
    for (const tr of tracers) {
      if (tr.life <= 0) continue;
      tr.life -= dt;
      tr.mesh.visible = tr.life > 0;
      (tr.mesh.material as MeshBasicMaterial).opacity = Math.max(0, tr.life / 0.14);
    }

    // Tinkers: ours predicted, the others interpolated.
    const seenP = new Set<number>();
    const placeTinker = (e: InterpolatedEntity | undefined, owner: number) => {
      if (!e) return;
      seenP.add(owner);
      const tk = tinkerFor(owner);
      const x = m(e, RF.x);
      const z = m(e, RF.z);
      tk.root.position.set(x, stage.groundAt(x, z) + 0.05 + Math.sin(t * 3 + owner) * 0.04, z);
      tk.root.rotation.y = e.values[RF.yaw] ?? 0;
      tk.ring.scale.setScalar((Math.round(e.values[RF.flags] ?? 0) & 1) !== 0 ? 1.4 + Math.sin(t * 6) * 0.1 : 1);
    };
    placeTinker(view.self, app.self);
    for (const e of view.others) if (e.kind === RulesKind.Avatar) placeTinker(e, e.owner);
    for (const [owner, tk] of tinkers) {
      if (seenP.has(owner)) continue;
      stage.scene.remove(tk.root);
      tinkers.delete(owner);
    }

    // The ghost: where a click builds, with the picked tower's reach.
    const show = hover && !app.preview && !towerAt(hover.tx, hover.ty) && v?.phase !== "ended";
    ghost.visible = !!show;
    if (show && hover) {
      const c = tileCenter(b, hover.tx, hover.ty);
      ghost.position.set(c.x, stage.groundAt(c.x, c.z) + 0.03, c.z);
      const ok = canBuild(hover.tx, hover.ty) && (v?.gold ?? 0) >= (g.towers[picked]?.def.cost ?? 0);
      const col = ok ? 0x9dff7a : 0xff6a4a;
      (ghostBody.material as MeshStandardMaterial).color.setHex(col);
      (rangeRing.material as MeshBasicMaterial).color.setHex(col);
      const r = (g.towers[picked]?.levels[0]?.range ?? 3) * TILE_M;
      rangeRing.scale.setScalar(r);
      ghostBody.visible = canBuild(hover.tx, hover.ty);
    }
    bellGlow.scale.setScalar(2.4 + Math.sin(t * 2) * 0.15);

    // HUD.
    if (v) {
      const me = v.players.find((p) => p.id === app.self);
      hud.status([
        ["WAVE", `${Math.max(1, v.wave)} / ${v.waves}`],
        ["BELLS", `${v.lives}`],
        ["GOLD", `${v.gold ?? me?.gold ?? 0}`],
        v.stage === "build" ? ["NEXT WAVE", `${v.countdown}s`] : ["CREEPS", `${v.left}`],
      ]);
      cards.forEach((c, i) => c.classList.toggle("poor", (v.gold ?? 0) < (g.towers[i]?.def.cost ?? 0)));
      const readyN = v.players.filter((p) => p.ready).length;
      waveBtn.disabled = v.stage !== "build";
      waveBtn.classList.toggle("ready", v.ready === true);
      waveBtn.textContent = v.stage === "build" ? (v.ready ? `Ready ${readyN}/${v.players.length}` : `Call wave ${v.countdown}s`) : `Wave ${v.wave}`;
      nextEl.textContent = v.next.length ? `Next: ${v.next.map((n) => `${n.count} ${ENEMY_NAMES[g.creeps[n.type]?.id ?? ""] ?? g.creeps[n.type]?.id ?? ""}`).join(" · ")}` : "";
      if (v.boss) {
        bossbar.classList.add("show");
        (bossbar.firstChild as HTMLElement).textContent = (ENEMY_NAMES[g.creeps[v.boss.type]?.id ?? ""] ?? "BOSS").toUpperCase();
        ((bossbar.lastChild as HTMLElement).firstChild as HTMLElement).style.transform = `scaleX(${Math.max(0, v.boss.hp / v.boss.maxHp)})`;
      } else bossbar.classList.remove("show");
      if (v.wave !== knownWave && v.stage === "wave") {
        knownWave = v.wave;
        waveBanner.textContent = g.creeps.some((c, i) => c.boss && v.next.some((n) => n.type === i)) ? `WAVE ${v.wave} · BOSS` : `WAVE ${v.wave}`;
        waveBanner.classList.add("show");
        clearTimeout(bannerTimer);
        bannerTimer = window.setTimeout(() => waveBanner.classList.remove("show"), 1600);
        sfx.play("levelUp");
      }
      if (knownLives >= 0 && v.lives < knownLives) hud.toast(`${knownLives - v.lives} bell${knownLives - v.lives > 1 ? "s" : ""} lost`);
      knownLives = v.lives;
      hud.end(v.phase === "ended", v.outcome === "won" ? "SPIRE HELD" : "SPIRE FELL", v.outcome === "won" ? `All ${v.waves} waves held` : `Fell at wave ${v.wave}`, v.endsIn ?? null);
      // The tower panel.
      const tw = panelFor ? towerAt(panelFor.tx, panelFor.ty) : undefined;
      if (tw && panelFor) {
        const c = tileCenter(b, panelFor.tx, panelFor.ty);
        const p = stage.project(c.x, 2.2, c.z, app.canvas.clientWidth, app.canvas.clientHeight);
        panel.style.left = `${p.x}px`;
        panel.style.top = `${p.y}px`;
        const def = g.towers[tw.type];
        const cost = def?.upgradeCost[tw.level];
        const spent = (def?.def.cost ?? 0) + (def?.upgradeCost.slice(0, tw.level).reduce((a, x) => a + x, 0) ?? 0);
        const key = `${panelFor.tx},${panelFor.ty},${tw.level},${v.gold},${tw.owner}`;
        if (panel.dataset.k !== key) {
          panel.dataset.k = key;
          panel.innerHTML = `<b></b> <small></small><div class="row"></div>`;
          (panel.querySelector("b") as HTMLElement).textContent = WEAPON_NAMES[def?.id ?? ""]?.name ?? def?.id ?? "";
          (panel.querySelector("small") as HTMLElement).textContent = `L${tw.level + 1}${tw.owner === app.self ? "" : ` · P${tw.owner}`}`;
          const row = panel.querySelector(".row") as HTMLElement;
          const upBtn = document.createElement("button");
          upBtn.className = "go";
          upBtn.textContent = cost === undefined ? "Max" : `Upgrade ${cost}`;
          upBtn.disabled = cost === undefined || (v.gold ?? 0) < cost;
          const at = panelFor;
          upBtn.addEventListener("click", () => clock.act(TowerAct.Upgrade, 0, at.tx, at.ty));
          row.append(upBtn);
          if (tw.owner === app.self) {
            const sell = document.createElement("button");
            sell.textContent = `Sell +${Math.floor(spent * (g.refund ?? 0.6))}`;
            sell.addEventListener("click", () => {
              clock.act(TowerAct.Sell, 0, at.tx, at.ty);
              panelFor = null;
            });
            row.append(sell);
          }
        }
        panel.classList.add("show");
      } else panel.classList.remove("show");
    }
  });
  app.extraStats(() => ({ towers: towers.size, creeps: creeps.size, wave: lastView?.wave ?? 0, lives: lastView?.lives ?? 0, gold: lastView?.gold ?? 0 }));

  function fireFx(type: number, x: number, z: number, tx: number, tz: number, mine: boolean): void {
    const kind = g.towers[type]?.def.kind ?? "bolt";
    const color = kind === "frost" ? 0x9fe8ff : kind === "chain" ? 0xb9a0ff : kind === "splash" ? 0xffa040 : 0xffe0a0;
    const tr = tracers.find((t) => t.life <= 0);
    if (tr) {
      const from = new Vector3(x, 1.5, z);
      const to = new Vector3(tx, 0.6, tz);
      const len = from.distanceTo(to);
      tr.mesh.position.copy(from);
      tr.mesh.lookAt(to);
      tr.mesh.scale.set(kind === "splash" ? 3 : 1, kind === "splash" ? 3 : 1, len);
      (tr.mesh.material as MeshBasicMaterial).color.setHex(color);
      tr.life = 0.14;
      tr.mesh.visible = true;
    }
    if (kind === "splash") {
      stage.ring(tx, tz, (g.towers[type]?.def.radius ?? 1) * TILE_M, 0xffa040);
      stage.burst("burst", tx, 0.5, tz, 0xffa040, 10);
    } else if (kind === "frost") stage.burst("magic", tx, 0.6, tz, 0x9fe8ff, 6);
    else if (kind === "chain") stage.burst("sparks", tx, 0.7, tz, 0xb9a0ff, 8);
    else stage.burst("hitSpark", tx, 0.6, tz, 0xffe0a0, 4);
    if (mine || Math.random() < 0.3) sfx.play("shoot", { gain: mine ? 0.7 : 0.25 });
  }

  /** The board plate: tiles, the road and its sleepers, drawn once on a canvas. */
  function boardTexture(): CanvasTexture {
    const px = 32;
    const c = document.createElement("canvas");
    c.width = b.w * px;
    c.height = b.h * px;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas");
    let s = 3;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let y = 0; y < b.h; y++)
      for (let x = 0; x < b.w; x++) {
        const k = tileKey(x, y);
        const road = b.road.has(k);
        ctx.fillStyle = road ? "#a88a5c" : (x + y) % 2 === 0 ? "#5f7a3e" : "#587238";
        ctx.fillRect(x * px, y * px, px, px);
        if (road) {
          for (let i = 0; i < 6; i++) {
            ctx.fillStyle = `rgba(70, 50, 30, ${0.2 + r() * 0.2})`;
            ctx.fillRect(x * px + r() * px, y * px + r() * px, 3, 3);
          }
        } else {
          ctx.strokeStyle = "rgba(20, 30, 10, 0.25)";
          ctx.strokeRect(x * px + 0.5, y * px + 0.5, px - 1, px - 1);
          for (let i = 0; i < 5; i++) {
            ctx.fillStyle = `rgba(150, 190, 90, ${0.15 + r() * 0.2})`;
            ctx.fillRect(x * px + r() * px, y * px + r() * px, 2, 3);
          }
        }
      }
    // Sleepers across the road.
    ctx.fillStyle = "rgba(60, 40, 22, 0.75)";
    for (let i = 1; i < b.path.length; i++) {
      const a = b.path[i - 1] as readonly [number, number];
      const d = b.path[i] as readonly [number, number];
      const n = Math.abs(d[0] - a[0]) + Math.abs(d[1] - a[1]);
      const sx = Math.sign(d[0] - a[0]);
      const sy = Math.sign(d[1] - a[1]);
      for (let j = 0; j <= n * 2; j++) {
        const cx = (a[0] + 0.5 + (sx * j) / 2) * px;
        const cy = (a[1] + 0.5 + (sy * j) / 2) * px;
        if (sx !== 0) ctx.fillRect(cx - 2, cy - px * 0.42, 4, px * 0.84);
        else ctx.fillRect(cx - px * 0.42, cy - 2, px * 0.84, 4);
      }
    }
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.magFilter = NearestFilter;
    return t;
  }
}

main().catch((e: unknown) => {
  const t = document.getElementById("banner-text");
  if (t) t.textContent = `Could not start: ${e instanceof Error ? e.message : String(e)}`;
  console.error(e);
});
