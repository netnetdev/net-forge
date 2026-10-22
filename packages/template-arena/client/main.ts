/**
 * VOLTYARD client: join a room by link, predict your own wirejack (move,
 * aim, weapon and cooldowns), draw everyone else ~100 ms in the past, and
 * dress it with the game-feel kit. The server decides every hit; beams are
 * lag-compensated, so you hit what you saw.
 *
 * URL parameters:
 *   ?room=<id>        join a friend's instance (the Invite button makes this link)
 *   ?place=<name>     the place (default "yard")
 *   ?server=<url>     room server (default: VITE_ROOMS_URL, else this host on :2567)
 *   ?webgl=1          force the WebGL2 backend
 *   ?autopilot=1      a bot plays (headless measurement and screenshots); =newcomer plays loose, like a new person
 *   ?preview=1        the camera frames the biggest fight instead of our own fighter (the Launcher's style previews)
 *   ?stats=1          show frame, network and server numbers (also the ` key)
 *   ?shapes=1         draw the fallback shapes instead of library models
 *   ?style=<style>    draw the game in another art style (toon, ps1, pixel, voxel, handdrawn; default: the style game.ts declares)
 *   ?library=<url>    asset library base URL (default: VITE_LIBRARY_URL, else ./library)
 *   ?host=netnet, ?coin=, ?title=, ?player=   set by Net Forge (client/host.ts)
 */
import { Button, EntityKind, initSim, resolveConfig } from "@netnetcapital/engine-sim";
import type { InputCommand } from "@netnetcapital/engine-sim";
import { arenaBotInput, arenaBotMemory, F, PLAYER_UNITS, CROWD_UNITS } from "@netnetcapital/engine/game";
import type { EngineRoomWorld, RunInfo } from "@netnetcapital/engine/game";
import { guestId, joinRoom, savedSession } from "@netnetcapital/engine/net";
import type { RoomConnection } from "@netnetcapital/engine/net";
import { createRenderer, DamageNumbers, FeelAudio, FeelKit, FrameStats, pickStyle, SoundPlayer } from "@netnetcapital/engine/runtime";
import { soundBank } from "@netnetcapital/asset-library";
import { LibraryClient } from "@netnetcapital/asset-library/three";
import { arenaAdapter, arenaGame, COSMETICS, GAME_VERSION, PLACE, TEMPLATE } from "../src/manifest.js";
import { COSMETIC_SKUS, mockKit, UPGRADE_SKUS } from "../src/store.js";
import type { KitStoreBridge, SkuPrice } from "../src/store.js";
import { ARENA_SAMPLES, defineArenaCues, killConfirm } from "./audio.js";
import { hostFlags, namedPlayer, onHostPlayer, postReady, storeNote } from "./host.js";
import type { PlayerMode } from "./host.js";
import { Hud } from "./hud.js";
import { ArenaInput } from "./input.js";
import { SKU_NAMES, TITLE, UPGRADE_NAMES } from "./names.js";
import { css, finishOf } from "./palette.js";
import { ArenaScene } from "./scene.js";
import type { SceneEntity } from "./scene.js";
import { gearOf, wireGear, wirePot, wireStake } from "./stake.js";

export interface ArenaStats {
  backend: string;
  fps: number;
  frameMs: { mean: number; p50: number; p95: number; p99: number };
  cpuMs: { mean: number; p95: number };
  drawCalls: number;
  triangles: number;
  playersInView: number;
  entitiesInView: number;
  /** ?preview=1: standing fighters in the fight the camera frames. */
  previewFight: number;
  downKBps: number;
  upKBps: number;
  rttMs: number;
  joinMs: number;
  firstFrameMs: number;
  corrections: number;
  inputBuffer: number | null;
  frames: number;
  roomId: string;
  phase: string;
  kills: number;
  deaths: number;
  pixelRatio: number;
  /** Game-feel effects fired so far. */
  feel: { numbers: number; beams: number; flashes: number; bursts: number; shots: number; hitStops: number; shakes: number; hits: number; kills: number };
  /** Library samples decoded and failed, and whether the music loop started. */
  sound: { cues: number; failed: number; music: boolean; played: number };
}

