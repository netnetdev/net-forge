// Browser and Node client for a room: asks the world service for a seat,
// connects, and wires the Colyseus room to a NetClient. Used by the Vite
// demo and the headless load bots.

import { Client, type Room } from '@colyseus/sdk';
import { DEFAULT_CLIENT, NetClient } from './client.js';
import type { SimAdapter } from './sim-adapter.js';
import {
  MSG_INPUT,
  MSG_SNAPSHOT,
  type CommandMessage,
  type CommandResult,
  type EarnMessage,
  type GameProfile,
  type RebaseMessage,
  type RunIdMessage,
  type SignInResult,
  type PotMessage,
  type StakeMessage,
  type WelcomeMessage,
} from './protocol.js';

export interface JoinParams {
  readonly endpoint: string; // http(s)://host:port
  readonly place: string;
  readonly template: string;
  readonly wallet?: string;
  /** Session token from POST /auth/sign-in. Without it the seat plays as a guest and earns nothing. */
  readonly session?: string;
  /** A guest profile id (see protocol GUEST_ID_RE): a guest's progress is saved under it. */
  readonly guest?: string;
  readonly friendRoomId?: string;
}

export interface RoomConnection<W, I> {
  readonly room: Room;
  /** The current predictor. Replaced on a rebase (new entity id), so read it each time. */
  readonly net: NetClient<W, I>;
  readonly welcome: WelcomeMessage;
  readonly roomId: string;
  /** Snapshot payload bytes received (excluding Colyseus/WS framing). */
  bytesIn(): number;
  messagesIn(): number;
  onEarn(cb: (e: EarnMessage) => void): void;
  /** Run state the room broadcasts (game-defined JSON), latest first-come. */
  onRun(cb: (info: unknown) => void): void;
  latestRun(): unknown;
  /** A fresh referee run after the game reset (new runId). */
  onRunId(cb: (m: RunIdMessage) => void): void;
  /** The room rebuilt its world at a safe point (hot swap or a new verification segment). */
  onRebase(cb: (m: RebaseMessage) => void): void;
  /** Sign in mid-session with a token from POST /auth/sign-in. */
  signIn(session: string): Promise<SignInResult>;
  /** The seat's saved progress, pushed by the room on join and whenever it changes (achievements, unlocks, goals). */
  onProfile(cb: (p: GameProfile) => void): void;
  latestProfile(): GameProfile | null;
  /**
   * The buy-in run: tell the room a stake was spent (the Kit's
   * coins.spend(amount, "stake"), committed). The room fixes the stake from
   * its own ledger at run start and answers with a 'stake' message.
   * `amount` (whole coins) counts only on a mock-store room (local play).
   */
  stake(amount?: number): void;
  /** Stake state from the room: live, waiting for the next run, closed (with its share paid), or refused. */
  onStake(cb: (m: StakeMessage) => void): void;
  latestStake(): StakeMessage | null;
  /** PvP pot: tell the room an entry was spent (coins.spend(entry, "pot")); it joins the next round's pot (taken once, at that round's start). */
  pot(): void;
  onPot(cb: (m: PotMessage) => void): void;
  /** A store hook (revive token, cosmetic); resolves with the room's verdict. */
  command(cmd: CommandMessage): Promise<CommandResult>;
  claim(): Promise<unknown>;
  leave(): Promise<void>;
}

interface JoinResponse {
  readonly roomId: string;
  readonly reason: string;
  readonly reservations: readonly Parameters<Client['consumeSeatReservation']>[0][];
}

