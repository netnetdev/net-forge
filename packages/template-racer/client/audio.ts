/**
 * TORQUEBAY's sound cues on the engine's FeelAudio. Coins, boosts and bumps
 * play the asset library's CC0 samples (KART_SAMPLES); the drift screech and
 * the countdown stay synthesized. Every cue keeps a synth fallback.
 */
import type { FeelAudio } from "@netnetcapital/engine/runtime";

/** Cue name -> library sound id (soundBank's `cues` overrides). */
export const KART_SAMPLES: Readonly<Record<string, string>> = {
  coin: "audio.sfx.coin",
  boost: "audio.sfx.dash",
  bump: "audio.sfx.impact",
  lap: "audio.sfx.confirm",
  finish: "audio.sfx.level_up",
};

export function defineKartCues(a: FeelAudio): void {
  a.define("coin", { wave: "triangle", f0: 1320, f1: 1980, ms: 90, gain: 0.45 }, { minGapMs: 30, voices: 3, pitchVar: 0.06 });
  a.define("drift", { wave: "sawtooth", f0: 520, f1: 470, ms: 260, gain: 0.25 }, { minGapMs: 200, voices: 1, pitchVar: 0.05 });
  a.define("boost", { wave: "sawtooth", f0: 180, f1: 900, ms: 320, gain: 0.5 }, { minGapMs: 150, voices: 1 });
  a.define("bump", { wave: "square", f0: 140, f1: 50, ms: 140, gain: 0.55 }, { minGapMs: 120, voices: 2 });
  a.define("lap", { wave: "triangle", f0: 660, f1: 990, ms: 180, gain: 0.6 }, { minGapMs: 300, voices: 1, pitchVar: 0 });
  a.define("finish", { wave: "triangle", f0: 523, f1: 1046, ms: 420, gain: 0.7 }, { minGapMs: 400, voices: 1, pitchVar: 0 });
  a.define("tick", { wave: "square", f0: 880, f1: 880, ms: 70, gain: 0.35 }, { minGapMs: 200, voices: 1, pitchVar: 0 });
  a.define("go", { wave: "square", f0: 1320, f1: 1320, ms: 200, gain: 0.4 }, { minGapMs: 200, voices: 1, pitchVar: 0 });
}
