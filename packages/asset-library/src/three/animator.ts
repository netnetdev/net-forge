/**
 * Character animation: the engine runtime's AnimatedCharacter (skinned
 * glTF, locomotion crossfades, ground-speed playback) driven through the
 * library's shared rigs. The rig maps the canonical clips (idle, walk, run,
 * attack, shoot, hit, die) to whatever each pack calls them, so templates
 * never deal in file clip names.
 */
import { AnimatedCharacter } from "@netforge/engine/runtime";
import type { AnimationClip, Object3D } from "three/webgpu";
import { clipFor, type Clip, type RigDef } from "../rigs.js";

export interface CharacterAnimator {
  /** Ground speed in m/s: picks idle, walk or run and matches playback rate. */
  setSpeed(mps: number): void;
  /** Play a canonical clip; `once` returns to locomotion when it ends; `hold` stays on its last frame. False when the rig has no such clip. */
  play(clip: Clip, opts?: { once?: boolean; hold?: boolean }): boolean;
  update(dt: number): void;
  /** The file clip playing now, or null. */
  readonly playing: string | null;
  dispose(): void;
}

/** A model with no clips: every call is a no-op. */
export class StaticAnimator implements CharacterAnimator {
  readonly playing = null;
  setSpeed(): void {}
  play(): boolean {
    return false;
  }
  update(): void {}
  dispose(): void {}
}

/** CharacterAnimator over the engine's AnimatedCharacter. */
export class RigAnimator implements CharacterAnimator {
  readonly character: AnimatedCharacter;
  private readonly names: string[];
  private held = false;

  constructor(root: Object3D, clips: readonly AnimationClip[], private readonly rig: RigDef) {
    this.names = clips.map((c) => c.name);
    const pick = (c: Clip) => clipFor(rig, c, this.names) ?? undefined;
    const idle = pick("idle");
    const walk = pick("walk");
    const run = pick("run");
    this.character = new AnimatedCharacter(root, clips, {
      clips: { ...(idle ? { idle } : {}), ...(walk ? { walk } : {}), ...(run ? { run } : {}) },
      walkSpeed: rig.walkSpeed,
      runSpeed: rig.runSpeed,
    });
  }

  get playing(): string | null {
    return this.character.playing;
  }

  setSpeed(mps: number): void {
    if (!this.held) this.character.setSpeed(mps);
  }

  play(clip: Clip, opts: { once?: boolean; hold?: boolean } = {}): boolean {
    const name = clipFor(this.rig, clip, this.names);
    if (!name) return false;
    if (opts.hold) {
      this.held = true;
      return this.character.play(name, { loop: "once" });
    }
    this.held = false;
    if (opts.once) return this.character.oneShot(name);
    if (clip === "idle" || clip === "walk" || clip === "run") {
      // Back to locomotion: the engine picks idle, walk or run from the ground speed.
      this.character.setSpeed(0);
      return true;
    }
    return this.character.play(name);
  }

  update(dt: number): void {
    this.character.update(dt);
  }

  dispose(): void {
    this.character.dispose();
  }
}
