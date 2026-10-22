# @netnetcapital/engine-sim

The shared simulation of the NetNet game runtime (`specs/game-runtime.md` §4).
One TypeScript module that runs the same way in the browser (client
prediction) and on the room server (authority): a bitECS world, Rapier
physics (the deterministic WebAssembly build), a fixed tick, a kinematic
character controller, sequence-numbered input commands and binary,
quantized, delta-capable snapshots.

No DOM, no timers, no network, no chain reads. The package compiles with
`lib: ES2022` only.

## Public API

Everything is exported from the package root. Types live in `src/api.ts`.

```ts
import {
  initSim, createWorld, destroyWorld, addPlayer, removePlayer, step,
  quantizeInput, encodeInput, decodeInput, encodeInputs, decodeInputs,
  captureState, applyState, encodeSnapshot, decodeSnapshot, snapshotBaseTick,
  renderView, playerNetId, lastProcessedSeq, FixedStepper,
  Button, EntityKind, DEFAULT_TICK_RATE,
} from "@netnetcapital/engine-sim";

await initSim();                         // once per process (Rapier WASM)
const world = createWorld({ tickRate: 30, seed: 7, enemies: { target: 2000 } });
addPlayer(world, 1);

// THE API: one fixed tick, all players' inputs for that tick.
const { tick, events } = step(world, new Map([[1, { seq: 1, tick: 0, moveX: 0, moveZ: 1, yaw: 0, buttons: Button.Fire }]]));
```

### Ticks

- `step(world, inputs)` advances exactly one fixed tick of `1 / tickRate`
  seconds. It never reads a clock. Systems run in the spec's order: input,
  AI, physics, combat, pickups, spawners, game rules, lifetime.
- `FixedStepper` turns wall-clock deltas into a tick count plus a render
  `alpha`. It is clock-free too, so the client drives it from
  `requestAnimationFrame` and the server from its own loop.

### Inputs

- `InputCommand { seq, tick, moveX, moveZ, yaw, buttons }`. `seq` increases
  per player; `step` records the last consumed `seq` as that player's `ack`
  in the state, which is what client reconciliation keys on.
- Every command is quantized on entry (`quantizeInput`: moves to 1/127, yaw
  to a u16 turn), so the predicting client and the authoritative server
  consume bit-identical inputs.
- `encodeInput` is 15 bytes. `encodeInputs` packs several (send the last
  few unacked commands in every packet to ride out loss).
- A player missing from `inputs` gets a neutral command for that tick.

### State and snapshots

- `captureState(world, include?)` returns a `SimState`: integers only
  (positions and velocities in 1/1024 m fixed point, yaw as a u16 turn),
  entities sorted by `netId`. `include` is the interest-management hook:
  pass a filter per client.
- The sim snaps its own state onto that grid at the end of every tick, so
  `applyState(world, captureState(other))` reproduces `other` exactly and
  both worlds keep stepping identically.
- `encodeSnapshot(state)` is a full snapshot; `encodeSnapshot(state, baseline)`
  is a delta against a state the receiver already acknowledged. Fields are
  zigzag varints of the difference from the baseline (a full snapshot is a
  delta against nothing), with a per-entity changed-field mask, so a resting
  entity costs about 3 bytes and a walking one about 8.
- `snapshotBaseTick(bytes)` tells the receiver which baseline a delta needs;
  `decodeSnapshot(bytes, baseline)` throws if the wrong one is passed.

### Rendering

`renderView(world)` returns dense typed arrays (`netId`, `kind`, `x/y/z`,
`yaw`, and `prevX/prevY/prevZ/prevYaw` from the previous tick) so the
renderer interpolates with the stepper's `alpha` without touching the ECS.

## Determinism

Practical, as the spec asks (§4): the same module and the same Rapier
build (`@dimforge/rapier3d-deterministic-compat`, cross-platform
determinism enabled) on both sides, entity iteration in `netId` order, a
seeded PRNG in the state, and state quantized every tick. On one engine
the same inputs give the same snapshot bytes (tested over 1,000 ticks).
Across JavaScript engines `Math.sin/cos` may differ in the last bit; the
server is authoritative and clients reconcile, so that is acceptable.

