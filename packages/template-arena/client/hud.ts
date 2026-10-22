/**
 * The HUD: plain DOM over the canvas. Text updates are
 * throttled; bars move every frame with transforms. Copy is labels, not
 * sentences.
 */
import { BOT_PLAYER_BASE, EntityFlag, maxHealthFor, selectedSlot, slotWeapon } from "@netnetcapital/engine-sim";
import type { ResolvedSimConfig } from "@netnetcapital/engine-sim";
import { F, PLAYER_UNITS } from "@netnetcapital/engine/game";
import type { CompiledGame, RunInfo } from "@netnetcapital/engine/game";
import type { SceneEntity } from "./scene.js";
import { RULE_NAMES, TITLE, UPGRADE_NAMES, WEAPON_NAMES } from "./names.js";
import { css, playerColor } from "./palette.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e as T;
};

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Seat bots go by first names (the full board still marks them as bots). */
export const BOT_NAMES = ["Mara", "Dex", "Juno", "Rook", "Vega", "Nico", "Tamsin", "Ozzy", "Lark", "Remy", "Sable", "Bram", "Ivy", "Cass", "Wren", "Kit"];

/** Short player labels: YOU, P2, or a seat bot's name. */
export function playerLabel(id: number, self: number): string {
  if (id === self) return "YOU";
  return id >= BOT_PLAYER_BASE ? (BOT_NAMES[(id - BOT_PLAYER_BASE) % BOT_NAMES.length] ?? "Bot").toUpperCase() : `P${id}`;
}

/** Off-screen opponents within this many metres get an edge arrow. */
const ARROW_RANGE = 45;

export interface HudCallbacks {
  pickWeapon(slot: number): void;
  invite(): void;
  toggleStore(): void;
  toggleSound(): boolean;
}

export class Hud {
  private lastText = 0;
  private readonly earnedThisRun = new Map<string, number>();
  private toastTimer = 0;
  private lastRun = 0;
  private symbol = "";
  /** What play pays here (client/host.ts): a guest in Net Forge earns nothing, and the HUD says so. */
  private mode: "earning" | "guest" | "play" = "earning";
  private slotKey = "";
  private boardOpen = false;
  private readonly cdTicks: number[];

  constructor(
    private readonly game: CompiledGame,
    private readonly config: ResolvedSimConfig,
    private readonly selfPlayer: number,
    private readonly cb: HudCallbacks,
  ) {
    $("invite").addEventListener("click", () => cb.invite());
    $("store-btn").addEventListener("click", () => cb.toggleStore());
    $("store-close").addEventListener("click", () => cb.toggleStore());
    // The label names the current state. Sound starts on, so the first click mutes and reads "Sound off".
    $("sound").textContent = "Sound on";
    $("sound").addEventListener("click", () => {
      $("sound").textContent = cb.toggleSound() ? "Sound off" : "Sound on";
    });
    $("title").textContent = TITLE.toUpperCase();
    this.cdTicks = config.content.weapons.map((w) => w.cooldownTicks);
    // Weapon slots: one card per loadout weapon.
    const slots = $("slots");
    slots.innerHTML = "";
    game.loadout.forEach((wi, s) => {
      const id = game.weaponIds[wi] ?? "";
      const card = document.createElement("button");
      card.className = "slot";
      card.id = `slot${s}`;
      card.innerHTML = `<kbd>${s + 1}</kbd><b></b><span></span><i class="cd"><i></i></i>`;
      (card.querySelector("b") as HTMLElement).textContent = WEAPON_NAMES[id]?.name ?? id;
      (card.querySelector("span") as HTMLElement).textContent = WEAPON_NAMES[id]?.line ?? "";
      card.addEventListener("click", () => cb.pickWeapon(s));
      slots.append(card);
    });
    // Tab holds the full board open; the corner keeps only the top three and your own row.
    addEventListener("keydown", (e) => {
      if (e.code === "Tab") {
        e.preventDefault();
        this.boardOpen = true;
        $("board-full").classList.add("open");
      }
    });
    addEventListener("keyup", (e) => {
      if (e.code === "Tab") {
        this.boardOpen = false;
        $("board-full").classList.remove("open");
      }
    });
  }

  /** Names the coin everywhere the HUD shows it: the token's own name, symbol and logo. */
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

  get coinSymbol(): string {
    return this.symbol;
  }

  /** The wordmark: the game's own name (Net Forge names it), else the template's. */
  title(name: string): void {
    $("title").textContent = name.toUpperCase();
  }

  /**
   * What play pays the person at the screen. A guest (no wallet in
   * Net Forge) sees "not earning" where the balance was, and earn toasts say
   * how to get paid; play money says so.
   */
  player(mode: "earning" | "guest" | "play"): void {
    this.mode = mode;
    const box = $("coin-box");
    box.classList.toggle("guest", mode === "guest");
    box.classList.toggle("play", mode === "play");
    box.title = mode === "guest" ? `Connect a wallet to earn ${this.symbol}` : mode === "play" ? `${this.symbol} has not launched: coins are play money` : "";
    this.lastText = 0;
  }

