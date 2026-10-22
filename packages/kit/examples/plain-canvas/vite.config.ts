// Inside this repository the example runs against the Kit's source. A copy of
// this folder outside the repo installs @netnetcapital/kit from npm instead
// and can drop the alias.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      "@netnetcapital/kit": fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
    },
  },
});
