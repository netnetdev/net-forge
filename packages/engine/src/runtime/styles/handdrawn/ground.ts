/**
 * Painted surfaces for template-built ground: a field (loose washes of
 * green and ochre, pen grass, pebbles, a few flowers) and a paved yard
 * (slabs ruled in pencil, stains, cracks). Painted once on a canvas with
 * the style's pigments, tileable, deterministic. Original work.
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three/webgpu";
import type { Texture } from "three/webgpu";
import { PIGMENTS } from "./palette.js";
import { seeded } from "./textures.js";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const css = (hex: number, a = 1): string => `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;

function canvas(size: number): { c: HTMLCanvasElement | OffscreenCanvas; g: Ctx } | null {
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(size, size);
    const g = c.getContext("2d");
    return g ? { c, g } : null;
  }
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  return g ? { c, g } : null;
}

/** Draw at (x, y) and at its wrapped copies near the edges, so the tile repeats seamlessly. */
function tiled(size: number, x: number, y: number, reach: number, draw: (x: number, y: number) => void): void {
  for (const dx of [-size, 0, size]) {
    for (const dy of [-size, 0, size]) {
      const px = x + dx;
      const py = y + dy;
      if (px < -reach || py < -reach || px > size + reach || py > size + reach) continue;
      draw(px, py);
    }
  }
}

/** An irregular closed blob path (a wash's outline). */
function blob(g: Ctx, x: number, y: number, r: number, rnd: () => number, lumps = 9): void {
  const k: number[] = Array.from({ length: lumps }, () => 0.7 + rnd() * 0.6);
  g.beginPath();
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const f = a / (Math.PI * 2) * lumps;
    const i0 = Math.floor(f) % lumps;
    const i1 = (i0 + 1) % lumps;
    const t = f - Math.floor(f);
    const s = t * t * (3 - 2 * t);
    const rr = r * ((k[i0] ?? 1) * (1 - s) + (k[i1] ?? 1) * s);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr * 0.8;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
}

/** A watercolour wash: a pale fill and a darker tide line where the water dried. */
function wash(g: Ctx, x: number, y: number, r: number, color: number, alpha: number, rnd: () => number): void {
  blob(g, x, y, r, rnd);
  g.fillStyle = css(color, alpha);
  g.fill();
  g.strokeStyle = css(color, Math.min(1, alpha * 1.6));
  g.lineWidth = 1.5 + rnd() * 1.5;
  g.stroke();
}

/** A wobbly pen line from (x0, y0) to (x1, y1). */
function penLine(g: Ctx, x0: number, y0: number, x1: number, y1: number, rnd: () => number, wobble = 1.2): void {
  const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 14));
  g.beginPath();
  g.moveTo(x0 + (rnd() - 0.5) * wobble, y0 + (rnd() - 0.5) * wobble);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    g.lineTo(x0 + (x1 - x0) * t + (rnd() - 0.5) * wobble, y0 + (y1 - y0) * t + (rnd() - 0.5) * wobble);
  }
  g.stroke();
}

