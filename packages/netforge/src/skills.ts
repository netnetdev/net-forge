// The Agent Skills shipped in this package (skills/<name>/SKILL.md).

import { cpSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The package's skills folder (next to dist/ and src/). */
export function skillsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
}

export interface SkillInfo {
  readonly name: string;
  readonly description: string;
}

export function listSkills(): SkillInfo[] {
  const root = skillsDir();
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((d) => existsSync(join(root, d, "SKILL.md")))
    .sort()
    .map((d) => {
      const text = readFileSync(join(root, d, "SKILL.md"), "utf8");
      const field = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(text)?.[1]?.trim() ?? "";
      return { name: field("name") || d, description: field("description") };
    });
}

/** Copies every skill folder into `to`; returns the folders copied. */
export function copySkills(to: string): string[] {
  const root = skillsDir();
  const out: string[] = [];
  for (const s of readdirSync(root)) {
    if (!existsSync(join(root, s, "SKILL.md"))) continue;
    cpSync(join(root, s), join(to, s), { recursive: true });
    out.push(join(to, s));
  }
  return out;
}
