// Comet Sweep: sweep up sparks, dodge comets. Clear a wave by collecting
// every spark in it. Mouse, touch or arrow keys steer.
//
// Wired with the NetNet Kit: `kit add` wrote the two netnet-kit lines and
// src/netnet.ts. Everything else Kit-related below is what an agent adds
// by following llms.txt: earn calls, a token-priced revive, one store item,
// a cash-out button, and a HUD that reads the Kit's snapshot for free.

import { startKit } from "./netnet"; // netnet-kit
void startKit(); // netnet-kit
import { earn, kit } from "./netnet";

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;
const W = canvas.width;
const H = canvas.height;
const REVIVE_COST = 5;

type Vec = { x: number; y: number };
type Comet = Vec & { vx: number; vy: number; r: number };

const ship: Vec = { x: W / 2, y: H - 80 };
let target: Vec = { ...ship };
let sparks: Vec[] = [];
let comets: Comet[] = [];
let wave = 1;
let score = 0;
let alive = true;
let revivedThisWave = false;
let busy = false;
const keys = new Set<string>();

function spawnWave(n: number): void {
  sparks = Array.from({ length: 4 + n * 2 }, () => ({ x: 30 + Math.random() * (W - 60), y: 40 + Math.random() * (H - 200) }));
  comets = Array.from({ length: 1 + n }, () => ({
    x: Math.random() * W, y: -20, vx: (Math.random() - 0.5) * 2, vy: 1.2 + Math.random() * (0.6 + n * 0.25), r: 10 + Math.random() * 10,
  }));
}

function onWaveCleared(): void {
  earn("wave_cleared");
  if (!revivedThisWave) earn("wave_flawless");
  wave += 1;
  revivedThisWave = false;
  spawnWave(wave);
}

function onCrash(): void {
  alive = false;
}

function restart(): void {
  wave = 1;
  score = 0;
  alive = true;
  revivedThisWave = false;
  spawnWave(wave);
}

async function revive(): Promise<void> {
  if (busy || kit.coins.balance() < REVIVE_COST) return;
  busy = true;
  try {
    await kit.coins.spend(REVIVE_COST, "revive");
    comets = comets.filter((c) => Math.hypot(c.x - ship.x, c.y - ship.y) > 120);
    revivedThisWave = true;
    alive = true;
  } catch (err) {
    console.warn(err);
  } finally {
    busy = false;
  }
}

