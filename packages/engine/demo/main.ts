import { ArenaClient } from "@netnetcapital/engine/runtime";
import type { ArenaStats } from "@netnetcapital/engine/runtime";
import { startFxDemo } from "./fx.js";
import type { LookPreset, QualityTier } from "../src/runtime/render/index.js";

declare global {
  interface Window {
    /** Latest stats, read by the headless measurement script. */
    __arena?: ArenaStats;
  }
}

const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => {
  const v = Number(params.get(k));
  return Number.isFinite(v) && v > 0 ? v : d;
};
const enemies = Math.floor(num("enemies", 2000));
const hud = document.getElementById("hud");
const host = document.getElementById("game");
const err = document.getElementById("err");

let lastHud = 0;
function render(s: ArenaStats): void {
  window.__arena = s;
  const now = performance.now();
  if (!hud || now - lastHud < 250) return;
  lastHud = now;
  hud.textContent = [
    `${s.backend.toUpperCase()}  ${s.fps.toFixed(0)} fps`,
    `frame ${s.frameMs.mean.toFixed(1)} ms  p95 ${s.frameMs.p95.toFixed(1)}  p99 ${s.frameMs.p99.toFixed(1)}`,
    `cpu   ${s.cpuMs.mean.toFixed(2)} ms  p95 ${s.cpuMs.p95.toFixed(2)}`,
    `sim   ${s.simMsPerTick.toFixed(2)} ms/tick  tick ${s.tick}`,
    `draws ${s.drawCalls}  tris ${(s.triangles / 1000).toFixed(1)}k  dpr ${s.pixelRatio}`,
    `enemies ${s.enemies}  kills ${s.kills}  hp ${s.health}`,
  ].join("\n");
}

async function main(): Promise<void> {
  if (!host) throw new Error("missing #game");
  if (params.get("fx") === "1") {
    const q = params.get("quality");
    await startFxDemo(host, {
      enemies,
      seed: num("seed", 1),
      forceWebGL: params.get("webgl") === "1",
      autopilot: params.get("autopilot") === "1",
      outline: params.get("outline") === "1",
      crowd: params.get("crowd") === "vat" ? "vat" : "motion",
      preset: (params.get("preset") ?? "night") as LookPreset,
      quality: q === "low" || q === "medium" || q === "high" ? (q as QualityTier) : "auto",
      onStats: render,
    });
    return;
  }
  const arena = await ArenaClient.create(host, {
    sim: { seed: num("seed", 1), enemies: { target: enemies, spawnPerTick: 128 } },
    forceWebGL: params.get("webgl") === "1",
    autopilot: params.get("autopilot") === "1",
    onStats: render,
  });
  arena.start();
}

main().catch((e: unknown) => {
  if (err) {
    err.style.display = "grid";
    err.textContent = `Engine failed to start: ${e instanceof Error ? e.message : String(e)}`;
  }
  console.error(e);
});
