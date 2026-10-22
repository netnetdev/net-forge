/**
 * The HUD shell the board templates share: plain DOM over the canvas.
 * The coin box, Invite, Store and Sound, toasts, the
 * end screen with what the run paid, the store sheet (run upgrades,
 * finishes, losable gear and the stake), the earn goals, the stats overlay
 * and the loading banner. Each template themes it with its own colours and
 * type and adds its own panels. Copy is labels, not sentences.
 */
import type { GameManifest } from "@netnetcapital/engine";
import type { RoomConnection } from "@netnetcapital/engine/net";
import type { KitStoreBridge, SkuPrice } from "./kit.js";
import { gearOf, wireGear, wireStake } from "./stake.js";
import { storeNote, type PlayerMode } from "./host.js";

export interface HudTheme {
  /** Main light (titles, focus). */
  readonly accent: string;
  /** Second light (money, rewards). */
  readonly gold: string;
  readonly ink: string;
  readonly dim: string;
  /** Panel fill. */
  readonly panel: string;
  /** Page background behind the canvas. */
  readonly bg: string;
  /** Font stack. */
  readonly font: string;
  /** Display font for titles (defaults to font). */
  readonly display?: string;
  /** Corner radius, px. */
  readonly radius?: number;
}

export interface HudLabels {
  readonly title: string;
  readonly rules: Readonly<Record<string, string>>;
  readonly skus: Readonly<Record<string, string>>;
  readonly upgrades: Readonly<Record<string, { name: string; line: string }>>;
  /** Shown under the banner while joining. */
  readonly loading: string;
  /** Help line at the bottom left (desktop only). */
  readonly help: string;
}

