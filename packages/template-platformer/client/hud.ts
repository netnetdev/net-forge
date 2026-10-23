/**
 * SKYLEDGE's HUD (plain DOM over the canvas): the course and everyone's
 * place along it, your coins, the race clock and your place, the countdown,
 * the standings, the results with what this round paid, the coin box and
 * toasts. Text updates are throttled to ten a second.
 */
import { PF } from "@netforge/engine/game";
import type { CompiledGame, RaceInfo } from "@netforge/engine/game";
import { BOT_PLAYER_BASE, platformCoinCount } from "@netforge/engine-sim";
import { RULE_NAMES } from "./names.js";
import type { SceneEntity } from "./scene.js";
import { climberColor } from "./scene.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};
const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;
const clockText = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const nameOf = (id: number, self: number) => (id === self ? "You" : id >= BOT_PLAYER_BASE ? `Climber ${id - BOT_PLAYER_BASE + 1}` : `Player ${id}`);

export interface HudActions {
  invite(): void;
  toggleStore(): void;
  toggleSound(): boolean;
  ready(): void;
}

export class Hud {
  private symbol = "";
  private mode: "earning" | "guest" | "play" = "earning";
  private lastText = 0;
  private toastTimer = 0;
  private lastRun = -1;
  private readonly earnedThisRun = new Map<string, number>();
  private readonly markers = new Map<number, HTMLElement>();
  private lastCount = -1;
  private lastAnnounce = 0;

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

  /** What play pays the person at the screen (guest: "not earning"; play money: a caption). */
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

  /** Every frame: `self` our predicted climber, `everyone` all climbers in view. */
  update(now: number, self: SceneEntity | undefined, everyone: readonly SceneEntity[], run: (RaceInfo & { level?: string | null }) | null, balance: number, buffs: string): void {
    if (run && run.run !== this.lastRun) {
      this.lastRun = run.run;
      this.earnedThisRun.clear();
    }
    // The countdown is big and immediate: update it every frame.
    const count = $("count");
    const counting = run?.phase === "countdown";
    count.classList.toggle("show", counting);
    if (counting && run && run.countdown !== this.lastCount) {
      this.lastCount = run.countdown;
      $("count-n").textContent = run.countdown > 0 ? String(run.countdown) : "GO";
      $("count-sub").textContent = run.level ? run.level.toUpperCase() : "";
    }
    // A system's announce() (and the finish window) shows as a toast.
    if (run?.announce && run.announce.id !== this.lastAnnounce) {
      this.lastAnnounce = run.announce.id;
      this.toast(run.announce.text);
    }
    if (now - this.lastText < 100) return;
    this.lastText = now;
    $("coin-balance").textContent = this.balanceText(balance);
    $("buffs").textContent = buffs;
    const platformer = this.game.platformer;
    const course = run?.course ?? 0;
    const level = platformer?.levels[course];
    $("course").textContent = run?.level ?? platformer?.names[course] ?? "";
    if (self && level) {
      const n = platformCoinCount({ coinsLo: self.values[PF.coinsLo] ?? 0, coinsHi: self.values[PF.coinsHi] ?? 0 });
      $("coin-count").textContent = String(n);
      $("coin-total").textContent = `/ ${level.coins.length}`;
    }
    // Everyone's place along the course: a marker on the track bar.
    const track = $("track");
    const seen = new Set<number>();
    for (const p of run?.players ?? []) {
      seen.add(p.id);
      let m = this.markers.get(p.id);
      if (!m) {
        m = document.createElement("i");
        m.style.setProperty("--c", `#${climberColor(p.id).toString(16).padStart(6, "0")}`);
        track.append(m);
        this.markers.set(p.id, m);
      }
      m.classList.toggle("me", p.id === this.self);
      m.style.left = `${Math.min(100, p.progress * 100).toFixed(1)}%`;
    }
    for (const [id, m] of this.markers) {
      if (seen.has(id)) continue;
      m.remove();
      this.markers.delete(id);
    }
    // Clock and place.
    const timer = $("timer");
    if (run) {
      const left = run.left;
      timer.textContent = run.phase === "racing" ? (left !== null ? clockText(left) : clockText(run.seconds)) : run.phase === "countdown" ? "READY" : "DONE";
      timer.classList.toggle("low", run.phase === "racing" && left !== null && left <= 15);
      const me = run.players.find((p) => p.id === this.self);
      $("place").textContent = me ? (me.place !== null ? `FINISHED ${ord(me.place).toUpperCase()} · ${me.time?.toFixed(2)} s` : `${ord(me.rank).toUpperCase()} OF ${run.players.length}`) : "";
      // Standings.
      const board = $("board");
      board.replaceChildren(
        ...run.players.slice(0, 8).map((p) => {
          const li = document.createElement("li");
          if (p.id === this.self) li.className = "me";
          li.style.setProperty("--c", `#${climberColor(p.id).toString(16).padStart(6, "0")}`);
          li.innerHTML = `<em></em><span class="dot"></span><span></span><b></b>`;
          (li.children[0] as HTMLElement).textContent = String(p.rank);
          (li.children[2] as HTMLElement).textContent = nameOf(p.id, this.self);
          (li.children[3] as HTMLElement).textContent = p.place !== null ? `${p.time?.toFixed(1)}s` : `${Math.round(p.progress * 100)}%`;
          return li;
        }),
      );
      this.results(run);
    }
    void everyone;
  }

  private results(run: RaceInfo & { level?: string | null }): void {
    const end = $("end");
    const show = run.phase === "results";
    end.classList.toggle("show", show);
    if (!show) return;
    const me = run.players.find((p) => p.id === this.self);
    $("end-title").textContent = me?.place === 1 ? "FIRST TO THE FLAG" : me?.place !== null && me?.place !== undefined ? `${ord(me.place).toUpperCase()} PLACE` : "OUT OF TIME";
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
    $("end-next").textContent = run.nextRunIn !== null ? `NEXT COURSE IN ${run.nextRunIn}` : "";
  }

  stats(text: string): void {
    $("stats").textContent = text;
  }
}
