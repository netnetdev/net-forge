/**
 * The HUD: plain DOM over the canvas (game-runtime.md §3: Preact or plain
 * DOM). Text updates are throttled; bars move every frame with transforms.
 * Copy is labels, not sentences.
 */
import { DOT_ICON, STAT_ICONS, WEAPON_ICONS } from "./icons.js";
import { decodeChoices, EntityFlag, maxHealthFor, slotLevel, slotWeapon, statLevel, xpForLevel } from "@netnetcapital/engine-sim";
import type { WeaponDef } from "@netnetcapital/engine";
import type { ResolvedSimConfig } from "@netnetcapital/engine-sim";
import { F, PLAYER_UNITS, todaysGoals } from "@netnetcapital/engine/game";
import type { CompiledGame, RunInfo } from "@netnetcapital/engine/game";
import type { SceneEntity } from "./scene.js";
import { ENEMY_NAMES, RULE_NAMES, UPGRADE_NAMES, WEAPON_NAMES } from "./names.js";
import { KEEPER_COLORS } from "./palette.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e as T;
};

/** What one weapon level changes, in words ("+1 projectile, -20% cooldown"), from its declared levels or the generic curve. */
function levelChange(def: WeaponDef | undefined, level: number): string {
  if (!def) return "";
  const change = def.levels?.[level - 1];
  if (!change) return def.levels ? "" : "+25% damage";
  const noun: Record<string, string> = { bolt: "projectile", boomerang: "blade", orbit: "blade", chain: "jump", meteor: "meteor", cone: "sweep", nova: "pulse", aura: "pulse" };
  return Object.entries(change)
    .map(([field, v]) => {
      if (typeof v === "string") return `${v} ${field}`;
      const sign = v >= 0 ? "+" : "";
      if (field === "count") return `${sign}${v} ${noun[def.kind] ?? "count"}`;
      if (field === "cooldown") return `${sign}${v}s cooldown`;
      if (field === "range") return `${sign}${v} m range`;
      if (field === "spread") return `${sign}${v}° wider`;
      return `${sign}${v} ${field}`;
    })
    .join(", ");
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
/** A declared id as words ("gloam_ram" → "Gloam Ram") when the names table has no entry. */
const words = (id: string) => id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const SOURCE_WORDS: Readonly<Record<string, string>> = { contact: "touch", charge: "charge", blast: "blast", projectile: "shot", slam: "slam", hazard: "hazard" };

/** Today's goals: three of the declared missions, the same for everyone on a UTC day (the engine's rule; the server counts the same ones). */
export { todaysGoals };

export interface HudCallbacks {
  pick(k: number): void;
  reroll(): void;
  skip(): void;
  revive(): void;
  /** Spend the free self-revive (the same as Space while downed). */
  getUp(): void;
  invite(): void;
  toggleStore(): void;
  toggleSound(): boolean;
  /** Sign in with a wallet: saves follow the wallet to every device. */
  signIn(): void;
  /** Choose keeper `index` (taken at the start of a run). */
  keeper(index: number): void;
  /** The end screen's "Play again" vote. */
  again(): void;
}

export class Hud {
  private lastText = 0;
  private offerKey = "";
  private readonly earnedThisRun = new Map<string, number>();
  private toastTimer = 0;
  private lastRun = 0;
  private lastAnnounce = 0;
  private announceTimer = 0;
  /** Most enemies alive this run (the end screen shows it). */
  private peak = 0;
  /** The game's coin: its token's own symbol and logo (never a generic "COIN"). */
  private symbol = "";
  /** What play pays here (client/host.ts): a guest in Net Forge earns nothing, and the HUD says so. */
  private mode: "earning" | "guest" | "play" = "earning";
  /** The keeper this viewer picked (index), and the achievements this browser has seen. */
  private keeperPick = 0;
  private unlocked: ReadonlySet<string> = new Set();
  private keepersKey = "";
  private invKey = "";
  private goalsKey = "";
  private endKey = "";
  private voted = false;
  /** Goals done today (this browser). */
  private goalsDone = new Set<string>();
  private readonly day = Math.floor(Date.now() / 86_400_000);
  private readonly goals: string[];

  constructor(
    private readonly game: CompiledGame,
    private readonly config: ResolvedSimConfig,
    private readonly cb: HudCallbacks,
  ) {
    for (let k = 0; k < 3; k++) $(`card${k}`).addEventListener("click", () => cb.pick(k));
    $("reroll").addEventListener("click", () => cb.reroll());
    $("skip").addEventListener("click", () => cb.skip());
    $("revive-btn").addEventListener("click", () => cb.revive());
    $("getup-btn").addEventListener("click", () => cb.getUp());
    $("invite").addEventListener("click", () => cb.invite());
    $("store-btn").addEventListener("click", () => cb.toggleStore());
    $("store-close").addEventListener("click", () => cb.toggleStore());
    // The label names the current state: "Sound on" while you hear it.
    $("sound").addEventListener("click", () => this.setSound(cb.toggleSound()));
    $("signin").addEventListener("click", () => cb.signIn());
    $("end-again").addEventListener("click", () => {
      this.voted = true;
      $("end-again").classList.add("voted");
      cb.again();
    });
    $("keepers").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-k]");
      if (!b || b.classList.contains("locked")) return;
      cb.keeper(Number(b.dataset.k));
    });
    this.goals = todaysGoals([...game.manifest.missions.keys()], this.day);
  }

  /** Your own level-up: a warm flash and the word, for you only. */
  levelUp(): void {
    const el = $("lvlflash");
    el.classList.remove("go");
    void el.offsetWidth;
    el.classList.add("go");
  }

  /** Touch screens: say how to move and dash with the stick and the button. */
  touchHint(): void {
    $("intro").textContent = "Drag to move · DASH to dodge";
  }

  /** Show whether sound is muted (the button names the current state). */
  setSound(muted: boolean): void {
    const b = $("sound");
    b.textContent = muted ? "Sound off" : "Sound on";
    b.setAttribute("aria-pressed", muted ? "false" : "true");
  }

  /** Who the saves belong to: a wallet (short address) or a guest (the button signs in). */
  setAccount(address: string | null): void {
    const b = $("signin");
    b.textContent = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Sign in to save";
    b.classList.toggle("signed", address !== null);
    b.toggleAttribute("disabled", address !== null);
  }

  /** The viewer's keeper pick, the keeper ids its profile opened (achievements or coins), and today's goals done (all from the server). */
  setKeepers(pick: number, unlocked: ReadonlySet<string>, goalsDone: ReadonlySet<string>): void {
    this.keeperPick = pick;
    this.unlocked = unlocked;
    this.goalsDone = new Set(goalsDone);
    this.keepersKey = "";
  }

  /** True when a keeper may be picked now (no unlock, or the profile reached its achievement). */
  keeperOpen(index: number): boolean {
    const [id, k] = [...this.game.manifest.keepers][index] ?? [];
    return !!k && (k.unlock === undefined || this.unlocked.has(id ?? ""));
  }

  /** The keeper picker: shown at the start of a run (before the first level) and on the end screen. */
  private keepers(show: boolean, inEnd: boolean): void {
    const box = $("keepers");
    const list = [...this.game.manifest.keepers.values()];
    const visible = show && list.length > 0;
    // It lives in the end box while the end screen shows.
    const host = inEnd ? $("end-keeper-slot") : document.body;
    if (box.parentElement !== host) host.append(box);
    box.classList.toggle("show", visible);
    if (!visible) return;
    const key = `${this.keeperPick}:${[...this.unlocked].join(",")}`;
    if (key === this.keepersKey) return;
    this.keepersKey = key;
    box.innerHTML = list
      .map((k, i) => {
        const open = this.keeperOpen(i);
        return `<button class="keeper${i === this.keeperPick ? " on" : ""}${open ? "" : " locked"}" data-k="${i}" style="--k:${k.tint ?? "#ffb347"}"><b></b><small></small></button>`;
      })
      .join("");
    list.forEach((k, i) => {
      const b = box.children[i] as HTMLElement;
      (b.querySelector("b") as HTMLElement).textContent = k.name;
      const lock = k.unlock ? (this.game.manifest.achievements.get(k.unlock)?.text ?? k.unlock) : "";
      (b.querySelector("small") as HTMLElement).textContent = this.keeperOpen(i) ? (k.text ?? "") : `Locked: ${lock}`;
    });
  }

  /** Weapons and passives with levels, and the dash cooldown ring. */
  private inventory(self: SceneEntity): void {
    const dash = self.values[F.dash] ?? 0;
    const cdMax = Math.max(1, this.config.content.coop.dashCooldownTicks);
    $("dash-ring").style.setProperty("--p", String(1 - ((dash >>> 8) & 0xff) / cdMax));
    const weapons = self.values[F.weapons] ?? 0;
    const stats = self.values[F.stats] ?? 0;
    const key = `${weapons}:${stats}`;
    if (key === this.invKey) return;
    this.invKey = key;
    const evolvedIds = new Set([...this.game.manifest.weapons.values()].map((w) => w.evolve?.into).filter((x): x is string => !!x));
    const slots: string[] = [];
    for (let s = 0; s < 4; s++) {
      const wi = slotWeapon(weapons, s);
      if (wi < 0) continue;
      const id = this.game.weaponIds[wi] ?? "";
      const name = WEAPON_NAMES[id]?.name ?? words(id);
      const icon = WEAPON_ICONS[this.config.content.weapons[wi]?.kind ?? ""] ?? DOT_ICON;
      slots.push(`<div class="slot${evolvedIds.has(id) ? " evolved" : ""}" title="${name}">${icon}<span>${slotLevel(weapons, s)}</span></div>`);
    }
    this.game.upgradeIds.forEach((id, i) => {
      const lvl = statLevel(stats, i);
      if (lvl === 0) return;
      const name = UPGRADE_NAMES[id]?.name ?? words(id);
      const icon = STAT_ICONS[this.config.content.stats[i]?.stat ?? ""] ?? DOT_ICON;
      slots.push(`<div class="slot passive" title="${name}">${icon}<span>${lvl}</span></div>`);
    });
    const ring = $("dash-ring");
    $("inv").innerHTML = slots.join("");
    $("inv").prepend(ring);
  }

  /** Today's three goals with this run's progress; a goal reached is remembered for the day. Returns newly done ids. */
  private goalsUpdate(run: RunInfo, me: number): string[] {
    const missions = this.game.manifest.missions;
    if (this.goals.length === 0) return [];
    const counts = run.players.find((p) => p.id === me)?.counts ?? {};
    const fresh: string[] = [];
    const rows = this.goals.map((id) => {
      const m = missions.get(id);
      if (!m) return "";
      const n = Math.min(m.n, counts[m.when] ?? 0);
      if (n >= m.n && !this.goalsDone.has(id)) {
        this.goalsDone.add(id);
        fresh.push(id);
      }
      const done = this.goalsDone.has(id);
      return `<li class="${done ? "done" : ""}"><span>${done ? "✓" : "○"}</span>${m.text}<em>${done ? "" : m.n > 1 ? `${n}/${m.n}` : ""}</em></li>`;
    });
    const html = rows.join("");
    if (html !== this.goalsKey) {
      this.goalsKey = html;
      $("goals").innerHTML = html;
    }
    return fresh;
  }

  /**
   * A card's words: the name, what it does or what this level changes
   * ("+1 projectile, -20% cooldown"), a tag (NEW, Lv 3 → 4, EVOLUTION) and,
   * for weapons, the passive it evolves with.
   */
  private offerLabel(u: number, weapons: number, stats: number): { name: string; line: string; tag: string; hint: string } {
    const nW = this.game.weaponIds.length;
    if (u < nW) {
      const id = this.game.weaponIds[u] ?? "";
      const n = WEAPON_NAMES[id] ?? { name: id, line: "" };
      const def = this.game.manifest.weapons.get(id);
      const hintId = def?.evolve?.requires;
      const hint = hintId ? `Evolves with ${UPGRADE_NAMES[hintId]?.name ?? hintId}` : "";
      let level = 0;
      for (let s = 0; s < 4; s++) if (slotWeapon(weapons, s) === u) level = slotLevel(weapons, s);
      if (level > 0) return { name: n.name, line: levelChange(def, level), tag: `Lv ${level} → ${level + 1}`, hint };
      const from = [...this.game.manifest.weapons].find(([, w]) => w.evolve?.into === id)?.[0];
      if (from) return { name: n.name, line: `Replaces ${WEAPON_NAMES[from]?.name ?? from}`, tag: "Evolution", hint: "" };
      return { ...n, tag: "New", hint };
    }
    const id = this.game.upgradeIds[u - nW] ?? "";
    const n = UPGRADE_NAMES[id] ?? { name: id, line: "" };
    const lvl = statLevel(stats, u - nW);
    return { ...n, tag: lvl > 0 ? `Lv ${lvl} → ${lvl + 1}` : "New", hint: "" };
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

  /** The coin box's text: the balance, or "EMBER · not earning" for a guest, as VOLTYARD says it (play money gets a caption in CSS). */
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
    this.toastTimer = window.setTimeout(() => t.classList.remove("show"), 2600);
  }

  /** Every frame. `self` is the predicted character; `players` every keeper in view (others interpolated). */
  update(now: number, self: SceneEntity | undefined, players: readonly SceneEntity[], run: RunInfo | null, project: (x: number, y: number, z: number) => { x: number; y: number; onScreen: boolean }, store: { revivePrice: number; balance: number }): void {
    if (run && run.run !== this.lastRun) {
      this.lastRun = run.run;
      this.earnedThisRun.clear();
      this.peak = 0;
    }
    if (run) this.peak = Math.max(this.peak, run.enemies);
    if (self) {
      this.inventory(self);
      const level = self.values[F.level] ?? 1;
      const xp = self.values[F.xp] ?? 0;
      const need = xpForLevel(this.config, level);
      const hp = self.values[F.health] ?? 0;
      const max = maxHealthFor(this.config, self.values[F.stats] ?? 0);
      $("xp-fill").style.transform = `scaleX(${Math.min(1, xp / need)})`;
      $("hp-fill").style.transform = `scaleX(${Math.min(1, hp / Math.max(1, max))})`;
      const flags = self.values[F.flags] ?? 0;
      const downed = (flags & EntityFlag.Downed) !== 0;
      const dead = (flags & EntityFlag.Dead) !== 0;
      const ov = $("downed");
      ov.classList.toggle("show", (downed || dead) && run?.phase === "playing");
      // Upgrade offers.
      const { offers, pending } = decodeChoices(self.values[F.choices] ?? 0);
      const rerolls = Math.max(0, this.config.content.progression.rerolls - ((self.values[F.value] ?? 0) & 0xf));
      const key = pending > 0 && !downed && !dead ? offers.join(",") + ":" + pending + ":" + rerolls : "";
      if (key !== this.offerKey) {
        this.offerKey = key;
        $("cards").classList.toggle("show", key !== "");
        const weapons = self.values[F.weapons] ?? 0;
        const stats = self.values[F.stats] ?? 0;
        offers.forEach((u, k) => {
          const card = $(`card${k}`);
          card.style.display = u >= 0 ? "" : "none";
          if (u < 0) return;
          const l = this.offerLabel(u, weapons, stats);
          card.innerHTML = `<kbd>${k + 1}</kbd><i></i><b></b><span></span><em></em>`;
          (card.querySelector("b") as HTMLElement).textContent = l.name;
          (card.querySelector("span") as HTMLElement).textContent = l.line;
          (card.querySelector("i") as HTMLElement).textContent = l.tag;
          (card.querySelector("em") as HTMLElement).textContent = l.hint;
          card.classList.toggle("evolve", l.tag === "Evolution");
        });
        $("pending").textContent = pending > 1 ? `+${pending - 1}` : "";
        const reroll = $<HTMLButtonElement>("reroll");
        reroll.textContent = `Reroll ${rerolls}`;
        reroll.disabled = rerolls === 0;
      }
      if (now - this.lastText > 100) {
        $("level").textContent = `LV ${level}`;
        $("hp-text").textContent = `${hp} / ${max}`;
        // Game.bleed: downed or respawn ticks in bits 0..11, free get-ups used in bits 12..15.
        const bleed = self.values[F.bleed] ?? 0;
        const secs = Math.ceil((bleed & 0xfff) / this.config.tickRate);
        const coop = this.config.content.coop;
        const getUps = Math.max(0, coop.selfRevives - ((bleed >>> 12) & 0xf));
        const getUp = $<HTMLButtonElement>("getup-btn");
        getUp.style.display = downed && getUps > 0 ? "" : "none";
        if (downed) {
          $("downed-title").textContent = "DOWNED";
          $("downed-sub").textContent = getUps > 0 ? `${secs}s · free get-up` : `${secs}s · crawl to a friend`;
        } else if (dead) {
          const teamUp = players.some((p) => p.owner !== self.owner && ((p.values[F.flags] ?? 0) & (EntityFlag.Downed | EntityFlag.Dead)) === 0);
          $("downed-title").textContent = "OUT";
          $("downed-sub").textContent = teamUp && coop.respawnTicks > 0 ? `Back in ${secs}s` : "";
        }
        const btn = $<HTMLButtonElement>("revive-btn");
        btn.textContent = `Revive  ${store.revivePrice} ${this.symbol}`;
        btn.disabled = store.balance < store.revivePrice;
      }
    }
    if (now - this.lastText > 100) $("coin-balance").textContent = this.balanceText(store.balance);

    // The controls, centred, for the first 5 s of each run.
    $("intro").classList.toggle("show", !!run && run.phase === "playing" && run.seconds < 5 && !!self);
    this.arrows(run, project);
    // Teammates: list, and a marker with revive progress over anyone downed.
    const markers = $("markers");
    let mi = 0;
    for (const p of players) {
      if (self && p.owner === self.owner) continue;
      const flags = p.values[F.flags] ?? 0;
      const downed = (flags & EntityFlag.Downed) !== 0;
      const x = (p.values[F.px] ?? 0) / PLAYER_UNITS;
      const z = (p.values[F.pz] ?? 0) / PLAYER_UNITS;
      const s = project(x, 1.2, z);
      let m = markers.children[mi] as HTMLElement | undefined;
      if (!m) {
        m = document.createElement("div");
        m.className = "marker";
        markers.append(m);
      }
      mi++;
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Off-screen teammates sit on the screen edge in their direction (clear of the HUD corners).
      const cx = Math.max(24, Math.min(w - 24, s.x));
      const cy = Math.max(150, Math.min(h - 60, s.y));
      const color = KEEPER_COLORS[(p.owner - 1) % KEEPER_COLORS.length] ?? 0xffffff;
      const progress = downed ? (p.values[F.revive] ?? 0) / this.config.content.coop.reviveTicks : 0;
      m.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`;
      m.style.setProperty("--c", `#${color.toString(16).padStart(6, "0")}`);
      m.style.setProperty("--p", String(progress));
      m.classList.toggle("down", downed);
      m.classList.toggle("off", !s.onScreen);
      m.style.display = s.onScreen && !downed ? "none" : "";
    }
    while (markers.children.length > mi) markers.lastElementChild?.remove();

    if (now - this.lastText > 100) {
      this.lastText = now;
      if (run) {
        $("timer").textContent = mmss(run.seconds);
        // The show: the round being played (each round's end counts as a wave).
        $("wave").textContent = run.paused ? "PAUSED" : run.phase === "playing" ? `ROUND ${run.wave}` : "";
        $("kills").textContent = `${run.kills.toLocaleString("en-US")}`;
        this.bosses(run.bosses ?? (run.boss ? [run.boss] : []));
        this.team(run);
        this.end(run, self?.owner ?? 0);
        this.announce(run);
        $("next").textContent = run.next && run.phase === "playing" ? `${run.next.label}  ${mmss(run.next.in)}` : "";
        const level1 = self ? (self.values[F.level] ?? 1) === 1 && decodeChoices(self.values[F.choices] ?? 0).pending === 0 : false;
        this.keepers(run.phase !== "playing" || (level1 && run.seconds < 30), run.phase !== "playing");
      }
    }
  }

  /** A bar for every living boss, oldest first. */
  private bosses(list: RunInfo["bosses"]): void {
    const box = $("boss");
    box.classList.toggle("show", list.length > 0);
    while (box.children.length < list.length) {
      const row = document.createElement("div");
      row.className = "boss-row";
      row.innerHTML = '<div class="boss-name"></div><div class="bar"><div class="boss-fill"></div></div>';
      box.append(row);
    }
    while (box.children.length > list.length) box.lastElementChild?.remove();
    list.forEach((b, i) => {
      const row = box.children[i] as HTMLElement;
      (row.querySelector(".boss-name") as HTMLElement).textContent = ENEMY_NAMES[b.prefab] ?? b.prefab;
      (row.querySelector(".boss-fill") as HTMLElement).style.transform = `scaleX(${Math.max(0, b.health / Math.max(1, b.max))})`;
    });
  }

  /** A new announcement from the run: a big centred banner for a few seconds. */
  private announce(run: RunInfo): void {
    const a = run.announce;
    if (!a || a.id === this.lastAnnounce) return;
    this.lastAnnounce = a.id;
    const el = $("announce");
    $("announce-text").textContent = a.text;
    el.classList.remove("danger", "reward");
    if (a.tone !== "info") el.classList.add(a.tone);
    el.classList.add("show");
    clearTimeout(this.announceTimer);
    this.announceTimer = window.setTimeout(() => el.classList.remove("show"), 2800);
  }

  /** An arrow on the screen edge toward each boss that is off screen. */
  private arrows(run: RunInfo | null, project: (x: number, y: number, z: number) => { x: number; y: number; onScreen: boolean }): void {
    const box = $("arrows");
    const list = (run?.bosses ?? []).filter((b) => !project(b.x, 1.5, b.z).onScreen);
    while (box.children.length < list.length) {
      const a = document.createElement("div");
      a.className = "arrow";
      box.append(a);
    }
    while (box.children.length > list.length) box.lastElementChild?.remove();
    const w = window.innerWidth;
    const h = window.innerHeight;
    list.forEach((b, i) => {
      const s = project(b.x, 1.5, b.z);
      const dx = s.x - w / 2;
      const dy = s.y - h / 2;
      const k = Math.min((w / 2 - 36) / Math.max(1, Math.abs(dx)), (h / 2 - 36) / Math.max(1, Math.abs(dy)));
      const ang = Math.atan2(dy, dx) + Math.PI / 2;
      (box.children[i] as HTMLElement).style.transform = `translate(${w / 2 + dx * k - 11}px, ${h / 2 + dy * k - 11}px) rotate(${ang}rad)`;
    });
  }

  private team(run: RunInfo): void {
    const list = $("team");
    const rows = run.players.map((p) => {
      const color = KEEPER_COLORS[(p.id - 1) % KEEPER_COLORS.length] ?? 0xffffff;
      const state = p.dead ? "OUT" : p.downed ? "DOWN" : `LV ${p.level}`;
      const name = p.keeper ? (this.game.manifest.keepers.get(p.keeper)?.name ?? `Guest ${p.id}`) : `Guest ${p.id}`;
      return `<li style="--c:#${color.toString(16).padStart(6, "0")}"><span class="dot"></span>${name}${p.buffed ? " ✦" : ""}<em>${state}</em><small>${p.kills}</small></li>`;
    });
    const html = rows.join("");
    if (list.innerHTML !== html) list.innerHTML = html;
  }

  /** Goals reached this frame (main remembers them for the day). */
  goalsReached(run: RunInfo | null, me: number): string[] {
    return run ? this.goalsUpdate(run, me) : [];
  }

  /**
   * The end screen, all from the run's summary data: each keeper's build
   * (weapons with level and damage), what downed them, their titles, the
   * coin breakdown, and the "Play again" vote (the run restarts when
   * everyone votes, or by itself after the countdown).
   */
  private end(run: RunInfo, me: number): void {
    const el = $("end");
    const show = run.phase !== "playing";
    el.classList.toggle("show", show);
    if (!show) {
      if (this.voted) $("end-again").classList.remove("voted");
      this.voted = false;
      this.endKey = "";
      return;
    }
    const s = run.summary;
    $("end-title").textContent = run.phase === "won" ? "THE BELL BREAKS" : "THE LIGHT WENT OUT";
    $("end-stats").innerHTML = [
      ["Time", mmss(s?.seconds ?? run.seconds)],
      ["Peak crowd", String(s?.peak ?? this.peak)],
      ["Kills", run.kills.toLocaleString("en-US")],
    ]
      .map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`)
      .join("");
    const key = JSON.stringify(s?.players ?? []);
    if (key !== this.endKey) {
      this.endKey = key;
      const keepers = this.game.manifest.keepers;
      $("end-players").innerHTML = (s?.players ?? [])
        .map((p) => {
          const color = KEEPER_COLORS[(p.id - 1) % KEEPER_COLORS.length] ?? 0xffffff;
          const top = Math.max(1, ...p.weapons.map((w) => w.damage));
          const rows = p.weapons
            .map((w) => `<li><span>${WEAPON_NAMES[w.id]?.name ?? words(w.id)} <small>Lv ${w.level}</small></span><span>${w.damage.toLocaleString("en-US")}</span><div class="dmgbar" style="transform: scaleX(${w.damage / top})"></div></li>`)
            .join("");
          const passives = p.passives.map((u) => `${UPGRADE_NAMES[u.id]?.name ?? words(u.id)} ${u.level}`).join(" · ");
          const by = p.downedBy ? `Downed by ${ENEMY_NAMES[p.downedBy.prefab] ?? words(p.downedBy.prefab)} (${SOURCE_WORDS[p.downedBy.source] ?? p.downedBy.source})` : "Never downed";
          const keeper = p.keeper ? (keepers.get(p.keeper)?.name ?? words(p.keeper)) : `Guest ${p.id}`;
          const coins = p.coins.map((c) => `${RULE_NAMES[c.rule] ?? words(c.rule)} +${(this.game.manifest.earnRules.get(c.rule)?.pay ?? 0) * c.units} ${this.symbol}`).join(" · ");
          return `<section class="end-player" style="--c:#${color.toString(16).padStart(6, "0")}"><header><span class="dot"></span>${keeper}${p.id === me ? " <small>(you)</small>" : ""} <small>LV ${p.level} · ${p.kills} kills · ${p.revives} revives</small><span class="titles">${p.titles.join(" · ")}</span></header><ul>${rows}</ul><div class="line">${passives}</div><div class="line">${by}${coins ? ` · ${coins}` : ""}</div></section>`;
        })
        .join("");
    }
    const earned = [...this.earnedThisRun].map(([r, u]) => `<li>${RULE_NAMES[r] ?? r}<b>+${(this.game.manifest.earnRules.get(r)?.pay ?? 0) * u} ${this.symbol}</b></li>`);
    $("end-earned").innerHTML =
      (earned.length > 0 ? earned.join("") : "<li>No earn this run</li>") + (this.mode === "guest" && earned.length > 0 ? `<li class="guest">Not paid: connect a wallet to earn ${this.symbol}</li>` : "");
    const humans = run.players.filter((p) => !p.bot);
    const ready = humans.filter((p) => p.ready).length;
    $("end-again").textContent = this.voted ? `Ready ${ready}/${humans.length}` : "Play again";
    $("end-next").textContent = run.nextRunIn !== null ? `Next run in ${run.nextRunIn}s` : "";
  }

  stats(text: string): void {
    $("stats").textContent = text;
  }
}