canvas.addEventListener("pointermove", (e) => {
  const r = canvas.getBoundingClientRect();
  target = { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
});
canvas.addEventListener("pointerdown", (e) => {
  if (alive) return;
  const r = canvas.getBoundingClientRect();
  const y = ((e.clientY - r.top) / r.height) * H;
  if (y > H / 2 + 10 && y < H / 2 + 50 && kit.coins.balance() >= REVIVE_COST) void revive();
  else restart();
});
addEventListener("keydown", (e) => keys.add(e.key));
addEventListener("keyup", (e) => keys.delete(e.key));

function step(): void {
  if (!alive) return;
  const speed = 5;
  if (keys.has("ArrowLeft")) target.x -= speed * 2;
  if (keys.has("ArrowRight")) target.x += speed * 2;
  if (keys.has("ArrowUp")) target.y -= speed * 2;
  if (keys.has("ArrowDown")) target.y += speed * 2;
  target.x = Math.max(12, Math.min(W - 12, target.x));
  target.y = Math.max(12, Math.min(H - 12, target.y));
  ship.x += (target.x - ship.x) * 0.18;
  ship.y += (target.y - ship.y) * 0.18;

  sparks = sparks.filter((s) => {
    const hit = Math.hypot(s.x - ship.x, s.y - ship.y) < 16;
    if (hit) score += 1;
    return !hit;
  });
  for (const c of comets) {
    c.x += c.vx;
    c.y += c.vy;
    if (c.y > H + 30) { c.y = -20; c.x = Math.random() * W; }
    if (c.x < -30 || c.x > W + 30) c.vx = -c.vx;
    if (Math.hypot(c.x - ship.x, c.y - ship.y) < c.r + 9) onCrash();
  }
  if (sparks.length === 0) onWaveCleared();
}

function draw(): void {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#ffd166";
  for (const s of sparks) { ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = "#ef476f";
  for (const c of comets) { ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.fill(); }
  // Reading Kit state every frame is free: it is the snapshot, not the chain.
  ctx.fillStyle = kit.store.owns("skin_gold") ? "#ffd166" : "#7ad7f0";
  ctx.beginPath();
  ctx.moveTo(ship.x, ship.y - 12);
  ctx.lineTo(ship.x - 9, ship.y + 10);
  ctx.lineTo(ship.x + 9, ship.y + 10);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#d8e1ea";
  ctx.font = "14px ui-monospace, Menlo, monospace";
  ctx.fillText(`WAVE ${wave}   SCORE ${score}`, 12, 22);
  if (!alive) {
    ctx.textAlign = "center";
    ctx.fillText("CRASHED", W / 2, H / 2 - 20);
    ctx.fillText("TAP TO RESTART", W / 2, H / 2);
    if (kit.coins.balance() >= REVIVE_COST) ctx.fillText(`REVIVE: ${REVIVE_COST} ${kit.coins.symbol()}`, W / 2, H / 2 + 34);
    ctx.textAlign = "left";
  }
}

function frame(): void {
  step();
  draw();
  requestAnimationFrame(frame);
}

// HUD: DOM text updated from the Kit's subscription, never from a timer.
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const bal = $<HTMLSpanElement>("bal");
const usd = $<HTMLSpanElement>("usd");
const connectBtn = $<HTMLButtonElement>("connect");
const claimBtn = $<HTMLButtonElement>("claim");
const goldBtn = $<HTMLButtonElement>("gold");
const cashBtn = $<HTMLButtonElement>("cashout");

function renderHud(): void {
  const s = kit.getState();
  bal.textContent = s.status === "ready" ? `${kit.format.token(s.token.balance, 1)} ${s.token.symbol}` : s.status === "error" ? "Offline" : "-";
  usd.textContent = s.status === "ready" ? `${kit.format.usd(kit.token.valueUsd())}  $${(Number(s.usdg) / 1e6).toFixed(2)} cash` : "";
  connectBtn.hidden = s.account !== null || s.status !== "ready";
  const pending = s.pendingRewards.reduce((n, r) => n + r.amount, 0n);
  claimBtn.hidden = pending === 0n;
  claimBtn.textContent = `Claim ${kit.format.token(pending, 1)}`;
  const owned = kit.store.owns("skin_gold");
  goldBtn.disabled = owned || !s.account || busy;
  goldBtn.textContent = owned ? "Gold ship owned" : "Gold ship $1.00";
  cashBtn.disabled = !s.account || s.token.balance === 0n || busy;
}

async function act(fn: () => Promise<unknown>): Promise<void> {
  if (busy) return;
  busy = true;
  renderHud();
  try {
    await fn();
  } catch (err) {
    console.warn(err);
  } finally {
    busy = false;
    renderHud();
  }
}

connectBtn.onclick = () => act(() => kit.wallet.connect());
claimBtn.onclick = () => act(() => kit.earn.claimAll());
goldBtn.onclick = () => act(() => kit.store.buy("skin_gold"));
cashBtn.onclick = () => act(async () => {
  const amount = kit.token.balance() / 2;
  const q = kit.token.quoteCashOut(amount);
  if (confirm(`Cash out ${amount.toFixed(1)} ${kit.coins.name()} (${kit.coins.symbol()}) for ${kit.format.usd(q.usd)}?`)) await kit.token.cashOut(amount);
});

kit.subscribe(renderHud);
renderHud();
spawnWave(wave);
frame();