const CSS = (t: HudTheme) => `
:root { color-scheme: dark; --ink: ${t.ink}; --dim: ${t.dim}; --accent: ${t.accent}; --gold: ${t.gold}; --panel: ${t.panel}; --line: color-mix(in srgb, ${t.accent} 30%, transparent); --r: ${t.radius ?? 8}px; font-family: ${t.font}; }
html, body { margin: 0; height: 100%; background: ${t.bg}; color: var(--ink); overflow: hidden; touch-action: none; -webkit-user-select: none; user-select: none; }
#game { position: fixed; inset: 0; }
#game canvas { display: block; width: 100%; height: 100%; }
.hud { position: fixed; z-index: 5; pointer-events: none; font-variant-numeric: tabular-nums; }
.hud button, .hud input, .hud .tap { pointer-events: auto; }
button { font: inherit; color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: var(--r); padding: 7px 11px; cursor: pointer; }
button:disabled { opacity: 0.45; cursor: default; }
button:active { transform: scale(0.97); }
button.go { background: var(--accent); color: ${t.bg}; border-color: transparent; font-weight: 800; }
#top-left { top: max(10px, env(safe-area-inset-top)); left: 12px; max-width: min(360px, 52vw); }
#title { font: 900 13px ${t.display ?? t.font}; letter-spacing: 0.26em; color: var(--accent); text-shadow: 0 1px 0 rgba(0,0,0,0.6); }
#status { margin-top: 6px; display: grid; gap: 4px; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: var(--r); background: var(--panel); border: 1px solid rgba(255,255,255,0.08); font-weight: 700; font-size: 13px; width: fit-content; }
.chip small { color: var(--dim); font-weight: 600; letter-spacing: 0.08em; }
#top-right { top: max(10px, env(safe-area-inset-top)); right: 12px; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; width: min(260px, 46vw); }
#top-right .row { display: flex; gap: 6px; }
#coin-box { display: flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: var(--r); background: var(--panel); border: 1px solid var(--line); font-weight: 700; white-space: nowrap; }
#coin-box.guest #coin-balance { color: var(--dim); font-weight: 600; }
#coin-box.play { display: block; text-align: right; }
#coin-box.play #coin-logo { vertical-align: middle; margin-right: 6px; }
#coin-box.play::after { content: "play money"; display: block; margin-top: 1px; font-size: 10px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--dim); }
#coin-logo { border-radius: 50%; }
#goals { list-style: none; margin: 0; padding: 6px 9px; background: var(--panel); border-radius: var(--r); font-size: 11px; display: grid; gap: 3px; min-width: 170px; }
#goals:empty { display: none; }
#goals li { display: flex; justify-content: space-between; gap: 10px; color: var(--dim); }
#goals li b { color: var(--ink); font-weight: 700; }
#goals li.paid { color: var(--gold); }
#goals li.paid b { color: var(--gold); }
#toast { left: 50%; top: 70px; transform: translate(-50%, -10px); padding: 8px 14px; border-radius: 999px; background: var(--panel); border: 1px solid var(--gold); font-weight: 700; opacity: 0; transition: opacity 200ms, transform 200ms; white-space: nowrap; z-index: 9; }
#toast.show { opacity: 1; transform: translate(-50%, 0); }
#banner { left: 50%; top: 50%; transform: translate(-50%, -50%); text-align: center; font-size: 14px; color: var(--dim); letter-spacing: 0.12em; }
#banner b { display: block; font: 900 44px ${t.display ?? t.font}; letter-spacing: 0.24em; color: var(--accent); margin-bottom: 8px; }
#end { inset: 0; display: none; place-items: center; background: rgba(0, 0, 0, 0.55); z-index: 8; }
#end.show { display: grid; }
#end .box { width: min(420px, 90vw); padding: 22px; border-radius: calc(var(--r) * 1.6); background: var(--panel); border: 1px solid var(--line); text-align: center; backdrop-filter: blur(6px); }
#end-title { font: 900 26px ${t.display ?? t.font}; letter-spacing: 0.14em; color: var(--accent); }
#end-sub { color: var(--dim); margin-top: 4px; font-size: 13px; }
#end-earned { list-style: none; padding: 0; margin: 14px 0 12px; text-align: left; font-size: 14px; }
#end-earned li { display: flex; justify-content: space-between; padding: 6px 0; border-top: 1px solid var(--line); }
#end-earned b { color: var(--gold); }
#end-earned li.none { color: var(--dim); justify-content: center; }
#end-next { color: var(--dim); font-size: 12px; letter-spacing: 0.12em; }
#store { top: 0; right: 0; bottom: 0; width: min(330px, 88vw); background: var(--panel); backdrop-filter: blur(8px); border-left: 1px solid var(--line); padding: 18px; box-sizing: border-box; transform: translateX(100%); transition: transform 220ms ease; pointer-events: auto; overflow-y: auto; z-index: 8; }
#store.show { transform: none; }
#store h2 { margin: 0 0 2px; font-size: 15px; letter-spacing: 0.2em; }
#store h3 { margin: 16px 0 0; font-size: 10px; letter-spacing: 0.24em; color: var(--dim); font-weight: 600; }
#store .item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 0; border-top: 1px solid rgba(255, 255, 255, 0.08); }
#store .item > div { display: flex; align-items: center; gap: 10px; }
#store .swatch { width: 26px; height: 26px; border-radius: 7px; flex: none; }
#store small { color: var(--dim); }
#store button { min-width: 88px; }
#store-close { margin-top: 16px; }
#stats { left: 12px; bottom: 120px; font: 11px/1.4 ui-monospace, monospace; color: var(--dim); white-space: pre; display: none; background: rgba(0,0,0,0.5); padding: 6px; border-radius: 6px; }
#stats.show { display: block; }
#help { left: 12px; bottom: max(10px, env(safe-area-inset-bottom)); font-size: 10px; letter-spacing: 0.08em; color: var(--dim); }
html[data-host="netnet"] #invite { display: none; }
html[data-preview="1"] .hud { display: none !important; }
@media (pointer: coarse) { #help { display: none; } }
@media (max-width: 560px) {
  #top-right { width: 58vw; }
  #top-right button { padding: 5px 8px; font-size: 12px; }
  #goals { display: none; }
}
`;

const SHELL = (l: HudLabels) => `
<div id="game"></div>
<div id="top-left" class="hud"><div id="title"></div><div id="status"></div></div>
<div id="top-right" class="hud">
  <div id="coin-box"><img id="coin-logo" alt="" width="18" height="18" hidden /><span id="coin-balance"></span></div>
  <div class="row"><button id="invite">Invite</button><button id="store-btn">Store</button><button id="sound">Sound</button></div>
  <ul id="goals"></ul>
</div>
<div id="end" class="hud"><div class="box"><div id="end-title"></div><div id="end-sub"></div><ul id="end-earned"></ul><div id="end-next"></div></div></div>
<aside id="store" class="hud">
  <h2>STORE</h2>
  <small id="coin-name"></small>
  <h3>THIS RUN</h3>
  <div id="store-upgrades"></div>
  <h3>FINISHES</h3>
  <div id="store-finishes"></div>
  <div class="item" id="gear-row"><div style="display: block"><span id="gear-name"></span><br /><small id="gear-line"></small></div><button id="gear-buy" style="white-space: nowrap"></button></div>
  <div class="item" id="stake-row"><div style="display: block">Stake a run<br /><small id="stake-line"></small></div><span style="white-space: nowrap"><input id="stake-amount" type="number" aria-label="Stake" style="width: 56px" /> <button id="stake-go" style="min-width: 0">Stake</button></span></div>
  <small id="store-note"></small>
  <br /><button id="store-close">Close</button>
</aside>
<div id="toast" class="hud"></div>
<div id="stats" class="hud"></div>
<div id="help" class="hud">${l.help}</div>
<div id="banner" class="hud"><b>${l.title.toUpperCase()}</b><span id="banner-text">${l.loading}</span></div>
`;

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e as T;
};

