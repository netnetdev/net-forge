/**
 * EMBERWATCH client: join a room by link, predict your own keeper, draw
 * everyone else ~100 ms in the past, and dress it with the game-feel kit.
 *
 * URL parameters:
 *   ?room=<id>        join a friend's instance (the Invite button makes this link)
 *   ?place=<name>     the place (default "field")
 *   ?server=<url>     room server (default: VITE_ROOMS_URL, else this host on :2567)
 *   ?webgl=1          force the WebGL2 backend
 *   ?autopilot=1      a bot plays (headless measurement)
 *   ?stats=1          show frame, network and server numbers (also the ` key)
 *   ?quality=low|medium|high   pin the render quality tier (default: auto-detected)
 *   ?feel=subtle|default|heavy the game-feel preset
 *   ?shapes=1         draw the fallback shapes instead of library models
 *   ?style=<style>    draw the game in another art style (toon, ps1, pixel, voxel, handdrawn; default: the style game.ts declares)
 *   ?library=<url>    asset library base URL (default: VITE_LIBRARY_URL, else ./library)
 *   ?host=netnet, ?coin=, ?title=, ?player=   set by Net Forge (client/host.ts)
 */
import { initSim, keeperButtons, maxHealthFor, resolveConfig } from "@netforge/engine-sim";
import type { InputCommand } from "@netforge/engine-sim";
import { CROWD_UNITS, F, HumanBot, insideView, PLAYER_UNITS } from "@netforge/engine/game";
import type { EngineRoomWorld, RunInfo } from "@netforge/engine/game";
import { guestId, joinRoom, ProfileApi, rotateGuestId, savedSession, saveSession, signInWithWallet } from "@netforge/engine/net";
import type { Eip1193, GameProfile, ProfileAuth, RoomConnection } from "@netforge/engine/net";
import { createRenderer, DamageNumbers, FeelKit, FrameStats, pickStyle, SoundPlayer } from "@netforge/engine/runtime";
import type { FeelPresetName, QualityTier } from "@netforge/engine/runtime";
import { soundBank } from "@netforge/asset-library";
import { LibraryClient } from "@netforge/asset-library/three";
import { COSMETICS, GAME_VERSION, PLACE, survivorAdapter, survivorGame, TEMPLATE } from "../src/manifest.js";
import { COSMETIC_PRICE, mockKit, REVIVE_PRICE } from "../src/store.js";
import type { KitStoreBridge, SkuPrice } from "../src/store.js";
import { hostFlags, namedPlayer, onHostPlayer, postReady, storeNote } from "./host.js";
import type { PlayerMode } from "./host.js";
import { Hud } from "./hud.js";
import { SurvivorInput } from "./input.js";
import { SurvivorScene } from "./scene.js";
import type { SceneEntity } from "./scene.js";
import { gearOf, wireGear, wireStake } from "./stake.js";
import { SKU_NAMES } from "./names.js";

export interface SurvivorStats {
  backend: string;
  fps: number;
  frameMs: { mean: number; p50: number; p95: number; p99: number };
  cpuMs: { mean: number; p95: number };
  drawCalls: number;
  triangles: number;
  enemiesDrawn: number;
  entitiesInView: number;
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
  wave: number;
  level: number;
  pixelRatio: number;
  /** Game-feel effects fired so far. */
  feel: { numbers: number; rings: number; bursts: number; flashes: number; decals: number; impacts: number; crits: number; rises: number; slowMos: number; levelUps: number; hitStops: number; shakes: number; kills: number; chunks: number; blasts: number };
  /** Render quality tier in use. */
  quality: string;
}

declare global {
  interface Window {
    __survivor?: SurvivorStats;
  }
}

const params = new URLSearchParams(location.search);
// The Kit flags (client/host.ts): framed by Net Forge (?host=netnet),
// the host draws Invite and sign-in, so the game hides its own and the two
// never both show; it names the game's coin and title, and says whether play
// pays the person at the screen. Standalone play reads none of this.
const launcher = hostFlags(params);
if (launcher.framed) document.documentElement.dataset.host = "netnet";
if (launcher.title) document.title = launcher.title;
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
const bootAt = performance.now();
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const endpoint = params.get("server") ?? env.VITE_ROOMS_URL ?? `${location.protocol}//${location.hostname}:2567`;
const autopilot = params.get("autopilot") === "1";
const banner = document.getElementById("banner");
const bannerText = document.getElementById("banner-text");
const bannerTitle = banner?.querySelector("b");
if (bannerTitle && launcher.title) bannerTitle.textContent = launcher.title.toUpperCase();
const host = document.getElementById("game");

