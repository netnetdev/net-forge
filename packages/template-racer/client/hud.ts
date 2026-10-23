/**
 * TORQUEBAY's HUD (plain DOM and one canvas over the scene): lap and place,
 * the race clock, a minimap of the circuit with every kart, speed, the drift
 * charge, the countdown, standings, results with what this race paid, the
 * coin box and toasts. Text updates are throttled to ten a second.
 */
import { KF } from "@netforge/engine/game";
import type { CompiledGame, RaceInfo } from "@netforge/engine/game";
import { BOT_PLAYER_BASE, kartCoinCount } from "@netforge/engine-sim";
import type { KartTrack } from "@netforge/engine-sim";
import { RULE_NAMES } from "./names.js";
import type { SceneEntity } from "./scene.js";
import { kartColor } from "./scene.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};
const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;
const clockText = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const nameOf = (id: number, self: number) => (id === self ? "You" : id >= BOT_PLAYER_BASE ? `Driver ${id - BOT_PLAYER_BASE + 1}` : `Player ${id}`);
const css = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

export interface HudActions {
  invite(): void;
  toggleStore(): void;
  toggleSound(): boolean;
  ready(): void;
}

type Info = RaceInfo & { level?: string | null; laps?: number };

export class Hud {
  private symbol = "";
  private mode: "earning" | "guest" | "play" = "earning";
  private lastText = 0;
  private toastTimer = 0;
  private lastRun = -1;
  private lastCount = -1;
  private lastAnnounce = 0;
  private readonly earnedThisRun = new Map<string, number>();
  private mapTrack: KartTrack | null = null;
  private mapBox = { minX: 0, minZ: 0, scale: 1 };

  constructor(
    private readonly game: CompiledGame,
    private readonly self: number,
    actions: HudActions,
  ) {
    $("invite").addEventListener("click", () => actions.invite());
    $("store-btn").addEventListener("click", () => actions.toggleStore());
    $("store-close").addEventListener("click", () => actions.toggleStore());
    $("ready").addEventListener("click", () => actions.ready());
    $("sound").addEventListener("click", (e) => {
      const muted = actions.toggleSound();
      (e.currentTarget as HTMLElement).textContent = muted ? "Sound off" : "Sound on";
    });
  }

  coin(name: string, symbol: string, logo: string | null): void {
    this.symbol = symbol;
    const img = $<HTMLImageElement>("coin-logo");
    if (logo) {
      img.src = logo;
      img.alt = name;
      img.hidden = false;
    } else img.hidden = true;
    $("coin-name").textContent = name;
  }

  title(name: string): void {
    $("title").textContent = name.toUpperCase();
  }

  player(mode: "earning" | "guest" | "play"): void {
    this.mode = mode;
    const box = $("coin-box");
    box.classList.toggle("guest", mode === "guest");
    box.classList.toggle("play", mode === "play");
    box.title = mode === "guest" ? `Connect a wallet to earn ${this.symbol}` : mode === "play" ? `${this.symbol} has not launched: coins are play money` : "";
    this.lastText = 0;
  }

  private balanceText(balance: number): string {
    if (this.mode === "guest") return `${this.symbol} · not earning`;
    return `${Math.floor(balance).toLocaleString("en-US")} ${this.symbol}`;
  }

  earned(rule: string, units: number): void {
    this.earnedThisRun.set(rule, (this.earnedThisRun.get(rule) ?? 0) + units);
    const pay = this.game.manifest.earnRules.get(rule)?.pay ?? 0;
    const name = RULE_NAMES[rule] ?? rule;
    this.toast(this.mode === "guest" ? `${name}  Connect to earn ${pay * units} ${this.symbol}` : `${name}  +${pay * units} ${this.symbol}`);
  }

