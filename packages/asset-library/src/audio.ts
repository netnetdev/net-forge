/**
 * The audio section as a sound bank the engine's SoundPlayer loads
 * (`@netnetcapital/engine/runtime`): every cue's sample URL and mix gain,
 * and one music loop. Pure data: the engine does the playing.
 */
import { cueSounds, musicTracks, soundById } from "./library.js";
import { libraryUrl, soundPath } from "./paths.js";

export interface BankSound {
  readonly url: string;
  readonly gain: number;
}

/** Structurally the engine's `SoundBank`. */
export interface LibrarySoundBank {
  readonly cues: Readonly<Record<string, BankSound>>;
  readonly music: BankSound | null;
}

export interface SoundBankOptions {
  /** A music id (audio.music.*), or null for none. Default: the first track. */
  readonly music?: string | null;
  /** Cue name -> sound id overrides (e.g. { kill: "audio.sfx.big_kill" }). */
  readonly cues?: Readonly<Record<string, string>>;
}

/** URLs and gains for every cue sound and one music loop, under the library's base URL. */
export function soundBank(base: string, o: SoundBankOptions = {}): LibrarySoundBank {
  const cues: Record<string, BankSound> = {};
  for (const [cue, s] of cueSounds()) cues[cue] = { url: libraryUrl(base, soundPath(s)), gain: s.gain };
  for (const [cue, id] of Object.entries(o.cues ?? {})) {
    const s = soundById(id);
    if (!s || s.kind !== "sfx") throw new Error(`${id} is not a sound effect in the library`);
    cues[cue] = { url: libraryUrl(base, soundPath(s)), gain: s.gain };
  }
  let music: BankSound | null = null;
  if (o.music !== null) {
    const s = o.music ? soundById(o.music) : musicTracks()[0];
    if (o.music && (!s || s.kind !== "music")) throw new Error(`${o.music} is not a music loop in the library`);
    if (s) music = { url: libraryUrl(base, soundPath(s)), gain: s.gain };
  }
  return { cues, music };
}