## What the week-2 world contains

A walled square arena with cylindrical pillars (`DEFAULT_ARENA`), player
characters on Rapier's kinematic character controller (walk, sprint, jump
with coyote time and a jump buffer, Fire = radial pulse), and an enemy
spawner that keeps `enemies.target` chasers alive on a ring around the
players. Enemies steer in the ECS (seek the nearest player, separate from
neighbours on a uniform grid, slide off pillars and players); they are not
Rapier bodies, which keeps 2,000 of them at about 2.5-3.5 ms a tick in
Node on a laptop. Navmesh steering (`recast-navigation-js`) replaces the
seek when templates need it.

## Scripts

```sh
pnpm --filter @netnetcapital/engine-sim test
pnpm --filter @netnetcapital/engine-sim typecheck
pnpm --filter @netnetcapital/engine-sim bench   # step cost at 2,000 and 4,000 enemies
```

## Content mode (Template 1)

When the config lists `content.weapons`, the world runs the genre
machinery templates build on instead of the arena rules above:

- **Enemy types** (`content.enemyTypes`): health, speed, radius, contact
  damage, XP, boss, mass. `spawnEnemy(world, type, x, z)` spawns one; the
  game runner (packages/engine/src/game) drives waves.
- **Weapons fire by themselves**: `nova` (hits everything in range when an
  enemy is near), `bolt` (projectiles at the nearest enemy, piercing),
  `orbit` (blades circling the player, `orbitAngle` is exported so
  renderers draw them where the sim hits). Level scaling: +25% damage a
  level, an extra projectile or blade every second level, -6% cooldown.
- **XP gems** drop from kills (capped by `progression.maxPickups`; past it
  XP goes straight to the killer) and are pulled in by a magnet radius.
- **Level-ups** offer three upgrades (`choices` field) drawn from a hash of
  (seed, netId, level), not the world PRNG, so a predicting client agrees
  with the server. `Button.Choice1..3` take one.
- **Passives** (`content.stats`): speed, maxHealth, magnet, might, haste,
  regen, armor.
- **Co-op downed and revive**: at zero health a player is downed and bleeds
  out; a teammate standing within `coop.reviveRadius` revives them; bled-out
  players are out until `respawnDead`. `revivePlayer` is the paid revive.
- **Dash** on `Button.Sprint` with invulnerability and an input buffer
  (`coop.dashBufferTicks`): a press just before the cooldown ends still dashes.
- **Corpses**: a killed enemy keeps its NetId for `coop.corpseTicks` with
  `EntityFlag.Dead`, so clients see it die instead of vanish.
- Run control: `resetRun`, `listPlayers`, `enemyCount`, `entityHealth`,
  `setCosmetic`, `spawnRingPoint`, `simRandom`.

Snapshot version 2 carries the new per-entity fields. Determinism, capture
and apply in content mode are tested (`test/content.test.ts`); the bench
reports 4 players and 2,000 enemies at about 1.5 ms a tick.

## Arena mode (Template 2)

`content.arena.enabled` turns content mode into the arena shooter's
machinery (src/arena.ts), on the same fields and snapshot format:

- **Twin-stick**: `moveX`/`moveZ` move in the world frame, `yaw` is the aim.
- **Loadouts** (`progression.loadout`, up to 4 weapons in the packed
  `weapons` slots; the selected slot rides in `choices & 3`).
  `Button.Choice1..3` pick a slot, `Button.Alt` cycles, `Button.Fire`
  fires the selected weapon when its cooldown is ready: `blaster`
  (projectiles fanned over `spread`, swept against players so nothing
  tunnels, stopped by pillars), `beam` (hitscan, clamped by pillars and
  walls with `beamRange`), `nova` (a blast around you).
- **PvP**: players hurt each other (no self damage); at zero health a
  player is killed (`player.killed` with `by`), drops a heal pickup, waits
  `arena.respawnTicks` and respawns at the spawn point farthest from every
  opponent (`arenaSpawn`) with `arena.spawnIframeTicks` of protection that
  firing ends.
