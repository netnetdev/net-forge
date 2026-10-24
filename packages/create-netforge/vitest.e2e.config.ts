import { defineConfig } from "vitest/config";

// The end-to-end run: packs the local packages, scaffolds from the tarballs
// offline, installs, and plays two templates in headless Chrome. Minutes, not
// seconds, so it is not part of `pnpm test`.
export default defineConfig({ test: { include: ["test/e2e/**/*.test.ts"], testTimeout: 540_000, hookTimeout: 540_000, fileParallelism: false } });
