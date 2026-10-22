/**
 * Boots a board template's page: the Kit flags from Net Forge, the
 * renderer and the stage in the game's art style, the room by link, the
 * input clock, the store, sound and the stats overlay. The template then
 * draws its own board on `stage` and reads its own run state from `view()`.
 *
 * URL parameters (every board template):
 *   ?room=<id>        join a friend's instance (the Invite link)
 *   ?place=<name>     the place
 *   ?server=<url>     room server (default: VITE_ROOMS_URL, else this host on :2567)
 *   ?webgl=1          force the WebGL2 backend
 *   ?autopilot=1      the genre's bot plays (measurement and screenshots)
 *   ?preview=1        a style preview: the camera frames the board, the HUD hides
 *   ?stats=1          show frame, network and server numbers (also the ` key)
 *   ?shapes=1         draw the fallback shapes instead of library models
 *   ?style=<style>    another art style (toon, ps1, pixel, voxel, handdrawn)
 *   ?library=<url>    asset library base URL (default: VITE_LIBRARY_URL, else ./library)
 *   ?host=netnet, ?coin=, ?title=, ?player=   set by Net Forge (host.ts)
 */
import type { GameManifest } from "@netnetcapital/engine";
import type { SimAdapter } from "@netnetcapital/engine/net";
import type { RulesInput, RulesWorld } from "@netnetcapital/engine/rules";
import { createRenderer, FeelAudio, FrameStats, pickStyle, SoundPlayer } from "@netnetcapital/engine/runtime";
import type { LookPreset } from "@netnetcapital/engine/runtime";
import { soundBank } from "@netnetcapital/asset-library";
import { LibraryClient } from "@netnetcapital/asset-library/three";
import { InputClock, joinBoard, roomsEndpoint, type BoardConnection } from "./connect.js";
import { hostFlags, namedPlayer, onHostPlayer, postReady, type PlayerMode } from "./host.js";
import { Hud, wireStore, type EarnProgress, type HudLabels, type HudTheme } from "./hud.js";
import { mockKit, type KitStoreBridge, type SkuPrice } from "./kit.js";
import { BoardStage } from "./stage.js";

export interface BoardBootOptions<S> {
  readonly adapter: SimAdapter<RulesWorld<S>, RulesInput>;
  readonly manifest: GameManifest;
  /** Room template and default place. */
  readonly template: string;
  readonly place: string;
  readonly version: string;
  readonly labels: HudLabels;
  readonly theme: HudTheme;
  /** The template's own coin until a creator renames it. */
  readonly coin: { name: string; symbol: string; logo: string | null };
  readonly cosmetics: Readonly<Record<string, number>>;
  readonly swatch: (cosmetic: number) => string;
  /** Ground the stage frames, metres. */
  readonly ground: { w: number; h: number };
  readonly preset?: LookPreset;
  readonly theme3d?: string;
  readonly groundColor?: number;
  readonly pitch?: number;
  /** false: no style-built land (voxel) under the game's own surface. */
  readonly field?: boolean;
  /** The autopilot's input (?autopilot=1): the genre's own bot over the latest run state. */
  readonly autopilot?: (tick: number) => RulesInput | null;
  /** Key for the remembered mute. */
  readonly soundKey: string;
}

/** The per-player run state every board view carries (adapter infoFor). */
export interface BoardView {
  readonly you?: number;
  readonly phase?: "playing" | "ended";
  readonly outcome?: "won" | "lost" | null;
  readonly endsIn?: number | null;
  readonly earn?: readonly EarnProgress[];
  readonly upgrades?: Readonly<Record<string, number>>;
  readonly [k: string]: unknown;
}

export interface BoardApp<S> {
  readonly params: URLSearchParams;
  readonly conn: () => BoardConnection<S>;
  readonly self: number;
  readonly hud: Hud;
  readonly stage: BoardStage;
  readonly clock: InputClock;
  readonly kit: KitStoreBridge;
  readonly sfx: FeelAudio;
  readonly sound: SoundPlayer;
  readonly autopilot: boolean;
  readonly preview: boolean;
  readonly style: string;
  readonly canvas: HTMLCanvasElement;
  readonly joinMs: number;
  /** The latest per-player run state. */
  view<V extends BoardView>(): V | null;
  /** Every frame: dt in seconds. The stage draws after `fn`. */
  loop(fn: (dt: number, now: number) => void): void;
  /** Extra lines for the stats overlay and window.__board. */
  extraStats(fn: () => Record<string, unknown>): void;
}

