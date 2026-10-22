import { Button } from "../src/index.js";
import type { InputCommand, PlayerId, TickInputs } from "../src/index.js";

/** Scripted, seeded input stream: wandering movement, turning, jumps, pulses, sprint. */
export function scriptedInputs(players: readonly PlayerId[], seed: number) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
    t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  };
  const seq = new Map<PlayerId, number>();
  const yaw = new Map<PlayerId, number>();
  return (tick: number): TickInputs => {
    const m = new Map<PlayerId, InputCommand>();
    for (const p of players) {
      const n = (seq.get(p) ?? 0) + 1;
      seq.set(p, n);
      const y = (yaw.get(p) ?? 0) + (rnd() - 0.5) * 0.3;
      yaw.set(p, y);
      let buttons = 0;
      if (rnd() < 0.05) buttons |= Button.Jump;
      if (rnd() < 0.2) buttons |= Button.Fire;
      if (rnd() < 0.3) buttons |= Button.Sprint;
      m.set(p, { seq: n, tick, moveX: rnd() * 2 - 1, moveZ: rnd() * 1.5 - 0.3, yaw: y, buttons });
    }
    return m;
  };
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A small survivor-style content set: three enemy types (one boss), three weapons, two passives. */
export const CONTENT_CONFIG = {
  seed: 5,
  enemies: { target: 0 },
  content: {
    enemyTypes: [
      { health: 10, speed: 3.5, radius: 0.35, damage: 5, xp: 1 },
      { health: 30, speed: 2.5, radius: 0.5, damage: 10, xp: 5 },
      { health: 2000, speed: 2.2, radius: 1.6, damage: 25, xp: 50, boss: true, mass: 20 },
    ],
    weapons: [
      { kind: "nova", damage: 8, cooldownTicks: 30, range: 4, count: 1, speed: 0, pierce: 0, knockback: 4, maxLevel: 8 },
      { kind: "bolt", damage: 12, cooldownTicks: 20, range: 14, count: 1, speed: 22, pierce: 1, knockback: 2, maxLevel: 8 },
      { kind: "orbit", damage: 6, cooldownTicks: 1, range: 2.2, count: 2, speed: 4, pierce: 0, knockback: 3, maxLevel: 8 },
    ],
    stats: [
      { stat: "speed", step: 0.08, maxLevel: 5 },
      { stat: "maxHealth", step: 20, maxLevel: 5 },
    ],
    progression: { xpBase: 3, xpGrowth: 2 },
  },
} as const;

/** Inputs that also press upgrade choices and dash now and then. */
export function contentInputs(players: readonly PlayerId[], seed: number) {
  const base = scriptedInputs(players, seed);
  return (tick: number): TickInputs => {
    const m = new Map<PlayerId, InputCommand>();
    for (const [p, cmd] of base(tick)) {
      let buttons = cmd.buttons & ~(Button.Fire | Button.Jump);
      if ((tick + p) % 17 === 0) buttons |= Button.Choice1 << (p % 3);
      if ((tick + p) % 41 === 0) buttons |= Button.Sprint;
      m.set(p, { ...cmd, yaw: 0, buttons });
    }
    return m;
  };
}
