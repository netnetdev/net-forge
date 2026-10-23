/**
 * The room connection for a board template: join by link, an input clock
 * that sends one input a tick (the server consumes one a tick), the avatar
 * predicted from it, and actions queued so each rides exactly one input.
 */
import { guestId, joinRoom, savedSession } from "@netforge/engine/net";
import type { RoomConnection } from "@netforge/engine/net";
import type { RulesInput, RulesWorld } from "@netforge/engine/rules";
import { IDLE_INPUT } from "@netforge/engine/rules";
import type { SimAdapter } from "@netforge/engine/net";

export interface BoardJoin {
  readonly endpoint: string;
  readonly place: string;
  readonly template: string;
  readonly friendRoomId?: string;
}

export type BoardConnection<S> = RoomConnection<RulesWorld<S>, RulesInput>;

/** Joins the room (saves under the signed-in wallet or this browser's guest id). */
export async function joinBoard<S>(adapter: SimAdapter<RulesWorld<S>, RulesInput>, j: BoardJoin): Promise<{ conn: BoardConnection<S>; joinMs: number }> {
  const t0 = performance.now();
  const session = savedSession(j.endpoint);
  const conn = await joinRoom(adapter, {
    endpoint: j.endpoint,
    place: j.place,
    template: j.template,
    guest: guestId(),
    ...(session ? { session: session.token } : {}),
    ...(j.friendRoomId ? { friendRoomId: j.friendRoomId } : {}),
  });
  return { conn, joinMs: performance.now() - t0 };
}

/**
 * One input a tick, on the server's clock (clock adjustment from the
 * snapshot headers). The cursor and the stick are sampled each tick; an
 * action waits in a queue and rides the next tick's input, one per tick.
 */
export class InputClock {
  private stickX = 0;
  private stickZ = 0;
  private cursorX = 0;
  private cursorZ = 0;
  private readonly queue: { act: number; a: number; b: number; c: number }[] = [];
  ticks = 0;
  /** Actions sent so far. */
  sent = 0;
  private timer = 0;

  constructor(
    private readonly conn: () => BoardConnection<unknown>,
    /** An autopilot input (playtest and measure), or null to play from the queue. */
    private readonly auto: ((tick: number) => RulesInput | null) | null = null,
  ) {}

  /** Stick, -1..1 each axis (walking heroes). */
  stick(x: number, z: number): void {
    this.stickX = Math.max(-1, Math.min(1, x));
    this.stickZ = Math.max(-1, Math.min(1, z));
  }

  /** Cursor on the ground, metres. */
  cursor(x: number, z: number): void {
    this.cursorX = x;
    this.cursorZ = z;
  }

  /** Queue an action (sent on the next tick). */
  act(act: number, a = 0, b = 0, c = 0): void {
    if (this.queue.length < 16) this.queue.push({ act, a, b, c });
  }

  private sample(): RulesInput {
    const auto = this.auto?.(this.ticks) ?? null;
    if (auto) return auto;
    const q = this.queue.shift();
    return {
      ...IDLE_INPUT,
      mx: Math.round(this.stickX * 127),
      mz: Math.round(this.stickZ * 127),
      cx: Math.round(this.cursorX * 16),
      cz: Math.round(this.cursorZ * 16),
      ...(q ? { act: q.act, a: q.a, b: q.b, c: q.c } : {}),
    };
  }

  start(): void {
    let next = performance.now();
    this.timer = window.setInterval(() => {
      const now = performance.now();
      let n = 0;
      const c = this.conn();
      while (next <= now && n < 8) {
        const i = this.sample();
        if (i.act !== 0) this.sent++;
        c.net.tick(i, now);
        this.ticks++;
        next += c.net.tickIntervalMs();
        n++;
      }
      if (n === 8) next = now + c.net.tickIntervalMs();
    }, 4);
  }

  stop(): void {
    clearInterval(this.timer);
  }
}

/** The room server: ?server=, else VITE_ROOMS_URL, else this host on :2567. */
export function roomsEndpoint(params: URLSearchParams): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return params.get("server") ?? env.VITE_ROOMS_URL ?? `${location.protocol}//${location.hostname}:2567`;
}
