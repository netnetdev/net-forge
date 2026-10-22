/**
 * VOLTYARD's sound cues on the engine's FeelAudio (FeelKit). Shots, downs
 * and heals play real CC0 samples from the asset library's audio section
 * (ARENA_SAMPLES, loaded by the engine's SoundPlayer with a music loop);
 * the FeelKit's own cues (impact, bigKill, hurt) take the library's samples
 * by name. Two cues stay synthesized on purpose so you can tell them apart
 * without looking: the hit tick and the two-note kill confirm. Every cue
 * keeps a synth recipe as the fallback when a sample cannot load. Others'
 * cues ("-o") are played quieter. Starts on the first user gesture.
 */
import type { FeelAudio } from "@netnetcapital/engine/runtime";

/** Arena cue name -> library sound id (soundBank's `cues` overrides). */
export const ARENA_SAMPLES: Readonly<Record<string, string>> = {
  zap: "audio.sfx.shoot",
  "zap-o": "audio.sfx.shoot",
  wide: "audio.sfx.shoot",
  "wide-o": "audio.sfx.shoot",
  down: "audio.sfx.downed",
  "down-o": "audio.sfx.kill",
  heal: "audio.sfx.revive",
};

export function defineArenaCues(a: FeelAudio): void {
  a.define("zap", { wave: "square", f0: 1300, f1: 500, ms: 50, gain: 0.35 }, { minGapMs: 40, voices: 3 });
  a.define("zap-o", { wave: "square", f0: 1300, f1: 500, ms: 50, gain: 0.35 }, { minGapMs: 40, voices: 3 });
  a.define("wide", { wave: "square", f0: 260, f1: 60, ms: 140, gain: 0.6 }, { minGapMs: 60, voices: 2 });
  a.define("wide-o", { wave: "square", f0: 260, f1: 60, ms: 140, gain: 0.6 }, { minGapMs: 60, voices: 2 });
  a.define("beam", { wave: "sawtooth", f0: 1800, f1: 120, ms: 220, gain: 0.7 }, { minGapMs: 60, voices: 2 });
  a.define("beam-o", { wave: "sawtooth", f0: 1800, f1: 120, ms: 220, gain: 0.7 }, { minGapMs: 60, voices: 2 });
  a.define("hitmark", { wave: "triangle", f0: 2600, f1: 1900, ms: 40, gain: 0.55 }, { minGapMs: 35, voices: 2, pitchVar: 0.03 });
  a.define("confirm", { wave: "triangle", f0: 660, f1: 990, ms: 120, gain: 0.8 }, { minGapMs: 80, voices: 2, pitchVar: 0 });
  a.define("confirm2", { wave: "triangle", f0: 990, f1: 1980, ms: 200, gain: 0.8 }, { minGapMs: 80, voices: 2, pitchVar: 0 });
  a.define("down-o", { wave: "triangle", f0: 520, f1: 260, ms: 160, gain: 0.3 }, { minGapMs: 120, voices: 2 });
  a.define("down", { wave: "sawtooth", f0: 300, f1: 40, ms: 600, gain: 0.8 }, { minGapMs: 300, voices: 1 });
  a.define("heal", { wave: "sine", f0: 440, f1: 880, ms: 180, gain: 0.6 }, { minGapMs: 150, voices: 1 });
}

/** Our kill: two rising notes. */
export function killConfirm(a: FeelAudio): void {
  a.play("confirm");
  setTimeout(() => a.play("confirm2"), 90);
}
