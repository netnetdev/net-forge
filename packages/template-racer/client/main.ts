/**
 * TORQUEBAY client: join a room by link, predict your own kart (steering,
 * throttle and drifts apply the instant you press), draw the other karts
 * ~100 ms in the past, and dress it with the game-feel kit. The
 * room's race runner decides places, coins and pay.
 *
 * URL parameters:
 *   ?room=<id>        join a friend's instance (the Invite button makes this link)
 *   ?place=<name>     the place (default "cliffs")
 *   ?server=<url>     room server (default: VITE_ROOMS_URL, else this host on :2567)
 *   ?webgl=1          force the WebGL2 backend
 *   ?autopilot=1      a bot drives (headless measurement and screenshots); =newcomer drives loose
 *   ?preview=1        the Launcher's style previews
 *   ?quality=<tier>   low, medium or high (default: detected)
 *   ?stats=1          show frame, network and server numbers (also the ` key)
 *   ?shapes=1         draw the fallback shapes instead of library models
 *   ?style=<style>    draw the game in another art style (toon, ps1, pixel, voxel, handdrawn; default: the style game.ts declares)
 *   ?library=<url>    asset library base URL (default: VITE_LIBRARY_URL, else ./library)
 *   ?host=netnet, ?coin=, ?title=, ?player=   set by Net Forge (client/host.ts)
 */
import { initSim, KART_STATS } from "@netforge/engine-sim";
import type { InputCommand } from "@netforge/engine-sim";
import { KF, kartAutopilot } from "@netforge/engine/game";
import type { KartRoomWorld, RaceInfo } from "@netforge/engine/game";
import { guestId, joinRoom, savedSession } from "@netforge/engine/net";
import type { RoomConnection } from "@netforge/engine/net";
import { createRenderer, FeelAudio, FeelKit, FrameStats, pickStyle, SoundPlayer } from "@netforge/engine/runtime";
import { soundBank } from "@netforge/asset-library";
import { LibraryClient } from "@netforge/asset-library/three";
import { COSMETICS, GAME_VERSION, PLACE, racerAdapter, racerGame, TEMPLATE } from "../src/manifest.js";
import { COSMETIC_SKUS, mockKit, UPGRADE_SKUS } from "../src/store.js";
import type { KitStoreBridge, SkuPrice } from "../src/store.js";
import { defineKartCues, KART_SAMPLES } from "./audio.js";
import { hostFlags, namedPlayer, onHostPlayer, postReady, storeNote } from "./host.js";
import type { PlayerMode } from "./host.js";
import { Hud } from "./hud.js";
import { KartInput } from "./input.js";
import { SKU_NAMES, TITLE, UPGRADE_NAMES } from "./names.js";
import { KartScene, paintOf } from "./scene.js";
import { PIXEL_PLAYER } from "./decor.js";
import type { SceneEntity } from "./scene.js";
import { gearOf, wireGear, wirePot, wireStake } from "./stake.js";

export interface RacerStats {
  backend: string;
  fps: number;
  frameMs: { mean: number; p50: number; p95: number; p99: number };
  cpuMs: { mean: number; p95: number };
  drawCalls: number;
  triangles: number;
  playersInView: number;
  /** Climbers on screen (the Launcher's style previews score frames by it). */
  busy: number;
  downKBps: number;
  upKBps: number;
  rttMs: number;
  joinMs: number;
  firstFrameMs: number;
  /** performance.now() of the first drawn frame: ms from navigation start (includes the download). */
  firstFrameAt: number;
  corrections: number;
  inputBuffer: number | null;
  frames: number;
  roomId: string;
  phase: string;
  course: number;
  place: number | null;
  progress: number;
  finishes: number;
  pixelRatio: number;
  feel: { coins: number; turbos: number; laps: number; walls: number };
  /** Track chunks streamed in and out, and held now. */
  streaming: { built: number; dropped: number; live: number };
  sound: { cues: number; failed: number; music: boolean; played: number };
}

declare global {
  interface Window {
    __racer?: RacerStats;
  }
}

