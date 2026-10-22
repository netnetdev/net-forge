// The agent guides ship next to dist/ (llms.txt, llms-full.txt). Resolved
// relative to this module so it works from src/ (tests) and dist/ (published).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function readGuide(full: boolean): string {
  return readFileSync(join(pkgRoot, full ? "llms-full.txt" : "llms.txt"), "utf8");
}

/** One section of llms-full.txt by heading keyword (e.g. "Phaser"), or the whole file. */
export function guideSection(topic?: string): string {
  const text = readGuide(true);
  if (!topic) return text;
  const parts = text.split(/\n(?=## )/);
  const hit = parts.filter((p) => p.split("\n")[0]?.toLowerCase().includes(topic.toLowerCase()));
  return hit.length > 0 ? hit.join("\n") : text;
}