  toast(text: string): void {
    const t = $("toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove("show"), 2400);
  }

  /** Every frame: our predicted kart, every kart in view, the run info, the drawn track. */
  update(now: number, self: SceneEntity | undefined, everyone: readonly SceneEntity[], run: Info | null, balance: number, buffs: string, track: KartTrack | null): void {
    if (run && run.run !== this.lastRun) {
      this.lastRun = run.run;
      this.earnedThisRun.clear();
    }
    const count = $("count");
    const counting = run?.phase === "countdown";
    count.classList.toggle("show", counting);
    if (counting && run && run.countdown !== this.lastCount) {
      this.lastCount = run.countdown;
      $("count-n").textContent = run.countdown > 0 ? String(run.countdown) : "GO";
      $("count-sub").textContent = run.level ? run.level.toUpperCase() : "";
    }
    if (run?.announce && run.announce.id !== this.lastAnnounce) {
      this.lastAnnounce = run.announce.id;
      this.toast(run.announce.text);
    }
    // The drift charge bar and the speed read every frame.
    if (self) {
      const flags = self.values[KF.flags] ?? 0;
      const charge = (self.values[KF.timers] ?? 0) & 0xfff;
      const drift = $("drift");
      drift.classList.toggle("on", (flags & 1) !== 0);
      const bar = drift.firstElementChild as HTMLElement | null;
      if (bar) {
        bar.style.width = `${Math.min(100, (charge / 120) * 100).toFixed(0)}%`;
        bar.style.setProperty("--c", charge >= 120 ? "#d16bff" : charge >= 72 ? "#ffa53a" : charge >= 33 ? "#5fc8ff" : "#bbbbbb");
      }
      const v = Math.hypot((self.values[KF.vx] ?? 0) / 1024, (self.values[KF.vz] ?? 0) / 1024);
      $("kmh").textContent = String(Math.round(v * 3.6 * 1.6));
    }
    this.drawMap(track, self, everyone);
    if (now - this.lastText < 100) return;
    this.lastText = now;
    $("coin-balance").textContent = this.balanceText(balance);
    $("buffs").textContent = buffs;
    $("course").textContent = run?.level ?? "";
    const laps = run?.laps ?? 3;
    if (self && track) {
      const lap = (((self.values[KF.track] ?? 0) >>> 16) & 0xff) + 1;
      $("lap").textContent = `LAP ${Math.min(laps, lap)}/${laps}`;
      $("coin-count").textContent = String(kartCoinCount({ coinsLo: self.values[KF.coinsLo] ?? 0, coinsHi: self.values[KF.coinsHi] ?? 0 }));
      $("coin-total").textContent = `/ ${track.coinAt.length}`;
    }
    const timer = $("timer");
    if (run) {
      const left = run.left;
      timer.textContent = run.phase === "racing" ? clockText(run.seconds) : run.phase === "countdown" ? "READY" : "DONE";
      timer.classList.toggle("low", run.phase === "racing" && left !== null && left <= 15);
      const me = run.players.find((p) => p.id === this.self);
      $("place").textContent = me ? (me.place !== null ? `${ord(me.place).toUpperCase()}` : `${ord(me.rank).toUpperCase()}/${run.players.length}`) : "";
      $("board").replaceChildren(
        ...run.players.slice(0, 8).map((p) => {
          const li = document.createElement("li");
          if (p.id === this.self) li.className = "me";
          li.style.setProperty("--c", css(kartColor(p.id)));
          li.innerHTML = `<em></em><span class="dot"></span><span></span><b></b>`;
          (li.children[0] as HTMLElement).textContent = String(p.rank);
          (li.children[2] as HTMLElement).textContent = nameOf(p.id, this.self);
          (li.children[3] as HTMLElement).textContent = p.place !== null ? `${p.time?.toFixed(1)}s` : `L${Math.min(laps, Math.floor(p.progress * laps) + 1)}`;
          return li;
        }),
      );
      this.results(run);
    }
  }

  /** The circuit as a line and every kart as a dot (ours larger). */
  private drawMap(track: KartTrack | null, self: SceneEntity | undefined, everyone: readonly SceneEntity[]): void {
    const cv = document.getElementById("map") as HTMLCanvasElement | null;
    const g = cv?.getContext("2d");
    if (!cv || !g || !track) return;
    if (track !== this.mapTrack) {
      this.mapTrack = track;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < track.count; i++) {
        minX = Math.min(minX, track.x[i] ?? 0);
        maxX = Math.max(maxX, track.x[i] ?? 0);
        minZ = Math.min(minZ, track.z[i] ?? 0);
        maxZ = Math.max(maxZ, track.z[i] ?? 0);
      }
      const scale = (cv.width - 40) / Math.max(maxX - minX, maxZ - minZ, 1);
      this.mapBox = { minX: minX - 20 / scale, minZ: minZ - 20 / scale, scale };
    }
    const { minX, minZ, scale } = this.mapBox;
    const px = (x: number) => (x - minX) * scale;
    const pz = (z: number) => (z - minZ) * scale;
    g.clearRect(0, 0, cv.width, cv.height);
    g.lineJoin = "round";
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 9;
    g.beginPath();
    for (let i = 0; i <= track.count; i++) {
      const k = i % track.count;
      if (i === 0) g.moveTo(px(track.x[k] ?? 0), pz(track.z[k] ?? 0));
      else g.lineTo(px(track.x[k] ?? 0), pz(track.z[k] ?? 0));
    }
    g.stroke();
    for (const e of [...everyone, ...(self ? [self] : [])]) {
      const mine = e === self;
      g.fillStyle = css(kartColor(e.owner));
      g.beginPath();
      g.arc(px((e.values[KF.x] ?? 0) / 1024), pz((e.values[KF.z] ?? 0) / 1024), mine ? 11 : 7, 0, Math.PI * 2);
      g.fill();
      if (mine) {
        g.strokeStyle = "#fff";
        g.lineWidth = 3;
        g.stroke();
      }
    }
  }