declare global {
  interface Window {
    __arena?: ArenaStats;
  }
}

const params = new URLSearchParams(location.search);
// The Kit flags (client/host.ts): framed by Net Forge (?host=netnet),
// the host draws Invite, so the game hides its own and the two never both
// show; it names the game's coin and title, and says whether play pays the
// person at the screen. Standalone play reads none of this.
const launcher = hostFlags(params);
if (launcher.framed) document.documentElement.dataset.host = "netnet";
let playerMode: PlayerMode = launcher.player;
// The mode the host has named, on the URL or in a message: once it has, it
// alone says whether coins are real, for the coin box and the store alike.
let hostMode: PlayerMode | null = namedPlayer(params);
let onPlayer: ((mode: PlayerMode) => void) | null = null;
onHostPlayer(launcher, (mode) => {
  playerMode = mode;
  hostMode = mode;
  onPlayer?.(mode);
});

/**
 * A game played in Net Forge names its own coin (?coin=TICKER, 2 to 6
 * capitals or digits), so its HUD never shows the template's coin. The
 * template's own token keeps its logo.
 */
function withDraftCoin(kit: KitStoreBridge): KitStoreBridge {
  const coin = launcher.coin;
  if (!coin || coin === kit.coins.symbol()) return kit;
  return { ...kit, coins: { ...kit.coins, name: () => coin, symbol: () => coin, logo: () => null } };
}
/** The wordmark: the game's own name when Net Forge names it, else the template's. */
const GAME_TITLE = launcher.title ?? TITLE;
const bootAt = performance.now();
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const endpoint = params.get("server") ?? env.VITE_ROOMS_URL ?? `${location.protocol}//${location.hostname}:2567`;
const autopilotMode = params.get("autopilot");
const autopilot = autopilotMode === "1" || autopilotMode === "newcomer";
const banner = document.getElementById("banner");
const bannerText = document.getElementById("banner-text");
const host = document.getElementById("game");
document.title = GAME_TITLE;
const bannerTitle = banner?.querySelector("b");
if (bannerTitle) bannerTitle.textContent = GAME_TITLE.toUpperCase();

