/**
 * INKWRIT client: a duel at a scribe's desk. Your hand is at the bottom
 * (only you and the room ever see it), your inked creatures stand on their
 * cards on your side of the desk, the other scribe's on theirs. Click a
 * card to play it (spells that aim ask for a target), click one of your
 * ready creatures and then a target to attack, End turn passes. Between
 * duels you draft one of three new cards. Alone, an AI scribe of the
 * gauntlet takes the other seat. The room decides every draw, hit and win.
 *
 * URL parameters: see @netforge/tabletop boot.ts.
 */
import { BoxGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace } from "three/webgpu";
import type { InterpolatedEntity } from "@netforge/engine/net";
import { CardAct, RF, RulesKind, Target, UNITS } from "@netforge/engine/rules";
import type { RulesInput } from "@netforge/engine/rules";
import { bootBoard, cssColor, type BoardView, type Placed } from "@netforge/tabletop";
import { cardsAdapter, cardsGame, cardsManifest, COSMETICS, GAME_VERSION, PLACE, TEMPLATE } from "../src/manifest.js";
import { INKWRIT_COIN } from "../src/store.js";
import { LAMP_MODEL, SHELF_MODELS } from "./decor.js";
import { KEEPER_COLORS, RULE_NAMES, SKU_NAMES, TITLE, UPGRADE_NAMES, WEAPON_NAMES } from "./names.js";

interface UnitV {
  readonly type: number;
  readonly attack: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly guard: boolean;
  readonly ready: boolean;
}
interface SideV {
  readonly player: number;
  readonly hero: number;
  readonly heroMax: number;
  readonly mana: number;
  readonly maxMana: number;
  readonly hand: number;
  readonly deck: number;
  readonly board: readonly UnitV[];
}
interface CardsView extends BoardView {
  readonly stage: "waiting" | "duel" | "draft" | "done";
  readonly duelNo: number;
  readonly duels: number;
  readonly countdown: number;
  readonly duel: { readonly turn: number; readonly turnNo: number; readonly timer: number; readonly tier: number; readonly sides: readonly SideV[] } | null;
  readonly log: readonly { p: number; kind: string; card: number; target: number }[];
  readonly players: readonly { id: number; bot: boolean; wins: number; losses: number; draws: number; deck: number }[];
  readonly hand?: readonly number[];
  readonly offer?: readonly number[] | null;
  readonly list?: readonly number[];
}

const genre = cardsGame();
const g = genre.game;
const manifest = cardsManifest();
const FINISH = [0x2b2b2b, 0xb2382e, 0xd4af37];
const W = 18;
const H = 13;
const cardName = (type: number) => WEAPON_NAMES[g.cards[type]?.id ?? ""]?.name ?? g.cards[type]?.id ?? "?";
const cardLine = (type: number) => WEAPON_NAMES[g.cards[type]?.id ?? ""]?.line ?? "";

let lastView: CardsView | null = null;
let selfId = 0;

/** The browser's autopilot (?autopilot=1): draft the first offer; on our turn play what we can afford, attack, end. */
const autopilot = (tick: number): RulesInput | null => {
  const v = lastView;
  if (!v || tick % 12 !== 0) return null;
  const go = (act: number, a = 0, b = 0, c = 0): RulesInput => ({ mx: 0, mz: 0, cx: 0, cz: 0, act, a, b, c });
  if (v.stage === "draft" && v.offer) return go(CardAct.Draft, 0);
  const d = v.duel;
  if (!d || d.turn !== selfId) return null;
  const me = d.sides.find((s) => s.player === selfId);
  const foe = d.sides.find((s) => s.player !== selfId);
  if (!me || !foe) return null;
  const guards = foe.board.map((u, i) => ({ u, i })).filter((x) => x.u.guard);
  const hand = v.hand ?? [];
  for (let i = 0; i < hand.length; i++) {
    const c = hand[i] as number;
    const def = g.cards[c]?.def;
    if (!def || def.cost > me.mana || (def.kind === "unit" && me.board.length >= g.table.boardMax)) continue;
    let target: number = Target.None;
    const fx = def.effect;
    if (fx?.target === "enemy") target = guards[0] ? Target.EnemyUnit + guards[0].i : Target.EnemyHero;
    if (fx?.target === "own_unit") {
      if (me.board.length === 0) continue;
      target = Target.OwnUnit;
    }
    return go(CardAct.Play, i, target, c);
  }
  const ready = me.board.findIndex((u) => u.ready && u.attack > 0);
  if (ready >= 0) return go(CardAct.Attack, ready, guards[0] ? Target.EnemyUnit + guards[0].i : Target.EnemyHero);
  return go(CardAct.End);
};