export async function joinRoom<W, I>(sim: SimAdapter<W, I>, p: JoinParams): Promise<RoomConnection<W, I>> {
  const res = await fetch(`${p.endpoint}/world/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      place: p.place,
      template: p.template,
      ...(p.wallet ? { wallet: p.wallet } : {}),
      ...(p.session ? { session: p.session } : {}),
      ...(p.guest ? { guest: p.guest } : {}),
      ...(p.friendRoomId ? { friendRoomId: p.friendRoomId } : {}),
    }),
  });
  if (!res.ok) throw new Error(`world/join ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as JoinResponse;
  const reservation = body.reservations[0];
  if (!reservation) throw new Error('no reservation');
  return connectReservation(sim, p.endpoint, reservation);
}

export async function connectReservation<W, I>(
  sim: SimAdapter<W, I>,
  endpoint: string,
  reservation: Parameters<Client['consumeSeatReservation']>[0],
): Promise<RoomConnection<W, I>> {
  const client = new Client(endpoint);
  const room = await client.consumeSeatReservation(reservation);
  let bytes = 0;
  let msgs = 0;
  const early: Uint8Array[] = [];
  let net: NetClient<W, I> | null = null;
  room.onMessage(MSG_SNAPSHOT, (payload: Uint8Array) => {
    bytes += payload.length;
    msgs++;
    if (net) net.receiveSnapshot(payload, performance.now());
    else early.push(payload);
  });
  const earnCbs: Array<(e: EarnMessage) => void> = [];
  room.onMessage('earn', (e: EarnMessage) => earnCbs.forEach((cb) => cb(e)));
  let run: unknown = null;
  const runCbs: Array<(info: unknown) => void> = [];
  room.onMessage('run', (info: unknown) => {
    run = info;
    runCbs.forEach((cb) => cb(info));
  });
  const runIdCbs: Array<(m: RunIdMessage) => void> = [];
  room.onMessage('run-id', (m: RunIdMessage) => runIdCbs.forEach((cb) => cb(m)));
  const rebaseCbs: Array<(m: RebaseMessage) => void> = [];
  room.onMessage('rebase', (m: RebaseMessage) => {
    // Same player, possibly a new entity; seqs continue (the server's queue ignores old ones).
    if (net) net = new NetClient(sim, net.player, m.entity, (b) => room.sendBytes(MSG_INPUT, b), { ...DEFAULT_CLIENT, firstSeq: net.nextSeq });
    rebaseCbs.forEach((cb) => cb(m));
  });
  let profile: GameProfile | null = null;
  const profileCbs: Array<(p: GameProfile) => void> = [];
  room.onMessage('profile', (p: GameProfile) => {
    profile = p;
    profileCbs.forEach((cb) => cb(p));
  });
  let stakeMsg: StakeMessage | null = null;
  const stakeCbs: Array<(m: StakeMessage) => void> = [];
  room.onMessage('stake', (m: StakeMessage) => {
    stakeMsg = m;
    stakeCbs.forEach((cb) => cb(m));
  });
  let potMsg: PotMessage | null = null;
  const potCbs: Array<(m: PotMessage) => void> = [];
  room.onMessage('pot', (m: PotMessage) => {
    potMsg = m;
    potCbs.forEach((cb) => cb(m));
  });
  const signIns: Array<(r: SignInResult) => void> = [];
  room.onMessage('sign-in-result', (r: SignInResult) => signIns.shift()?.(r));
  const pending: Array<(r: CommandResult) => void> = [];
  room.onMessage('command-result', (r: CommandResult) => pending.shift()?.(r));
  room.onMessage('pong', () => undefined);
  const welcome = await new Promise<WelcomeMessage>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no welcome')), 5000);
    room.onMessage('welcome', (w: WelcomeMessage) => {
      clearTimeout(timer);
      resolve(w);
    });
  });
  const nc = new NetClient(sim, welcome.player, welcome.entity, (b) => room.sendBytes(MSG_INPUT, b));
  net = nc;
  for (const b of early) nc.receiveSnapshot(b, performance.now());
  return {
    room,
    get net(): NetClient<W, I> {
      return net ?? nc;
    },
    welcome,
    roomId: room.roomId,
    bytesIn: () => bytes,
    messagesIn: () => msgs,
    onEarn: (cb) => earnCbs.push(cb),
    onRun: (cb) => runCbs.push(cb),
    latestRun: () => run,
    onRunId: (cb) => runIdCbs.push(cb),
    onRebase: (cb) => rebaseCbs.push(cb),
    signIn: (session) =>
      new Promise<SignInResult>((resolve) => {
        signIns.push(resolve);
        room.send('sign-in', { session });
      }),
    onProfile: (cb) => {
      profileCbs.push(cb);
      if (profile) cb(profile);
    },
    latestProfile: () => profile,
    stake: (amount) => room.send('stake', amount !== undefined ? { amount } : {}),
    onStake: (cb) => {
      stakeCbs.push(cb);
      if (stakeMsg) cb(stakeMsg);
    },
    latestStake: () => stakeMsg,
    pot: () => room.send('pot', {}),
    onPot: (cb) => {
      potCbs.push(cb);
      if (potMsg) cb(potMsg);
    },
    command: (cmd) =>
      new Promise<CommandResult>((resolve) => {
        pending.push(resolve);
        room.send('command', cmd);
      }),
    claim: () =>
      new Promise((resolve) => {
        room.onMessage('attest', resolve);
        room.onMessage('attest-error', resolve);
        room.send('claim');
      }),
    leave: async () => {
      await room.leave(true);
    },
  };
}
