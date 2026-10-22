// prepublishOnly guard for @netnetcapital/kit in the public source repo:
// refuses to publish while src/registry.generated.ts still holds a
// PLACEHOLDER address. The registry is synced from NetNet's canonical
// address registry upstream and arrives here with the export; it is never
// edited by hand.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const file = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "registry.generated.ts");
const placeholders = readFileSync(file, "utf8")
  .split("\n")
  .filter((l) => l.includes('status: "PLACEHOLDER"'))
  .map((l) => l.trim().split(":")[0]);
if (placeholders.length > 0) {
  console.error(`@netnetcapital/kit: the address registry still has PLACEHOLDER entries (${placeholders.join(", ")}). Publish after they are verified upstream.`);
  process.exit(1);
}
