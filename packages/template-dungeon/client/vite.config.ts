import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
// Relative imports: vite loads its config with Node, which cannot run the workspace package's TypeScript entry; esbuild bundles these.
import { idsForStyle } from "../../asset-library/src/library.js";
import { libraryIdsIn } from "../../asset-library/src/paths.js";
import { assetLibrary } from "../../asset-library/src/vite.js";
import { inEveryStyle } from "../../asset-library/src/restyle.js";
import { SCENE_MODELS } from "./decor.js";

const gameSource = () => readFileSync(fileURLToPath(new URL("../src/game.ts", import.meta.url)), "utf8");

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  // The asset library at ./library: served in dev, and the models game.ts and the scene use copied into the build.
  // Plus the ps1 style's surface textures (ten 128 px PNGs), so ?style=ps1 draws them in a build too.
  plugins: [assetLibrary({ ids: () => [...inEveryStyle([...libraryIdsIn(gameSource()), ...SCENE_MODELS]), ...idsForStyle("ps1").filter((id) => id.includes(".surface_"))] })],
  build: {
    outDir: fileURLToPath(new URL("../dist", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 4096,
  },
  server: { port: 5340, host: true },
  preview: { port: 5341, host: true },
});