async function main(): Promise<void> {
  const app = await bootBoard({
    adapter: cardsAdapter(),
    manifest,
    template: TEMPLATE,
    place: PLACE,
    version: GAME_VERSION,
    labels: {
      title: TITLE,
      rules: RULE_NAMES,
      skus: SKU_NAMES,
      upgrades: UPGRADE_NAMES,
      loading: "Mixing the ink",
      help: "Click a card to play · click your creature, then a target, to attack · E or Enter ends the turn · Esc cancels",
    },
    theme: {
      accent: "#e8c872",
      gold: "#f2d48b",
      ink: "#f3ead6",
      dim: "#b3a68a",
      panel: "rgba(28, 22, 18, 0.88)",
      bg: "#17120e",
      font: '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
      display: '"Palatino Linotype", Palatino, Georgia, serif',
      radius: 3,
    },
    coin: INKWRIT_COIN,
    cosmetics: COSMETICS,
    swatch: (c) => `linear-gradient(135deg, ${cssColor(FINISH[c] ?? 0x2b2b2b)}, #120c08)`,
    ground: { w: W, h: H },
    preset: "studio",
    theme3d: "study",
    groundColor: 0x3a2a1c,
    pitch: 1.12,
    // The duel is on a desk: no voxel meadow growing through the mat.
    field: false,
    autopilot,
    soundKey: "inkwrit:sound",
  });
  selfId = app.self;
  const { stage, hud, clock, sfx } = app;
  sfx.define("flip", { wave: "noise", f0: 3000, f1: 900, ms: 70, gain: 0.3 }, { minGapMs: 40, voices: 3 });
  sfx.define("quill", { wave: "triangle", f0: 1500, f1: 900, ms: 60, gain: 0.25 }, { minGapMs: 40, voices: 2 });

  // ---- The desk: a wooden top with a felt mat, the piles, the lamp and the study's clutter beyond.
  const desk = new Mesh(new BoxGeometry(W, 0.4, H), new MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.7, metalness: 0.05 }));
  desk.position.y = -0.2;
  desk.receiveShadow = true;
  stage.add(desk);
  const mat = new Mesh(new PlaneGeometry(W - 2, H - 2), new MeshStandardMaterial({ map: matTexture(), roughness: 1 }));
  mat.rotation.x = -Math.PI / 2;
  mat.position.y = 0.01;
  mat.receiveShadow = true;
  stage.add(mat);
  // The hand sits over the bottom of the screen: frame the desk a little lower.
  stage.frameRect(0, 1.4, W, H + 2.5);
  const lamp = stage.model(LAMP_MODEL, 0.8, 0xffb347, 1.4);
  lamp.root.position.set(W / 2 - 1.4, 0, -H / 2 + 1.3);
  stage.add(lamp.root);
  SHELF_MODELS.forEach((id, i) => {
    const m = stage.model(id, 1.6 + (i % 2) * 0.6, 0x7a5a3a, 1.8);
    m.root.position.set(-W / 2 - 2 - (i % 2) * 1.5, 0, -H / 2 + 2 + i * 2.8);
    stage.add(m.root);
  });

  // Card meshes: face-down piles (decks) and the other scribe's hand, a face-up plinth under each creature.
  const back = cardBackTexture();
  const cardGeo = new BoxGeometry(1.5, 0.04, 2.1);
  const backMat = new MeshStandardMaterial({ map: back, roughness: 0.8 });
  const edgeMat = new MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.9 });
  const cardMats = [edgeMat, edgeMat, backMat, backMat, edgeMat, edgeMat];
  const piles: Group[] = [];
  for (const z of [3.4, -3.4]) {
    const pile = new Group();
    pile.position.set(W / 2 - 2.2, 0.02, z);
    stage.add(pile);
    piles.push(pile);
  }
  const foeHand = new Group();
  foeHand.position.set(1, 0.03, -5.2);
  stage.add(foeHand);
  const faceCache = new Map<number, CanvasTexture>();
  const faceOf = (type: number) => {
    let t = faceCache.get(type);
    if (!t) faceCache.set(type, (t = cardFaceTexture(type)));
    return t;
  };

  // ---- Creatures on the board: a library model standing on its card, with a DOM badge (attack and health, and a button).
  const units = new Map<string, { root: Group; model: Placed; type: number; card: Mesh; hp: number }>();
  const heroes = new Map<number, { root: Group; hp: number }>();
  const quills = new Map<number, Group>();
  const overlay = document.createElement("div");
  overlay.className = "hud";
  overlay.style.inset = "0";
  document.body.append(overlay);
  const style = document.createElement("style");
  style.textContent = `
.badge { position: absolute; transform: translate(-50%, -50%); pointer-events: auto; display: flex; gap: 3px; align-items: center; font: 800 13px var(--display, serif); cursor: pointer; }
.badge i { font-style: normal; min-width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; color: #fff; text-shadow: 0 1px 0 #000; border: 1px solid rgba(0,0,0,0.5); }
.badge i.a { background: #b8862f; }
.badge i.h { background: #a2312a; }
.badge.ready { filter: drop-shadow(0 0 6px #9dff7a); }
.badge.guard i.h { box-shadow: 0 0 0 2px #cfd8e3; }
.badge.target { filter: drop-shadow(0 0 7px #ff6a4a); animation: pulse 0.8s infinite alternate; }
.badge.picked { filter: drop-shadow(0 0 8px #f2d48b); transform: translate(-50%, -60%) scale(1.15); }
.hero { position: absolute; transform: translate(-50%, -50%); pointer-events: auto; text-align: center; font: 700 12px var(--display, serif); cursor: pointer; padding: 3px 9px; border-radius: 4px; background: var(--panel); border: 1px solid rgba(232, 200, 114, 0.4); }
.hero b { display: block; font-size: 20px; color: #ffb0a0; }
.hero.target { border-color: #ff6a4a; box-shadow: 0 0 12px #ff6a4a; }
@keyframes pulse { to { filter: drop-shadow(0 0 2px #ff6a4a); } }
#hand { position: fixed; left: 50%; bottom: max(8px, env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex; gap: 6px; z-index: 6; }
.card { pointer-events: auto; width: min(112px, 13vw); aspect-ratio: 5 / 7; border-radius: 6px; padding: 6px; box-sizing: border-box; display: flex; flex-direction: column; gap: 3px; background: linear-gradient(#efe4c8, #dccaa0); color: #2a1d12; border: 2px solid #3a2a1c; cursor: pointer; transition: transform 120ms; text-align: left; font: 13px var(--display, serif); }
.card:hover, .card.picked { transform: translateY(-14px); }
.card.poor { filter: grayscale(0.7) brightness(0.8); }
.card .cost { align-self: flex-start; width: 22px; height: 22px; border-radius: 50%; background: #1f3550; color: #fff; display: grid; place-items: center; font-weight: 800; }
.card b { font-size: 13px; line-height: 1.05; }
.card small { font-size: 11px; color: #5a4632; flex: 1; }
.card .stats { display: flex; justify-content: space-between; font-weight: 800; }
#endturn { position: fixed; right: 14px; bottom: max(100px, calc(env(safe-area-inset-bottom) + 90px)); z-index: 6; pointer-events: auto; min-width: 118px; font-weight: 800; }
#mana { position: fixed; right: 14px; bottom: max(150px, calc(env(safe-area-inset-bottom) + 140px)); z-index: 6; font: 800 14px var(--display, serif); color: #9fd0ff; text-shadow: 0 1px 0 #000; }
#banner2 { left: 50%; top: 40%; transform: translate(-50%, -50%); font: 900 38px var(--display, serif); letter-spacing: 0.18em; color: var(--accent); text-shadow: 0 2px 0 #000; opacity: 0; transition: opacity 300ms; }
#banner2.show { opacity: 1; }
#draft { position: fixed; inset: 0; z-index: 7; display: none; place-items: center; background: rgba(0,0,0,0.45); }
#draft.show { display: grid; }
#draft .row { display: flex; gap: 14px; }
#draft .card { width: 140px; }
#draft h2 { text-align: center; font: 900 20px var(--display, serif); letter-spacing: 0.2em; color: var(--accent); margin: 0 0 12px; }
#loglines { position: fixed; top: max(12px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%); z-index: 5; font-size: 12px; color: var(--dim); text-align: center; }
@media (max-height: 500px) { .card { width: 78px; padding: 4px; font-size: 11px; } .card small { display: none; } #endturn { bottom: 90px; min-width: 90px; } #mana { bottom: 130px; } }
`;
  document.head.append(style);
  const handEl = document.createElement("div");
  handEl.id = "hand";
  document.body.append(handEl);
  const endBtn = document.createElement("button");
  endBtn.id = "endturn";
  endBtn.className = "go";
  endBtn.textContent = "End turn";
  document.body.append(endBtn);
  const manaEl = document.createElement("div");
  manaEl.id = "mana";
  document.body.append(manaEl);
  const banner = document.createElement("div");
  banner.id = "banner2";
  banner.className = "hud";
  document.body.append(banner);
  const draftEl = document.createElement("div");
  draftEl.id = "draft";
  document.body.append(draftEl);
  const logEl = document.createElement("div");
  logEl.id = "loglines";
  logEl.className = "hud";
  document.body.append(logEl);

  // ---- Choosing: a card to play or a creature to attack with, then (when it aims) a target.
  type Pick = { kind: "play"; slot: number; type: number } | { kind: "attack"; from: number } | null;
  let picked: Pick = null;
  const myTurn = () => lastView?.duel?.turn === app.self && lastView.stage === "duel";
  const sides = () => {
    const d = lastView?.duel;
    return { me: d?.sides.find((s) => s.player === app.self), foe: d?.sides.find((s) => s.player !== app.self) };
  };
  const send = (act: number, a = 0, b = 0, c = 0) => {
    clock.act(act, a, b, c);
    sfx.play("quill");
  };
  const target = (t: number) => {
    const p = picked;
    if (!p || !myTurn()) return;
    if (p.kind === "play") send(CardAct.Play, p.slot, t, p.type);
    else send(CardAct.Attack, p.from, t);
    picked = null;
  };
  endBtn.addEventListener("click", () => {
    if (!myTurn()) return;
    picked = null;
    send(CardAct.End);
  });
  addEventListener("keydown", (e) => {
    if (e.code === "Escape") picked = null;
    if ((e.code === "KeyE" || e.code === "Enter") && myTurn()) {
      picked = null;
      send(CardAct.End);
    }
  });
  app.canvas.addEventListener("pointermove", (e) => {
    const p = stage.pick(e.clientX, e.clientY, app.canvas.getBoundingClientRect());
    if (p) clock.cursor(p.x, p.z);
  });
  app.canvas.addEventListener("pointerdown", () => {
    picked = null;
  });

  const unitX = (i: number, n: number) => 1 + (i - (n - 1) / 2) * 2.2;
  const sideZ = (mine: boolean) => (mine ? 1.9 : -1.9);
  const heroZ = (mine: boolean) => (mine ? 2.6 : -2.6);

  let handKey = "";
  let draftKey = "";
  let lastTurn = -1;
  let lastStage = "";
  let lastLog = "";
  let bannerTimer = 0;
  const showBanner = (text: string) => {
    banner.textContent = text;
    banner.classList.add("show");
    clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => banner.classList.remove("show"), 1300);
  };
  const badges = new Map<string, HTMLElement>();
  const heroTags = new Map<number, HTMLElement>();

  app.loop((dt, now) => {
    const v = app.view<CardsView>();
    lastView = v;
    const t = now / 1000;
    const view = app.conn().net.render(now);
    const wpx = app.canvas.clientWidth;
    const hpx = app.canvas.clientHeight;
    const proj = (x: number, y: number, z: number) => stage.project(x, y, z, wpx, hpx);

    // Quills: ours predicted, the other scribe's interpolated.
    const seen = new Set<number>();
    const placeQuill = (e: InterpolatedEntity | undefined, owner: number) => {
      if (!e) return;
      seen.add(owner);
      let q = quills.get(owner);
      if (!q) {
        q = quill(KEEPER_COLORS[(owner - 1) % KEEPER_COLORS.length] ?? 0x2f5d8a, FINISH[Math.round(e.values[RF.value] ?? 0)]);
        quills.set(owner, q);
        stage.add(q);
      }
      q.position.set((e.values[RF.x] ?? 0) / UNITS, 1.2 + Math.sin(t * 2.4 + owner) * 0.08, (e.values[RF.z] ?? 0) / UNITS);
    };
    placeQuill(view.self, app.self);
    for (const e of view.others) if (e.kind === RulesKind.Avatar) placeQuill(e, e.owner);
    for (const [o, q] of quills) {
      if (seen.has(o)) continue;
      stage.scene.remove(q);
      quills.delete(o);
    }
    if (!v) return;
    const d = v.duel;
    const { me, foe } = sides();

    // Creatures.
    const want = new Set<string>();
    for (const side of d?.sides ?? []) {
      const mine = side.player === app.self;
      side.board.forEach((u, i) => {
        const key = `${side.player}:${i}:${u.type}`;
        want.add(key);
        const x = unitX(i, side.board.length);
        const z = sideZ(mine);
        let un = units.get(key);
        if (!un) {
          const root = new Group();
          const c = new Mesh(cardGeo, [edgeMat, edgeMat, new MeshStandardMaterial({ map: faceOf(u.type), roughness: 0.85 }), backMat, edgeMat, edgeMat]);
          c.position.y = 0.03;
          root.add(c);
          const model = stage.model(g.cards[u.type]?.def.model ?? "style.lowpoly.imp", 1.15, KEEPER_COLORS[(side.player - 1) % KEEPER_COLORS.length], 1.7);
          model.root.position.y = 0.05;
          if (!mine) model.root.rotation.y = Math.PI;
          root.add(model.root);
          root.position.set(x, 0, z);
          stage.add(root);
          un = { root, model, type: u.type, card: c, hp: u.health };
          units.set(key, un);
          stage.burst("magic", x, 0.6, z, 0x6fa8dc, 16);
          sfx.play("flip");
        }
        un.root.position.x += (x - un.root.position.x) * Math.min(1, dt * 10);
        if (u.health < un.hp) {
          stage.burst("hitSpark", un.root.position.x, 0.8, z, 0xffd27a, 10);
          sfx.play("hit");
          floatText(proj(un.root.position.x, 1.8, z), `-${un.hp - u.health}`);
        }
        un.hp = u.health;
        un.model.root.position.y = 0.05 + (u.ready && mine ? Math.abs(Math.sin(t * 4)) * 0.08 : 0);
        // Its badge: attack and health, the button that picks it (yours) or aims at it (theirs).
        let b = badges.get(key);
        if (!b) {
          b = document.createElement("div");
          b.className = "badge";
          b.innerHTML = `<i class="a"></i><i class="h"></i>`;
          const idx = i;
          b.addEventListener("pointerdown", (ev) => {
            ev.stopPropagation();
            sfx.unlock();
            if (mine) {
              if (picked?.kind === "play" && g.cards[picked.type]?.def.effect?.target === "own_unit") return target(Target.OwnUnit + idx);
              if (myTurn()) picked = { kind: "attack", from: idx };
            } else target(Target.EnemyUnit + idx);
          });
          overlay.append(b);
          badges.set(key, b);
        }
        const p = proj(un.root.position.x, 0.2, z + (mine ? 1.2 : -1.2));
        b.style.left = `${p.x}px`;
        b.style.top = `${p.y}px`;
        (b.firstChild as HTMLElement).textContent = String(u.attack);
        (b.lastChild as HTMLElement).textContent = String(u.health);
        b.classList.toggle("ready", mine && u.ready && myTurn());
        b.classList.toggle("guard", u.guard);
        b.classList.toggle("picked", mine && picked?.kind === "attack" && picked.from === i);
        b.classList.toggle("target", !mine && picked !== null && (!foe?.board.some((x) => x.guard) || u.guard || picked.kind === "play"));
      });
    }
    for (const [key, un] of units) {
      if (want.has(key)) continue;
      stage.burst("kill", un.root.position.x, 0.6, un.root.position.z, 0x1f1a30, 22);
      stage.scene.remove(un.root);
      units.delete(key);
      badges.get(key)?.remove();
      badges.delete(key);
    }

    // Heroes: the scribes themselves at each end of the desk, with their health as the target button.
    const heroSeen = new Set<number>();
    for (const side of d?.sides ?? []) {
      const mine = side.player === app.self;
      heroSeen.add(side.player);
      let h = heroes.get(side.player);
      if (!h) {
        const root = new Group();
        const m = stage.model(manifest.game.players.prefab, 2.2, KEEPER_COLORS[(side.player - 1) % KEEPER_COLORS.length]);
        if (!mine) m.root.rotation.y = Math.PI;
        root.add(m.root);
        root.position.set(-W / 2 + 1.6, 0, heroZ(mine));
        stage.add(root);
        h = { root, hp: side.hero };
        heroes.set(side.player, h);
      }
      if (side.hero < h.hp) {
        stage.burst("burst", h.root.position.x, 1.4, h.root.position.z, 0xff6a4a, 18);
        stage.kick(0.25);
        sfx.play(mine ? "hurt" : "impact");
        floatText(proj(h.root.position.x, 2.6, h.root.position.z), `-${h.hp - side.hero}`);
      }
      h.hp = side.hero;
      let tag = heroTags.get(side.player);
      if (!tag) {
        tag = document.createElement("div");
        tag.className = "hero";
        tag.addEventListener("pointerdown", (ev) => {
          ev.stopPropagation();
          target(mine ? Target.OwnHero : Target.EnemyHero);
        });
        overlay.append(tag);
        heroTags.set(side.player, tag);
      }
      const p = proj(h.root.position.x, 0, h.root.position.z + (mine ? 1.3 : -1.0));
      tag.style.left = `${p.x}px`;
      tag.style.top = `${p.y}px`;
      const who = mine ? "You" : v.players.find((x) => x.id === side.player)?.bot ? `AI scribe, tier ${d ? d.tier + 1 : 1}` : `P${side.player}`;
      tag.innerHTML = `<b>${side.hero}</b>${who}`;
      tag.classList.toggle("target", !mine && picked !== null && !foe?.board.some((x) => x.guard));
    }
    for (const [p, h] of heroes) {
      if (heroSeen.has(p)) continue;
      stage.scene.remove(h.root);
      heroes.delete(p);
      heroTags.get(p)?.remove();
      heroTags.delete(p);
    }

    // Piles and the other scribe's face-down hand.
    const stack = (pile: Group, n: number) => {
      while (pile.children.length < Math.min(30, n)) {
        const c = new Mesh(cardGeo, cardMats);
        c.position.y = pile.children.length * 0.045;
        c.rotation.y = (pile.children.length % 3) * 0.02;
        pile.add(c);
      }
      while (pile.children.length > Math.min(30, n)) pile.remove(pile.children[pile.children.length - 1] as Mesh);
    };
    stack(piles[0] as Group, me?.deck ?? 0);
    stack(piles[1] as Group, foe?.deck ?? 0);
    const fh = foe?.hand ?? 0;
    while (foeHand.children.length < fh) foeHand.add(new Mesh(cardGeo, cardMats));
    while (foeHand.children.length > fh) foeHand.remove(foeHand.children[foeHand.children.length - 1] as Mesh);
    foeHand.children.forEach((c, i) => {
      const k = i - (fh - 1) / 2;
      c.position.set(k * 0.9, 0.02 + i * 0.01, Math.abs(k) * 0.12);
      c.rotation.y = -k * 0.08;
    });

    // Your hand (DOM): only your view carries it.
    const hand = v.hand ?? [];
    const key = `${hand.join(",")}|${me?.mana ?? 0}|${myTurn()}|${picked?.kind === "play" ? picked.slot : -1}`;
    if (key !== handKey) {
      handKey = key;
      handEl.innerHTML = "";
      hand.forEach((type, slot) => {
        const def = g.cards[type]?.def;
        const el = cardEl(type);
        if (!def || def.cost > (me?.mana ?? 0) || !myTurn()) el.classList.add("poor");
        if (picked?.kind === "play" && picked.slot === slot) el.classList.add("picked");
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          sfx.unlock();
          if (!myTurn() || !def) return;
          if (def.cost > (me?.mana ?? 0)) return hud.toast("Not enough ink");
          const aim = def.effect?.target;
          if (aim === "enemy" || (aim === "own_unit" && (me?.board.length ?? 0) > 0)) {
            picked = { kind: "play", slot, type };
            handKey = "";
            return;
          }
          picked = null;
          send(CardAct.Play, slot, Target.None, type);
        });
        handEl.append(el);
      });
    }
    // The draft between duels: three cards, only you see yours.
    const offer = v.stage === "draft" ? (v.offer ?? null) : null;
    const dk = offer ? offer.join(",") : "";
    if (dk !== draftKey) {
      draftKey = dk;
      draftEl.innerHTML = "";
      draftEl.classList.toggle("show", offer !== null && !app.preview);
      if (offer) {
        const box = document.createElement("div");
        box.innerHTML = `<h2>DRAFT A CARD</h2><div class="row"></div>`;
        offer.forEach((type, i) => {
          const el = cardEl(type);
          el.addEventListener("click", () => send(CardAct.Draft, i));
          (box.lastChild as HTMLElement).append(el);
        });
        draftEl.append(box);
      }
    }

    // Turn changes, results, the log.
    if (d && d.turnNo !== lastTurn) {
      lastTurn = d.turnNo;
      if (d.turn === app.self) {
        showBanner("YOUR TURN");
        sfx.play("pick");
      }
    }
    if (v.stage !== lastStage) {
      if (v.stage === "draft" || v.stage === "done") {
        const lastWin = v.log.filter((l) => l.kind === "win" || l.kind === "draw").at(-1);
        if (lastWin) {
          const won = lastWin.kind === "win" && lastWin.p === app.self;
          showBanner(lastWin.kind === "draw" ? "DRAWN" : won ? "VICTORY" : "DEFEAT");
          sfx.play(won ? "levelUp" : "hurt");
        }
      }
      lastStage = v.stage;
    }
    const lk = v.log.map((l) => `${l.p}${l.kind}${l.card}${l.target}`).join("|");
    if (lk !== lastLog) {
      lastLog = lk;
      const l = v.log.at(-1);
      logEl.textContent = l ? `${l.p === app.self ? "You" : "They"} ${l.kind === "play" ? `played ${cardName(l.card)}` : l.kind === "attack" ? `attacked with ${cardName(l.card)}` : l.kind === "end" ? "ended the turn" : l.kind === "win" ? "won the duel" : "drew"}` : "";
    }
    const mine = v.players.find((p) => p.id === app.self);
    hud.status([
      ["DUEL", `${Math.max(1, v.duelNo)} / ${v.duels}`],
      ["RECORD", `${mine?.wins ?? 0}-${mine?.losses ?? 0}`],
      v.stage === "duel" && d ? [d.turn === app.self ? "YOUR TURN" : "THEIR TURN", `${d.timer}s`] : v.stage === "waiting" ? ["WAITING", "for a scribe"] : v.stage === "draft" ? ["DRAFT", `${v.countdown}s`] : ["RUN", "over"],
      ["DECK", `${mine?.deck ?? 0} cards`],
    ]);
    manaEl.textContent = me ? `INK ${me.mana} / ${me.maxMana}` : "";
    endBtn.disabled = !myTurn();
    endBtn.style.visibility = d ? "visible" : "hidden";
    const won = (mine?.wins ?? 0) > (mine?.losses ?? 0);
    hud.end(v.phase === "ended", won ? "THE PAGE IS YOURS" : "BLOTTED OUT", `${mine?.wins ?? 0} won, ${mine?.losses ?? 0} lost`, v.endsIn ?? null);
  });
  app.extraStats(() => ({ units: units.size, hand: lastView?.hand?.length ?? 0, duel: lastView?.duelNo ?? 0, stage: lastView?.stage ?? "" }));

  function floatText(p: { x: number; y: number }, text: string): void {
    const el = document.createElement("div");
    el.className = "hud";
    el.textContent = text;
    el.style.cssText = `left:${p.x}px;top:${p.y}px;font:900 22px var(--display, serif);color:#ff8a6a;text-shadow:0 2px 0 #000;transform:translate(-50%,-50%);transition:transform 700ms ease-out, opacity 700ms;`;
    document.body.append(el);
    requestAnimationFrame(() => {
      el.style.transform = "translate(-50%, -160%)";
      el.style.opacity = "0";
    });
    setTimeout(() => el.remove(), 800);
  }
}

