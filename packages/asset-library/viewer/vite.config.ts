import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { assetLibrary } from "../src/vite.js";

// The library viewer (dev tool): serves the built library at /library.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [assetLibrary({ copy: false })],
  server: { port: 5480, strictPort: true },
});