  /** The coin box's text: the balance, or "VOLT · not earning" for a guest (play money gets a caption in CSS). */
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

  /** Every frame. `self` is the predicted character; `players` every wirejack in view (others interpolated). */
  update(
    now: number,
    self: SceneEntity | undefined,
    players: readonly SceneEntity[],
    run: RunInfo | null,
    project: (x: number, y: number, z: number) => { x: number; y: number; onScreen: boolean },
    balance: number,
  ): void {
    if (run && run.run !== this.lastRun) {
      this.lastRun = run.run;
      this.earnedThisRun.clear();
    }
    const text = now - this.lastText > 100;
    if (self) {
      const hp = self.values[F.health] ?? 0;
      const max = maxHealthFor(this.config, self.values[F.stats] ?? 0);
      $("hp-fill").style.transform = `scaleX(${Math.min(1, hp / Math.max(1, max))})`;
      const dead = ((self.values[F.flags] ?? 0) & EntityFlag.Dead) !== 0;
      $("down").classList.toggle("show", dead && run?.phase === "playing");
      // Weapon slots: the selected one lit, cooldowns as bars.
      const weapons = self.values[F.weapons] ?? 0;
      const wcd = self.values[F.wcd] ?? 0;
      const slot = selectedSlot(self.values[F.choices] ?? 0);
      for (let s = 0; s < this.game.loadout.length; s++) {
        const card = document.getElementById(`slot${s}`);
        if (!card) continue;
        const wi = slotWeapon(weapons, s);
        const full = this.cdTicks[wi] ?? 1;
        const cd = (wcd >>> (s * 8)) & 0xff;
        (card.querySelector(".cd > i") as HTMLElement | null)?.style.setProperty("transform", `scaleX(${Math.min(1, cd / full)})`);
      }
      const key = String(slot);
      if (key !== this.slotKey) {
        this.slotKey = key;
        for (let s = 0; s < this.game.loadout.length; s++) document.getElementById(`slot${s}`)?.classList.toggle("on", s === slot);
      }
      if (text) {
        $("hp-text").textContent = `${hp}`;
        if (dead) $("down-sub").textContent = `${Math.max(1, Math.ceil((self.values[F.cooldown] ?? 0) / this.config.tickRate))}s`;
        // Store upgrades this round.
        const stats = self.values[F.stats] ?? 0;
        const active = this.game.upgradeIds.filter((_, i) => ((stats >>> (i * 4)) & 0x0f) > 0).map((id) => UPGRADE_NAMES[id]?.name ?? id);
        $("buffs").textContent = active.join("  ");
      }
    }
    if (text) $("coin-balance").textContent = this.balanceText(balance);

    // Name tags and health over every other wirejack on screen; an edge arrow for each one nearby but off screen.
    const tags = $("tags");
    const arrows = $("arrows");
    const sx = (self?.values[F.px] ?? 0) / PLAYER_UNITS;
    const sz = (self?.values[F.pz] ?? 0) / PLAYER_UNITS;
    const w = innerWidth;
    const h = innerHeight;
    let ti = 0;
    let ai = 0;
    for (const p of players) {
      if (self && p.owner === self.owner) continue;
      if (((p.values[F.flags] ?? 0) & EntityFlag.Dead) !== 0) continue;
      const px = (p.values[F.px] ?? 0) / PLAYER_UNITS;
      const pz = (p.values[F.pz] ?? 0) / PLAYER_UNITS;
      const s = project(px, 2.4, pz);
      if (!s.onScreen) {
        const dist = Math.hypot(px - sx, pz - sz);
        if (!self || dist > ARROW_RANGE) continue;
        // From the screen centre toward the opponent, pinned inside the HUD margins (the weapon cards sit at the bottom).
        const dx = s.x - w / 2;
        const dy = s.y - h / 2;
        const hx = w / 2 - 34;
        const hy = dy < 0 ? h / 2 - 80 : h / 2 - 118;
        const k = Math.min(hx / Math.max(1e-3, Math.abs(dx)), hy / Math.max(1e-3, Math.abs(dy)));
        let a = arrows.children[ai] as HTMLElement | undefined;
        if (!a) {
          a = document.createElement("i");
          arrows.append(a);
        }
        ai++;
        const near = 1 - Math.min(1, Math.max(0, (dist - 12) / (ARROW_RANGE - 12)));
        a.style.setProperty("--c", css(playerColor(p.owner)));
        a.style.opacity = (0.45 + 0.55 * near).toFixed(2);
        a.style.transform = `translate(${(w / 2 + dx * k).toFixed(1)}px, ${(h / 2 + dy * k).toFixed(1)}px) rotate(${Math.atan2(dy, dx).toFixed(3)}rad) scale(${(0.8 + 0.5 * near).toFixed(2)})`;
        continue;
      }
      let t = tags.children[ti] as HTMLElement | undefined;
      if (!t) {
        t = document.createElement("div");
        t.className = "tag";
        t.innerHTML = "<span></span><i><i></i></i>";
        tags.append(t);
      }
      ti++;
      const max = maxHealthFor(this.config, p.values[F.stats] ?? 0);
      t.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      t.style.setProperty("--c", css(playerColor(p.owner)));
      const label = playerLabel(p.owner, this.selfPlayer);
      const span = t.firstElementChild as HTMLElement;
      if (span.textContent !== label) span.textContent = label;
      ((t.lastElementChild as HTMLElement).firstElementChild as HTMLElement).style.transform = `scaleX(${Math.min(1, (p.values[F.health] ?? 0) / Math.max(1, max))})`;
    }
    while (tags.children.length > ti) tags.lastElementChild?.remove();
    while (arrows.children.length > ai) arrows.lastElementChild?.remove();

    if (text) {
      this.lastText = now;
      if (run) {
        const left = run.round?.left ?? 0;
        $("timer").textContent = mmss(left);
        $("timer").classList.toggle("low", left <= 15 && run.phase === "playing");
        $("goal").textContent = run.round?.frags ? `FIRST TO ${run.round.frags}` : "MOST KILLS";
        this.board(run);
        this.feed(run);
        this.end(run);
      }
    }
  }