/** A hand or draft card as DOM: cost, name, its line, attack and health for a creature. */
function cardEl(type: number): HTMLButtonElement {
  const def = g.cards[type]?.def;
  const el = document.createElement("button");
  el.className = "card";
  el.innerHTML = `<span class="cost"></span><b></b><small></small><span class="stats"><span></span><span></span></span>`;
  (el.querySelector(".cost") as HTMLElement).textContent = String(def?.cost ?? 0);
  (el.querySelector("b") as HTMLElement).textContent = cardName(type);
  (el.querySelector("small") as HTMLElement).textContent = `${def?.kind === "spell" ? "Spell. " : def?.guard ? "Guard. " : def?.rush ? "Rush. " : ""}${cardLine(type)}`;
  const st = el.querySelectorAll(".stats span");
  if (def?.kind === "unit") {
    (st[0] as HTMLElement).textContent = `⚔ ${def.attack}`;
    (st[1] as HTMLElement).textContent = `♥ ${def.health}`;
  }
  return el;
}

/** The quill each scribe points with: a feather on a nib, in the player's colour (a finish recolours the nib). */
function quill(color: number, finish: number | undefined): Group {
  const q = new Group();
  const vane = new Mesh(new ConeGeometry(0.16, 1.3, 6), new MeshStandardMaterial({ color: new Color(0xf2ead8), roughness: 0.8 }));
  vane.position.y = 0.7;
  const nib = new Mesh(new CylinderGeometry(0.04, 0.0, 0.35, 6), new MeshStandardMaterial({ color: finish ?? color, metalness: 0.6, roughness: 0.3, emissive: new Color(color), emissiveIntensity: 0.25 }));
  nib.position.y = -0.05;
  q.add(vane, nib);
  q.rotation.z = 0.5;
  return q;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas");
  draw(ctx);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function matTexture(): CanvasTexture {
  return canvasTexture(512, 360, (c) => {
    c.fillStyle = "#1f3a2e";
    c.fillRect(0, 0, 512, 360);
    let s = 9;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 4000; i++) {
      c.fillStyle = `rgba(${r() > 0.5 ? 40 : 20}, ${60 + r() * 20}, ${45 + r() * 15}, 0.5)`;
      c.fillRect(r() * 512, r() * 360, 2, 2);
    }
    c.strokeStyle = "rgba(232, 200, 114, 0.55)";
    c.lineWidth = 3;
    c.strokeRect(14, 14, 484, 332);
    c.setLineDash([6, 6]);
    c.beginPath();
    c.moveTo(30, 180);
    c.lineTo(482, 180);
    c.stroke();
  });
}

