import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  build: { outDir: fileURLToPath(new URL("./dist", import.meta.url)), emptyOutDir: true, target: "es2022" },
  server: { port: 5312 },
});