  /** Kills first; on a tie a person ranks above a seat bot (bots never take the round). */
  private standings(run: RunInfo) {
    return [...run.players].sort((a, b) => b.kills - a.kills || Number(a.bot) - Number(b.bot) || a.deaths - b.deaths || a.id - b.id);
  }

  private board(run: RunInfo): void {
    const all = this.standings(run);
    const rank = all.findIndex((p) => p.id === this.selfPlayer);
    const row = (p: RunInfo["players"][number], i: number, full: boolean) => {
      const me = p.id === this.selfPlayer ? ' class="me"' : "";
      const tag = full && p.bot ? '<i class="bot">BOT</i>' : "";
      return `<li${me} style="--c:${css(playerColor(p.id))}"><em>${i + 1}</em><span class="dot"></span>${playerLabel(p.id, this.selfPlayer)}${tag}<b>${p.kills}</b>${full ? `<small>${p.deaths}</small>` : ""}</li>`;
    };
    // The corner: the top three, and your own row when you are lower.
    const mini = all
      .map((p, i) => ({ p, i }))
      .filter(({ i }) => i < 3 || i === rank)
      .map(({ p, i }) => row(p, i, false))
      .join("");
    const list = $("board");
    if (list.innerHTML !== mini) list.innerHTML = mini;
    if (!this.boardOpen) return;
    const html = `<li class="head"><em></em><span></span>PLAYER<b>K</b><small>D</small></li>${all.map((p, i) => row(p, i, true)).join("")}`;
    const full = $("board-full");
    if (full.innerHTML !== html) full.innerHTML = html;
  }

  private feed(run: RunInfo): void {
    const items = run.feed
      .filter((f) => f.ago < 6)
      .slice(-4)
      .map((f) => `<li><span style="color:${css(playerColor(f.by))}">${playerLabel(f.by, this.selfPlayer)}</span><i>&#x2715;</i><span style="color:${css(playerColor(f.victim))}">${playerLabel(f.victim, this.selfPlayer)}</span></li>`);
    const html = items.join("");
    const list = $("feed");
    if (list.innerHTML !== html) list.innerHTML = html;
  }

  private end(run: RunInfo): void {
    const el = $("end");
    const show = run.phase !== "playing";
    el.classList.toggle("show", show);
    if (!show) return;
    // The round goes to the best person in it; a seat bot never takes it.
    const top = this.standings(run).find((p) => !p.bot);
    $("end-title").textContent = top && top.kills > 0 ? (top.id === this.selfPlayer ? "TOP OF THE YARD" : `${playerLabel(top.id, this.selfPlayer)} TAKES IT`) : "ROUND OVER";
    $("end-board").innerHTML = this.standings(run)
      .slice(0, 8)
      .map((p, i) => `<li${p.id === this.selfPlayer ? ' class="me"' : ""}><em>${i + 1}</em>${playerLabel(p.id, this.selfPlayer)}<b>${p.kills}</b><small>${p.deaths}</small></li>`)
      .join("");
    const earned = [...this.earnedThisRun].map(([r, u]) => `<li>${RULE_NAMES[r] ?? r}<b>+${(this.game.manifest.earnRules.get(r)?.pay ?? 0) * u} ${this.symbol}</b></li>`);
    $("end-earned").innerHTML =
      (earned.length > 0 ? earned.join("") : "<li>No earn this round</li>") + (this.mode === "guest" && earned.length > 0 ? `<li class="guest">Not paid: connect a wallet to earn ${this.symbol}</li>` : "");
    $("end-next").textContent = run.nextRunIn !== null ? `Next round ${run.nextRunIn}s` : "";
  }

  stats(text: string): void {
    $("stats").textContent = text;
  }
}
