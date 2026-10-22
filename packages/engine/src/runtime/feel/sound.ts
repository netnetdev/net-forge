/**
 * The sound player: real CC0 samples for FeelKit's named cues and one
 * music loop, with a mute that sticks.
 *
 *   const sound = new SoundPlayer(feel.audio, { key: "emberwatch" });
 *   sound.load(soundBank(libraryBase));   // @netnetcapital/asset-library: cue -> { url, gain }, music
 *   sound.unlockOnGesture();              // browsers start audio on the first press
 *   hudButton.onclick = () => label(sound.toggle());
 *
 * Effects decode into FeelAudio buffers under the same cue names, so every
 * `feel.hit()`, `feel.kill()` and `audio.play("levelUp")` plays the sample
 * and falls back to its synth recipe until it loads (or if it fails to
 * decode). Music streams through an <audio> element (no decode of the whole
 * track, no CORS needed for a CDN library), loops, fades in, pauses while
 * the tab is hidden, and follows the mute. Nothing here runs without a
 * browser: tests inject the element and the fetch.
 */
import type { FeelAudio } from "./audio.js";

export interface SoundBankEntry {
  readonly url: string;
  /** The sample's mix level (1 = as recorded). */
  readonly gain?: number;
}

/** Cue name -> sample, and an optional music loop (the asset library's `soundBank()` builds one). */
export interface SoundBank {
  readonly cues: Readonly<Record<string, SoundBankEntry>>;
  readonly music?: SoundBankEntry | null;
}

/** The slice of HTMLAudioElement the music uses. */
export interface MusicElement {
  src: string;
  loop: boolean;
  volume: number;
  muted: boolean;
  preload: string;
  readonly paused: boolean;
  play(): Promise<void> | void;
  pause(): void;
}

export interface SoundPlayerOptions {
  /** Music volume 0..1 before the track's own gain. Default 0.4. */
  readonly musicVolume?: number;
  /** Effects volume multiplier on every sample's gain. Default 1. */
  readonly sfxVolume?: number;
  /** Start with music on (the mute still wins). Default true. */
  readonly music?: boolean;
  /** Storage key prefix for the remembered mute ("<key>:muted"). Default "netnet:sound". Null keeps nothing. */
  readonly key?: string | null;
  /** Seconds the music fades in over. Default 2. */
  readonly fadeIn?: number;
  /** Build the music element (tests). Default `new Audio()`. */
  readonly createMusic?: () => MusicElement | null;
  /** Fetch a sample's bytes (tests). Default `fetch`. */
  readonly fetchBytes?: (url: string) => Promise<ArrayBuffer>;
  /** Pause the music while the tab is hidden. Default true. */
  readonly pauseWhenHidden?: boolean;
}

function readStore(key: string): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}
function writeStore(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  } catch {
    // Private window or blocked storage: the choice lasts this page.
  }
}

export class SoundPlayer {
  /** Samples decoded so far, and ones that failed (they keep their synth recipe). */
  readonly loaded = { cues: 0, failed: 0, music: false };
  private bank: SoundBank | null = null;
  private music: MusicElement | null = null;
  private musicGain = 1;
  private musicOn: boolean;
  private mutedNow: boolean;
  private fade = 1;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private readonly o: { musicVolume: number; sfxVolume: number; key: string | null; fadeIn: number; createMusic: () => MusicElement | null; fetchBytes: (url: string) => Promise<ArrayBuffer>; pauseWhenHidden: boolean };

