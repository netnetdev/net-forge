/**
 * Top-down input for ROMPHOUSE: keyboard (WASD/arrows, Space or Shift to
 * dash, 1/2/3 to pick an upgrade), a gamepad (left stick, A dash, X/Y/B
 * picks, rumble on hits) and touch (a nipplejs stick anywhere on the left
 * of the screen, a dash button; upgrade cards are tapped in the HUD).
 *
 * The sim's input frame: yaw 0, so moveX is +x (screen right) and moveZ is
 * -z (screen up). Upgrade picks are held for two ticks so the sim sees the
 * press edge even if a tick is skipped.
 */
import { Button, keeperButtons } from "@netforge/engine-sim";
import type { InputCommand } from "@netforge/engine-sim";

export class PartyInput {
  private readonly keys = new Set<string>();
  private stickX = 0;
  private stickY = 0;
  private dashHeld = false;
  private choice = -1;
  private choiceTicks = 0;
  /** Reroll or skip pressed (Button.Reroll / Button.Skip), held for two ticks like a pick. */
  private extra = 0;
  private extraTicks = 0;
  private readonly cleanup: (() => void)[] = [];
  readonly touch: boolean;
  private pad: Gamepad | null = null;

  constructor(private readonly root: HTMLElement) {
    this.touch = globalThis.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in globalThis;
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
      this.keys.add(e.code);
      if (e.code === "Digit1" || e.code === "Numpad1") this.pick(0);
      if (e.code === "Digit2" || e.code === "Numpad2") this.pick(1);
      if (e.code === "Digit3" || e.code === "Numpad3") this.pick(2);
      if (e.code === "KeyR") this.reroll();
      if (e.code === "KeyX") this.skip();
    };
    const up = (e: KeyboardEvent) => this.keys.delete(e.code);
    const blur = () => this.keys.clear();
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("blur", blur);
    this.cleanup.push(() => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
      removeEventListener("blur", blur);
    });
    if (this.touch) void this.bindTouch();
  }

  /** Take upgrade offer k (0..2) on the next ticks (keys, card taps, gamepad). */
  pick(k: number): void {
    this.choice = k;
    this.choiceTicks = 2;
  }

  /** Press dash for the next ticks (the downed screen's Get up button). */
  getUp(): void {
    this.extra = Button.Sprint;
    this.extraTicks = 2;
  }

  /** Reroll the open cards (one per run). */
  reroll(): void {
    this.extra = Button.Reroll;
    this.extraTicks = 2;
  }

  /** The keeper to play (held on every tick; the sim takes it at the start of a run). -1: none. */
  keeper = -1;
  /** The end screen's "Play again" vote, held until the next run starts. */
  ready = false;

  /** Skip the open cards for a small heal. */
  skip(): void {
    this.extra = Button.Skip;
    this.extraTicks = 2;
  }

  private async bindTouch(): Promise<void> {
    const nipple = await import("nipplejs");
    const zone = document.createElement("div");
    zone.className = "stick-zone";
    this.root.append(zone);
    const sticks = nipple.create({ zone, mode: "dynamic", color: "rgba(255,200,120,0.8)", size: 120 });
    sticks.on("move", (evt) => {
      this.stickX = evt.data.vector.x;
      this.stickY = evt.data.vector.y;
    });
    sticks.on("end", () => {
      this.stickX = 0;
      this.stickY = 0;
    });
    const dash = document.createElement("button");
    dash.className = "dash-button";
    dash.textContent = "DASH";
    dash.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.dashHeld = true;
    });
    const release = () => {
      this.dashHeld = false;
    };
    dash.addEventListener("pointerup", release);
    dash.addEventListener("pointercancel", release);
    dash.addEventListener("pointerleave", release);
    this.root.append(dash);
    this.cleanup.push(() => {
      sticks.destroy();
      zone.remove();
      dash.remove();
    });
  }

  private readPad(): { x: number; y: number; buttons: number } | null {
    const pads = navigator.getGamepads?.() ?? [];
    this.pad = null;
    for (const p of pads) if (p && p.connected) this.pad = p;
    const p = this.pad;
    if (!p) return null;
    const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : v);
    let buttons = 0;
    if (p.buttons[0]?.pressed || p.buttons[5]?.pressed) buttons |= Button.Sprint;
    if (p.buttons[2]?.pressed) this.pick(0);
    if (p.buttons[3]?.pressed) this.pick(1);
    if (p.buttons[1]?.pressed) this.pick(2);
    return { x: dz(p.axes[0] ?? 0), y: -dz(p.axes[1] ?? 0), buttons };
  }

  /** Controller rumble (Gamepad API), when a pad that supports it is connected. */
  rumble(strength: number, ms: number): void {
    const act = (this.pad as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null)?.vibrationActuator;
    void act?.playEffect?.("dual-rumble", { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }).catch(() => undefined);
  }

  /** One command for the next fixed tick. */
  sample(tick: number): InputCommand {
    const k = this.keys;
    let mx = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    let my = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    let buttons = 0;
    if (k.has("Space") || k.has("ShiftLeft") || k.has("ShiftRight") || this.dashHeld) buttons |= Button.Sprint;
    const pad = this.readPad();
    if (pad) {
      if (pad.x !== 0 || pad.y !== 0) {
        mx = pad.x;
        my = pad.y;
      }
      buttons |= pad.buttons;
    }
    if (this.stickX !== 0 || this.stickY !== 0) {
      mx = this.stickX;
      my = this.stickY;
    }
    if (this.extraTicks > 0) {
      buttons |= this.extra;
      this.extraTicks--;
    }
    if (this.choiceTicks > 0) {
      buttons |= Button.Choice1 << this.choice;
      this.choiceTicks--;
    }
    if (this.keeper >= 0) buttons |= keeperButtons(this.keeper);
    if (this.ready) buttons |= Button.Ready;
    return { seq: 0, tick, moveX: mx, moveZ: my, yaw: 0, buttons };
  }

  dispose(): void {
    for (const f of this.cleanup.splice(0)) f();
  }
}
