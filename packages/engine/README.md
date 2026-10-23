# @netforge/engine

The client side of the Net Forge game engine.

Two entry points, on purpose:

| Import | Who uses it | What it holds |
|---|---|---|
| `@netforge/engine` | generated game code (the model) | `game`, `prefab`, `system`, `earn`, `store`, `engine.test.run`: declarative, Zod-validated, no DOM, no renderer, no netcode |
| `@netforge/engine/runtime` | templates, the Net Forge shell, the demo | three.js renderer (WebGPU, WebGL2 fallback), `InstancedCrowd`, `CameraRig`, `InputController` (keyboard/mouse, nipplejs touch), `AssetLoader` (glTF + meshopt + KTX2), `ArenaClient`, `SystemScheduler`, `collectManifest` |

A game module never reaches the renderer, netcode or physics.
Bad declarations throw `GameDefinitionError` with one actionable line per
issue, e.g. `model: reference assets by library id (e.g. "style.lowpoly.bat"), never by URL or path`.

## Status (Template 1)

- Declarations, validation, manifest cross-checks and the tick-based
  `SystemScheduler`, plus `weapon()`, `upgrade()`, pickup prefabs, bosses,
  and systems' `alive()`, `on(event)`, `respawnDead()`, `end(outcome)`.
- `@netforge/engine/game` runs a declared game on engine-sim:
  `compileGame` (manifest to sim content), `GameRunner` (systems on a run
  clock, game events, run phases), `EarnTracker`, the engine-sim
  `SimAdapter` (`engineSimAdapter`, wire schema `engineSchema`) and a
  playtest bot. `engine.test.run` plays the declared game when there is one
  (kills, waves, levels, earn by rule, softlock, ms/tick).
- `@netforge/engine/net` is the client half of the netcode (the server
  half runs in the hosted Net Forge room server): prediction and reconciliation, interpolation, delta
  snapshots with per-kind fields, input packets, client clock adjustment
  for one-input-per-tick sims, the wire protocol and the Colyseus room client.
- `AssetLoader` is built but no template uses it yet (Template 1 art is
  procedural, see packages/template-survivor/client/library.ts).

## Status (Template 2, the arena shooter)

- `game({ template: "arena", arena, round, players: { loadout, bots,
  respawn, drop } })`, weapon kinds `blaster` (with `spread`) and `beam`,
  and `emit(event, players?)` for crediting chosen players.
- `compileGame` builds the yard (floor, pillars, spawns) and the arena
  rules; it refuses survivor weapons in an arena and arena weapons in a
  survivor game, with a line the model can act on.
- `GameRunner` adds the round clock and frag limit (a round is a run),
  `opponent.killed` / `player.died` / `round.top` / `round.finished`
  events, kills and deaths per player, a kill feed in `RunInfo`, and seat
  bots (`players.bots`) that fill empty seats while a human is present and
  never earn. Killing a bot scores and shows in the feed but pays no earn
  rule, and `round.top` pays only when another person was in the round
  (both arrive as unpaid events, and so does anything a system emits while
  handling one). Bots play through `arenaBotInput` (game/arena-bot.ts), a pure
  function of the present, so a room's run replays exactly.
- `engineSimAdapter` gives arena games the lag-compensation hooks the room
  server's core already calls (`hitscans`, `hitboxes`, `applyHit`), runs
  the client without authority, and grants store upgrades by name.
- `engine.test.run` plays arena games with the bots and reports kills,
  deaths, rounds, `topScore` and `scorers`.
- The registry seals a game once its manifest is collected, so one process
  (the room server) can load several game modules in turn.

## Board genres (`@netforge/engine/rules`)

Tower defense, idle, card battler and monster collector do not run on
engine-sim's action world. Each is a deterministic rules module (integer
state, a seeded PRNG word, no clocks) behind the same `SimAdapter` seam,
so the room server, the netcode, the referee, run verification, the store,
the stake and losable gear are the ones every template uses.

- `RulesGenre<S>` (rules/kit.ts): `create`, `join`, `act` (a player's
  validated action), `step` (one tick), `outcome`, `view(state, player)`
  (what that player may see: hidden hands stay hidden), `entities` (moving
  things, interpolated on the client) and the genre's own bot.