/** A swatch colour as CSS. */
export const cssColor = (c: number): string => `#${c.toString(16).padStart(6, "0")}`;

export interface EarnProgress {
  readonly id: string;
  readonly when: string;
  readonly n: number;
  readonly have: number;
  readonly paid: boolean;
}

export class Hud {
  private toastTimer = 0;
  private symbol = "";
  mode: PlayerMode = "earning";
  private goalsKey = "";
  private ended = false;
  private earnedRun = new Map<string, number>();

  constructor(
    private readonly labels: HudLabels,
    theme: HudTheme,
    private readonly manifest: GameManifest,
  ) {
    const style = document.createElement("style");
    style.textContent = CSS(theme);
    document.head.append(style);
    document.body.insertAdjacentHTML("afterbegin", SHELL(labels));
    $("title").textContent = labels.title.toUpperCase();
    document.title = labels.title;
  }

  /** The wordmark (Net Forge names the game). */
  title(name: string): void {
    $("title").textContent = name.toUpperCase();
    document.title = name;
    const b = document.querySelector("#banner b");
    if (b) b.textContent = name.toUpperCase();
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

  get coinSymbol(): string {
    return this.symbol;
  }

  /** What play pays the person at the screen (Net Forge's flag). */
  player(mode: PlayerMode): void {
    this.mode = mode;
    const box = $("coin-box");
    box.classList.toggle("guest", mode === "guest");
    box.classList.toggle("play", mode === "play");
    box.title = mode === "guest" ? `Connect a wallet to earn ${this.symbol}` : mode === "play" ? `${this.symbol} has not launched: coins are play money` : "";
  }

  balance(n: number): void {
    $("coin-balance").textContent = this.mode === "guest" ? `${this.symbol} · not earning` : `${Math.floor(n).toLocaleString("en-US")} ${this.symbol}`;
  }

  toast(text: string): void {
    const t = $("toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove("show"), 2400);
  }

  /** The room credited an earn rule. */
  earned(rule: string, units: number): void {
    this.earnedRun.set(rule, (this.earnedRun.get(rule) ?? 0) + units);
    const pay = (this.manifest.earnRules.get(rule)?.pay ?? 0) * units;
    const name = this.labels.rules[rule] ?? rule;
    this.toast(this.mode === "guest" ? `${name}  Connect to earn ${pay} ${this.symbol}` : `${name}  +${pay} ${this.symbol}`);
  }

  /** The run's goals with this player's progress (the room's counts). */
  goals(list: readonly EarnProgress[] | undefined): void {
    if (!list) return;
    const key = list.map((g) => `${g.id}:${g.have}:${g.paid}`).join("|");
    if (key === this.goalsKey) return;
    this.goalsKey = key;
    const el = $("goals");
    el.innerHTML = "";
    for (const g of list) {
      const li = document.createElement("li");
      if (g.paid) li.className = "paid";
      const pay = this.manifest.earnRules.get(g.id)?.pay ?? 0;
      li.innerHTML = `<span></span><b></b>`;
      (li.firstChild as HTMLElement).textContent = this.labels.rules[g.id] ?? g.id;
      (li.lastChild as HTMLElement).textContent = g.paid ? `+${pay}` : g.n > 1 ? `${g.have}/${g.n}` : `${pay}`;
      el.append(li);
    }
  }

  /** Status chips at the top left: [label, value] pairs. */
  status(chips: readonly (readonly [string, string])[]): void {
    const el = $("status");
    const want = chips.map(([a, b]) => `${a}\u0000${b}`).join("\u0001");
    if (el.dataset.k === want) return;
    el.dataset.k = want;
    el.innerHTML = "";
    for (const [label, value] of chips) {
      const c = document.createElement("div");
      c.className = "chip";
      c.innerHTML = `<small></small><span></span>`;
      (c.firstChild as HTMLElement).textContent = label;
      (c.lastChild as HTMLElement).textContent = value;
      el.append(c);
    }
  }

  /** The end screen while the room shows it. */
  end(show: boolean, title: string, sub: string, endsIn: number | null): void {
    const el = $("end");
    if (show && !this.ended) {
      const list = $("end-earned");
      list.innerHTML = "";
      for (const [rule, units] of this.earnedRun) {
        const li = document.createElement("li");
        li.className = this.mode === "guest" ? "guest" : "";
        li.innerHTML = `<span></span><b></b>`;
        (li.firstChild as HTMLElement).textContent = this.labels.rules[rule] ?? rule;
        (li.lastChild as HTMLElement).textContent = `+${(this.manifest.earnRules.get(rule)?.pay ?? 0) * units} ${this.symbol}`;
        list.append(li);
      }
      if (this.earnedRun.size === 0) list.innerHTML = `<li class="none">No goals this run</li>`;
    }
    if (!show && this.ended) this.earnedRun.clear();
    this.ended = show;
    el.classList.toggle("show", show);
    if (show) {
      $("end-title").textContent = title;
      $("end-sub").textContent = sub;
      $("end-next").textContent = endsIn !== null ? `NEXT RUN IN ${Math.ceil(endsIn)}` : "";
    }
  }

  stats(text: string): void {
    $("stats").textContent = text;
  }

  ready(): void {
    document.getElementById("banner")?.remove();
  }

  failed(message: string): void {
    const t = document.getElementById("banner-text");
    if (t) t.textContent = message;
  }
}

/**
 * The store: run upgrades (a SKU named after a declared upgrade: spent, then
 * the room applies one level for this run), finishes (owned for good,
 * equipped by a room command), the first losable gear, and the stake.
 */
export function wireStore(opts: {
  readonly hud: Hud;
  readonly manifest: GameManifest;
  readonly kit: KitStoreBridge;
  readonly conn: RoomConnection<unknown, unknown>;
  readonly labels: HudLabels;
  readonly cosmetics: Readonly<Record<string, number>>;
  readonly swatch: (cosmetic: number) => string;
  readonly hostMode: () => PlayerMode | null;
  readonly unlock?: () => void;
}): { toggle(): void } {
  const { hud, manifest, kit, conn, labels } = opts;
  const sym = kit.coins.symbol();
  const prices: Record<string, SkuPrice> = Object.fromEntries(manifest.skus);
  const upgradesEl = $("store-upgrades");
  for (const [id, s] of manifest.skus) {
    if (s.grants || s.coins === undefined || !manifest.upgrades.has(id)) continue;
    const price = s.coins;
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `<div><div><span class="name"></span><br /><small></small></div></div><button></button>`;
    (row.querySelector(".name") as HTMLElement).textContent = labels.skus[id] ?? id;
    (row.querySelector("small") as HTMLElement).textContent = labels.upgrades[id]?.line ?? "";
    const btn = row.querySelector("button") as HTMLButtonElement;
    btn.textContent = `${price} ${sym}`;
    btn.addEventListener("click", async () => {
      opts.unlock?.();
      let proof: string | null;
      try {
        proof = (await kit.coins.spend(price, id)).key;
      } catch {
        hud.toast(`Not enough ${sym}`);
        return;
      }
      const r = await conn.command({ name: id, ...(proof ? { proof } : {}) });
      hud.toast(r.ok ? `${labels.skus[id] ?? id} on` : r.reason === "store not live" ? "Store opens at launch" : "Already on this run");
    });
    upgradesEl.append(row);
  }
  const finishesEl = $("store-finishes");
  for (const [id, cosmetic] of Object.entries(opts.cosmetics)) {
    const price = prices[id]?.coins;
    if (price === undefined) continue;
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `<div><span class="swatch"></span><div><span class="name"></span><br /><small>Finish</small></div></div><button></button>`;
    (row.querySelector(".swatch") as HTMLElement).style.background = opts.swatch(cosmetic);
    (row.querySelector(".name") as HTMLElement).textContent = labels.skus[id] ?? id;
    const btn = row.querySelector("button") as HTMLButtonElement;
    btn.textContent = `${price} ${sym}`;
    btn.addEventListener("click", async () => {
      opts.unlock?.();
      if (!kit.store.owns(id)) {
        try {
          await kit.store.buy(id, { pay: "coins" });
        } catch {
          hud.toast(`Not enough ${sym}`);
          return;
        }
      }
      const r = await conn.command({ name: "cosmetic", value: cosmetic });
      if (!r.ok) return hud.toast("Finishes open at launch");
      for (const b of finishesEl.querySelectorAll("button")) if (b !== btn && b.textContent === "Equipped") b.textContent = "Equip";
      btn.textContent = "Equipped";
    });
    finishesEl.append(row);
  }
  wireStake(conn as never, kit, (t) => hud.toast(t));
  wireGear(gearOf(manifest.skus, labels.skus), kit, (t) => hud.toast(t));
  const note = $("store-note");
  const showNote = () => (note.textContent = storeNote(opts.hostMode(), conn.welcome.earnLive, sym));
  showNote();
  let open = false;
  const toggle = () => {
    open = !open;
    $("store").classList.toggle("show", open);
    showNote();
  };
  $("store-btn").addEventListener("click", toggle);
  $("store-close").addEventListener("click", toggle);
  return { toggle };
}
