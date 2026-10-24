# @netforge/engine-sim

The deterministic shared simulation of the Net Forge game engine: one TypeScript module that runs the same way in the browser (client prediction) and on a room server (authority).

It holds a bitECS world, Rapier physics (the deterministic WebAssembly build), a fixed tick, a kinematic character controller, sequence-numbered input commands and binary, quantized, delta-capable snapshots. It has no DOM, no timers, no network and no chain reads, and compiles with `lib: ES2022` only.

## Install

```sh
npm install @netforge/engine-sim
```

Node 20 or later, or any modern browser.

## Example

```ts
import { initSim, createWorld, addPlayer, step, captureState, encodeSnapshot, Button } from "@netforge/engine-sim";

await initSim();                                   // once per process (loads the Rapier WASM)
const world = createWorld({ tickRate: 30, seed: 7, enemies: { target: 2000 } });
addPlayer(world, 1);

// One fixed tick, with every player's input for that tick.
const { tick, events } = step(world, new Map([[1, { seq: 1, tick: 0, moveX: 0, moveZ: 1, yaw: 0, buttons: Button.Fire }]]));

const bytes = encodeSnapshot(captureState(world)); // a full snapshot; pass a baseline for a delta
```

Real rigid-body physics on the same deterministic build:

```ts
import { initSim, createPhysics, restorePhysics } from "@netforge/engine-sim";

await initSim();
const phys = createPhysics({ tickRate: 30, gravity: [0, -20, 0] });
phys.addStaticBox([30, 0.5, 30], [0, -0.5, 0]);
const hero = phys.addCharacter({ position: [0, 1, 0], dashTicks: 6, coyoteTicks: 5 });
const { events, characters } = phys.step(new Map([[hero, { moveX: 1, moveZ: 0, jump: false, dash: false }]]));
const copy = restorePhysics(phys.snapshot());      // bit-identical when stepped the same way
```

## Key API

Everything is exported from the package root. Types and constants live in `src/api.ts`.

- **Ticks**: `step(world, inputs)` advances exactly one tick of `1 / tickRate` seconds and never reads a clock. `FixedStepper` turns wall-clock deltas into a tick count plus a render `alpha`.
- **Inputs**: `InputCommand { seq, tick, moveX, moveZ, yaw, buttons }`. `quantizeInput` makes client and server consume bit-identical inputs. `encodeInput` is 15 bytes (`INPUT_BYTES`); `encodeInputs` packs several. A player missing from `inputs` gets a neutral command.
- **State**: `captureState(world, include?)` returns integer-only state sorted by `netId` (`include` is the interest-management filter). `applyState` reproduces it exactly. `encodeSnapshot(state, baseline?)`, `decodeSnapshot(bytes, baseline)` and `snapshotBaseTick(bytes)` handle full and delta snapshots.
- **Rendering**: `renderView(world)` returns dense typed arrays (`netId`, `kind`, positions, yaw and their previous-tick values) for interpolation without touching the ECS.
- **Content mode**: enemy types, self-firing weapons, XP gems, level-up choices, passives, co-op downed and revive, dash and corpses for horde games (`spawnEnemy`, `resetRun`, `listPlayers`, `revivePlayer`, `grantUpgrade` and more).
- **Arena mode**: twin-stick movement, loadouts, PvP, respawns and a lag-compensation seam (`beamShot`, `arenaHitboxes`, `applyBeamHit`).
- **Physics**: `createPhysics()` and `restorePhysics(bytes)`: bodies, layers (`Layer`, `layerMask`), contact and trigger events, ray and shape queries, CCD, joints, knockback, a full character motor and `stateHash()`.
- **Platform mode**: `createPlatformWorld` and `platformStep` for the side-view platformer.
- **Kart mode**: `createKartWorld` and `kartStep` for arcade kart racing.

## Determinism

The same module and the same Rapier build (`@dimforge/rapier3d-deterministic-compat`) run on both sides, entities iterate in `netId` order, the PRNG lives in the state, and state is quantized every tick. On one JavaScript engine the same inputs give the same snapshot bytes (tested over 1,000 ticks). Across engines `Math.sin` and `Math.cos` may differ in the last bit; the server is authoritative and clients reconcile.

## Who uses it

Game code does not import this package. Templates and room hosts do, through `@netforge/engine` (whose `@netforge/engine/game` entry compiles a declared game into this simulation). Use it directly to build a new template or a custom host.

## Docs

- https://forge.netnet.capital/docs/packages/engine-sim
- `llms.txt` (summary for agents) and `llms-full.txt` (the full reference with every public type and its doc comments) in this package

## License

MIT. See `LICENSE` and `NOTICE`.