- `rulesAdapter(genre, manifest)`: earn rules per player per run
  (`EarnTracker`), seat bots that never earn, unpaid events, the late-start rule
  (world progress never pays a run that started after the world began),
  store upgrades and gear as recorded room commands capped at maxLevel,
  cosmetics, the end screen and `run.reset`. Each player's avatar (a cursor,
  a builder, a walking hero) is predicted from its own input.
- `SimAdapter.infoFor(world, player)`: run state sent to one player only
  (the room sends it when it changed, every `infoEveryTicks`).
- Declarations: each genre adds its own typed functions to this package's
  root (tower defense: `towerBoard`, `tower`, `waves`), validated by its own
  Zod schemas and stored with `declareContent`. `engine.test.run` plays a
  board genre through `playRules` and reports its own checks under
  `rules.checks`.

## Game feel kit (`runtime/feel`)

One-line components every template uses. `FeelKit` wraps them:
`hit`, `kill`, `hurt`, `levelUp`, `land`, `dash` and `footstep`, with the
presets `subtle`, `default` and `heavy`. The parts work alone too:

- `Trauma`: seeded-noise trauma shake.
- `FeelClock`: hit-stop and slow motion with a smooth catch-up; the netcode never pauses.
- `HitFlash` and `KnockbackOffsets`: flash and spring squash per entity id.
- `Spring` and `Spring3`.
- `DamageNumbers`: pooled, and merges rapid hits on one id.
- `Tweens` and `Ease`, with `pop`, `shakeEl` and `countUp` for UI.
- `FeelAudio`: procedural cues with throttles, voice limits, pan and distance falloff; `addBuffer` takes CC0 samples later. `Footsteps` alongside it.
- `Rumble`: Gamepad dual-rumble, with a `navigator.vibrate` fallback.

`CameraRig` adds `addTrauma`, `punch` (an FOV kick), a smoothed and
clamped lead and a dead zone. Its old `shake(amplitude, seconds)` still
works.

## Render pipeline (`runtime/render`)

`createRenderStack(handle, scene, camera, { preset, quality, bloom, outline })`
returns the whole pipeline. Call `stack.frame(dt, focus)` in place of
`renderer.render(scene, camera)`. It includes:

- `LightingRig`: hemisphere light plus a sun whose shadow follows the focus, texel-snapped.
- `PostFX`: bloom, colour grade, vignette and hurt pulse, tone mapping applied once, FXAA, and an optional depth outline.
- `Atmosphere`: fog and a sky gradient.
- `QualityManager`: tiers and dynamic resolution.
- `GpuParticles`: one draw, with motion on the GPU.
- `GroundDecals` and `GroundRings`.

It runs on WebGPU and on WebGL2. Animated characters:

- `AnimatedCrowd`: procedural vertex animation for instanced crowds.
- `VatCrowd` and `bakeVertexAnimation`: vertex-animation textures for skinned crowds.
- `AnimatedCharacter`: glTF skinned meshes on an `AnimationMixer` with locomotion blending.
- `buildSegmentRig`: a procedural rig for tests and demos.

The demo shows all of it with `?fx=1` (`&outline=1`, `&crowd=vat`,
`&preset=dusk`, `&quality=low`).

Game code declares the look and feel it wants: `game({ look })`,
`prefab({ feel })` and `weapon({ feel })`, validated by `lookSchema` and
`feelSchema`. See `llms.txt`.

## Demo

```sh
pnpm --filter @netforge/engine-sim build
pnpm --filter @netforge/engine demo          # http://localhost:5310
# ?enemies=2000  ?webgl=1 (force the WebGL2 backend)  ?autopilot=1 (scripted input)
```

Measure in headless Chrome (raw CDP, no puppeteer dependency):

```sh
pnpm --filter @netforge/engine demo:build
pnpm --filter @netforge/engine exec vite preview --config demo/vite.config.ts --port 5311
CHROME_BIN=/path/to/chrome node packages/engine/scripts/measure-demo.mjs "http://localhost:5311/?autopilot=1" 20 --enable-unsafe-webgpu --use-angle=metal
```

The script always launches with `--use-mock-keychain --password-store=basic`
and a throwaway profile, so it never prompts for the macOS keychain.