/**
 * What this browser kept before saves moved to the server: read once,
 * imported into the guest profile, then left alone. Every access may fail.
 */
const legacy = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`emberwatch:${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(`emberwatch:${key}`, value);
    } catch {
      // Private window or blocked storage.
    }
  },
};
const loadSet = (key: string): Set<string> => new Set((legacy.get(key) ?? "").split(",").filter(Boolean));

async function main(): Promise<void> {
  if (!host) throw new Error("missing #game");
  await initSim();
  const game = survivorGame();
  const config = resolveConfig(game.sim);
  const canvas = document.createElement("canvas");
  host.append(canvas);
  const handle = await createRenderer(canvas, { forceWebGL: params.get("webgl") === "1", antialias: true });

  const adapter = survivorAdapter();
  const friendRoomId = params.get("room") ?? undefined;
  const place = params.get("place") ?? PLACE;
  const joinStart = performance.now();
  // Saves live on the room server: a guest id until the player signs in with a wallet.
  let session = savedSession(endpoint);
  const conn: RoomConnection<EngineRoomWorld, InputCommand> = await joinRoom(adapter, {
    endpoint,
    place,
    template: TEMPLATE,
    guest: guestId(),
    ...(session ? { session: session.token } : {}),
    ...(friendRoomId ? { friendRoomId } : {}),
  });
  const joinMs = performance.now() - joinStart;
  if (friendRoomId && conn.roomId !== friendRoomId) setTimeout(() => hud.toast("That room was full, started a new one"), 500);
  if (conn.welcome.version !== GAME_VERSION) setTimeout(() => hud.toast("A new version is live. Reload to update."), 800);
  history.replaceState(null, "", `${location.pathname}?room=${conn.roomId}${place !== PLACE ? `&place=${encodeURIComponent(place)}` : ""}${params.has("server") ? `&server=${encodeURIComponent(endpoint)}` : ""}${params.has("game") ? `&game=${encodeURIComponent(params.get("game") ?? "")}` : ""}${autopilot ? "&autopilot=1" : ""}${params.has("webgl") ? "&webgl=1" : ""}${params.has("stats") ? "&stats=1" : ""}${params.has("style") ? `&style=${encodeURIComponent(params.get("style") ?? "")}` : ""}`);

  // The engine's feel kit: hit-stop clock, trauma shake, flash, knockback, numbers, sound, rumble.
  const feelParam = params.get("feel");
  const feel = new FeelKit({
    preset: feelParam === "subtle" || feelParam === "heavy" ? (feelParam as FeelPresetName) : "default",
    // Crits show in gold.
    numbers: new DamageNumbers(document.body, { colors: { crit: "#ffd23f" } }),
  });
  const qualityParam = params.get("quality");
  // ?style=<art style> previews the game in another style (default: the one game.ts declares).
  const artStyle = pickStyle(game.manifest.game.style, params.get("style"));
  // The asset library: real models by library id (./library next to the page, or the published CID). ?shapes=1 draws the fallback shapes only.
  const libraryBase = params.get("library") ?? env.VITE_LIBRARY_URL ?? "./library";
  const library = params.get("shapes") === "1" ? null : new LibraryClient(handle, { baseUrl: libraryBase, style: artStyle });
  // Real CC0 samples for the feel kit's cues and a music loop, from the library's audio section. Starts on the first press; the mute is remembered.
  const sound = feel.audio ? new SoundPlayer(feel.audio, { key: "emberwatch:sound", musicVolume: 0.35 }) : null;
  sound?.load(soundBank(libraryBase));
  const scene = new SurvivorScene(handle, game, config, feel, {
    library,
    style: artStyle,
    quality: qualityParam === "low" || qualityParam === "medium" || qualityParam === "high" ? (qualityParam as QualityTier) : "auto",
    switches: {
      ...(params.get("shadows") === "0" ? { shadows: false } : params.get("shadows") === "1" ? { shadows: true } : {}),
      ...(params.get("post") === "0" ? { post: false } : {}),
      ...(params.get("lights") === "0" ? { lights: false } : {}),
      ...(params.get("props") === "0" ? { props: false } : {}),
    },
  });
  feel.camera = scene.rig;
  feel.project = (x, y, z) => scene.project(x, y, z);
  // Build every GPU pipeline now, behind the banner, so the first kill does not hitch.
  scene.resize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
  await scene.warmup();
  const input = new SurvivorInput(document.body);
  const sfx = feel.audio;
  // Low health: a heartbeat under the music.
  sfx?.define("heartbeat", { wave: "sine", f0: 86, f1: 42, ms: 170, gain: 0.9 }, { minGapMs: 280, voices: 1, pitchVar: 0 });
  // Achievements, unlocked keepers, today's goals and the keeper pick come from the player's profile on the server.
  const unlocked = new Set<string>();
  const goalsDone = new Set<string>();
  const open = new Set<string>();
  const keeperIds = [...game.manifest.keepers.keys()];
  const keeperOpen = (i: number) => {
    const k = [...game.manifest.keepers.values()][i];
    return !!k && (k.unlock === undefined || open.has(keeperIds[i] ?? ""));
  };
  let keeperPick = 0;
  input.keeper = keeperIds.length > 0 ? keeperPick : -1;
  let api: ProfileApi | null = null;
  let profile: GameProfile | null = null;
  const auth = (): ProfileAuth => (session ? { session: session.token } : { guest: guestId() });
  const prices: Record<string, SkuPrice> = Object.fromEntries(game.manifest.skus);
  // The Kit plugs in here (packages/kit, kit.init({ game })): kit.coins and
  // kit.store have these exact names. The mock stands in until the token is live.
  const kit: KitStoreBridge = withDraftCoin(mockKit({ earned: 60, wallet: 0, usdg: 5 }, prices));
  let storeOpen = false;
  let run: RunInfo | null = null;
  conn.onRun((info) => {
    run = info as RunInfo;
  });

  const hud = new Hud(game, config, {
    pick: (k) => {
      sfx?.unlock();
      sfx?.play("pick");
      input.pick(k);
    },
    reroll: () => input.reroll(),
    skip: () => input.skip(),
    revive: () => void paidRevive(),
    getUp: () => input.getUp(),
    invite: () => {
      const url = `${location.origin}${location.pathname}?room=${conn.roomId}${place !== PLACE ? `&place=${encodeURIComponent(place)}` : ""}${params.has("server") ? `&server=${encodeURIComponent(endpoint)}` : ""}${params.has("game") ? `&game=${encodeURIComponent(params.get("game") ?? "")}` : ""}`;
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
      if (!sound) return true;
      sfx?.unlock();
      return sound.toggle();
    },
    keeper: (i) => {
      if (!keeperOpen(i)) return;
      keeperPick = i;
      input.keeper = i;
      void api?.setSettings(auth(), { ...(profile?.settings ?? {}), keeper: keeperIds[i] ?? "" }).catch(() => undefined);
      hud.setKeepers(keeperPick, open, goalsDone);
      sfx?.play("pick");
    },
    signIn: () => void signIn(),
    again: () => {
      input.ready = true;
    },
  });
  hud.setKeepers(keeperPick, open, goalsDone);
  hud.setSound(sound?.muted ?? true);
  hud.setAccount(session?.address ?? null);

  /** The room pushes the profile on join and on every change (an achievement from the sim, a merge, a purchase). */
  let firstProfile = true;
  conn.onProfile((p) => {
    const before = new Set(unlocked);
    profile = p;
    api ??= new ProfileApi(endpoint, p.game);
    unlocked.clear();
    for (const a of p.achievements) unlocked.add(a.id);
    open.clear();
    for (const k of p.keepers) open.add(k);
    goalsDone.clear();
    for (const g of p.goals.done) goalsDone.add(g);
    if (firstProfile) {
      firstProfile = false;
      const want = typeof p.settings.keeper === "string" ? keeperIds.indexOf(p.settings.keeper) : -1;
      if (want >= 0 && keeperOpen(want)) keeperPick = want;
      void carryOver(p);
    } else {
      for (const id of unlocked) {
        if (before.has(id)) continue;
        const keeperName = [...game.manifest.keepers.values()].find((k) => k.unlock === id)?.name;
        hud.toast(`${game.manifest.achievements.get(id)?.title ?? id}${keeperName ? `  ·  ${keeperName} unlocked` : ""}`);
      }
    }
    if (!keeperOpen(keeperPick)) keeperPick = 0;
    input.keeper = keeperIds.length > 0 ? keeperPick : -1;
    hud.setKeepers(keeperPick, open, goalsDone);
  });

  /**
   * Once: progress this browser kept before saves moved to the server goes
   * into the guest profile; a signed-in player's guest progress then merges
   * into the wallet (and the guest id is spent).
   */
  async function carryOver(p: GameProfile): Promise<void> {
    if (!api) return;
    try {
      const old = loadSet("achievements");
      const today = Math.floor(Date.now() / 86_400_000);
      const oldGoals = loadSet(`goals-${today}`);
      const oldKeeper = legacy.get("keeper");
      if (legacy.get("imported") !== "1" && (old.size > 0 || oldGoals.size > 0 || oldKeeper)) {
        if (p.kind === "guest" && p.imported) legacy.set("imported", "1");
        else {
          await api.importLocal(guestId(), { achievements: [...old], goals: { day: today, done: [...oldGoals] }, ...(oldKeeper ? { settings: { keeper: oldKeeper } } : {}) });
          legacy.set("imported", "1");
        }
      }
      if (session) {
        await api.claim(session.token, guestId());
        rotateGuestId();
      }
    } catch {
      // The server keeps whatever it has; the next load tries again.
    }
  }

  /** Sign in with a wallet (one signature, no gas): the guest's progress merges into the wallet's saves. */
  async function signIn(): Promise<void> {
    const provider = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    if (!provider) return hud.toast("No wallet found in this browser");
    try {
      session = await signInWithWallet(endpoint, provider);
      if (api) await api.claim(session.token, guestId()).catch(() => undefined);
      rotateGuestId();
      const r = await conn.signIn(session.token);
      hud.setAccount(session.address);
      hud.toast(r.ok ? "Signed in: progress saved to your wallet" : "Signed in");
    } catch {
      saveSession(endpoint, null);
      session = null;
      hud.toast("Sign-in cancelled");
    }
  }
  let runNumber = 0;
  conn.onEarn((e) => hud.earned(e.rule, e.units));

  async function paidRevive(): Promise<void> {
    let proof: string | null;
    try {
      proof = (await kit.coins.spend(REVIVE_PRICE, "revive")).key;
    } catch {
      hud.toast(`Not enough ${kit.coins.symbol()}`);
      return;
    }
    // The spend's key proves the paid revive to the room, once.
    const r = await conn.command({ name: "revive", ...(proof ? { proof } : {}) });
    if (!r.ok) hud.toast(r.reason === "store not live" ? "Revives open when the store goes live" : "Revive not available now");
  }
  async function equipCosmetic(): Promise<void> {
    const r = await conn.command({ name: "cosmetic", value: COSMETICS.skin_aurora ?? 1 });
    if (!r.ok) hud.toast("Cosmetics open when the store goes live");
  }
  const buy = document.getElementById("buy-aurora") as HTMLButtonElement | null;
  buy?.addEventListener("click", async () => {
    if (!kit.store.owns("skin_aurora")) {
      try {
        await kit.store.buy("skin_aurora", { pay: "coins" });
      } catch {
        hud.toast(`Not enough ${kit.coins.symbol()}`);
        return;
      }
    }
    buy.textContent = "Equipped";
    await equipCosmetic();
  });
  hud.coin(kit.coins.name(), kit.coins.symbol(), kit.coins.logo());
  wireStake(conn, kit, (t) => hud.toast(t));
  wireGear(gearOf(game.manifest.skus, SKU_NAMES), kit, (t) => hud.toast(t));
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
  const priceEl = document.getElementById("revive-price");
  if (priceEl) priceEl.textContent = `${REVIVE_PRICE} ${kit.coins.symbol()}`;
  if (buy) buy.textContent = `${COSMETIC_PRICE} ${kit.coins.symbol()}`;

  // RTT probe every 2 s (a control message, not the hot path).
  let rtt = 0;
  conn.room.onMessage("pong", (t: number) => {
    rtt = performance.now() - t;
  });
  setInterval(() => conn.room.send("ping", performance.now()), 2000);

  // ?autopilot=1: the human-like playtest bot (200 ms reactions, kiting, a second per card).
  const autopilotBot = new HumanBot({ picks: "greedy", weaponCount: game.weaponIds.length, seed: conn.welcome.player });
  // Input on its own fixed clock, steered by the server's queue (clock adjustment).
  let nextTick = performance.now();
  let ticks = 0;
  let lastView: { self: SceneEntity | undefined; others: readonly SceneEntity[] } = { self: undefined, others: [] };
  setInterval(() => {
    const now = performance.now();
    let n = 0;
    while (nextTick <= now && n < 5) {
      let cmd: InputCommand;
      if (autopilot) {
        const me = lastView.self;
        const enemies: [number, number][] = [];
        for (const e of lastView.others) if (e.kind === 2) enemies.push([(e.values[F.ex] ?? 0) / CROWD_UNITS, (e.values[F.ez] ?? 0) / CROWD_UNITS]);
        const gems: [number, number][] = [];
        for (const e of lastView.others) if (e.kind === 4) gems.push([(e.values[F.ex] ?? 0) / CROWD_UNITS, (e.values[F.ez] ?? 0) / CROWD_UNITS]);
        if (me) {
          const x = (me.values[F.px] ?? 0) / PLAYER_UNITS;
          const z = (me.values[F.pz] ?? 0) / PLAYER_UNITS;
          const seen = (q: readonly [number, number]) => insideView(game.view, q[0] - x, q[1] - z);
          const flags = me.values[F.flags] ?? 0;
          cmd = autopilotBot.input(
            { x, z, up: (flags & 6) === 0, choices: me.values[F.choices] ?? 0, weapons: me.values[F.weapons] ?? 0, half: config.arena.halfExtent, pillars: config.arena.pillars, enemies: enemies.filter(seen), gems: gems.filter(seen) },
            ticks,
          );
        } else cmd = adapter.input.idle;
        // The autopilot plays the picked keeper and votes to play again.
        cmd = { ...cmd, buttons: cmd.buttons | (keeperIds.length > 0 ? keeperButtons(keeperPick) : 0) | (input.ready ? 1 << 10 : 0) };
      } else cmd = input.sample(ticks);
      conn.net.tick(cmd, now);
      ticks++;
      nextTick += conn.net.tickIntervalMs();
      n++;
    }
    if (n === 5) nextTick = now + conn.net.tickIntervalMs();
  }, 4);
  sfx?.unlockOnGesture();
  // Buttons click (cards and keepers play their own confirm).
  addEventListener("click", (e) => {
    const b = (e.target as HTMLElement | null)?.closest?.("button");
    if (b && !b.closest("#cards") && !b.closest("#keepers")) sfx?.play("ui");
  });
  if (input.touch) hud.touchHint();
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
  let level = 1;
  let xpSeen = 0;
  let wasDown = false;
  let nextBeat = 0;
  let lastBytes = 0;
  let lastUp = 0;
  let lastNet = performance.now();
  let downKBps = 0;
  let upKBps = 0;
  let lastStats = 0;
  let pixelRatio = handle.renderer.getPixelRatio();
  // The red vignette is drawn by the post stack now (FeelKit.hurtPulse).
  const hurt = document.getElementById("hurt");
  if (hurt) hurt.style.display = "none";
  const tickMs = 1000 / adapter.tickHz;

  handle.renderer.setAnimationLoop((t: number) => {
    const real = performance.now();
    if (last !== 0) frame.push(t - last);
    last = t;
    const { now, dt, realDt } = feel.tick(real);
    const view = conn.net.render(now);
    lastView = view;
    const worldTick = conn.net.renderTick(now) + 100 / tickMs;
    const players = view.others.filter((e) => e.kind === 1);
    // Low health: a pulsing red edge and a heartbeat (faster the lower it gets).
    const selfHp = view.self?.values[F.health] ?? 0;
    const selfMax = Math.max(1, maxHealthFor(config, view.self?.values[F.stats] ?? 0));
    const selfUp = view.self ? ((view.self.values[F.flags] ?? 0) & 6) === 0 : false;
    const low = selfUp && selfHp > 0 && selfHp / selfMax < 0.3;
    if (low && real >= nextBeat) {
      sfx?.play("heartbeat");
      nextBeat = real + 520 + (selfHp / selfMax) * 1600;
    }
    const lowPulse = low ? 0.28 + 0.16 * Math.max(0, Math.sin(real / 140)) : 0;
    const ev = scene.frame({ dt, realDt, worldTick, self: view.self, others: view.others, selfPlayer: conn.welcome.player, hurt: Math.max(feel.hurtPulse * 0.7, lowPulse) });
    if (frames === 0) {
      firstFrameMs = real - bootAt;
      banner?.remove();
    }
    frames++;

    // Game feel the scene does not fire itself: our own hurt and level-ups.
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (ev.selfHurt > 0) feel.hurt(ev.selfHurt, Math.max(1, (view.self?.values[F.health] ?? 0) + ev.selfHurt));
    const myLevel = view.self?.values[F.level] ?? level;
    if (myLevel > level && view.self) {
      // Yours only: the flash, the word and the sound never fire for a teammate's level.
      feel.levelUp();
      hud.levelUp();
      // A level-up burst around the keeper.
      const lx = (view.self.values[F.px] ?? 0) / PLAYER_UNITS;
      const lz = (view.self.values[F.pz] ?? 0) / PLAYER_UNITS;
      scene.stack.particles.burst("magic", lx, 0.6, lz, { count: 36, color: 0x7ad7ff, speed: 6 });
      scene.stack.particles.burst("embers", lx, 0.2, lz, { count: 18, color: 0xffd36b, speed: 4 });
      scene.counts.levelUps++;
    }
    feel.update(dt, realDt);
    // Gems: a soft tink as your XP climbs (the cue's own gap keeps a vacuum from machine-gunning).
    const myXp = view.self?.values[F.xp] ?? 0;
    if (view.self && (myXp > xpSeen || myLevel > level) && frames > 1) sfx?.play("gem", { gain: 0.8 });
    xpSeen = myXp;
    // Going down and getting back up have their own sounds.
    const myFlags = view.self?.values[F.flags] ?? 0;
    const downNow = (myFlags & 6) !== 0;
    if (view.self && downNow !== wasDown && frames > 1) sfx?.play(downNow ? "downed" : "revive");
    wasDown = downNow;
    level = myLevel;
    const runNow = run ?? (conn.latestRun() as RunInfo | null);
    hud.update(real, view.self, players, runNow, (x, y, z) => scene.project(x, y, z, w, h), {
      revivePrice: REVIVE_PRICE,
      balance: kit.coins.balance(),
    });
    if (runNow) {
      if (runNow.run !== runNumber) {
        runNumber = runNow.run;
        input.ready = false;
      }
      // Achievements and goals are saved by the server (the profile message above); the HUD shows the run's progress.
      for (const g of hud.goalsReached(runNow, conn.welcome.player)) hud.toast(`Goal: ${game.manifest.missions.get(g)?.text ?? g}`);
    }
    cpu.push(performance.now() - real);

    // Dynamic resolution and quality tiers live in the engine's render stack (spec §5).
    pixelRatio = handle.renderer.getPixelRatio();

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
    const stats: SurvivorStats = {
      backend: handle.backend,
      fps: mean > 0 ? 1000 / mean : 0,
      frameMs: { mean, p50: frame.percentile(0.5), p95: frame.percentile(0.95), p99: frame.percentile(0.99) },
      cpuMs: { mean: cpu.mean(), p95: cpu.percentile(0.95) },
      drawCalls: info.drawCalls,
      triangles: info.triangles,
      enemiesDrawn: ev.enemiesDrawn,
      entitiesInView: view.others.length,
      downKBps,
      upKBps,
      rttMs: rtt,
      joinMs,
      firstFrameMs,
      corrections: conn.net.corrections,
      inputBuffer: conn.net.serverInputBuffer,
      frames,
      roomId: conn.roomId,
      phase: run?.phase ?? "",
      wave: run?.wave ?? 0,
      level,
      pixelRatio,
      feel: {
        numbers: feel.numbers?.shown ?? 0,
        ...scene.counts,
        hitStops: feel.clock.stops,
        shakes: feel.counts.hits + feel.counts.hurts + feel.counts.bigKills,
        kills: feel.counts.kills,
        chunks: scene.dressing.counts.chunks,
        blasts: scene.dressing.counts.blasts,
      },
      quality: scene.stack.quality.tier,
    };
    window.__survivor = stats;
    if (real - lastStats > 250) {
      lastStats = real;
      hud.stats(
        [
          `${stats.backend.toUpperCase()}  ${stats.fps.toFixed(0)} fps  p95 ${stats.frameMs.p95.toFixed(1)} ms  dpr ${pixelRatio}`,
          `draws ${stats.drawCalls}  tris ${(stats.triangles / 1000).toFixed(0)}k  enemies drawn ${stats.enemiesDrawn}`,
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
