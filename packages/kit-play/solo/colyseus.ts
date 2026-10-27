// A stand-in for @colyseus/sdk in solo demo builds: the engine's room
// client (connectReservation) uses `new Client(endpoint)`,
// `consumeSeatReservation`, and the room's onMessage / send / sendBytes /
// leave. Here they go to the in-browser room host instead of a WebSocket,
// so the engine and the template client run unchanged.

import * as bridge from "./bridge.js";
import type { MessageType } from "./protocol.js";

type Handler = (data: unknown) => void;

export class Room {
  roomId = "";
  sessionId = "";
  name = "solo";
  private session = "";
  private readonly handlers = new Map<MessageType, Set<Handler>>();
  private readonly any = new Set<(type: MessageType, data: unknown) => void>();
  /** Messages that arrived before anyone listened for their type, delivered when a listener comes. */
  private readonly unheard = new Map<MessageType, unknown[]>();
  private readonly leaveCbs = new Set<(code: number) => void>();
  private left = false;

  /** @internal */
  async attach(token: string): Promise<void> {
    const { roomId, session } = await bridge.open(
      token,
      (type, data) => this.deliver(type, data),
      () => this.closed(1000),
    );
    this.roomId = roomId;
    this.session = session;
    this.sessionId = session;
  }

  private deliver(type: MessageType, data: unknown): void {
    const hs = this.handlers.get(type);
    this.any.forEach((cb) => cb(type, data));
    if (hs && hs.size > 0) hs.forEach((h) => h(data));
    else if (this.any.size === 0) {
      const list = this.unheard.get(type) ?? [];
      if (list.length < 64) list.push(data);
      this.unheard.set(type, list);
    }
  }

  private closed(code: number): void {
    if (this.left) return;
    this.left = true;
    this.leaveCbs.forEach((cb) => cb(code));
  }

  onMessage(type: MessageType, cb: Handler): () => void;
  onMessage(type: "*", cb: (type: MessageType, data: unknown) => void): () => void;
  onMessage(type: MessageType, cb: Handler | ((type: MessageType, data: unknown) => void)): () => void {
    if (type === "*") {
      const f = cb as (type: MessageType, data: unknown) => void;
      this.any.add(f);
      return () => this.any.delete(f);
    }
    const f = cb as Handler;
    let hs = this.handlers.get(type);
    if (!hs) this.handlers.set(type, (hs = new Set()));
    hs.add(f);
    const waiting = this.unheard.get(type);
    if (waiting) {
      this.unheard.delete(type);
      queueMicrotask(() => waiting.forEach((d) => f(d)));
    }
    return () => hs.delete(f);
  }

  send(type: MessageType, message?: unknown): void {
    if (!this.left) bridge.send(this.session, type, message);
  }

  sendBytes(type: number, bytes: Uint8Array | ArrayLike<number>): void {
    if (this.left) return;
    bridge.sendBytes(this.session, type, bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
  }

  onLeave(cb: (code: number) => void): () => void {
    this.leaveCbs.add(cb);
    return () => this.leaveCbs.delete(cb);
  }

  onError(_cb: (code: number, message?: string) => void): () => void {
    return () => undefined;
  }

  onStateChange(_cb: (state: unknown) => void): () => void {
    return () => undefined;
  }

  removeAllListeners(): void {
    this.handlers.clear();
    this.any.clear();
    this.leaveCbs.clear();
  }

  async leave(_consented = true): Promise<number> {
    if (!this.left) {
      bridge.leave(this.session);
      this.closed(1000);
    }
    return 1000;
  }
}

interface Reservation {
  readonly sessionId: string;
}

export class Client {
  constructor(readonly endpoint: string) {}

  async consumeSeatReservation(reservation: Reservation): Promise<Room> {
    const room = new Room();
    await room.attach(reservation.sessionId);
    return room;
  }

  async joinOrCreate(): Promise<Room> {
    throw new Error("the solo demo seats players through /world/join only");
  }

  async join(): Promise<Room> {
    return this.joinOrCreate();
  }

  async create(): Promise<Room> {
    return this.joinOrCreate();
  }

  async joinById(): Promise<Room> {
    return this.joinOrCreate();
  }

  async reconnect(): Promise<Room> {
    return this.joinOrCreate();
  }
}

export default { Client, Room };
