/**
 * BRINEWORKS client: your works is one of eight plots on a shared salt
 * flat. Rake (Space or the big button) to bring in salt by hand and keep the
 * works tended, buy and level plants from the bar, ship crystals to the
 * barge. The room makes every litre, kilo and crystal on its own clock;
 * your foreman (the cursor) is predicted, so pointing never waits.
 *
 * URL parameters: see @netforge/tabletop boot.ts.
 */
import { BoxGeometry, CircleGeometry, Color, ConeGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, RingGeometry } from "three/webgpu";
import type { InterpolatedEntity } from "@netforge/engine/net";
import { IdleAct, plantSpot, plotCenter, PLOT, RF, RulesKind, UNITS, IDLE_SEATS } from "@netforge/engine/rules";
import type { RulesInput } from "@netforge/engine/rules";
import { bootBoard, cssColor, type Placed } from "@netforge/tabletop";
import { COSMETICS, GAME_VERSION, idleAdapter, idleGame, idleManifest, PLACE, TEMPLATE } from "../src/manifest.js";
import { BRINE_COIN } from "../src/store.js";
import { idleAutopilot, type IdleView } from "../src/autopilot.js";
import { BARGE_MODEL, CRYSTAL_MODEL, EDGE_MODELS } from "./decor.js";
import { KEEPER_COLORS, RULE_NAMES, SKU_NAMES, TITLE, UPGRADE_NAMES, WEAPON_NAMES } from "./names.js";


