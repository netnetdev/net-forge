// The solo demo's boot module, imported ahead of the template's
// client/main.ts. It answers the room server's HTTP routes in memory (the
// engine's fetch calls to SOLO_ENDPOINT never reach the network), starts
// the room host, and shows the start screen: the seat is taken when the
// player presses Play, so nothing runs against them while they read it.

import { entry } from "virtual:kit-play-solo";
import * as bridge from "./bridge.js";
import { SOLO_ENDPOINT } from "./protocol.js";

const FORGE_URL = "https://forge.netnet.capital";

let start: () => void = () => undefined;
const started = new Promise<void>((resolve) => {
  start = resolve;
});

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = urlOf(input);
  if (!url.startsWith(SOLO_ENDPOINT)) return realFetch(input, init);
  const u = new URL(url);
  const req = input instanceof Request ? input : null;
  const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {};
  new Headers(init?.headers ?? req?.headers).forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  const body = typeof init?.body === "string" ? init.body : req ? await req.text() : null;
  // The seat waits for Play: the room starts when the player does.
  if (u.pathname === "/world/join") await started;
  const r = await bridge.http(method, u.pathname, headers, body || null);
  return new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } });
};

const CSS = `
#nf-solo-start{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:16px;background:rgba(8,10,16,.9);color:#f2f4f8;font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-user-select:none;user-select:none}
#nf-solo-start .card{max-width:420px;width:100%;text-align:center;display:grid;gap:14px}
#nf-solo-start h1{margin:0;font-size:clamp(28px,7vw,44px);letter-spacing:.08em;text-transform:uppercase;font-weight:800}
#nf-solo-start p{margin:0;color:#c5cbd6}
#nf-solo-start button{justify-self:center;font:700 18px system-ui,-apple-system,sans-serif;letter-spacing:.06em;color:#0b0d12;background:#f2f4f8;border:0;border-radius:10px;padding:14px 44px;cursor:pointer;min-width:180px}
#nf-solo-start button:disabled{opacity:.6;cursor:progress}
#nf-solo-start button:focus-visible{outline:3px solid #9ab8ff;outline-offset:3px}
#nf-solo-start code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;color:#f2f4f8;background:rgba(255,255,255,.08);padding:2px 6px;border-radius:5px;-webkit-user-select:all;user-select:all}
#nf-solo-start .err{color:#ffb4ab;display:none}
#nf-solo-corner{position:fixed;right:max(8px,env(safe-area-inset-right));top:max(6px,env(safe-area-inset-top));z-index:2147483001;font:600 11px system-ui,-apple-system,sans-serif;color:rgba(242,244,248,.78);background:rgba(8,10,16,.55);padding:4px 8px;border-radius:6px;text-decoration:none;pointer-events:auto}
#nf-solo-corner:hover{color:#fff}
#nf-solo-start.gone{display:none}
#nf-solo-corner.quiet{top:auto;bottom:max(6px,env(safe-area-inset-bottom));opacity:.7}
@media (max-width:600px){#nf-solo-corner.quiet{display:none}}
#invite,#signin{display:none!important}
`;

function sentence(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function mount(): void {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);

  const corner = document.createElement("a");
  corner.id = "nf-solo-corner";
  corner.href = FORGE_URL;
  corner.target = "_blank";
  corner.rel = "noopener";
  corner.textContent = "Built with Net Forge";

  const screen = document.createElement("div");
  screen.id = "nf-solo-start";
  screen.setAttribute("role", "dialog");
  screen.setAttribute("aria-label", "Start");
  const card = document.createElement("div");
  card.className = "card";
  const h1 = document.createElement("h1");
  h1.textContent = document.title || sentence(entry.label);
  const what = document.createElement("p");
  what.textContent = `${sentence(entry.label)} demo. It plays in your browser.`;
  const play = document.createElement("button");
  play.type = "button";
  play.textContent = "Play";
  const make = document.createElement("p");
  make.append("Make your own: ");
  const code = document.createElement("code");
  code.textContent = "npm create netforge@latest";
  make.append(code);
  const err = document.createElement("p");
  err.className = "err";
  card.append(h1, what, play, make, err);
  screen.append(card);
  document.body.append(screen, corner);

  // The template names itself once its client runs: keep the heading in step.
  const retitle = () => {
    if (document.title) h1.textContent = document.title;
  };
  new MutationObserver(retitle).observe(document.querySelector("title") ?? document.head, { childList: true, subtree: true, characterData: true });

  const go = () => {
    if (play.disabled) return;
    play.disabled = true;
    screen.classList.add("gone");
    corner.classList.add("quiet");
    // A key hint pinned to the bottom right moves up to make room for the corner link.
    const help = document.getElementById("help");
    if (help && getComputedStyle(help).right !== "auto" && getComputedStyle(help).position === "fixed") help.style.marginBottom = "22px";
    window.focus();
    start();
  };
  play.addEventListener("click", go);
  window.addEventListener("keydown", function onKey(e) {
    if (screen.classList.contains("gone")) return window.removeEventListener("keydown", onKey);
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      go();
    }
  });
  bridge.onFatal((message) => {
    screen.classList.remove("gone");
    play.style.display = "none";
    err.style.display = "block";
    err.textContent = `The demo could not start: ${message}`;
  });
  play.focus();
}

bridge.warmUp();
if (document.body) mount();
else document.addEventListener("DOMContentLoaded", mount, { once: true });