- **Authority**: `arena.authority` is false on a predicting client, which
  then predicts only its own movement, aim, weapon choice and cooldowns
  (no projectiles, hits or respawns of its own).
- **Lag compensation seam**: with `arena.externalHitscan` (room servers),
  human beams are not resolved in `step`; the room asks `beamShot(world,
  player, cmd)` before the step, rewinds `arenaHitboxes` to what the
  shooter saw, and applies the hit with `applyBeamHit`. Bots
  (`BOT_PLAYER_BASE` and up) and the headless harness resolve beams in the
  sim against the present.
- Store upgrades: `grantUpgrade(world, player, statIndex)` adds one passive
  level for the rest of the run. `listPickups` feeds bots.

Tested in `test/arena.test.ts`: loadout and slot choice, world-frame
movement, kills and respawn, pillars stopping bolts, beams in the sim and
through the external seam, exact prediction of the shooter's own state,
and snapshot restore mid-fight.

## Physics

`createPhysics()` gives a game real rigid-body physics on the same
deterministic Rapier build, independent of the survivor world above
(`src/physics/`). Everything is keyed by a `BodyId` the wrapper assigns in
creation order and never reuses, every loop runs in BodyId order, and
events come back sorted, so the same calls on two worlds (or on a world
and its restored snapshot) give bit-identical states.

```ts
import { initSim, createPhysics, restorePhysics, Layer, layerMask } from "@netnetcapital/engine-sim";

await initSim();
const phys = createPhysics({ tickRate: 30, gravity: [0, -20, 0] });
phys.addStaticBox([30, 0.5, 30], [0, -0.5, 0]);                 // level, on Layer.Level
const crate = phys.addBody({ type: "dynamic", shape: { box: [0.4, 0.4, 0.4] }, position: [2, 1, 0], mass: 8, restitution: 0.2 });
const zone = phys.addTrigger({ box: [2, 2, 2] }, [8, 1, 0]);      // sensor: enter and exit events only
const hero = phys.addCharacter({ position: [0, 1, 0], dashTicks: 6, coyoteTicks: 5 });

const { events, characters } = phys.step(new Map([[hero, { moveX: 1, moveZ: 0, jump: false, dash: false }]]));
phys.applyKnockback(crate, [0, 0, 0], 6, { lift: 2 });         // 6 m/s away from the blast, 2 m/s up
const hit = phys.raycast([0, 1, 0], [1, 0, 0], 50, { mask: layerMask("Level", "Prop"), exclude: [hero] });
const bytes = phys.snapshot();                                  // reconcile: restorePhysics(bytes)
```

- **Bodies**: `addBody({ type: "dynamic" | "kinematic" | "static", shape, position, rotation, mass | density, friction, restitution, linearDamping, angularDamping, gravityScale, layer, mask, sensor, ccd, lockRotations, linearVelocity, angularVelocity, userData })`,
  `removeBody`, `setPosition`, `setRotation`, `setLinearVelocity`, `setAngularVelocity`, `position`, `rotation`, `velocity`, `angularVelocity`, `mass`,
  `applyImpulse` (N·s), `applyForce` (N, this step only), `applyKnockback(id, from, strength, { lift, byMass })` (a velocity change; `byMass` divides it by mass),
  `setKinematicTarget(id, pos, rot?)` for moving platforms and doors (they push dynamic bodies), `wake`, `sleep`, `isSleeping`.
  Shapes: `{ box: [hx, hy, hz] }`, `{ sphere: r }`, `{ capsule: [halfHeight, r] }`, `{ cylinder: [halfHeight, r] }`. Sugar: `addStaticBox`, `addTrigger`.