const genre = idleGame();
const g = genre.game;
const manifest = idleManifest();
const FLAT_W = PLOT.cols * (PLOT.w + PLOT.gapX) + 4;
const FLAT_H = 2 * PLOT.d + PLOT.gapZ + 4;
const FINISH = [0xd8c39a, 0xf4f1ea, 0xb5552e];
const fmt = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(1)}t` : `${Math.floor(n).toLocaleString("en-US")}`);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

let lastView: IdleView | null = null;
const autopilot = (tick: number): RulesInput | null => idleAutopilot(lastView, tick);

async function main(): Promise<void> {
  const app = await bootBoard({
    adapter: idleAdapter(),
    manifest,
    template: TEMPLATE,
    place: PLACE,
    version: GAME_VERSION,
    labels: { title: TITLE, rules: RULE_NAMES, skus: SKU_NAMES, upgrades: UPGRADE_NAMES, loading: "Opening the sluices", help: "Space rake · 1-5 buy a plant · S ship crystals · ` stats" },
    theme: {
      accent: "#2aa7d8",
      gold: "#e8a33c",
      ink: "#1d2a33",
      dim: "#5d6f7b",
      panel: "rgba(250, 247, 240, 0.9)",
      bg: "#efe9dc",
      font: '"Futura", "Century Gothic", "Trebuchet MS", system-ui, sans-serif',
      display: '"Futura", "Century Gothic", system-ui, sans-serif',
      radius: 2,
    },
    coin: BRINE_COIN,
    cosmetics: COSMETICS,
    swatch: (c) => `linear-gradient(135deg, ${cssColor(FINISH[c] ?? 0xd8c39a)}, #2a3a44)`,
    ground: { w: FLAT_W, h: FLAT_H },
    preset: "day",
    theme3d: "desert",
    groundColor: 0xe9e1cc,
    pitch: 1.05,
    autopilot,
    soundKey: "brineworks:sound",
  });
  const { stage, hud, clock, sfx } = app;
  sfx.define("rake", { wave: "noise", f0: 1800, f1: 600, ms: 90, gain: 0.35 }, { minGapMs: 60, voices: 3, pitchVar: 0.15 });
  sfx.define("crate", { wave: "triangle", f0: 520, f1: 780, ms: 140, gain: 0.5 }, { minGapMs: 100, voices: 2, pitchVar: 0 });
  sfx.define("ship", { wave: "sine", f0: 300, f1: 900, ms: 260, gain: 0.55 }, { minGapMs: 200, voices: 1, pitchVar: 0 });

  // ---- The flat: plots, the canal and its barge, the edge of the pan.
  const plotMat = (mine: boolean) => new MeshStandardMaterial({ color: mine ? 0xe6f6fb : 0xc9dde2, roughness: 0.35, metalness: 0.05, emissive: new Color(mine ? 0x2a6a80 : 0x0e2a33), emissiveIntensity: mine ? 0.35 : 0.15 });
  const plots: Mesh[] = [];
  for (let slot = 0; slot < IDLE_SEATS; slot++) {
    const c = plotCenter(slot);
    const m = new Mesh(new BoxGeometry(PLOT.w, 0.08, PLOT.d), plotMat(false));
    m.position.set(c.x, stage.groundAt(c.x, c.z) + 0.04, c.z);
    m.receiveShadow = true;
    stage.add(m);
    plots.push(m);
    // Low berms around each plot.
    for (const [dx, dz, w, d] of [
      [0, -PLOT.d / 2, PLOT.w, 0.3],
      [0, PLOT.d / 2, PLOT.w, 0.3],
      [-PLOT.w / 2, 0, 0.3, PLOT.d],
      [PLOT.w / 2, 0, 0.3, PLOT.d],
    ] as const) {
      const berm = new Mesh(new BoxGeometry(w, 0.28, d), new MeshStandardMaterial({ color: 0xc9bc9d, roughness: 1 }));
      berm.position.set(c.x + dx, m.position.y + 0.12, c.z + dz);
      stage.add(berm);
    }
  }
  const canal = new Mesh(new PlaneGeometry(FLAT_W + 30, PLOT.gapZ * 0.8), new MeshStandardMaterial({ color: 0x3b9cc4, roughness: 0.2, metalness: 0.1, emissive: new Color(0x0a3448) }));
  canal.rotation.x = -Math.PI / 2;
  canal.position.y = 0.02;
  stage.add(canal);
  const barge = stage.model(BARGE_MODEL, 2.2, 0x8a6a4a, 7);
  barge.root.position.set(0, 0.1, 0);
  barge.root.rotation.y = Math.PI / 2;
  stage.add(barge.root);
  const hold = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: 0xbfe8ff, emissive: new Color(0x4fb6e0), emissiveIntensity: 0.6, roughness: 0.3 }));
  hold.position.set(0, 1.2, 0);
  hold.scale.set(4, 0.01, 1.6);
  stage.add(hold);
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const id of EDGE_MODELS) {
    const at: { x: number; z: number; yaw: number; s: number }[] = [];
    for (let i = 0; i < 9; i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      at.push({ x: (rnd() - 0.5) * (FLAT_W + 20), z: side * (FLAT_H / 2 + 2 + rnd() * 8), yaw: rnd() * 6.3, s: 0.7 + rnd() * 0.6 });
    }
    const crowd = stage.crowd(id, id.endsWith("tent") ? 2.4 : 1.6, at.length, 0xb59a7a);
    app.loop((_, now) => {
      crowd.begin();
      for (const p of at) crowd.push(p.x, stage.groundAt(p.x, p.z), p.z, p.yaw, 0, 0, 0, 0, p.s);
      crowd.end(now / 1000);
    });
  }

  // ---- Works: plant models, brine pools, salt piles, crystals; foremen.
  const plantModels = new Map<number, { placed: Placed; level: number; type: number }>();
  const piles = new Map<number, { pool: Mesh; pile: Mesh; crystals: Placed[]; salt: number }>();
  const foremen = new Map<number, Group>();
  const pileFor = (id: number) => {
    let p = piles.get(id);
    if (p) return p;
    const pool = new Mesh(new CircleGeometry(1, 28), new MeshStandardMaterial({ color: 0x5fc3e8, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 }));
    pool.rotation.x = -Math.PI / 2;
    const pile = new Mesh(new ConeGeometry(1, 1, 12), new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, emissive: new Color(0x404040) }));
    stage.add(pool, pile);
    p = { pool, pile, crystals: [], salt: 0 };
    piles.set(id, p);
    return p;
  };

  // ---- The bar: rake, plants, ship; the works meter.
  const style = document.createElement("style");
  style.textContent = `
#bar { left: 50%; bottom: max(10px, env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex; gap: 6px; align-items: stretch; }
#bar button { pointer-events: auto; }
#rake { width: 92px; font-weight: 900; letter-spacing: 0.12em; background: var(--accent); color: #fff; border: none; position: relative; overflow: hidden; }
#rake i { position: absolute; left: 0; bottom: 0; height: 4px; background: rgba(255,255,255,0.8); }
#bar .plant { width: min(118px, 17vw); padding: 6px 8px; text-align: left; display: grid; gap: 1px; }
#bar .plant b { font-size: 12px; }
#bar .plant span { font-size: 10px; color: var(--dim); }
#bar .plant i { font-style: normal; color: var(--gold); font-weight: 800; font-size: 12px; }
#bar .plant.poor { opacity: 0.55; }
#bar .plant kbd { font: 700 10px ui-monospace, monospace; color: var(--accent); }
#ship { width: 90px; font-weight: 800; }
#meter { left: 50%; top: max(10px, env(safe-area-inset-top)); transform: translateX(-50%); width: min(380px, 46vw); text-align: center; font-size: 11px; letter-spacing: 0.14em; color: var(--dim); }
#meter .row { display: flex; justify-content: space-between; margin-top: 4px; font-weight: 700; color: var(--ink); letter-spacing: 0.04em; font-size: 13px; }
#meter .bar { height: 8px; background: rgba(0,0,0,0.12); border-radius: 2px; overflow: hidden; margin-top: 4px; }
#meter .bar > i { display: block; height: 100%; background: linear-gradient(90deg, #2aa7d8, #8fe1ff); transform-origin: left; }
#stall { left: 50%; top: 38%; transform: translate(-50%, -50%); font: 900 30px var(--display, inherit); letter-spacing: 0.18em; color: #b5552e; background: rgba(250,247,240,0.92); padding: 10px 18px; border: 2px solid #b5552e; display: none; }
#stall.show { display: block; }
.puff { position: fixed; z-index: 6; pointer-events: none; font: 800 14px var(--display, inherit); color: #e8a33c; text-shadow: 0 1px 0 #fff; transition: transform 700ms ease-out, opacity 700ms; }
@media (max-width: 560px), (max-height: 500px) { #bar .plant span { display: none; } #bar .plant { width: 74px; padding: 4px 5px; } #bar .plant b { font-size: 10px; } #rake { width: 70px; } #ship { width: 64px; } }
`;
  document.head.append(style);
  const bar = document.createElement("div");
  bar.id = "bar";
  bar.className = "hud";
  document.body.append(bar);
  const rakeBtn = document.createElement("button");
  rakeBtn.id = "rake";
  rakeBtn.innerHTML = "RAKE<i></i>";
  bar.append(rakeBtn);
  const cards = g.plants.map((p, i) => {
    const c = document.createElement("button");
    c.className = "plant";
    c.innerHTML = `<kbd>${i + 1}</kbd><b></b><span></span><i></i>`;
    (c.querySelector("b") as HTMLElement).textContent = WEAPON_NAMES[p.id]?.name ?? p.id;
    c.addEventListener("click", () => buy(i));
    bar.append(c);
    return c;
  });
  const shipBtn = document.createElement("button");
  shipBtn.id = "ship";
  shipBtn.addEventListener("click", () => ship());
  bar.append(shipBtn);
  const meter = document.createElement("div");
  meter.id = "meter";
  meter.className = "hud";
  meter.innerHTML = `CONTRACT<div class="bar"><i></i></div><div class="row"><span id="m-left"></span><span id="m-hold"></span></div>`;
  document.body.append(meter);
  const stall = document.createElement("div");
  stall.id = "stall";
  stall.className = "hud";
  stall.textContent = "WORKS STOPPED · RAKE";
  document.body.append(stall);

  const rake = () => {
    sfx.unlock();
    if ((lastView?.rake ?? 1) > 0) return;
    clock.act(IdleAct.Rake);
    sfx.play("rake");
    const c = plotCenter(lastView?.slot ?? 0);
    stage.burst("dust", c.x + 4.6, 0.4, c.z + 3.4, 0xffffff, 8);
    puff(`+${g.rakeSalt / 1000} kg`, c.x + 4.6, c.z + 3.4);
  };
  const buy = (i: number) => {
    sfx.unlock();
    const v = lastView;
    if (!v?.costs || (v.salt ?? 0) < (v.costs[i] ?? Infinity)) {
      hud.toast("Not enough salt");
      return;
    }
    clock.act(IdleAct.Buy, i);
    sfx.play("land");
  };
  const ship = () => {
    const v = lastView;
    if (!v || (v.crystals ?? 0) < 1 || v.filled) return;
    clock.act(IdleAct.Ship, v.crystals ?? 1);
    sfx.play("ship");
    stage.burst("magic", 0, 1.5, 0, 0x8fe1ff, 20);
  };
  rakeBtn.addEventListener("click", rake);
  addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      rake();
    }
    const n = Number(e.key);
    if (n >= 1 && n <= g.plants.length) buy(n - 1);
    if (e.code === "KeyS") ship();
  });
  // Clicking your own plot rakes too; pointing walks your foreman.
  app.canvas.addEventListener("pointermove", (e) => {
    const p = stage.pick(e.clientX, e.clientY, app.canvas.getBoundingClientRect());
    if (p) clock.cursor(p.x, p.z);
  });
  app.canvas.addEventListener("pointerdown", (e) => {
    const p = stage.pick(e.clientX, e.clientY, app.canvas.getBoundingClientRect());
    if (!p) return;
    clock.cursor(p.x, p.z);
    const c = plotCenter(lastView?.slot ?? 0);
    if (Math.abs(p.x - c.x) < PLOT.w / 2 && Math.abs(p.z - c.z) < PLOT.d / 2) rake();
  });
  function puff(text: string, x: number, z: number): void {
    const s = stage.project(x, 1.5, z, app.canvas.clientWidth, app.canvas.clientHeight);
    const el = document.createElement("div");
    el.className = "puff";
    el.textContent = text;
    el.style.left = `${s.x}px`;
    el.style.top = `${s.y}px`;
    document.body.append(el);
    requestAnimationFrame(() => {
      el.style.transform = "translateY(-36px)";
      el.style.opacity = "0";
    });
    setTimeout(() => el.remove(), 750);
  }

  let mySlot = -1;
  let knownPacks = 0;
  let knownFilled = false;
  const m = (e: InterpolatedEntity, f: number) => (e.values[f] ?? 0) / UNITS;
  app.loop((_dt, now) => {
    const conn = app.conn();
    const v = app.view() as unknown as IdleView | null;
    lastView = v;
    const view = conn.net.render(now);
    const t = now / 1000;
    if (v?.slot !== undefined && v.slot !== mySlot) {
      const old = plots[mySlot];
      if (old) old.material = plotMat(false);
      mySlot = v.slot;
      (plots[mySlot] as Mesh).material = plotMat(true);
    }
    const seenPlants = new Set<number>();
    const seenPiles = new Set<number>();
    for (const e of view.others) {
      if (e.kind === RulesKind.Structure) {
        seenPlants.add(e.id);
        const type = Math.round(e.values[RF.type] ?? 0);
        const level = Math.round(e.values[RF.value] ?? 0);
        let pm = plantModels.get(e.id);
        if (!pm) {
          const def = g.plants[type]?.def;
          const h = def?.kind === "kiln" ? 2.4 : def?.kind === "pan" ? 1.1 : 1.6;
          const placed = stage.model(def?.model ?? "style.lowpoly.barrel", h, 0x9a8a6a, 2.4);
          placed.root.position.set(m(e, RF.x), stage.groundAt(m(e, RF.x), m(e, RF.z)) + 0.08, m(e, RF.z));
          stage.add(placed.root);
          pm = { placed, level: 0, type };
          plantModels.set(e.id, pm);
          stage.burst("dust", m(e, RF.x), 0.5, m(e, RF.z), 0xe8dcc0, 14);
        }
        if (level > pm.level && pm.level > 0) stage.burst("sparks", m(e, RF.x), 1.6, m(e, RF.z), 0xffd76a, 10);
        pm.level = level;
        const running = (Math.round(e.values[RF.flags] ?? 0) & 1) !== 0;
        const s = 1 + Math.min(10, level) * 0.04;
        pm.placed.root.scale.set(s, s * (running ? 1 + Math.sin(t * 8 + e.id) * 0.03 : 1), s);
      } else if (e.kind === RulesKind.Pickup) {
        seenPiles.add(e.owner);
        const p = pileFor(e.owner);
        const x = m(e, RF.x);
        const z = m(e, RF.z);
        const brine = e.values[RF.hp] ?? 0;
        const salt = e.values[RF.value] ?? 0;
        const crystals = e.values[RF.aux] ?? 0;
        const pr = 0.4 + Math.min(1.8, Math.sqrt(brine) * 0.05);
        p.pool.position.set(x - 2.6, stage.groundAt(x, z) + 0.1, z);
        p.pool.scale.setScalar(pr);
        const ps = 0.3 + Math.min(2.2, Math.cbrt(salt) * 0.16);
        p.pile.position.set(x, stage.groundAt(x, z) + ps * 0.5, z);
        p.pile.scale.set(ps * 0.9, ps, ps * 0.9);
        const want = Math.min(6, Math.floor(crystals));
        while (p.crystals.length < want) {
          const c = stage.model(CRYSTAL_MODEL, 0.8, 0x8fe1ff);
          const k = p.crystals.length;
          c.root.position.set(x + 1.4 + (k % 3) * 0.55, stage.groundAt(x, z) + 0.05, z - 0.5 + Math.floor(k / 3) * 0.6);
          stage.add(c.root);
          p.crystals.push(c);
        }
        while (p.crystals.length > want) stage.scene.remove((p.crystals.pop() as Placed).root);
      }
    }
    for (const [id, pm] of plantModels)
      if (!seenPlants.has(id)) {
        stage.scene.remove(pm.placed.root);
        plantModels.delete(id);
      }
    for (const [id, p] of piles)
      if (!seenPiles.has(id)) {
        stage.scene.remove(p.pool, p.pile);
        for (const c of p.crystals) stage.scene.remove(c.root);
        piles.delete(id);
      }
    // Foremen: ours predicted, the others interpolated.
    const seenF = new Set<number>();
    const place = (e: InterpolatedEntity | undefined, owner: number) => {
      if (!e) return;
      seenF.add(owner);
      let f = foremen.get(owner);
      if (!f) {
        f = new Group();
        const col = KEEPER_COLORS[(owner - 1) % KEEPER_COLORS.length] ?? 0xffffff;
        f.add(stage.model(manifest.game.players.prefab, 1.8, col).root);
        const ring = new Mesh(new RingGeometry(0.45, 0.62, 24), new MeshBasicMaterial({ color: col, side: DoubleSide }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.12;
        f.add(ring);
        stage.add(f);
        foremen.set(owner, f);
      }
      f.position.set(m(e, RF.x), stage.groundAt(m(e, RF.x), m(e, RF.z)) + 0.08, m(e, RF.z));
      f.rotation.y = e.values[RF.yaw] ?? 0;
    };
    place(view.self, app.self);
    for (const e of view.others) if (e.kind === RulesKind.Avatar) place(e, e.owner);
    for (const [o, f] of foremen)
      if (!seenF.has(o)) {
        stage.scene.remove(f);
        foremen.delete(o);
      }
    if (!v) return;
    hold.scale.y = Math.max(0.01, (v.contract / Math.max(1, v.contractTarget)) * 1.4);
    hold.position.y = 0.9 + hold.scale.y / 2;
    // HUD.
    hud.status([
      ["SALT", `${fmt(v.salt ?? 0)} kg`],
      ["BRINE", `${fmt(v.brine ?? 0)} L`],
      ["CRYSTALS", `${v.crystals ?? 0}`],
      ["NEXT CRATE", `${fmt(v.made ?? 0)} / ${fmt(v.nextPack ?? 0)} kg`],
    ]);
    ((meter.querySelector(".bar") as HTMLElement).firstChild as HTMLElement).style.transform = `scaleX(${Math.min(1, v.contract / Math.max(1, v.contractTarget))})`;
    (meter.querySelector("#m-left") as HTMLElement).textContent = `SHIFT ${mmss(v.left)}`;
    (meter.querySelector("#m-hold") as HTMLElement).textContent = v.filled ? "HOLD FULL" : `${v.contract} / ${v.contractTarget} crystals`;
    const ready = (v.rake ?? 0) === 0;
    rakeBtn.style.opacity = ready ? "1" : "0.75";
    (rakeBtn.lastChild as HTMLElement).style.width = `${ready ? 100 : Math.max(0, 100 - ((v.rake ?? 0) / g.rakeTicks) * 100)}%`;
    cards.forEach((c, i) => {
      const cost = v.costs?.[i] ?? 0;
      c.classList.toggle("poor", (v.salt ?? 0) < cost);
      (c.querySelector("span") as HTMLElement).textContent = `Lv ${v.levels?.[i] ?? 0} · ${WEAPON_NAMES[g.plants[i]?.id ?? ""]?.line ?? ""}`;
      (c.querySelector("i") as HTMLElement).textContent = `${fmt(cost)} kg`;
    });
    shipBtn.textContent = v.filled ? "Hold full" : `Ship ${v.crystals ?? 0}`;
    shipBtn.disabled = v.filled || (v.crystals ?? 0) < 1;
    stall.classList.toggle("show", v.stall === 0 && v.phase !== "ended" && !app.preview);
    const packs = Math.floor((v.made ?? 0) / (g.packEvery / 1000));
    if (packs > knownPacks && knownPacks > 0) {
      sfx.play("crate");
      if (packs % 5 === 0) hud.toast(`Crate ${packs}`);
    }
    knownPacks = packs;
    if (v.filled && !knownFilled) {
      hud.toast("The barge is full");
      stage.ring(0, 0, 6, 0x8fe1ff);
      sfx.play("levelUp");
    }
    knownFilled = v.filled;
    hud.end(v.phase === "ended", v.filled ? "SHIFT DONE · HOLD FULL" : "SHIFT DONE", `${fmt(v.made ?? 0)} kg of salt made`, v.endsIn ?? null);
  });
  app.extraStats(() => ({ plants: plantModels.size, works: piles.size, salt: lastView?.salt ?? 0, made: lastView?.made ?? 0, contract: lastView?.contract ?? 0 }));
}

main().catch((e: unknown) => {
  const t = document.getElementById("banner-text");
  if (t) t.textContent = `Could not start: ${e instanceof Error ? e.message : String(e)}`;
  console.error(e);
});