const params = new URLSearchParams(location.search);
const launcher = hostFlags(params);
if (launcher.framed) document.documentElement.dataset.host = "netnet";
let playerMode: PlayerMode = launcher.player;
let hostMode: PlayerMode | null = namedPlayer(params);
let onPlayer: ((mode: PlayerMode) => void) | null = null;
onHostPlayer(launcher, (mode) => {
  playerMode = mode;
  hostMode = mode;
  onPlayer?.(mode);
});

/** A game played in Net Forge names its own coin (?coin=TICKER); the template's token keeps its logo. */
function withDraftCoin(kit: KitStoreBridge): KitStoreBridge {
  const coin = launcher.coin;
  if (!coin || coin === kit.coins.symbol()) return kit;
  return { ...kit, coins: { ...kit.coins, name: () => coin, symbol: () => coin, logo: () => null } };
}
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
  const game = racerGame();
  const canvas = document.createElement("canvas");
  host.append(canvas);
  const handle = await createRenderer(canvas, { forceWebGL: params.get("webgl") === "1", antialias: true });

  const adapter = racerAdapter();
  const friendRoomId = params.get("room") ?? undefined;
  const place = params.get("place") ?? PLACE;
  const joinStart = performance.now();
  const session = savedSession(endpoint);
  const conn: RoomConnection<KartRoomWorld, InputCommand> = await joinRoom(adapter, {
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
    `${base}?room=${conn.roomId}${place !== PLACE ? `&place=${encodeURIComponent(place)}` : ""}${params.has("server") ? `&server=${encodeURIComponent(endpoint)}` : ""}${params.has("game") ? `&game=${encodeURIComponent(params.get("game") ?? "")}` : ""}`;
  history.replaceState(null, "", `${linkFor(location.pathname)}${autopilot ? `&autopilot=${autopilotMode}` : ""}${params.has("webgl") ? "&webgl=1" : ""}${params.has("stats") ? "&stats=1" : ""}${params.has("style") ? `&style=${encodeURIComponent(params.get("style") ?? "")}` : ""}${params.has("preview") ? "&preview=1" : ""}`);

  const libraryBase = params.get("library") ?? env.VITE_LIBRARY_URL ?? "./library";
  const artStyle = pickStyle(game.manifest.game.style, params.get("style"));
  const library = params.get("shapes") === "1" ? null : new LibraryClient(handle, { baseUrl: libraryBase, style: artStyle });
  const sfx = new FeelAudio();
  defineKartCues(sfx);
  const sound = new SoundPlayer(sfx, { key: "torquebay:sound", musicVolume: 0.28 });
  sound.load(soundBank(libraryBase, { cues: KART_SAMPLES }));
  const feel = new FeelKit({ preset: "default", audio: sfx });
  const q = params.get("quality");
  // The pixel style has its own kart sprite (the low-poly kart has no pixel twin).
  const playerModel = artStyle === "pixel" ? PIXEL_PLAYER : game.manifest.game.players.prefab;
  const scene = new KartScene(handle, game.racer, library, feel, playerModel, { style: artStyle, ...(q === "low" || q === "medium" || q === "high" ? { quality: q } : {}) });
  feel.camera = scene.rig;
  const input = new KartInput(document.body);
  const prices: Record<string, SkuPrice> = Object.fromEntries(game.manifest.skus);
  // The Kit plugs in here (packages/kit, kit.init({ game })): kit.coins and kit.store have these exact names.
  const kit: KitStoreBridge = withDraftCoin(mockKit({ earned: 120, wallet: 0, usdg: 5 }, prices));
  let storeOpen = false;
  let run: (RaceInfo & { level?: string | null }) | null = null;
  conn.onRun((info) => {
    run = info as RaceInfo & { level?: string | null };
  });

  const hud = new Hud(game, self, {
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
    ready: () => input.ready(),
  });
  conn.onEarn((e) => hud.earned(e.rule, e.units));
  const soundBtn = document.getElementById("sound");
  if (soundBtn && sound.muted) soundBtn.textContent = "Sound off";
  hud.coin(kit.coins.name(), kit.coins.symbol(), kit.coins.logo());
  wireStake(conn, kit, (t) => hud.toast(t));
  wirePot(conn, kit, (t) => hud.toast(t));
  wireGear(gearOf(game.manifest.skus, SKU_NAMES), kit, (t) => hud.toast(t));
  hud.title(GAME_TITLE);
  hud.player(playerMode);
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

  // The store: round upgrades (spent, applied by the room) and outfits (owned for good).
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
    const look = paintOf(cosmetic, 0xff8a3d);
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `<div><span class="swatch"></span><div><span class="name"></span><br /><small>Paint</small></div></div><button></button>`;
    (row.querySelector(".swatch") as HTMLElement).style.background = `linear-gradient(135deg, #${look.body.toString(16).padStart(6, "0")}, #${look.trim.toString(16).padStart(6, "0")})`;
    (row.querySelector(".name") as HTMLElement).textContent = SKU_NAMES[id] ?? id;
    const btn = row.querySelector("button") as HTMLButtonElement;
    btn.textContent = `${price} ${sym}`;
    btn.addEventListener("click", () => void buyPaint(id, cosmetic, btn));
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
    const r = await conn.command({ name: id, ...(proof ? { proof } : {}) });
    hud.toast(r.ok ? `${SKU_NAMES[id] ?? id} on` : r.reason === "store not live" ? "Store opens at launch" : "Already on this round");
  }
  async function buyPaint(id: string, cosmetic: number, btn: HTMLButtonElement): Promise<void> {
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
      hud.toast("Paint opens at launch");
      return;
    }
    for (const b of finishesEl?.querySelectorAll("button") ?? []) if (b !== btn && b.textContent === "Painted") b.textContent = "Paint";
    btn.textContent = "Painted";
  }

  let rtt = 0;
  conn.room.onMessage("pong", (t: number) => {
    rtt = performance.now() - t;
  });
  setInterval(() => conn.room.send("ping", performance.now()), 2000);

  // Autopilot (measurement and previews): the seat bot's driving on our newest predicted kart.
  const pilot = kartAutopilot(game.racer, game.tickRate);
  let lastView: { self: SceneEntity | undefined; others: readonly SceneEntity[] } = { self: undefined, others: [] };
  const autopilotInput = (tick: number): InputCommand => pilot(conn.net.predicted() ?? lastView.self, tick, autopilotMode === "newcomer" ? 0.4 : 0.95);

  let nextTick = performance.now();
  let ticks = 0;
  setInterval(() => {
    const now = performance.now();
    let n = 0;
    while (nextTick <= now && n < 8) {
      let cmd = autopilot ? autopilotInput(ticks) : input.sample(ticks);
      // Autopilot also votes for the next course on the results screen.
      if (autopilot && (run as RaceInfo | null)?.phase === "results") cmd = { ...cmd, buttons: cmd.buttons | (1 << 10) };
      conn.net.tick(cmd, now);
      ticks++;
      nextTick += conn.net.tickIntervalMs();
      n++;
    }
    if (n === 8) nextTick = now + conn.net.tickIntervalMs();
  }, 4);
  // Rumble (navigator.vibrate) needs a user gesture first: until then the feel kit's land and dash stay silent on the pad.
  let gestured = false;
  const gesture = () => {
    gestured = true;
    sfx.unlock();
  };
  addEventListener("pointerdown", gesture, { once: true });
  addEventListener("keydown", gesture, { once: true });
  addEventListener("keydown", (e) => {
    if (e.code === "Backquote") document.getElementById("stats")?.classList.toggle("show");
  });
  if (params.get("stats") === "1") document.getElementById("stats")?.classList.add("show");

  const resize = () => scene.resize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
  resize();
  new ResizeObserver(resize).observe(host);

  const frame = new FrameStats(600);
  const cpu = new FrameStats(600);
  let last = 0;
  let frames = 0;
  let firstFrameMs = 0;
  let firstFrameAt = 0;
  let lastBytes = 0;
  let lastUp = 0;
  let lastNet = performance.now();
  let downKBps = 0;
  let upKBps = 0;
  let lastStats = 0;
  let pixelRatio = handle.renderer.getPixelRatio();
  let resChanged = 0;
  let lastCount = -1;
  let finishes = 0;
  const flash = document.getElementById("flash");
  let flashT = 0;

  handle.renderer.setAnimationLoop((t: number) => {
    const real = performance.now();
    if (last !== 0) frame.push(t - last);
    last = t;
    const { now, dt, realDt } = feel.tick(real);
    const view = conn.net.render(now);
    lastView = view;
    const r = run ?? (conn.latestRun() as (RaceInfo & { level?: string | null }) | null);
    const ev = scene.frame({ dt, realDt, self: view.self, others: view.others, course: r?.course ?? 0 });
    if (frames === 0) {
      firstFrameMs = real - bootAt;
      firstFrameAt = real;
      banner?.remove();
    }
    frames++;
    // Game feel.
    if (ev.coins > 0) sfx.play("coin");
    if (ev.driftStart) sfx.play("drift");
    if (ev.boostStart) {
      sfx.play("boost");
      scene.rig.punch(6);
      input.rumble(0.5, 120);
      if (gestured) feel.dash();
    }
    if (ev.lap > 0) {
      sfx.play("lap");
      hud.toast(`Lap ${ev.lap + 1}`);
    }
    if (ev.wall) {
      sfx.play("bump");
      scene.rig.addTrauma(0.35);
      input.rumble(0.7, 120);
      flashT = 0.25;
    }
    if (ev.finished) {
      finishes++;
      sfx.play("finish");
      scene.rig.punch(-3);
    }
    if (r?.phase === "countdown" && r.countdown !== lastCount) {
      lastCount = r.countdown;
      sfx.play(r.countdown > 0 ? "tick" : "go");
    } else if (r?.phase === "racing" && lastCount > 0) {
      lastCount = 0;
      sfx.play("go");
    }
    flashT = Math.max(0, flashT - realDt);
    if (flash) flash.style.opacity = String(flashT * 2);
    const me = view.self;
    // This race's upgrades (store or gear), from our kart's own stat levels.
    const statWord = me ? (me.values[KF.stats] ?? 0) : 0;
    const buffs = [...game.manifest.upgrades.keys()]
      .filter((id, i) => {
        const stat = game.racer.upgradeStat[i];
        return stat !== undefined && ((statWord >>> (KART_STATS.indexOf(stat) * 4)) & 0xf) > 0;
      })
      .map((id) => UPGRADE_NAMES[id]?.name ?? id)
      .join(" · ");
    hud.update(real, view.self, view.others, r, kit.coins.balance(), buffs, scene.trackNow);
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
    const mine = r?.players.find((p) => p.id === self);
    const stats: RacerStats = {
      backend: handle.backend,
      fps: mean > 0 ? 1000 / mean : 0,
      frameMs: { mean, p50: frame.percentile(0.5), p95: frame.percentile(0.95), p99: frame.percentile(0.99) },
      cpuMs: { mean: cpu.mean(), p95: cpu.percentile(0.95) },
      drawCalls: info.drawCalls,
      triangles: info.triangles,
      playersInView: view.others.length + (view.self ? 1 : 0),
      busy: view.others.length + (view.self ? 1 : 0),
      downKBps,
      upKBps,
      rttMs: rtt,
      joinMs,
      firstFrameMs,
      firstFrameAt,
      corrections: conn.net.corrections,
      inputBuffer: conn.net.serverInputBuffer,
      frames,
      roomId: conn.roomId,
      phase: r?.phase ?? "",
      course: r?.course ?? 0,
      place: mine?.place ?? null,
      progress: mine?.progress ?? 0,
      finishes,
      pixelRatio,
      feel: { ...scene.counts },
      streaming: { ...scene.streaming },
      sound: { ...sound.loaded, played: sfx.played },
    };
    window.__racer = stats;
    if (real - lastStats > 250) {
      lastStats = real;
      hud.stats(
        [
          `${stats.backend.toUpperCase()}  ${stats.fps.toFixed(0)} fps  p95 ${stats.frameMs.p95.toFixed(1)} ms  dpr ${pixelRatio}`,
          `draws ${stats.drawCalls}  tris ${(stats.triangles / 1000).toFixed(0)}k  karts ${stats.playersInView}  chunks ${scene.streaming.live}`,
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