  constructor(
    readonly audio: FeelAudio,
    opts: SoundPlayerOptions = {},
  ) {
    this.o = {
      musicVolume: opts.musicVolume ?? 0.4,
      sfxVolume: opts.sfxVolume ?? 1,
      key: opts.key === undefined ? "netnet:sound" : opts.key,
      fadeIn: opts.fadeIn ?? 2,
      createMusic: opts.createMusic ?? (() => (typeof Audio !== "undefined" ? (new Audio() as MusicElement) : null)),
      fetchBytes: opts.fetchBytes ?? (async (url) => (await fetch(url)).arrayBuffer()),
      pauseWhenHidden: opts.pauseWhenHidden ?? true,
    };
    this.musicOn = opts.music ?? true;
    this.mutedNow = this.o.key ? readStore(`${this.o.key}:muted`) === "1" : false;
    audio.muted = this.mutedNow;
    if (this.o.pauseWhenHidden && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (!this.music) return;
        if (document.hidden) this.music.pause();
        else this.resumeMusic();
      });
    }
  }

  /** Load a bank: samples decode once audio is unlocked; the music starts then too. */
  load(bank: SoundBank): void {
    this.bank = bank;
    this.audio.whenUnlocked((ctx) => {
      for (const [cue, e] of Object.entries(bank.cues)) void this.loadCue(ctx, cue, e);
      if (bank.music) this.startMusic(bank.music);
    });
  }

  private async loadCue(ctx: AudioContext, cue: string, e: SoundBankEntry): Promise<void> {
    try {
      const buffer = await ctx.decodeAudioData(await this.o.fetchBytes(e.url));
      // Levels are absolute: undo the synth master so a sample's gain means the same in every game.
      const master = Math.max(0.01, this.audio.master);
      await this.audio.addBuffer(cue, buffer, { gain: ((e.gain ?? 1) * this.o.sfxVolume) / master });
      this.loaded.cues++;
    } catch {
      // Unsupported format or a missing file: the synth recipe keeps playing.
      this.loaded.failed++;
    }
  }

  private startMusic(e: SoundBankEntry): void {
    const el = this.music ?? this.o.createMusic();
    if (!el) return;
    this.music = el;
    this.musicGain = e.gain ?? 1;
    el.loop = true;
    el.preload = "auto";
    if (el.src !== e.url) el.src = e.url;
    this.fade = this.o.fadeIn > 0 ? 0 : 1;
    this.applyMusic();
    this.resumeMusic();
    this.loaded.music = true;
    if (this.fade < 1) {
      const step = 0.1 / this.o.fadeIn;
      this.fadeTimer = setInterval(() => {
        this.fade = Math.min(1, this.fade + step);
        this.applyMusic();
        if (this.fade >= 1 && this.fadeTimer) {
          clearInterval(this.fadeTimer);
          this.fadeTimer = null;
        }
      }, 100);
    }
  }

  private resumeMusic(): void {
    const el = this.music;
    if (!el || this.mutedNow || !this.musicOn) return;
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const p = el.play();
      if (p && typeof p.catch === "function") p.catch(() => undefined);
    } catch {
      // Autoplay refused: the next gesture's unlock tries again.
    }
  }

  private applyMusic(): void {
    const el = this.music;
    if (!el) return;
    el.volume = Math.max(0, Math.min(1, this.o.musicVolume * this.musicGain * this.fade));
    el.muted = this.mutedNow || !this.musicOn;
    if (el.muted) el.pause();
  }

  /** Start audio on the first pointer or key press (and music with it). */
  unlockOnGesture(target?: EventTarget): void {
    this.audio.unlockOnGesture(target);
  }

  /** Muted: no effects, no music. Remembered in this browser. */
  get muted(): boolean {
    return this.mutedNow;
  }
  set muted(v: boolean) {
    this.mutedNow = v;
    this.audio.muted = v;
    if (this.o.key) writeStore(`${this.o.key}:muted`, v ? "1" : "0");
    this.applyMusic();
    if (!v) {
      this.audio.unlock();
      this.resumeMusic();
    }
  }

  /** Flip the mute; returns the new state (true = muted). */
  toggle(): boolean {
    this.muted = !this.mutedNow;
    return this.mutedNow;
  }

  /** Music on or off on its own (effects keep playing). */
  get musicEnabled(): boolean {
    return this.musicOn;
  }
  set musicEnabled(v: boolean) {
    this.musicOn = v;
    this.applyMusic();
    if (v) this.resumeMusic();
  }

  /** Whether the music element is playing right now. */
  get musicPlaying(): boolean {
    return !!this.music && !this.music.paused && !this.music.muted;
  }

  /** The bank in use (null before load). */
  get current(): SoundBank | null {
    return this.bank;
  }

  dispose(): void {
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    this.music?.pause();
    this.music = null;
  }
}
