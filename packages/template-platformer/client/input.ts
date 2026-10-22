/**
 * SKYLEDGE input: run, jump, dash, drop.
 *
 *  - Keyboard: A/D or Left/Right run; Space, W, Up or K jump (hold for a
 *    full jump, tap for a hop); Shift, J or L dash; S or Down held with Jump
 *    drops through a ledge; R or Enter readies the next course.
 *  - Gamepad: left stick or d-pad runs, A jumps, X or RB dashes, down + A drops.
 *  - Touch: left and right buttons, a big JUMP and a DASH.
 *
 * Jump is sent as held (the sim finds the press edge and measures the hold
 * for the variable jump), so a press shorter than a tick still counts: a
 * press is held for at least two ticks.
 */
import { Button } from "@netnetcapital/engine-sim";
import type { InputCommand } from "@netnetcapital/engine-sim";

export class PlatformInput {
  private readonly keys = new Set<string>();
  private readonly touchHeld = new Set<string>();
  private jumpLatch = 0;
  private dashLatch = 0;
  private readyLatch = 0;
  private pad: Gamepad | null = null;
  readonly touch: boolean;

  constructor(root: HTMLElement) {
    this.touch = globalThis.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in globalThis;
    const jumpKeys = new Set(["Space", "KeyW", "ArrowUp", "KeyK"]);
    const dashKeys = new Set(["ShiftLeft", "ShiftRight", "KeyJ", "KeyL"]);
    addEventListener("keydown", (e) => {
      if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (jumpKeys.has(e.code)) this.jumpLatch = 2;
      if (dashKeys.has(e.code)) this.dashLatch = 2;
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
      const on = (e: PointerEvent) => {
        e.preventDefault();
        this.touchHeld.add(name);
        if (name === "jump") this.jumpLatch = 2;
        if (name === "dash") this.dashLatch = 2;
        el.setPointerCapture?.(e.pointerId);
      };
      const off = () => this.touchHeld.delete(name);
      el.addEventListener("pointerdown", on);
      el.addEventListener("pointerup", off);
      el.addEventListener("pointercancel", off);
      el.addEventListener("lostpointercapture", off);
    };
    bind("t-left", "left");
    bind("t-right", "right");
    bind("t-jump", "jump");
    bind("t-dash", "dash");
  }

  private has(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** Ask for the next course (the results screen's button). */
  ready(): void {
    this.readyLatch = 6;
  }

  /** This tick's command (seq is set by the netcode). */
  sample(tick: number): InputCommand {
    this.pad = (globalThis.navigator?.getGamepads?.() ?? []).find((p) => p) ?? null;
    let moveX = 0;
    let down = false;
    let jump = false;
    let dash = false;
    if (this.has("KeyA", "ArrowLeft") || this.touchHeld.has("left")) moveX -= 1;
    if (this.has("KeyD", "ArrowRight") || this.touchHeld.has("right")) moveX += 1;
    if (this.has("KeyS", "ArrowDown")) down = true;
    if (this.has("Space", "KeyW", "ArrowUp", "KeyK") || this.touchHeld.has("jump")) jump = true;
    if (this.has("ShiftLeft", "ShiftRight", "KeyJ", "KeyL") || this.touchHeld.has("dash")) dash = true;
    const pad = this.pad;
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (Math.abs(ax) > 0.25) moveX = Math.max(-1, Math.min(1, moveX + ax));
      if (pad.buttons[14]?.pressed) moveX = -1;
      if (pad.buttons[15]?.pressed) moveX = 1;
      if (ay > 0.6 || pad.buttons[13]?.pressed) down = true;
      if (pad.buttons[0]?.pressed) jump = true;
      if (pad.buttons[2]?.pressed || pad.buttons[5]?.pressed) dash = true;
      if (pad.buttons[9]?.pressed) this.readyLatch = 6;
    }
    if (this.jumpLatch > 0) {
      jump = true;
      this.jumpLatch--;
    }
    if (this.dashLatch > 0) {
      dash = true;
      this.dashLatch--;
    }
    let buttons = (jump ? Button.Jump : 0) | (dash ? Button.Sprint : 0);
    if (this.readyLatch > 0) {
      buttons |= Button.Ready;
      this.readyLatch--;
    }
    return { seq: 0, tick, moveX: Math.max(-1, Math.min(1, moveX)), moveZ: down ? -1 : 0, yaw: 0, buttons };
  }

  /** A short rumble on the pad (falls, springs). */
  rumble(strength: number, ms: number): void {
    const act = (this.pad as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | null)?.vibrationActuator;
    void act?.playEffect?.("dual-rumble", { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }).catch(() => undefined);
  }
}