async function main(): Promise<void> {
  if (!host) throw new Error("missing #game");
  await initSim();
  const game = arenaGame();
  const config = resolveConfig(game.sim);
  const canvas = document.createElement("canvas");
  host.append(canvas);
  const handle = await createRenderer(canvas, { forceWebGL: params.get("webgl") === "1", antialias: true });

  const adapter = arenaAdapter();
  const friendRoomId = params.get("room") ?? undefined;
  const place = params.get("place") ?? PLACE;
  const joinStart = performance.now();
  // Saves (owned finishes, settings) live on the room server under the signed-in wallet or this browser's guest id.
  const session = savedSession(endpoint);
  const conn: RoomConnection<EngineRoomWorld, InputCommand> = await joinRoom(adapter, {
    endpoint,
    place,
    template: TEMPLATE,
    guest: guestId(),
    ...(session ? { session: session.token } : {}),
    ...(friendRoomId ? { friendRoomId } : {}),
  });
  const joinMs = performance.now() - joinStart;
  const self = conn.welcome.player;
  if (friendRoomId && conn.roomId !== friendRoomId) setTimeout(() => hud.toast("Room full, new room"), 500);
  if (conn.welcome.version !== GAME_VERSION) setTimeout(() => hud.toast("Update ready. Reload."), 800);
  const linkFor = (base: string) =>
    `${base}?room=${conn.roomId}${place !== PLACE ? `&place=${encodeURIComponent(place)}` : ""}${params.has("server") ? `&server=${encodeURIComponent(endpoint)}` : ""}`;
  history.replaceState(null, "", `${linkFor(location.pathname)}${autopilot ? `&autopilot=${autopilotMode}` : ""}${params.has("webgl") ? "&webgl=1" : ""}${params.has("stats") ? "&stats=1" : ""}${params.has("style") ? `&style=${encodeURIComponent(params.get("style") ?? "")}` : ""}`);

  // The asset library: real models by library id (./library next to the page, or the published CID). ?shapes=1 draws the fallback shapes only.
  const libraryBase = params.get("library") ?? env.VITE_LIBRARY_URL ?? "./library";
  // ?style=<art style> previews the game in another style (default: the one game.ts declares).
  const artStyle = pickStyle(game.manifest.game.style, params.get("style"));
  const library = params.get("shapes") === "1" ? null : new LibraryClient(handle, { baseUrl: libraryBase, style: artStyle });
  // The engine's feel kit: hit-stop clock, trauma shake, flash, knockback, numbers, sound, rumble.
  const sfx = new FeelAudio();
  defineArenaCues(sfx);
  // Real CC0 samples for the cues and a music loop, from the library's audio section. Starts on the first press; the mute is remembered.
  const sound = new SoundPlayer(sfx, { key: "voltyard:sound", musicVolume: 0.3 });
  sound.load(soundBank(libraryBase, { cues: ARENA_SAMPLES }));
  const feel = new FeelKit({ preset: "default", audio: sfx, numbers: new DamageNumbers(document.body) });
  const scene = new ArenaScene(handle, game, config, library, feel, { style: artStyle });
  if (params.get("preview") === "1") scene.setPreview(true);
  feel.camera = scene.rig;
  feel.project = (x, y, z) => scene.project(x, y, z, Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
  let lastView: { self: SceneEntity | undefined; others: readonly SceneEntity[] } = { self: undefined, others: [] };
  const aimFrom = (cx: number, cy: number): number | null => {
    const me = lastView.self;
    if (!me) return null;
    const rect = canvas.getBoundingClientRect();
    const p = scene.groundPoint(cx - rect.left, cy - rect.top, rect.width, rect.height);
    if (!p) return null;
    const dx = p.x - (me.values[F.px] ?? 0) / PLAYER_UNITS;
    const dz = p.z - (me.values[F.pz] ?? 0) / PLAYER_UNITS;
    return dx * dx + dz * dz < 0.01 ? null : Math.atan2(-dx, -dz);
  };
  const input = new ArenaInput(document.body, aimFrom);
  const prices: Record<string, SkuPrice> = Object.fromEntries(game.manifest.skus);
  // The Kit plugs in here (packages/kit, kit.init({ game })): kit.coins and
  // kit.store have these exact names. The mock stands in until the token is live.
  const kit: KitStoreBridge = withDraftCoin(mockKit({ earned: 120, wallet: 0, usdg: 5 }, prices));
  let storeOpen = false;
  let run: RunInfo | null = null;
  conn.onRun((info) => {
    run = info as RunInfo;
  });

  const hud = new Hud(game, config, self, {
    pickWeapon: (slot) => {
      sfx.unlock();
      input.press(Button.Choice1 << slot);
    },
    invite: () => {
      const url = linkFor(`${location.origin}${location.pathname}`);
      void navigator.clipboard?.writeText(url).then(
        () => hud.toast("Invite link copied"),
        () => hud.toast(url),
      );
    },
    toggleStore: () => {
      storeOpen = !storeOpen;
      document.getElementById("store")?.classList.toggle("show", storeOpen);
    },
    toggleSound: () => {
      sfx.unlock();
      return sound.toggle();
    },
  });
  conn.onEarn((e) => hud.earned(e.rule, e.units));
  // The mute is remembered between visits: the button names the current state.
  const soundBtn = document.getElementById("sound");
  if (soundBtn && sound.muted) soundBtn.textContent = "Sound off";
  hud.coin(kit.coins.name(), kit.coins.symbol(), kit.coins.logo());
  wireStake(conn, kit, (t) => hud.toast(t));
  wirePot(conn, kit, (t) => hud.toast(t));
  wireGear(gearOf(game.manifest.skus, SKU_NAMES), kit, (t) => hud.toast(t));
  hud.title(GAME_TITLE);
  // Signed out in Net Forge, the HUD says play is not earning instead of showing a balance that never moves.
  hud.player(playerMode);
  // The store's note follows the same mode as the coin box (client/host.ts storeNote).
  const note = document.getElementById("store-note");
  const showNote = () => {
    if (note) note.textContent = storeNote(hostMode, conn.welcome.earnLive, kit.coins.symbol());
  };
  showNote();
  onPlayer = (mode) => {
    hud.player(mode);
    showNote();
  };
  postReady(launcher);

  // The store: round upgrades (spent, applied by the room) and finishes (owned for good).
  const sym = kit.coins.symbol();
  const upgradesEl = document.getElementById("store-upgrades");
  for (const id of UPGRADE_SKUS) {
    const price = prices[id]?.coins;
    if (price === undefined || !upgradesEl) continue;
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `<div><div><span class="name"></span><br /><small></small></div></div><button></button>`;
    (row.querySelector(".name") as HTMLElement).textContent = SKU_NAMES[id] ?? id;
    (row.querySelector("small") as HTMLElement).textContent = UPGRADE_NAMES[id]?.line ?? "";
    const btn = row.querySelector("button") as HTMLButtonElement;
    btn.textContent = `${price} ${sym}`;
    btn.addEventListener("click", () => void buyUpgrade(id, price));
    upgradesEl.append(row);
  }
  const finishesEl = document.getElementById("store-finishes");
  for (const id of COSMETIC_SKUS) {
    const price = prices[id]?.coins;
    const cosmetic = COSMETICS[id];
    if (price === undefined || cosmetic === undefined || !finishesEl) continue;
    const look = finishOf(cosmetic, 0x16e0ff);
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `<div><span class="swatch"></span><div><span class="name"></span><br /><small>Finish</small></div></div><button></button>`;
    (row.querySelector(".swatch") as HTMLElement).style.background = `linear-gradient(135deg, ${css(look.body)}, ${css(look.glow)})`;
    (row.querySelector(".name") as HTMLElement).textContent = SKU_NAMES[id] ?? id;
    const btn = row.querySelector("button") as HTMLButtonElement;
    btn.textContent = `${price} ${sym}`;
    btn.addEventListener("click", () => void buyFinish(id, cosmetic, btn));
    finishesEl.append(row);
  }

  async function buyUpgrade(id: string, price: number): Promise<void> {
    sfx.unlock();
    let proof: string | null;
    try {
      proof = (await kit.coins.spend(price, id)).key;
    } catch {
      hud.toast(`Not enough ${sym}`);
      return;
    }
    // The spend's key proves the paid command to the room, once.
    const r = await conn.command({ name: id, ...(proof ? { proof } : {}) });
    hud.toast(r.ok ? `${SKU_NAMES[id] ?? id} on` : r.reason === "store not live" ? "Store opens at launch" : "Already on this round");
  }
  async function buyFinish(id: string, cosmetic: number, btn: HTMLButtonElement): Promise<void> {
    sfx.unlock();
    if (!kit.store.owns(id)) {
      try {
        await kit.store.buy(id, { pay: "coins" });
      } catch {
        hud.toast(`Not enough ${sym}`);
        return;
      }
    }
    const r = await conn.command({ name: "cosmetic", value: cosmetic });
    if (!r.ok) {
      hud.toast("Finishes open at launch");
      return;
    }
    for (const b of finishesEl?.querySelectorAll("button") ?? []) if (b !== btn && b.textContent === "Equipped") b.textContent = "Equip";
    btn.textContent = "Equipped";
  }

  // RTT probe every 2 s (a control message, not the hot path).
  let rtt = 0;
  conn.room.onMessage("pong", (t: number) => {
    rtt = performance.now() - t;
  });
  setInterval(() => conn.room.send("ping", performance.now()), 2000);

  // Input on its own fixed clock, steered by the server's queue (clock adjustment).
  let nextTick = performance.now();
  let ticks = 0;
  const memory = arenaBotMemory();
  const loadout = game.loadout.map((wi) => {
    const w = config.content.weapons[wi];
    return { kind: w?.kind ?? "blaster", range: w?.range ?? 10, count: w?.count ?? 1 };
  });
  let autoAim = 0;
  const autopilotInput = (): InputCommand => {
    const me = lastView.self;
    if (!me) return adapter.input.idle;
    const opponents = lastView.others
      .filter((e) => e.kind === EntityKind.Player && ((e.values[F.flags] ?? 0) & 2) === 0)
      .map((e) => ({ id: e.owner, x: (e.values[F.px] ?? 0) / PLAYER_UNITS, z: (e.values[F.pz] ?? 0) / PLAYER_UNITS }));
    const pickups = lastView.others.filter((e) => e.kind === EntityKind.Pickup).map((e) => ({ x: (e.values[F.ex] ?? 0) / CROWD_UNITS, z: (e.values[F.ez] ?? 0) / CROWD_UNITS }));
    const cmd = arenaBotInput(
      {
        id: self,
        x: (me.values[F.px] ?? 0) / PLAYER_UNITS,
        z: (me.values[F.pz] ?? 0) / PLAYER_UNITS,
        health: me.values[F.health] ?? 0,
        maxHealth: 100,
        up: ((me.values[F.flags] ?? 0) & 2) === 0 && (run?.phase ?? "playing") === "playing",
        slot: (me.values[F.choices] ?? 0) & 3,
        loadout,
        opponents,
        pickups,
        pillars: config.arena.pillars,
        half: config.arena.halfExtent,
        ...(autopilotMode === "newcomer" ? { skill: 0.35 } : {}),
      },
      memory,
      ticks,
      config.tickRate,
    );
    autoAim = cmd.yaw;
    return cmd;
  };
  setInterval(() => {
    const now = performance.now();
    let n = 0;
    while (nextTick <= now && n < 8) {
      const cmd = autopilot ? autopilotInput() : input.sample(ticks);
      conn.net.tick(cmd, now);
      ticks++;
      nextTick += conn.net.tickIntervalMs();
      n++;
    }
    if (n === 8) nextTick = now + conn.net.tickIntervalMs();
  }, 4);
  addEventListener("pointerdown", () => sfx.unlock(), { once: true });
  addEventListener("keydown", () => sfx.unlock(), { once: true });
  addEventListener("keydown", (e) => {
    if (e.code === "Backquote") document.getElementById("stats")?.classList.toggle("show");
  });
  if (params.get("stats") === "1") document.getElementById("stats")?.classList.add("show");

  // A crosshair that follows the mouse.
  const cross = document.getElementById("crosshair");
  const crossRing = cross?.querySelector<HTMLElement>(".ring") ?? null;
  const crossMark = cross?.querySelector<HTMLElement>(".mark") ?? null;
  let crossHit = 0;
  let crossKill = 0;
  let crossKick = 0;
  let knownKills = 0;
  let lastKillFeel = -1e9;
  addEventListener("pointermove", (e) => {
    if (cross && e.pointerType === "mouse") cross.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  });

  const resize = () => scene.resize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
  resize();
  new ResizeObserver(resize).observe(host);

  const frame = new FrameStats(600);
  const cpu = new FrameStats(600);
  let last = 0;
  let frames = 0;
  let firstFrameMs = 0;
  let lastBytes = 0;
  let lastUp = 0;
  let lastNet = performance.now();
  let downKBps = 0;
  let upKBps = 0;
  let lastStats = 0;
  let pixelRatio = handle.renderer.getPixelRatio();
  let resChanged = 0;
  const hurt = document.getElementById("hurt");
  let shakes = 0;

  handle.renderer.setAnimationLoop((t: number) => {
    const real = performance.now();
    if (last !== 0) frame.push(t - last);
    last = t;
    const { now, dt, realDt } = feel.tick(real);
    const view = conn.net.render(now);
    lastView = view;
    const players = view.others.filter((e) => e.kind === EntityKind.Player);
    const ev = scene.frame({ dt, realDt, self: view.self, others: view.others, selfPlayer: self, aim: autopilot ? autoAim : input.aim });
    if (frames === 0) {
      firstFrameMs = real - bootAt;
      banner?.remove();
    }
    frames++;

    // Game feel (FeelKit): every shot of ours kicks and sounds, hits flash, push and mark the crosshair, kills stop time.
    for (const s of ev.shots.slice(0, 6)) {
      const cue = s.kind === "beam" ? "beam" : s.kind === "blaster-wide" ? "wide" : "zap";
      sfx.play(s.mine ? cue : `${cue}-o`, { pitch: s.kind === "blaster-wide" ? 0.62 : 1, gain: s.mine ? 1 : 0.35 });
      if (!s.mine) continue;
      crossKick = 1;
      scene.rig.addTrauma(s.kind === "beam" ? 0.32 : s.kind === "blaster-wide" ? 0.22 : 0.07);
      if (s.kind === "beam") scene.rig.punch(1.5);
      shakes++;
    }
    for (const hit of ev.hits.slice(0, 8)) feel.hit({ id: hit.id, x: hit.x, y: hit.y, z: hit.z, amount: hit.amount, big: hit.amount >= 40, dirX: hit.dirX, dirZ: hit.dirZ });
    if (ev.hits.length > 0) {
      sfx.play("hitmark");
      crossHit = 0.14;
    }
    for (const k of ev.kills) {
      feel.kill({ x: k.x, y: 1, z: k.z, big: true, color: k.color, dirX: k.dirX, dirZ: k.dirZ });
      killConfirm(sfx);
      crossKill = 0.4;
      lastKillFeel = real;
    }
    // The room's count is the referee: a kill it credits that the screen did not show still confirms.
    const myKills = (run as RunInfo | null)?.players.find((p) => p.id === self)?.kills ?? 0;
    if (myKills > knownKills && real - lastKillFeel > 1000) {
      killConfirm(sfx);
      crossKill = 0.4;
      feel.clock.hitStop(feel.preset.bigKillStopMs, real);
    }
    knownKills = myKills;
    if (ev.downs > ev.kills.length) sfx.play("down-o");
    if (ev.selfHurt > 0) {
      feel.hurt(ev.selfHurt, 100);
      shakes++;
    }
    if (ev.selfDown) {
      feel.clock.hitStop(70, real);
      scene.shake(0.7, 0.3);
      shakes++;
      sfx.play("down");
    }
    if (ev.selfHealed) sfx.play("heal");
    if (hurt) hurt.style.opacity = String(feel.hurtPulse * 0.85);
    crossHit = Math.max(0, crossHit - realDt);
    crossKill = Math.max(0, crossKill - realDt);
    crossKick = Math.max(0, crossKick - realDt * 9);
    if (cross) {
      cross.classList.toggle("fire", input.firing);
      cross.classList.toggle("kill", crossKill > 0);
      if (crossRing) crossRing.style.transform = `scale(${(1 + crossKick * 0.35).toFixed(3)})`;
      if (crossMark) {
        const t = Math.max(crossHit / 0.14, crossKill / 0.4);
        crossMark.style.opacity = t > 0 ? String(Math.min(1, t * 1.6).toFixed(2)) : "0";
        crossMark.style.transform = `scale(${(crossKill > 0 ? 1.25 : 1) + (1 - Math.min(1, t)) * 0.25})`;
      }
    }
    const w = host.clientWidth;
    const h = host.clientHeight;
    hud.update(real, view.self, players, run ?? (conn.latestRun() as RunInfo | null), (x, y, z) => scene.project(x, y, z, w, h), kit.coins.balance());
    feel.update(dt, realDt);
    cpu.push(performance.now() - real);

    // Dynamic resolution: hold 60 fps by trading pixels (spec §5 quality tiers).
    if (frame.count >= 120 && real - resChanged > 2000) {
      const p95 = frame.percentile(0.95);
      const cap = Math.min(globalThis.devicePixelRatio || 1, 2);
      let next = pixelRatio;
      if (p95 > 21 && pixelRatio > 0.75) next = Math.max(0.75, pixelRatio - 0.25);
      else if (p95 < 17.5 && pixelRatio < cap) next = Math.min(cap, pixelRatio + 0.25);
      if (next !== pixelRatio) {
        pixelRatio = next;
        handle.renderer.setPixelRatio(next);
        resize();
        resChanged = real;
      }
    }

    if (real - lastNet >= 1000) {
      const secs = (real - lastNet) / 1000;
      downKBps = (conn.bytesIn() - lastBytes) / secs / 1024;
      upKBps = (conn.net.stats.inputBytes - lastUp) / secs / 1024;
      lastBytes = conn.bytesIn();
      lastUp = conn.net.stats.inputBytes;
      lastNet = real;
    }
    const info = handle.renderer.info.render;
    const mean = frame.mean();
    const r = run as RunInfo | null;
    const mine = r?.players.find((p) => p.id === self);
    const stats: ArenaStats = {
      backend: handle.backend,
      fps: mean > 0 ? 1000 / mean : 0,
      frameMs: { mean, p50: frame.percentile(0.5), p95: frame.percentile(0.95), p99: frame.percentile(0.99) },
      cpuMs: { mean: cpu.mean(), p95: cpu.percentile(0.95) },
      drawCalls: info.drawCalls,
      triangles: info.triangles,
      playersInView: players.length + (view.self ? 1 : 0),
      entitiesInView: view.others.length,
      previewFight: scene.previewFight,
      downKBps,
      upKBps,
      rttMs: rtt,
      joinMs,
      firstFrameMs,
      corrections: conn.net.corrections,
      inputBuffer: conn.net.serverInputBuffer,
      frames,
      roomId: conn.roomId,
      phase: r?.phase ?? "",
      kills: mine?.kills ?? 0,
      deaths: mine?.deaths ?? 0,
      pixelRatio,
      feel: { numbers: feel.numbers?.shown ?? 0, ...scene.counts, hitStops: feel.clock.stops, shakes, hits: feel.counts.hits, kills: feel.counts.kills },
      sound: { ...sound.loaded, played: sfx.played },
    };
    window.__arena = stats;
    if (real - lastStats > 250) {
      lastStats = real;
      hud.stats(
        [
          `${stats.backend.toUpperCase()}  ${stats.fps.toFixed(0)} fps  p95 ${stats.frameMs.p95.toFixed(1)} ms  dpr ${pixelRatio}`,
          `draws ${stats.drawCalls}  tris ${(stats.triangles / 1000).toFixed(0)}k  players ${stats.playersInView}  entities ${stats.entitiesInView}`,
          `down ${downKBps.toFixed(1)} KB/s  up ${upKBps.toFixed(2)} KB/s  rtt ${rtt.toFixed(0)} ms  queue ${conn.net.serverInputBuffer?.toFixed(1) ?? "-"}`,
          `join ${joinMs.toFixed(0)} ms  first frame ${firstFrameMs.toFixed(0)} ms  corrections ${conn.net.corrections}`,
        ].join("\n"),
      );
    }
  });
}

main().catch((e: unknown) => {
  if (bannerText) bannerText.textContent = `Could not start: ${e instanceof Error ? e.message : String(e)}`;
  console.error(e);
});
