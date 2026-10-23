/**
 * TORQUEBAY input: throttle, brake, steer, drift.
 *
 *  - Keyboard: W or Up accelerates, S or Down brakes and reverses, A/D or
 *    Left/Right steer, Space or Shift drifts (hold through a bend, release
 *    for the mini-turbo); R or Enter readies the next race.
 *  - Gamepad: left stick steers, RT (or A) accelerates, LT (or B) brakes,
 *    RB or X drifts.
 *  - Touch: the kart accelerates by itself; left and right buttons steer,
 *    DRIFT and BRAKE buttons.
 */
import { Button } from "@netforge/engine-sim";
import type { InputCommand } from "@netforge/engine-sim";

export class KartInput {
  private readonly keys = new Set<string>();
  private readonly touchHeld = new Set<string>();
  private readyLatch = 0;
  private driftLatch = 0;
  readonly touch: boolean;
  private pad: Gamepad | null = null;

  constructor(root: HTMLElement) {
    this.touch = globalThis.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in globalThis;
    addEventListener("keydown", (e) => {
      if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === "Space" || e.code.startsWith("Shift")) this.driftLatch = 2;
      if (e.code === "KeyR" || e.code === "Enter") this.readyLatch = 6;
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => {
      this.keys.clear();
      this.touchHeld.clear();
    });
    const bind = (id: string, name: string) => {
      const el = root.ownerDocument.getElementById(id);
      if (!el) return;
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.touchHeld.add(name);
        if (name === "drift") this.driftLatch = 2;
        el.setPointerCapture?.(e.pointerId);
      });
      const off = () => this.touchHeld.delete(name);
      el.addEventListener("pointerup", off);
      el.addEventListener("pointercancel", off);
      el.addEventListener("lostpointercapture", off);
    };
    bind("t-left", "left");
    bind("t-right", "right");
    bind("t-drift", "drift");
    bind("t-brake", "brake");
  }

  ready(): void {
    this.readyLatch = 6;
  }

  private has(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  sample(tick: number): InputCommand {
    this.pad = (globalThis.navigator?.getGamepads?.() ?? []).find((p) => p) ?? null;
    let steer = 0;
    let throttle = 0;
    let drift = false;
    if (this.has("KeyA", "ArrowLeft") || this.touchHeld.has("left")) steer -= 1;
    if (this.has("KeyD", "ArrowRight") || this.touchHeld.has("right")) steer += 1;
    if (this.has("KeyW", "ArrowUp")) throttle = 1;
    if (this.has("KeyS", "ArrowDown") || this.touchHeld.has("brake")) throttle = -1;
    // Touch drives itself: the kart accelerates unless the brake is held.
    if (this.touch && this.touchHeld.size > 0 && !this.touchHeld.has("brake")) throttle = 1;
    if (this.touch && this.touchHeld.size === 0 && this.keys.size === 0) throttle = 1;
    if (this.has("Space", "ShiftLeft", "ShiftRight") || this.touchHeld.has("drift")) drift = true;
    const pad = this.pad;
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > 0.15) steer = Math.max(-1, Math.min(1, ax));
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.1 || pad.buttons[0]?.pressed) throttle = Math.max(throttle, rt > 0.1 ? rt : 1);
      if (lt > 0.1 || pad.buttons[1]?.pressed) throttle = -Math.max(lt, 0.8);
      if (pad.buttons[5]?.pressed || pad.buttons[2]?.pressed) drift = true;
      if (pad.buttons[9]?.pressed) this.readyLatch = 6;
    }
    if (this.driftLatch > 0) {
      drift = true;
      this.driftLatch--;
    }
    let buttons = drift ? Button.Sprint : 0;
    if (this.readyLatch > 0) {
      buttons |= Button.Ready;
      this.readyLatch--;
    }
    return { seq: 0, tick, moveX: steer, moveZ: throttle, yaw: 0, buttons };
  }

  rumble(strength: number, ms: number): void {
    const act = (this.pad as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | null)?.vibrationActuator;
    void act?.playEffect?.("dual-rumble", { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }).catch(() => undefined);
  }
}