function cardBackTexture(): CanvasTexture {
  return canvasTexture(150, 210, (c) => {
    c.fillStyle = "#1f3550";
    c.fillRect(0, 0, 150, 210);
    c.strokeStyle = "#e8c872";
    c.lineWidth = 6;
    c.strokeRect(8, 8, 134, 194);
    c.fillStyle = "#e8c872";
    c.beginPath();
    c.moveTo(75, 60);
    c.quadraticCurveTo(110, 110, 75, 150);
    c.quadraticCurveTo(40, 110, 75, 60);
    c.fill();
  });
}

function cardFaceTexture(type: number): CanvasTexture {
  const def = g.cards[type]?.def;
  return canvasTexture(150, 210, (c) => {
    c.fillStyle = "#efe4c8";
    c.fillRect(0, 0, 150, 210);
    c.strokeStyle = "#3a2a1c";
    c.lineWidth = 6;
    c.strokeRect(5, 5, 140, 200);
    c.fillStyle = "#1f3550";
    c.beginPath();
    c.arc(26, 26, 16, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#fff";
    c.font = "bold 20px serif";
    c.textAlign = "center";
    c.fillText(String(def?.cost ?? 0), 26, 33);
    c.fillStyle = "#2a1d12";
    c.font = "bold 15px serif";
    c.fillText(cardName(type), 75, 190);
  });
}

main().catch((e: unknown) => {
  const t = document.getElementById("banner-text");
  if (t) t.textContent = `Could not start: ${e instanceof Error ? e.message : String(e)}`;
  console.error(e);
});
