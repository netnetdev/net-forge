/**
 * @netnetcapital/engine/net: the client half of the netcode and everything
 * the room server shares with it: the SimAdapter seam,
 * schema-driven bit-packed delta snapshots, sequence-numbered input packets,
 * prediction and reconciliation, interpolation, the server clock estimate,
 * the room wire protocol, and the Colyseus room client.
 *
 * It lives in the engine so templates and the Net Forge site can use it
 * without depending on the room server; the server-only parts (ServerCore,
 * AoI, lag-compensation rewind) stay in the hosted Net Forge room server.
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
