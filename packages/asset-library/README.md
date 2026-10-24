# @netforge/asset-library

The CC0 game asset library of the Net Forge game engine: a manifest of real characters, creatures, vehicles, weapons, props, sprites and sounds, addressed by library id (`style.lowpoly.truck`) and never by URL, plus the shared rigs, the look composer, the example gallery and the three.js loader the templates draw with.

## Install

```sh
npm install @netforge/asset-library
```

Node 20 or later. The package ships TypeScript source (ES modules), so use it through a bundler or a TypeScript-aware runtime. The built model and sound files are a separate package, `@netforge/asset-library-files`.

## Example

```ts
import { assetById, idsForStyle, search, soundBank } from "@netforge/asset-library";

idsForStyle("lowpoly").length;                          // every stocked lowpoly id
search("lowpoly", "a ghost", 3).map((h) => h.asset.id); // ids that match a description
assetById("style.lowpoly.ghost")?.kind;                 // "creature"
const sounds = soundBank("./library");                  // { cues, music } URLs for the engine's SoundPlayer
```

Drawing a model in a template client (three.js):

```ts
import { createRenderer } from "@netforge/engine/runtime";
import { LibraryClient } from "@netforge/asset-library/three";

const handle = await createRenderer(canvas);
const lib = new LibraryClient(handle, { baseUrl: "./library" });
const hero = await lib.character("style.lowpoly.hooded_adventurer", { tint: "#ffd27a" });
scene.add(hero.root);
```

Serving the files in a Vite build:

```ts
import { assetLibrary } from "@netforge/asset-library/vite";

export default { plugins: [assetLibrary({ dir: "node_modules/@netforge/asset-library-files/library" })] };
```

## Entry points

| Import | What it holds |
|---|---|
| `@netforge/asset-library` | the manifest and lookups (`library`, `assetById`, `idsForStyle`, `search`, `referenceableIds`, `galleryFor`), looks (`resolveLook`), rigs and clips (`RIGS`, `CLIPS`, `clipFor`), paths (`assetPath`, `libraryUrl`), sounds (`soundBank`, `cueSounds`, `musicTracks`), `restyleId` and `modelGuide` |
| `@netforge/asset-library/three` | `LibraryClient` (loads through the engine's `AssetLoader` with meshopt and KTX2), `RigAnimator`, `bakeCrowd`, `prepareModel`, `proceduralAsset` |
| `@netforge/asset-library/vite` | `assetLibrary(options)`: serves the library at `./library` in dev and copies only the models a game uses into its build |
| `@netforge/asset-library/gallery` | ready-made looks per style, with a name, a line and a thumbnail |

## What is in it

| Style | Assets | Sources |
|---|---|---|
| `lowpoly` (3D) | 228 | Quaternius (animated characters, monsters, animals, dinosaurs, robots, tanks, weapons, props) and Kenney (Mini and Blocky Characters, Car, Blaster, Nature, Space, Food and City kits) |
| `pixel` (2D) | 52 | Kenney Tiny Dungeon, Pixel Platformer, Pixel Vehicle Pack |

- `toon`, `voxel`, `ps1` and `handdrawn` have a slot in the schema. A style is one JSON manifest plus its packs.
- Audio: 17 CC0 sound effects from Kenney's Impact, Interface, RPG, Sci-fi and Digital Audio packs, one per feel cue (hit, impact, kill, bigKill, hurt, levelUp, gem, coin, dash, step, land, boss, ui, pick, downed, revive, shoot), and one CC0 music loop, "Battle Theme A" by cynicmusic.
- Every asset has an id, a kind, a body plan, a rig, a pinned source with its licence page, a height, one plain description line, search tags and the aliases older drafts used.
- Shared rigs: Kenney's humanoids share one node and clip set, and Quaternius models share one naming family. Canonical clips are idle, walk, run, jump, attack, shoot, hit and die, with fallbacks.
- Appearances: a library base plus a tint, an accent, a scale and up to four parts make an original look.

Game code never imports this package. It names assets by id in `src/game.ts` (for example `prefab("shade", { model: "style.lowpoly.ghost" })`), and the template loads them.

## Docs

- https://forge.netnet.capital/docs/packages/asset-library
- `NOTICE` lists every pack, its licence and where the licence was verified.

## License

The code is MIT (see `LICENSE`). The art in the manifest is third-party work released under CC0 1.0 (see `NOTICE` and `LICENSES/`).
