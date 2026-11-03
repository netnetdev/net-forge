// src/names.json, the labels file next to game.ts, as the template client's
// names module: the template's own names.ts with the creator's labels in
// place of its tables. The labels are data written as JSON literals, so
// nothing in the file can execute.

export interface Names {
  readonly title: string;
  readonly weapons: Readonly<Record<string, { readonly name: string; readonly line: string }>>;
  readonly upgrades: Readonly<Record<string, { readonly name: string; readonly line: string }>>;
  readonly enemies: Readonly<Record<string, string>>;
  readonly rules: Readonly<Record<string, string>>;
  readonly skus: Readonly<Record<string, string>>;
  /** Overrides for the fixed HUD labels (keys in HUD_KEYS); unset ones keep the template's. */
  readonly hud: Readonly<Record<string, string>>;
}

const ID = /^[a-z][a-z0-9_]{0,47}$/;
const label = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 40;

/** The fixed HUD readouts a game may rename (the rest of its labels come from the tables above). */
const HUD_KEYS = ["lives", "enemies", "gold", "wave", "nextWave"] as const;

function hudTable(v: unknown): Record<string, string> {
  if (v === undefined) return {};
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("src/names.json hud must be an object");
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) {
    if (!(HUD_KEYS as readonly string[]).includes(k)) throw new Error(`src/names.json hud.${k}: unknown HUD label (use ${HUD_KEYS.join(", ")})`);
    if (!label(x)) throw new Error(`src/names.json hud.${k}: not a label (1 to 40 characters)`);
    out[k] = (x as string).trim();
  }
  return out;
}

function table<T>(v: unknown, ok: (x: unknown) => x is T, what: string): Record<string, T> {
  if (v === undefined) return {};
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`src/names.json ${what} must be an object`);
  const out: Record<string, T> = {};
  for (const [k, x] of Object.entries(v)) {
    if (!ID.test(k)) throw new Error(`src/names.json ${what}.${k}: ids are lower case letters, digits and _`);
    if (!ok(x)) throw new Error(`src/names.json ${what}.${k}: not a label (1 to 40 characters)`);
    out[k] = x;
  }
  return out;
}

const named = (x: unknown): x is { name: string; line: string } => {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return label(o.name) && label(o.line) && Object.keys(o).length === 2;
};

/** Parses src/names.json; throws with the first problem. */
export function parseNames(text: string): Names {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`src/names.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("src/names.json must be an object");
  const o = raw as Record<string, unknown>;
  if (!label(o.title)) throw new Error("src/names.json title: 1 to 40 characters");
  return {
    title: o.title.trim(),
    weapons: table(o.weapons, named, "weapons"),
    upgrades: table(o.upgrades, named, "upgrades"),
    enemies: table(o.enemies, label, "enemies"),
    rules: table(o.rules, label, "rules"),
    skus: table(o.skus, label, "skus"),
    hud: hudTable(o.hud),
  };
}

/** The names module: everything the template's names.ts exports, with these labels in place of its tables. */
export function namesModule(n: Names, templateNamesPath: string): string {
  const j = (v: unknown) => JSON.stringify(v);
  return [
    `import { HUD as HUD_BASE } from ${j(templateNamesPath)};`,
    `export * from ${j(templateNamesPath)};`,
    `export const TITLE = ${j(n.title)};`,
    `export const WEAPON_NAMES = ${j(n.weapons)};`,
    `export const UPGRADE_NAMES = ${j(n.upgrades)};`,
    `export const ENEMY_NAMES = ${j(n.enemies)};`,
    `export const RULE_NAMES = ${j(n.rules)};`,
    `export const SKU_NAMES = ${j(n.skus)};`,
    // Merge over the template's defaults so an unset HUD label keeps its original.
    `export const HUD = { ...HUD_BASE, ...${j(n.hud)} };`,
    "",
  ].join("\n");
}