  private results(run: Info): void {
    const end = $("end");
    const show = run.phase === "results";
    end.classList.toggle("show", show);
    if (!show) return;
    const me = run.players.find((p) => p.id === this.self);
    $("end-title").textContent = me?.place === 1 ? "CHEQUERED FLAG: FIRST" : me?.place !== null && me?.place !== undefined ? `${ord(me.place).toUpperCase()} PLACE` : "DID NOT FINISH";
    $("end-board").replaceChildren(
      ...run.players.map((p) => {
        const li = document.createElement("li");
        if (p.id === this.self) li.className = "me";
        li.innerHTML = `<em></em><span></span><b></b>`;
        (li.children[0] as HTMLElement).textContent = p.place !== null ? String(p.place) : "-";
        (li.children[1] as HTMLElement).textContent = nameOf(p.id, this.self);
        (li.children[2] as HTMLElement).textContent = p.time !== null ? `${p.time.toFixed(2)} s` : "did not finish";
        return li;
      }),
    );
    const mine = run.coins.find((c) => c.id === this.self)?.rules ?? [...this.earnedThisRun].map(([rule, units]) => ({ rule, units }));
    $("end-earned").replaceChildren(
      ...mine.map((r) => {
        const li = document.createElement("li");
        if (this.mode === "guest") li.className = "guest";
        const pay = (this.game.manifest.earnRules.get(r.rule)?.pay ?? 0) * r.units;
        li.innerHTML = `<span></span><b></b>`;
        (li.children[0] as HTMLElement).textContent = RULE_NAMES[r.rule] ?? r.rule;
        (li.children[1] as HTMLElement).textContent = this.mode === "guest" ? `${pay} ${this.symbol} (connect to earn)` : `+${pay} ${this.symbol}`;
        return li;
      }),
    );
    $("end-next").textContent = run.nextRunIn !== null ? `NEXT RACE IN ${run.nextRunIn}` : "";
  }

  stats(text: string): void {
    $("stats").textContent = text;
  }
}
