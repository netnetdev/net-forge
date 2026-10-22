import { Button } from "@netnetcapital/engine-sim";
import type { InputCommand } from "@netnetcapital/engine-sim";

export interface InputOptions {
  /** Radians of yaw/pitch per pixel of mouse movement. */
  readonly mouseSensitivity?: number;
  /** Radians per pixel of touch-drag look. */
  readonly touchSensitivity?: number;
  /** Force the touch UI on (default: when the device reports coarse pointers / touch). */
  readonly touch?: boolean;
}

export interface LookTarget {
  look(dYaw: number, dPitch: number): void;
  readonly yaw: number;
}

const KEY_BUTTONS: Record<string, number> = {
  Space: Button.Jump,
  ShiftLeft: Button.Sprint,
  ShiftRight: Button.Sprint,
  KeyE: Button.Use,
  KeyF: Button.Fire,
  KeyQ: Button.Alt,
};

/**
 * Keyboard + mouse (pointer lock) and touch (nipplejs virtual stick on the
 * left half, drag-to-look and action buttons on the right). `sample()`
 * produces one sequence-numbered InputCommand per fixed tick.
 */
export class InputController {
  private readonly keys = new Set<string>();
  private mouseButtons = 0;
  private stickX = 0;
  private stickY = 0;
  private touchButtons = 0;
  private seq = 0;
  private readonly cleanup: (() => void)[] = [];
  private readonly o: Required<InputOptions>;
  readonly touch: boolean;

  constructor(
    private readonly element: HTMLElement,
    private readonly look: LookTarget,
    opts: InputOptions = {},
  ) {
    this.o = {
      mouseSensitivity: 0.0025,
      touchSensitivity: 0.006,
      touch: opts.touch ?? (globalThis.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in globalThis),
      ...opts,
    };
    this.touch = this.o.touch;
    this.bindDesktop();
    if (this.touch) void this.bindTouch();
  }

  private on<K extends keyof WindowEventMap>(target: Window, type: K, fn: (e: WindowEventMap[K]) => void): void;
  private on<K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void): void;
  private on(target: Window | HTMLElement, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn, { passive: false });
    this.cleanup.push(() => target.removeEventListener(type, fn));
  }

  private bindDesktop(): void {
    const el = this.element;
    this.on(window, "keydown", (e) => {
      if (e.code === "Space") e.preventDefault();
      this.keys.add(e.code);
    });
    this.on(window, "keyup", (e) => this.keys.delete(e.code));
    this.on(window, "blur", () => {
      this.keys.clear();
      this.mouseButtons = 0;
    });
    this.on(el, "mousedown", (e) => {
      if (this.touch) return;
      if (document.pointerLockElement !== el) void el.requestPointerLock?.();
      this.mouseButtons |= e.button === 0 ? Button.Fire : e.button === 2 ? Button.Alt : 0;
    });
    this.on(window, "mouseup", (e) => {
      this.mouseButtons &= ~(e.button === 0 ? Button.Fire : e.button === 2 ? Button.Alt : 0);
    });
    this.on(el, "contextmenu", (e) => e.preventDefault());
    this.on(window, "mousemove", (e) => {
      if (document.pointerLockElement !== el) return;
      const s = this.o.mouseSensitivity;
      this.look.look(-e.movementX * s, e.movementY * s);
    });
  }

  private async bindTouch(): Promise<void> {
    // nipplejs is only downloaded on touch devices.
    const nipple = await import("nipplejs");
    const left = document.createElement("div");
    left.style.cssText = "position:absolute;left:0;top:0;bottom:0;width:50%;touch-action:none;z-index:2";
    const right = document.createElement("div");
    right.style.cssText = "position:absolute;right:0;top:0;bottom:0;width:50%;touch-action:none;z-index:2";
    this.element.append(left, right);
    this.cleanup.push(() => {
      left.remove();
      right.remove();
    });
    const sticks = nipple.create({ zone: left, mode: "dynamic", color: "white", size: 110 });
    sticks.on("move", (evt) => {
      this.stickX = evt.data.vector.x;
      this.stickY = evt.data.vector.y;
    });
    sticks.on("end", () => {
      this.stickX = 0;
      this.stickY = 0;
    });
    this.cleanup.push(() => sticks.destroy());

    // Right half: drag to look; two buttons for jump and fire.
    let lastX = 0;
    let lastY = 0;
    let lookId: number | null = null;
    this.on(right, "pointerdown", (e) => {
      if (e.target !== right) return;
      lookId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    this.on(right, "pointermove", (e) => {
      if (e.pointerId !== lookId) return;
      const s = this.o.touchSensitivity;
      this.look.look(-(e.clientX - lastX) * s, (e.clientY - lastY) * s);
      lastX = e.clientX;
      lastY = e.clientY;
    });
    const endLook = (e: PointerEvent) => {
      if (e.pointerId === lookId) lookId = null;
    };
    this.on(right, "pointerup", endLook);
    this.on(right, "pointercancel", endLook);

    const mk = (label: string, bit: number, bottom: number, rightPx: number) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = `position:absolute;bottom:${bottom}px;right:${rightPx}px;width:76px;height:76px;border-radius:50%;border:2px solid rgba(255,255,255,.6);background:rgba(255,255,255,.12);color:#fff;font:600 13px system-ui;touch-action:none`;
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.touchButtons |= bit;
      });
      const up = () => {
        this.touchButtons &= ~bit;
      };
      b.addEventListener("pointerup", up);
      b.addEventListener("pointercancel", up);
      b.addEventListener("pointerleave", up);
      right.append(b);
    };
    mk("JUMP", Button.Jump, 32, 120);
    mk("PULSE", Button.Fire, 110, 32);
  }

  /** One command for the next fixed tick. */
  sample(tick: number): InputCommand {
    const k = this.keys;
    let mx = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    let mz = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    if (this.stickX !== 0 || this.stickY !== 0) {
      mx = this.stickX;
      mz = this.stickY;
    }
    let buttons = this.mouseButtons | this.touchButtons;
    for (const code of k) buttons |= KEY_BUTTONS[code] ?? 0;
    return { seq: ++this.seq, tick, moveX: mx, moveZ: mz, yaw: this.look.yaw, buttons };
  }

  dispose(): void {
    for (const fn of this.cleanup.splice(0)) fn();
  }
}
