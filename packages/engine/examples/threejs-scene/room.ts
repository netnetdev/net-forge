// The authoritative half of the three.js example, with no DOM and no
// renderer, so it runs in Node (the test) and in the page (main.ts).
//
// One simulation, two roles: `sim` is engine-sim's shared world wrapped as a
// SimAdapter. The Room creates it with role "server" and steps it with every
// player's queued inputs; each NetClient creates it with role "client" and
// steps the same code to predict its own player. Clients send intentions
// (move this way, face this way, these buttons), never positions.
import { EntityKind, type InputCommand } from "@netforge/engine-sim";
import { CROWD_UNITS, F, PLAYER_UNITS, engineSimAdapter } from "@netforge/engine/game";
import {
  decodeInputPacket,
  encodeSnapshot,
  DEFAULT_INPUT_QUEUE,
  InputQueue,
  NetClient,
  quantizeEntity,
  SnapshotHistory,
  VirtualNet,
  type EntityState,
  type PlayerId,
  type QEntity,
} from "@netforge/engine/net";

/** The shared simulation: Rapier physics and the ECS at a fixed 30 Hz tick. */
export const sim = engineSimAdapter({ name: "threejs-scene", version: "1", arena: { tickRate: 30 } });

/** engine-sim steps exactly one command per player per tick, so the queue hands out one at a time and holds two in reserve. */
const QUEUE = { ...DEFAULT_INPUT_QUEUE, maxCredits: 1, targetDepth: 2 };

interface Conn {
  readonly entity: number;
  readonly queue: InputQueue<InputCommand>;
  readonly history: SnapshotHistory;
  readonly send: (bytes: Uint8Array) => void;
  ackTick: number;
}

/** The authoritative side: owns the world, takes inputs, sends each player a delta snapshot. */
export class Room {
  readonly world = sim.createWorld(1, "server");
  tickN = 0;
  private readonly conns = new Map<PlayerId, Conn>();

  join(player: PlayerId, send: (bytes: Uint8Array) => void): number {
    const entity = sim.addPlayer(this.world, player);
    this.conns.set(player, { entity, queue: new InputQueue<InputCommand>(QUEUE), history: new SnapshotHistory(64), send, ackTick: 0 });
    return entity;
  }

  /** An input packet from a player: commands only, decoded and queued. */
  receive(player: PlayerId, bytes: Uint8Array): void {
    const c = this.conns.get(player);
    if (!c) return;
    const packet = decodeInputPacket(sim.input, bytes);
    if (packet.ackTick > c.ackTick && packet.ackTick <= this.tickN) c.ackTick = packet.ackTick;
    c.queue.receive(packet.commands);
  }

  /** One server tick: apply each player's next command, step, send snapshots. */
  step(): void {
    this.tickN++;
    const inputs = new Map<PlayerId, InputCommand[]>();
    for (const [player, c] of this.conns) inputs.set(player, c.queue.consume().map((cmd) => cmd.input));
    sim.step(this.world, inputs);
    const all: QEntity[] = sim.snapshot(this.world).map((e) => ({ id: e.id, kind: e.kind, owner: e.owner, q: quantizeEntity(sim.schema, e) }));
    for (const c of this.conns.values()) {
      const baseline = c.ackTick > 0 ? (c.history.get(c.ackTick) ?? null) : null;
      const header = { tick: this.tickN, baselineTick: baseline ? c.ackTick : 0, ackSeq: c.queue.lastAppliedSeq, self: c.entity, inputBuffer: c.queue.pending };
      c.send(encodeSnapshot(sim.schema, header, all, baseline));
      c.history.put(this.tickN, all);
      c.history.pruneBefore(c.ackTick);
    }
  }
}

/** A simulated network between the clients and the room: one-way latency in ms, no loss. */
export const LINK = { latencyMs: 60, jitterMs: 10, loss: 0 } as const;

export interface Session {
  readonly room: Room;
  readonly net: VirtualNet;
  readonly clients: readonly NetClient<ReturnType<typeof sim.createWorld>, InputCommand>[];
}

/** A room and `players` clients joined over the simulated network. */
export function connect(players: number): Session {
  const room = new Room();
  const net = new VirtualNet(7);
  const clients = Array.from({ length: players }, (_, i) => {
    const player = i + 1;
    const holder: { client?: NetClient<ReturnType<typeof sim.createWorld>, InputCommand> } = {};
    const entity = room.join(player, (bytes) => net.send(LINK, () => holder.client?.receiveSnapshot(bytes, net.now)));
    const client = new NetClient(sim, player, entity, (bytes) => net.send(LINK, () => room.receive(player, bytes)));
    holder.client = client;
    return client;
  });
  return { room, net, clients };
}

/** An entity's ground position in metres (players and crowd use different fixed-point units). */
export function metres(e: Pick<EntityState, "kind" | "values">): { x: number; z: number } {
  const v = e.values;
  if (e.kind === EntityKind.Player) return { x: (v[F.px] ?? 0) / PLAYER_UNITS, z: (v[F.pz] ?? 0) / PLAYER_UNITS };
  return { x: (v[F.ex] ?? 0) / CROWD_UNITS, z: (v[F.ez] ?? 0) / CROWD_UNITS };
}

/** The intention a client sends for one tick. */
export function intent(seq: number, tick: number, moveX: number, moveZ: number, yaw = 0): InputCommand {
  return { seq, tick, moveX, moveZ, yaw, buttons: 0 };
}
