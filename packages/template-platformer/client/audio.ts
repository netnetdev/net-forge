/**
 * SKYLEDGE's sound cues on the engine's FeelAudio. Coins, landings, dashes
 * and falls play the asset library's CC0 samples (PLATFORM_SAMPLES, loaded
 * by the engine's SoundPlayer with a music loop); jumps stay synthesized so
 * a jump and an air jump are told apart by pitch. Every cue keeps a synth
 * recipe as the fallback when a sample cannot load.
 */
import type { FeelAudio } from "@netnetcapital/engine/runtime";

/** Cue name -> library sound id (soundBank's `cues` overrides). */
export const PLATFORM_SAMPLES: Readonly<Record<string, string>> = {
  coin: "audio.sfx.coin",
  land: "audio.sfx.land",
  dash: "audio.sfx.dash",
  fall: "audio.sfx.downed",
  checkpoint: "audio.sfx.confirm",
  finish: "audio.sfx.level_up",
  shield: "audio.sfx.hit",
};

export function definePlatformCues(a: FeelAudio): void {
  a.define("jump", { wave: "square", f0: 320, f1: 720, ms: 110, gain: 0.32 }, { minGapMs: 50, voices: 2, pitchVar: 0.03 });
  a.define("airjump", { wave: "square", f0: 520, f1: 1100, ms: 120, gain: 0.32 }, { minGapMs: 50, voices: 2, pitchVar: 0.03 });
  a.define("coin", { wave: "triangle", f0: 1320, f1: 1980, ms: 90, gain: 0.45 }, { minGapMs: 30, voices: 3, pitchVar: 0.06 });
  a.define("land", { wave: "triangle", f0: 160, f1: 60, ms: 90, gain: 0.5 }, { minGapMs: 80, voices: 1 });
  a.define("dash", { wave: "sawtooth", f0: 900, f1: 200, ms: 140, gain: 0.35 }, { minGapMs: 80, voices: 1 });
  a.define("spring", { wave: "sine", f0: 200, f1: 900, ms: 260, gain: 0.55 }, { minGapMs: 120, voices: 1 });
  a.define("fall", { wave: "sawtooth", f0: 420, f1: 60, ms: 520, gain: 0.6 }, { minGapMs: 300, voices: 1 });
  a.define("checkpoint", { wave: "triangle", f0: 660, f1: 990, ms: 160, gain: 0.6 }, { minGapMs: 120, voices: 1, pitchVar: 0 });
  a.define("finish", { wave: "triangle", f0: 523, f1: 1046, ms: 420, gain: 0.7 }, { minGapMs: 400, voices: 1, pitchVar: 0 });
  a.define("shield", { wave: "square", f0: 300, f1: 200, ms: 120, gain: 0.45 }, { minGapMs: 100, voices: 1 });
  a.define("tick", { wave: "square", f0: 880, f1: 880, ms: 70, gain: 0.35 }, { minGapMs: 200, voices: 1, pitchVar: 0 });
  a.define("go", { wave: "square", f0: 1320, f1: 1320, ms: 200, gain: 0.4 }, { minGapMs: 200, voices: 1, pitchVar: 0 });
}
