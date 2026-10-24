// Removes dist/ and starters/ before a build, so nothing stale is packed.
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const d of ["dist", "starters"]) rmSync(join(root, d), { recursive: true, force: true });
