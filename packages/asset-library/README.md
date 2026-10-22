# @netnetcapital/asset-library

The per-style asset library of the Net Forge game engine: real CC0
characters, creatures, vehicles, weapons, props and sprites, addressed by
library id (`style.lowpoly.truck`), never by URL.

```sh
pnpm --filter @netnetcapital/asset-library fetch-packs   # download every pack from its official source into .cache
pnpm --filter @netnetcapital/asset-library test
pnpm --filter @netnetcapital/asset-library viewer  # contact sheets at http://localhost:5480/?style=lowpoly
CHROME_BIN=... pnpm --filter @netnetcapital/asset-library shoot -- thumbs   # gallery thumbnails
```

The optimized library (`.glb`/`.png` files, thumbnails and `index.json`) is
built by the Net Forge asset pipeline, which is not part of this package.
The built files ship as `@netnetcapital/asset-library-files`; copy its
`library/` folder to `packages/asset-library/.library` to use the viewer and
`shoot` here, or pass that folder as `dir` to the Vite plugin.

## What is in git, and what is not

- In git: `manifest/` (packs with licence and verification, one JSON per
  style, the gallery), `NOTICE`, `LICENSES/`, the fetch script, and a
  three-file fixture subset in `fixtures/`.
- Not in git: `.cache/` (pack archives and source files) and `.library/`
  (optimized `.glb`/`.png`, thumbnails, `index.json`). Both are gitignored.
  After one fetch the asset pipeline rebuilds the library with no network.

## Stock today

| Style | Assets | Sources |
|---|---|---|
| `lowpoly` (3D) | 228 | Quaternius (animated characters, monsters, animals, dinosaurs, robots, tanks, weapons, props) and Kenney (Mini and Blocky Characters, Car, Blaster, Nature, Space, Food and City kits) |
| `pixel` (2D) | 52 | Kenney Tiny Dungeon, Pixel Platformer, Pixel Vehicle Pack |

`toon`, `voxel`, `ps1` and `handdrawn` have a slot in the schema and no
stock yet. A style is one JSON manifest plus its packs; nothing else changes.

Audio (`manifest/audio.json`, style `audio`): 17 CC0 sound effects from
Kenney's Impact, Interface, RPG, Sci-fi and Digital Audio packs, one per
FeelKit cue (hit, impact, kill, bigKill, hurt, levelUp, gem, coin, dash,
step, land, boss, ui, pick, downed, revive, shoot), and one CC0 music loop,
"Battle Theme A" by cynicmusic
(https://opengameart.org/content/battle-theme-a). Same rules as models:
licence verified per pack, bytes pinned by sha256, files only in `.cache`
and `.library` (`.library/audio/<sfx|music>/<name>.<ogg|mp3>`). `soundBank(base)`
turns it into the cue -> URL map the engine's `SoundPlayer` loads; each
entry's `gain` is its default mix level.

## Pieces

- **Manifest** (`src/schema.ts`, `manifest/*.json`): every asset has an id,
  kind, body plan, rig, source (archive path or pinned per-file URL with its
  licence page), height, one plain line for the model, search tags, and the
  aliases older drafts used. Variants (`monster_truck` = the truck on big
  wheels) and procedural pickups (gems, cells) are entries too.
- **Shared rigs** (`src/rigs.ts`): Kenney's humanoids share one node set and
  clip set; Quaternius models share one naming family. Canonical clips are
  idle, walk, run, jump, attack, shoot, hit, die, with fallbacks; body plans
  (biped, quadruped, flyer, blob, wheeled, static) drive crowd motion.
- **Appearances** (`src/look.ts`, engine `src/api/appearance.ts`): the internal composer
  the builder uses to turn a description into an original: a library base,
  a tint that shifts the palette, an accent, a scale, and up to four parts.
  Creators never see it; they describe or pick from the gallery.
- **Gallery** (`manifest/gallery.ts`, plain data Net Forge bundles): ready-made looks per style with a
  name, a line and a thumbnail; Net Forge's "pick a starting look".
- **Runtime** (`src/three/`): `LibraryClient` loads through the engine's
  `AssetLoader` (meshopt, KTX2), prepares models (face -z, scale, tint,
  parts), animates characters with the engine's `AnimatedCharacter` through
  the shared rigs (`RigAnimator`), and bakes crowds into static parts the
  engine's `AnimatedCrowd` animates (bob, waddle, squash, flash). Baking real
  clips into VAT crowds (`bakeVertexAnimation`) is the next step.
- **Build plugin** (`src/vite.ts`): serves `.library` at `./library` in dev
  and copies only the models a game uses into its build.