export interface BoardStats {
  backend: string;
  fps: number;
  frameMs: { mean: number; p50: number; p95: number; p99: number };
  drawCalls: number;
  triangles: number;
  downKBps: number;
  upKBps: number;
  rttMs: number;
  joinMs: number;
  firstFrameMs: number;
  /** First drawn frame since navigation start (download, parse, join and the first draw). */
  firstFrameNavMs: number;
  corrections: number;
  frames: number;
  roomId: string;
  style: string;
  models: number;
  failedModels: number;
  actions: number;
  extra: Record<string, unknown>;
}

declare global {
  interface Window {
    __board?: BoardStats;
  }
}

export async function bootBoard<S>(o: BoardBootOptions<S>): Promise<BoardApp<S>> {
  const bootAt = performance.now();
  const params = new URLSearchParams(location.search);
  const launcher = hostFlags(params);
  if (launcher.framed) document.documentElement.dataset.host = "netnet";
  const preview = params.get("preview") === "1";
  const hud = new Hud(o.labels, o.theme, o.manifest);
  if (preview) document.documentElement.dataset.preview = "1";
  let playerMode: PlayerMode = launcher.player;
  let hostMode: PlayerMode | null = namedPlayer(params);
  onHostPlayer(launcher, (mode) => {
    playerMode = mode;
    hostMode = mode;
    hud.player(mode);
  });
  const title = launcher.title ?? o.labels.title;
  hud.title(title);

  const host = document.getElementById("game");
  if (!host) throw new Error("missing #game");
  const canvas = document.createElement("canvas");
  host.append(canvas);
  const handle = await createRenderer(canvas, { forceWebGL: params.get("webgl") === "1", antialias: true });
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const libraryBase = params.get("library") ?? env.VITE_LIBRARY_URL ?? "./library";
  const style = pickStyle(o.manifest.game.style, params.get("style"));
  const library = params.get("shapes") === "1" ? null : new LibraryClient(handle, { baseUrl: libraryBase, style });
  const stage = new BoardStage(handle, {
    style,
    library,
    ground: o.ground,
    ...(o.preset ? { preset: o.preset } : {}),
    ...(o.theme3d ? { theme: o.theme3d } : {}),
    ...(o.groundColor !== undefined ? { groundColor: o.groundColor } : {}),
    ...(o.pitch !== undefined ? { pitch: o.pitch } : {}),
    ...(o.field !== undefined ? { field: o.field } : {}),
  });

  const endpoint = roomsEndpoint(params);
  const friendRoomId = params.get("room") ?? undefined;
  const place = params.get("place") ?? o.place;
  const { conn: first, joinMs } = await joinBoard(o.adapter, { endpoint, place, template: o.template, ...(friendRoomId ? { friendRoomId } : {}) });
  const conn = first;
  const self = conn.welcome.player;
  if (friendRoomId && conn.roomId !== friendRoomId) setTimeout(() => hud.toast("Room full, new room"), 500);
  if (conn.welcome.version !== o.version) setTimeout(() => hud.toast("Update ready. Reload."), 800);
  const autopilot = params.get("autopilot") === "1";
  const linkFor = (base: string) => `${base}?room=${conn.roomId}${place !== o.place ? `&place=${encodeURIComponent(place)}` : ""}${params.has("server") ? `&server=${encodeURIComponent(endpoint)}` : ""}`;
  const keep = ["autopilot", "webgl", "stats", "style", "preview", "shapes", "host", "coin", "title", "player", "library"].filter((k) => params.has(k)).map((k) => `&${k}=${encodeURIComponent(params.get(k) ?? "")}`).join("");
  history.replaceState(null, "", `${linkFor(location.pathname)}${keep}`);

  let latest: BoardView | null = null;
  conn.onRun((info) => {
    latest = info as BoardView;
  });

  // The Kit plugs in here (packages/kit, kit.init({ game })): kit.coins and kit.store have these exact names.
  const prices: Record<string, SkuPrice> = Object.fromEntries(o.manifest.skus);
  const coin = launcher.coin ? { name: launcher.coin, symbol: launcher.coin, logo: null } : o.coin;
  const kit = mockKit({ earned: 120, wallet: 0, usdg: 5 }, prices, coin);
  hud.coin(kit.coins.name(), kit.coins.symbol(), kit.coins.logo());
  hud.player(playerMode);
  conn.onEarn((e) => {
    hud.earned(e.rule, e.units);
    sfx.play("coin");
  });

  const sfx = new FeelAudio();
  const sound = new SoundPlayer(sfx, { key: o.soundKey, musicVolume: 0.25 });
  try {
    sound.load(soundBank(libraryBase));
  } catch {
    // no library audio: the synth cues play
  }
  const soundBtn = document.getElementById("sound");
  if (soundBtn) {
    soundBtn.textContent = sound.muted ? "Sound off" : "Sound";
    soundBtn.addEventListener("click", () => {
      sfx.unlock();
      soundBtn.textContent = sound.toggle() ? "Sound off" : "Sound";
    });
  }
  addEventListener("pointerdown", () => sfx.unlock(), { once: true });
  addEventListener("keydown", () => sfx.unlock(), { once: true });
  wireStore({ hud, manifest: o.manifest, kit, conn: conn as never, labels: o.labels, cosmetics: o.cosmetics, swatch: o.swatch, hostMode: () => hostMode, unlock: () => sfx.unlock() });
  document.getElementById("invite")?.addEventListener("click", () => {
    const url = linkFor(`${location.origin}${location.pathname}`);
    void navigator.clipboard?.writeText(url).then(
      () => hud.toast("Invite link copied"),
      () => hud.toast(url),
    );
  });
  postReady(launcher);

  const clock = new InputClock(() => conn as BoardConnection<unknown>, autopilot && o.autopilot ? o.autopilot : null);
  clock.start();

  let rtt = 0;
  conn.room.onMessage("pong", (t: number) => {
    rtt = performance.now() - t;
  });
  setInterval(() => conn.room.send("ping", performance.now()), 2000);
  addEventListener("keydown", (e) => {
    if (e.code === "Backquote") document.getElementById("stats")?.classList.toggle("show");
  });
  if (params.get("stats") === "1") document.getElementById("stats")?.classList.add("show");

  const resize = () => stage.resize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
  resize();
  new ResizeObserver(resize).observe(host);

  const frame = new FrameStats(600);
  const extras: (() => Record<string, unknown>)[] = [];
  let fns: ((dt: number, now: number) => void)[] = [];
  let last = 0;
  let frames = 0;
  let firstFrameMs = 0;
  let firstFrameNavMs = 0;
  let lastBytes = 0;
  let lastUp = 0;
  let lastNet = performance.now();
  let downKBps = 0;
  let upKBps = 0;
  let lastStats = 0;
  handle.renderer.setAnimationLoop((t: number) => {
    const real = performance.now();
    const dt = last === 0 ? 1 / 60 : Math.min(0.1, (t - last) / 1000);
    if (last !== 0) frame.push(t - last);
    last = t;
    for (const f of fns) f(dt, real);
    stage.frame(dt);
    if (frames === 0) {
      firstFrameMs = real - bootAt;
      firstFrameNavMs = real;
      hud.ready();
    }
    frames++;
    hud.balance(kit.coins.balance());
    const v = latest;
    if (v) {
      hud.goals(v.earn);
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
    const extra: Record<string, unknown> = {};
    for (const e of extras) Object.assign(extra, e());
    const stats: BoardStats = {
      backend: handle.backend,
      fps: mean > 0 ? 1000 / mean : 0,
      frameMs: { mean, p50: frame.percentile(0.5), p95: frame.percentile(0.95), p99: frame.percentile(0.99) },
      drawCalls: info.drawCalls,
      triangles: info.triangles,
      downKBps,
      upKBps,
      rttMs: rtt,
      joinMs,
      firstFrameMs,
      firstFrameNavMs,
      corrections: conn.net.corrections,
      frames,
      roomId: conn.roomId,
      style,
      models: stage.counts.models,
      failedModels: stage.counts.failed,
      actions: clock.sent,
      extra,
    };
    window.__board = stats;
    if (real - lastStats > 250) {
      lastStats = real;
      hud.stats(
        [
          `${stats.backend.toUpperCase()}  ${stats.fps.toFixed(0)} fps  p95 ${stats.frameMs.p95.toFixed(1)} ms  ${style}`,
          `draws ${stats.drawCalls}  tris ${(stats.triangles / 1000).toFixed(0)}k  models ${stats.models}`,
          `down ${downKBps.toFixed(1)} KB/s  up ${upKBps.toFixed(2)} KB/s  rtt ${rtt.toFixed(0)} ms`,
          `join ${joinMs.toFixed(0)} ms  first frame ${firstFrameMs.toFixed(0)} ms  corrections ${conn.net.corrections}`,
        ].join("\n"),
      );
    }
  });

  return {
    params,
    conn: () => conn,
    self,
    hud,
    stage,
    clock,
    kit,
    sfx,
    sound,
    autopilot,
    preview,
    style,
    canvas,
    joinMs,
    view: <V extends BoardView>() => latest as V | null,
    loop: (fn) => {
      fns = [...fns, fn];
    },
    extraStats: (fn) => extras.push(fn),
  };
}
