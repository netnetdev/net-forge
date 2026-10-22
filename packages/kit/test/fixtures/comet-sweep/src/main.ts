// Comet Sweep: sweep up sparks, dodge comets. Clear a wave by collecting
// every spark in it. Mouse, touch or arrow keys steer.

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;
const W = canvas.width;
const H = canvas.height;

type Vec = { x: number; y: number };
type Comet = Vec & { vx: number; vy: number; r: number };

const ship: Vec = { x: W / 2, y: H - 80 };
let target: Vec = { ...ship };
let sparks: Vec[] = [];
let comets: Comet[] = [];
let wave = 1;
let score = 0;
let alive = true;
const keys = new Set<string>();

function spawnWave(n: number): void {
  sparks = Array.from({ length: 4 + n * 2 }, () => ({ x: 30 + Math.random() * (W - 60), y: 40 + Math.random() * (H - 200) }));
  comets = Array.from({ length: 1 + n }, () => ({
    x: Math.random() * W, y: -20, vx: (Math.random() - 0.5) * 2, vy: 1.2 + Math.random() * (0.6 + n * 0.25), r: 10 + Math.random() * 10,
  }));
}

function onWaveCleared(): void {
  wave += 1;
  spawnWave(wave);
}

function onCrash(): void {
  alive = false;
}

function restart(): void {
  wave = 1;
  score = 0;
  alive = true;
  spawnWave(wave);
}

canvas.addEventListener("pointermove", (e) => {
  const r = canvas.getBoundingClientRect();
  target = { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
});
canvas.addEventListener("pointerdown", () => {
  if (!alive) restart();
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
  ctx.fillStyle = "#7ad7f0";
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
    ctx.fillText("CRASHED. TAP TO RESTART", W / 2, H / 2);
    ctx.textAlign = "left";
  }
}

function frame(): void {
  step();
  draw();
  requestAnimationFrame(frame);
}

spawnWave(wave);
frame();
