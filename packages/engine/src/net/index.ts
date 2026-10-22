/**
 * @netnetcapital/engine/net: the client half of the netcode and everything
 * the room server shares with it (game-runtime.md §6): the SimAdapter seam,
 * schema-driven bit-packed delta snapshots, sequence-numbered input packets,
 * prediction and reconciliation, interpolation, the server clock estimate,
 * the room wire protocol, and the Colyseus room client.
 *
 * Moved here from apps/rooms so templates and the Launcher can use it without
 * depending on the room server; the server-only parts (ServerCore, AoI,
 * lag-compensation rewind) stay in apps/rooms.
 */
export * from './bits.js';
export * from './schema.js';
export * from './snapshot.js';
export * from './input.js';
export * from './interpolation.js';
export * from './prediction.js';
export * from './client.js';
export * from './sim-adapter.js';
export * from './netsim.js';
export * from './protocol.js';
export * from './room-client.js';
export * from "./profile-client.js";