function texture(c: HTMLCanvasElement | OffscreenCanvas): Texture {
  const t = new CanvasTexture(c as HTMLCanvasElement);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** A meadow at the scale of one tile: washes, pen grass, pebbles and flowers. */
export function paintField(seed = 3, size = 1024): Texture | null {
  const cv = canvas(size);
  if (!cv) return null;
  const { c, g } = cv;
  const rnd = seeded(seed);
  // One pale base wash over the whole sheet, so the field reads as one place.
  g.fillStyle = css(0xdcd8b0);
  g.fillRect(0, 0, size, size);
  // Wet-in-wet: many soft spots of green and ochre glazed over each other, no edges.
  g.globalCompositeOperation = "multiply";
  const soft = [PIGMENTS.leaf, PIGMENTS.sap, PIGMENTS.leaf, PIGMENTS.olive, PIGMENTS.naples, PIGMENTS.ochre];
  for (let i = 0; i < 220; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 40 + rnd() * 110;
    const col = soft[i % soft.length] ?? PIGMENTS.leaf;
    const a = 0.05 + rnd() * 0.06;
    tiled(size, x, y, r, (px, py) => {
      const grad = g.createRadialGradient(px, py, 0, px, py, r);
      grad.addColorStop(0, css(col, a));
      grad.addColorStop(0.6, css(col, a * 0.7));
      grad.addColorStop(1, css(col, 0));
      g.fillStyle = grad;
      g.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  // A few washes that dried with a tide line: the hand of the painter.
  const hard = [PIGMENTS.sap, PIGMENTS.olive, PIGMENTS.ochre, PIGMENTS.leaf];
  for (let i = 0; i < 9; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 40 + rnd() * 90;
    const col = hard[i % hard.length] ?? PIGMENTS.sap;
    tiled(size, x, y, r * 1.4, (px, py) => wash(g, px, py, r, col, 0.06 + rnd() * 0.04, seeded(seed * 100 + i)));
  }
  g.globalCompositeOperation = "source-over";
  // Pen grass: little fans of strokes, in clumps.
  g.lineCap = "round";
  for (let k = 0; k < 70; k++) {
    const cx = rnd() * size;
    const cy = rnd() * size;
    const n = 4 + Math.floor(rnd() * 8);
    for (let i = 0; i < n; i++) {
      const x = cx + (rnd() - 0.5) * 70;
      const y = cy + (rnd() - 0.5) * 50;
      const blades = 3 + Math.floor(rnd() * 3);
      const h = 7 + rnd() * 9;
      const tone = rnd() < 0.5 ? PIGMENTS.sepia : PIGMENTS.viridian;
      tiled(size, x, y, 20, (px, py) => {
        g.strokeStyle = css(tone, 0.55 + rnd() * 0.25);
        g.lineWidth = 1 + rnd() * 0.7;
        for (let b = 0; b < blades; b++) {
          const a = -Math.PI / 2 + (b / (blades - 1) - 0.5) * 1.1 + (rnd() - 0.5) * 0.3;
          g.beginPath();
          g.moveTo(px + (b - blades / 2) * 1.6, py);
          g.quadraticCurveTo(px + Math.cos(a) * h * 0.5, py + Math.sin(a) * h * 0.6, px + Math.cos(a) * h, py + Math.sin(a) * h);
          g.stroke();
        }
      });
    }
  }
  // Pebbles: a pale fill and an inked outline, a shadow stroke underneath.
  for (let i = 0; i < 70; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const rx = 3 + rnd() * 7;
    const ry = rx * (0.55 + rnd() * 0.3);
    const rot = rnd() * Math.PI;
    tiled(size, x, y, 16, (px, py) => {
      g.fillStyle = css(PIGMENTS.stone, 0.9);
      g.strokeStyle = css(PIGMENTS.ink, 0.8);
      g.lineWidth = 1.2;
      g.beginPath();
      g.ellipse(px, py, rx, ry, rot, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.strokeStyle = css(PIGMENTS.umber, 0.5);
      g.beginPath();
      g.ellipse(px + 0.8, py + 1.2, rx, ry, rot, 0.2, Math.PI - 0.2);
      g.stroke();
    });
  }
  // Flowers: dots of colour with an inked ring, here and there.
  const petals = [PIGMENTS.vermilion, PIGMENTS.ochre, PIGMENTS.rose, PIGMENTS.white];
  for (let i = 0; i < 46; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const col = petals[i % petals.length] ?? PIGMENTS.ochre;
    tiled(size, x, y, 10, (px, py) => {
      g.fillStyle = css(col, 0.85);
      g.beginPath();
      g.arc(px, py, 2.4, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = css(PIGMENTS.ink, 0.6);
      g.lineWidth = 0.9;
      g.stroke();
    });
  }
  return texture(c);
}

/**
 * A pool of light as a painter leaves it: a soft wash with a ragged edge
 * and a faint tide line, white with alpha (the template tints it). Not
 * tiled: one pool per texture.
 */
export function paintGlow(seed = 13, size = 256): Texture | null {
  const cv = canvas(size);
  if (!cv) return null;
  const { c, g } = cv;
  const rnd = seeded(seed);
  const m = size / 2;
  for (let k = 0; k < 5; k++) {
    const r = m * (0.5 + k * 0.1);
    blob(g, m + (rnd() - 0.5) * 6, m + (rnd() - 0.5) * 6, r, rnd, 11);
    g.fillStyle = `rgba(255,255,255,${0.14 - k * 0.018})`;
    g.fill();
  }
  blob(g, m, m, m * 0.86, rnd, 13);
  g.strokeStyle = "rgba(255,255,255,0.32)";
  g.lineWidth = 2.5;
  g.stroke();
  const t = new CanvasTexture(c as HTMLCanvasElement);
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** A paved yard tile: four slabs ruled in pencil, with stains and cracks. */
export function paintPaving(seed = 7, size = 1024): Texture | null {
  const cv = canvas(size);
  if (!cv) return null;
  const { c, g } = cv;
  const rnd = seeded(seed);
  g.fillStyle = css(0xe6dfcf);
  g.fillRect(0, 0, size, size);
  const slabs = 4;
  const s = size / slabs;
  const tones = [PIGMENTS.slate, PIGMENTS.stone, PIGMENTS.cerulean, PIGMENTS.stone];
  for (let i = 0; i < slabs; i++) {
    for (let j = 0; j < slabs; j++) {
      const col = tones[Math.floor(rnd() * tones.length)] ?? PIGMENTS.stone;
      g.fillStyle = css(col, 0.14 + rnd() * 0.12);
      g.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
    }
  }
  for (let i = 0; i < 14; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 20 + rnd() * 60;
    tiled(size, x, y, r * 1.4, (px, py) => wash(g, px, py, r, i % 2 ? PIGMENTS.umber : PIGMENTS.paynes, 0.08 + rnd() * 0.06, seeded(seed * 50 + i)));
  }
  // Seams: two pencil passes each, slightly off one another.
  g.strokeStyle = css(PIGMENTS.paynes, 0.55);
  g.lineCap = "round";
  for (let pass = 0; pass < 2; pass++) {
    g.lineWidth = pass === 0 ? 2.2 : 1.1;
    for (let i = 0; i <= slabs; i++) {
      const p = i * s + (pass ? 1.5 : 0);
      penLine(g, p, 0, p, size, rnd, 1.6);
      penLine(g, 0, p, size, p, rnd, 1.6);
    }
  }
  // Cracks: short zig-zags in ink.
  g.strokeStyle = css(PIGMENTS.ink, 0.6);
  g.lineWidth = 1;
  for (let i = 0; i < 18; i++) {
    let x = rnd() * size;
    let y = rnd() * size;
    g.beginPath();
    g.moveTo(x, y);
    const n = 3 + Math.floor(rnd() * 4);
    let a = rnd() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      a += (rnd() - 0.5) * 1.4;
      x += Math.cos(a) * (6 + rnd() * 12);
      y += Math.sin(a) * (6 + rnd() * 12);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // Hatched corners where the slabs meet, a draughtsman's habit.
  g.strokeStyle = css(PIGMENTS.paynes, 0.35);
  g.lineWidth = 1;
  for (let i = 0; i < slabs; i++) {
    for (let j = 0; j < slabs; j++) {
      if (rnd() < 0.5) continue;
      const x = i * s + 6;
      const y = j * s + 6;
      for (let k = 0; k < 5; k++) penLine(g, x + k * 5, y, x, y + k * 5, rnd, 0.6);
    }
  }
  return texture(c);
}
