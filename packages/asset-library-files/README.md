# @netforge/asset-library-files

The built CC0 asset files of the Net Forge game engine: optimized models, sprites, textures and sounds addressed by library id (`style.lowpoly.truck`), with `library/index.json` mapping ids to files. `kit play` (`@netforge/kit-play`) serves them to a game running on your own computer.

## Install

```sh
npm install @netforge/asset-library-files
```

You rarely install it yourself: `@netforge/kit-play` depends on it.

## Example

```ts
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const libraryDir = join(dirname(require.resolve("@netforge/asset-library-files/package.json")), "library");
// libraryDir/index.json maps library ids to files; serve the folder as ./library
```

The folder can be passed as `dir` to the Vite plugin in `@netforge/asset-library/vite`, or to `kit play --library-url` when it is hosted on a mirror.

## What is in it

- `library/`: the optimized `.glb` and `.png` files, thumbnails, sounds and `index.json`.
- `NOTICE`: every pack, its author and where its licence was verified.
- `CC0-1.0.txt`: the CC0 1.0 dedication.

Every file is third-party art released under CC0 1.0 (Quaternius, Kenney, Screaming Brain Studios, cynicmusic). The package has no JavaScript.

## Docs

- https://forge.netnet.capital/docs/packages/asset-library-files
- `@netforge/asset-library` holds the manifest, the lookups and the three.js loader for these files.

## License

The package is MIT (see `LICENSE`). The art itself is CC0 1.0 (see `CC0-1.0.txt` and `NOTICE`): you may use it for anything, with no attribution required.
