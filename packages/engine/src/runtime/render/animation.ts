import { AnimationMixer, LoopOnce, LoopRepeat } from "three/webgpu";
import type { AnimationAction, AnimationClip, Object3D } from "three/webgpu";

export type LocomotionState = "idle" | "walk" | "run";

export interface LocomotionThresholds {
  /** Speed (m/s) at and above which the character walks. Default 0.4. */
  readonly walk: number;
  /** Speed at and above which it runs. Default 4. */
  readonly run: number;
  /** Hysteresis band, m/s, so speeds near a threshold do not flicker. Default 0.25. */
  readonly band: number;
}

export const DEFAULT_LOCOMOTION: LocomotionThresholds = { walk: 0.4, run: 4, band: 0.25 };

/** The locomotion state for a speed, with hysteresis around the current state. Pure. */
export function locomotionState(speed: number, current: LocomotionState, t: LocomotionThresholds = DEFAULT_LOCOMOTION): LocomotionState {
  const up = (th: number) => speed >= th + t.band;
  const down = (th: number) => speed < th - t.band;
  switch (current) {
    case "idle":
      return up(t.run) ? "run" : up(t.walk) ? "walk" : "idle";
    case "walk":
      return up(t.run) ? "run" : down(t.walk) ? "idle" : "walk";
    case "run":
      return down(t.walk) ? "idle" : down(t.run) ? "walk" : "run";
  }
}

export interface AnimatedCharacterOptions {
  /** Clip names for each locomotion state. Default "idle", "walk", "run". */
  readonly clips?: Partial<Record<LocomotionState, string>>;
  readonly thresholds?: Partial<LocomotionThresholds>;
  /** Speed (m/s) at which the walk and run clips play at timeScale 1 (foot speed matching). */
  readonly walkSpeed?: number;
  readonly runSpeed?: number;
  /** Default crossfade, s. Default 0.2. */
  readonly fade?: number;
}

export interface PlayOptions {
  readonly fade?: number;
  readonly loop?: "repeat" | "once";
  readonly timeScale?: number;
}

/**
 * A skinned character (glTF or procedural) with an AnimationMixer:
 * `setSpeed(mps)` drives idle/walk/run with crossfades and playback rate
 * matched to ground speed; `oneShot("attack")` plays once and blends back
 * to locomotion; `play(name)` for anything else. Call `update(dt)` per frame.
 */
export class AnimatedCharacter {
  readonly mixer: AnimationMixer;
  private readonly actions = new Map<string, AnimationAction>();
  private readonly names: Record<LocomotionState, string>;
  private readonly th: LocomotionThresholds;
  private readonly walkSpeed: number;
  private readonly runSpeed: number;
  private readonly fade: number;
  private current: AnimationAction | null = null;
  private loco: LocomotionState = "idle";
  private oneShotAction: AnimationAction | null = null;
  private speed = 0;

  constructor(
    readonly root: Object3D,
    clips: readonly AnimationClip[],
    opts: AnimatedCharacterOptions = {},
  ) {
    this.mixer = new AnimationMixer(root);
    for (const c of clips) this.actions.set(c.name, this.mixer.clipAction(c));
    this.names = { idle: "idle", walk: "walk", run: "run", ...opts.clips };
    this.th = { ...DEFAULT_LOCOMOTION, ...opts.thresholds };
    this.walkSpeed = opts.walkSpeed ?? 2;
    this.runSpeed = opts.runSpeed ?? 6;
    this.fade = opts.fade ?? 0.2;
    this.mixer.addEventListener("finished", (e) => {
      if (e.action === this.oneShotAction) {
        this.oneShotAction = null;
        this.enterLocomotion(this.fade, true);
      }
    });
    this.enterLocomotion(0, true);
  }

  has(name: string): boolean {
    return this.actions.has(name);
  }

  get state(): LocomotionState {
    return this.loco;
  }

  get playing(): string | null {
    return this.current?.getClip().name ?? null;
  }

  /** Crossfade to a clip. Returns false if the clip does not exist. */
  play(name: string, opts: PlayOptions = {}): boolean {
    const next = this.actions.get(name);
    if (!next) return false;
    const fade = opts.fade ?? this.fade;
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.setEffectiveTimeScale(opts.timeScale ?? 1);
    if (opts.loop === "once") {
      next.setLoop(LoopOnce, 1);
      next.clampWhenFinished = true;
    } else next.setLoop(LoopRepeat, Infinity);
    if (this.current && this.current !== next && fade > 0) next.crossFadeFrom(this.current, fade, true);
    else if (this.current && this.current !== next) this.current.stop();
    next.play();
    this.current = next;
    return true;
  }

  /** Play a clip once (attack, hit), then return to locomotion. */
  oneShot(name: string, opts: Omit<PlayOptions, "loop"> = {}): boolean {
    if (!this.play(name, { ...opts, loop: "once" })) return false;
    this.oneShotAction = this.current;
    return true;
  }

  /** Ground speed in m/s; picks the locomotion clip and its playback rate. */
  setSpeed(mps: number): void {
    this.speed = Math.max(0, mps);
    if (this.oneShotAction) return;
    const next = locomotionState(this.speed, this.loco, this.th);
    if (next !== this.loco) {
      this.loco = next;
      this.enterLocomotion(this.fade, false);
    }
    this.current?.setEffectiveTimeScale(this.rateFor(this.loco));
  }

  private rateFor(s: LocomotionState): number {
    if (s === "walk") return Math.min(2, Math.max(0.5, this.speed / this.walkSpeed));
    if (s === "run") return Math.min(2, Math.max(0.6, this.speed / this.runSpeed));
    return 1;
  }

  private enterLocomotion(fade: number, recompute: boolean): void {
    if (recompute) this.loco = locomotionState(this.speed, "idle", this.th);
    const want = this.names[this.loco];
    const name = this.actions.has(want) ? want : this.names.idle;
    if (this.current?.getClip().name === name && this.current.isRunning()) return;
    this.play(name, { fade, timeScale: this.rateFor(this.loco) });
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}