- **Layers**: `Layer.Level, Player, Enemy, Projectile, Pickup, Prop, Trigger, Debris, User1..User8` (16 bits). A body is on one layer and has a mask (default every layer). The rule is pairwise, Rapier's: two bodies touch only when EACH one's mask holds the other's layer, so both sides of a pair must agree. Queries look only at the layers in their `mask`.
- **Events** from `step()`: `contact.start`, `contact.end`, `trigger.enter`, `trigger.exit`, each `{ a, b }` with `a < b`, sorted by `(a, b, type)`.
- **Queries**: `raycast` (point, normal, distance), `raycastAll` (nearest first), `shapeCast(shape, from, dir, maxDist)`, `overlap(shape, position)`; options `mask`, `exclude`, `includeSensors`.
- **CCD**: `ccd: true` on fast bodies (bullets, thrown props). Rapier 0.21 also builds speculative contacts from velocity, so plain fast spheres already stop on static walls (tested up to 2,000 m/s); CCD adds the swept pass. Neither fully covers a thin body spinning fast, so keep projectiles round.
- **Joints**: `addJoint({ kind: "fixed" | "ball" | "hinge" | "slider", a, b, anchorA, anchorB, axis })`, `removeJoint`.
- **Character motor** (`addCharacter`): a capsule on Rapier's kinematic character controller with slopes (`maxSlopeClimb`; faces steeper than it are slid down, not stood on), steps (`stepHeight`, `stepWidth`), ground snapping (`snapToGround`), coyote time and jump buffering (ticks), variable jump height (`jumpCut` when jump is released while rising), separate ground and air acceleration (air control), `maxSpeed`, `gravityScale`, `terminalVelocity`, a dash (`dashTicks`, `dashSpeed`, `dashCooldownTicks`, `dashBufferTicks`, optional invulnerability) and pushing dynamic bodies. Input per tick is `{ moveX, moveZ, jump, dash }` in world space with held buttons (edges are found inside). `step()` returns a report per character (`grounded`, `landed`, `jumped`, `dashed`, `hitCeiling`, `groundNormal`); `characterState(id)` and `setCharacterState(id, s)` read and write the whole motor state for reconciliation. Knockback and impulses work on characters too. The default mask includes `Layer.Trigger` so triggers see characters (the motor itself ignores sensors).
- **Snapshots**: `snapshot()` is Rapier's own world snapshot plus the wrapper's ids, characters and joints; `restorePhysics(bytes)` rebuilds it, and stepping both gives the same bits. `stateHash()` hashes the raw float bits of every pose, velocity and motor state in BodyId order (equal hash, identical world); `snapshotHash()` hashes the snapshot bytes.
- `destroy()` frees the WebAssembly memory.

Rapier's scene queries only see colliders after a step, so the wrapper
runs a zero-length step (nothing moves) before a query or a step when
bodies were added, removed or teleported since the last one; that flag
rides in snapshots. Tests: `test/physics.test.ts` and
`test/physics-character.test.ts` (lockstep and replay determinism over 600
ticks, snapshot and restore mid-jump and mid-dash, CCD, layers, triggers,
contacts, ray and shape queries, restitution, friction, knockback, forces,
kinematic pushing, joints, and every motor feature).

## Platform mode (SKYLEDGE, the platformer)

`createPlatformWorld({ tickRate, levels, tuning, statSteps })` and
`platformStep(world, inputs)` (src/platform.ts) run a side-view race to the
flag in pure TypeScript: swept AABB movement against axis-aligned blocks on
a 1/1024 grid, so a predicting client replays its own climber exactly.
Coyote time, a jump buffer, variable jump height, apex hang, fall gravity,
corner nudges, an air dash, one-way ledges, moving platforms on the world
clock, springs, thorns, checkpoints and per-player coins. Climbers are
ghosts to each other. `capturePlatformPlayer` / `applyPlatformPlayer` are
the wire state. Tested in `test/platform.test.ts`.

## Kart mode (TORQUEBAY, the racer)

`createKartWorld({ tickRate, tracks, tuning, statSteps, authority })` and
`kartStep(world, inputs)` (src/kart.ts) run arcade kart physics on closed
tracks (a Catmull-Rom centreline sampled every ~2 m with a width, a grass
verge and barriers): forward and sideways velocity with grip, steering by
speed, drifts that charge a three-tier mini-turbo, boost pads, coins that
raise top speed, laps through ordered quarter checkpoints, and kart bumps
on the authority only (a predicting client leaves them out and the next
snapshot corrects). `captureKart` / `applyKart` are the wire state. Tested
in `test/kart.test.ts` (laps, drift tiers, pads, walls, bumps, upgrades,
exact replay).
