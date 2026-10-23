/**
 * Twin-stick input for VOLTYARD.
 *
 *  - Keyboard and mouse: WASD or arrows move, the mouse aims, hold the left
 *    button to fire, 1 2 3 pick a weapon, Q or the wheel cycles, Space or
 *    Shift dashes.
 *  - Gamepad: left stick moves, right stick aims (pushing it far fires),
 *    RT fires, LB or RB cycles, A dashes. Rumble on hits.
 *  - Touch: a stick on the left half moves, a stick on the right half aims
 *    and fires while pushed; SWAP and DASH buttons.
 *
 * The sim's frame: moveX is +x (screen right), moveZ is -z (screen up),
 * yaw is the aim (0 aims up the screen). Presses are held two ticks so the
 * sim sees the edge even if a tick is skipped.
 */
import { Button } from "@netforge/engine-sim";
import type { InputCommand } from "@netforge/engine-sim";

/** Screen point (CSS px) to an aim yaw from our character, or null before the first frame. */
export type AimFrom = (clientX: number, clientY: number) => number | null;

export class ArenaInput {
  private readonly keys = new Set<string>();
  private mouseX = -1;
  private mouseY = -1;
  private mouseDown = false;
  private yaw = 0;
  private moveStick = { x: 0, y: 0 };
  private aimStick = { x: 0, y: 0, on: false };
  private dashHeld = false;
  private pressBits = 0;
  private pressTicks = 0;
  private readonly cleanup: (() => void)[] = [];
  readonly touch: boolean;
  private pad: Gamepad | null = null;
  private padPrev = 0;
  /** Mouse aim is live (the cursor moved over the game). */
  private mouseAim = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly aimFrom: AimFrom,
  ) {
    this.touch = globalThis.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in globalThis;
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === "Digit1" || e.code === "Numpad1") this.press(Button.Choice1);
      if (e.code === "Digit2" || e.code === "Numpad2") this.press(Button.Choice2);
      if (e.code === "Digit3" || e.code === "Numpad3") this.press(Button.Choice3);
      if (e.code === "KeyQ" || e.code === "KeyE") this.press(Button.Alt);
    };
    const up = (e: KeyboardEvent) => this.keys.delete(e.code);
    const blur = () => {
      this.keys.clear();
      this.mouseDown = false;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mouseAim = true;
    };
    const pdown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      if ((e.target as HTMLElement | null)?.closest?.("button, aside, .panel")) return;
      this.mouseDown = true;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mouseAim = true;
    };
    const pup = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button === 0) this.mouseDown = false;
    };
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > 4) this.press(Button.Alt);
    };
    const menu = (e: Event) => e.preventDefault();
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("blur", blur);
    addEventListener("pointermove", move);
    addEventListener("pointerdown", pdown);
    addEventListener("pointerup", pup);
    addEventListener("wheel", wheel, { passive: true });
    root.addEventListener("contextmenu", menu);
    this.cleanup.push(() => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
      removeEventListener("blur", blur);
      removeEventListener("pointermove", move);
      removeEventListener("pointerdown", pdown);
      removeEventListener("pointerup", pup);
      removeEventListener("wheel", wheel);
      root.removeEventListener("contextmenu", menu);
    });
    if (this.touch) void this.bindTouch();
  }

  /** Press a button for the next two ticks (weapon picks from keys, the HUD and pads). */
  press(bits: number): void {
    this.pressBits |= bits;
    this.pressTicks = 2;
  }

  /** Is the player firing right now (for the crosshair). */
  get firing(): boolean {
    return this.mouseDown || (this.aimStick.on && Math.hypot(this.aimStick.x, this.aimStick.y) > 0.5);
  }

  private async bindTouch(): Promise<void> {
    const nipple = await import("nipplejs");
    const left = document.createElement("div");
    left.className = "stick-zone left";
    const right = document.createElement("div");
    right.className = "stick-zone right";
    this.root.append(left, right);
    const mover = nipple.create({ zone: left, mode: "dynamic", color: "rgba(22,224,255,0.7)", size: 120 });
    mover.on("move", (evt) => {
      this.moveStick = { x: evt.data.vector.x, y: evt.data.vector.y };
    });
    mover.on("end", () => {
      this.moveStick = { x: 0, y: 0 };
    });
    const aimer = nipple.create({ zone: right, mode: "dynamic", color: "rgba(255,79,216,0.7)", size: 120 });
    aimer.on("move", (evt) => {
      this.aimStick = { x: evt.data.vector.x, y: evt.data.vector.y, on: true };
      this.mouseAim = false;
    });
    aimer.on("end", () => {
      this.aimStick = { x: 0, y: 0, on: false };
    });
    const button = (label: string, cls: string, down: () => void, upFn?: () => void) => {
      const b = document.createElement("button");
      b.className = `touch-button ${cls}`;
      b.textContent = label;
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        down();
      });
      if (upFn) for (const ev of ["pointerup", "pointercancel", "pointerleave"]) b.addEventListener(ev, upFn);
      this.root.append(b);
      return b;
    };
    const dash = button("DASH", "dash", () => (this.dashHeld = true), () => (this.dashHeld = false));
    const swap = button("SWAP", "swap", () => this.press(Button.Alt));
    this.cleanup.push(() => {
      mover.destroy();
      aimer.destroy();
      left.remove();
      right.remove();
      dash.remove();
      swap.remove();
    });
  }

  private readPad(): { x: number; y: number; aimX: number; aimY: number; buttons: number } | null {
    const pads = navigator.getGamepads?.() ?? [];
    this.pad = null;
    for (const p of pads) if (p && p.connected) this.pad = p;
    const p = this.pad;
    if (!p) return null;
    const dz = (v: number) => (Math.abs(v) < 0.2 ? 0 : v);
    const held = (i: number) => (p.buttons[i]?.pressed ? 1 << i : 0);
    const now = held(0) | held(4) | held(5) | held(7);
    const pressed = now & ~this.padPrev;
    this.padPrev = now;
    let buttons = 0;
    if (now & 1) buttons |= Button.Sprint;
    if (now & (1 << 7)) buttons |= Button.Fire;
    if (pressed & ((1 << 4) | (1 << 5))) this.press(Button.Alt);
    return { x: dz(p.axes[0] ?? 0), y: dz(p.axes[1] ?? 0), aimX: dz(p.axes[2] ?? 0), aimY: dz(p.axes[3] ?? 0), buttons };
  }

  /** Controller rumble (Gamepad API), when a pad that supports it is connected. */
  rumble(strength: number, ms: number): void {
    const act = (this.pad as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null)?.vibrationActuator;
    void act?.playEffect?.("dual-rumble", { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }).catch(() => undefined);
  }

  /** The current aim, radians (0 aims up the screen). */
  get aim(): number {
    return this.yaw;
  }

  /** One command for the next fixed tick. */
  sample(tick: number): InputCommand {
    const k = this.keys;
    let mx = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    let my = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    let buttons = 0;
    if (k.has("Space") || k.has("ShiftLeft") || k.has("ShiftRight") || this.dashHeld) buttons |= Button.Sprint;
    if (this.mouseDown) buttons |= Button.Fire;
    if (this.mouseAim && this.mouseX >= 0) {
      const y = this.aimFrom(this.mouseX, this.mouseY);
      if (y !== null) this.yaw = y;
    }
    const pad = this.readPad();
    if (pad) {
      if (pad.x !== 0 || pad.y !== 0) {
        mx = pad.x;
        my = -pad.y;
      }
      if (pad.aimX !== 0 || pad.aimY !== 0) {
        // Stick down is +z on screen.
        this.yaw = Math.atan2(-pad.aimX, -pad.aimY);
        this.mouseAim = false;
        if (Math.hypot(pad.aimX, pad.aimY) > 0.85) buttons |= Button.Fire;
      }
      buttons |= pad.buttons;
    }
    if (this.moveStick.x !== 0 || this.moveStick.y !== 0) {
      mx = this.moveStick.x;
      my = this.moveStick.y;
    }
    if (this.aimStick.on && (this.aimStick.x !== 0 || this.aimStick.y !== 0)) {
      // nipplejs: y is up the screen, which is -z.
      this.yaw = Math.atan2(-this.aimStick.x, this.aimStick.y);
      if (Math.hypot(this.aimStick.x, this.aimStick.y) > 0.5) buttons |= Button.Fire;
    }
    if (this.pressTicks > 0) {
      buttons |= this.pressBits;
      if (--this.pressTicks === 0) this.pressBits = 0;
    }
    return { seq: 0, tick, moveX: mx, moveZ: my, yaw: this.yaw, buttons };
  }

  dispose(): void {
    for (const f of this.cleanup.splice(0)) f();
  }
}
