# @netnetcapital/asset-library

The per-style asset library of the game runtime (`specs/game-runtime.md` §10):
real CC0 characters, creatures, vehicles, weapons, props and sprites,
addressed by library id (`style.lowpoly.truck`), never by URL.

```sh
pnpm --filter @netnet/assets library              # fetch once, then optimize into packages/asset-library/.library
pnpm --filter @netnet/assets library -- --offline  # rebuild from the cache, no network
pnpm --filter @netnet/assets library -- --publish  # pin and mirror to the hosted CDN; prints VITE_LIBRARY_URL
pnpm --filter @netnetcapital/asset-library test
pnpm --filter @netnetcapital/asset-library viewer  # contact sheets at http://localhost:5480/?style=lowpoly
CHROME_BIN=... pnpm --filter @netnetcapital/asset-library shoot -- thumbs   # gallery thumbnails
```

## What is in git, and what is not

- In git: `manifest/` (packs with licence and verification, one JSON per
  style, the gallery), `NOTICE`, `LICENSES/`, the fetch script, and a
  three-file fixture subset in `fixtures/`.
- Not in git: `.cache/` (pack archives and source files) and `.library/`
  (optimized `.glb`/`.png`, thumbnails, `index.json`). Both are gitignored.
  After one fetch everything builds and runs offline.

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

## Brand: token logos and covers (`./brand`)

Every game gets a coin logo and a 3:4 cover drawn from its own library art, with no image vendor. `src/brand/` plans them (pure JSON, deterministic per seed), the page in `brand/` draws them in headless Chrome, and `./brand/node` drives that page over a DevTools pipe (no port, a throwaway profile, every request answered from memory).

```ts
import { brandInputFromGame, checkUpload, shownBrand, withGenerated, withUpload } from "@netnetcapital/asset-library/brand";
import { BrandRenderer, generateGameBrand, regenerateBrand } from "@netnetcapital/asset-library/brand/node";

const input = brandInputFromGame(gameTs, { title, ticker, prompt, names });
const r = await BrandRenderer.open({ chromeBin: process.env.CHROME_BIN! });
const { logo, cover } = await generateGameBrand(r, input);          // the defaults (seed 0)
const next = await regenerateBrand(r, input, "logo", logo.choice);  // the next option; pinned template or subject kept
await r.close();
```

Net Forge stores the files, keeps a `GameBrandState` per game and shows `shownBrand(state, kind)`: an upload (checked with `checkUpload`) always wins over the generated asset until the creator removes it. `brandOptions(input)` lists the templates and subjects for a regenerate menu. Each art style plugs in through one row of `STYLE_BRAND` in `src/brand/styles.ts`; a style without stock falls back to lowpoly models under its own treatment.

Proof sheet: `CHROME_BIN=... pnpm --filter @netnetcapital/asset-library brand -- --out <dir>` writes every logo size, every cover and `contact-sheet.png`.

### Key art (`planKeyArt`, `src/brand/draw/keyart.ts`)

Covers, hero banners and the art-style cards are key art, not gameplay frames: a staged scene planned from the game's own game.ts (the playable hero up front in an action pose, the signature foe beside them, the crowd charging out of the fog, the boss or the place's landmarks behind, its scenery and lights around them), rendered through the engine's own render stack in the plan's art style (that style's lighting, fog, grade, bloom and post, exactly as its games draw), then finished in 2D with atmosphere and the title lockup. Deterministic per seed; `planKeyArt(input, { style })` re-renders the same scene in another style.

```sh
CHROME_BIN=... pnpm --filter @netnetcapital/asset-library keyart -- --out <dir> --gpu          # proof set: hero, cover and card per game
CHROME_BIN=... pnpm --filter @netnetcapital/asset-library keyart -- --launcher --gpu --ss 2    # the Launcher's featured art and style cards, in place
```

`drawBrand(r, input, "cover" | "hero", choice)` draws a draft's key art (900x1200 and 1920x1080) for the generator.
