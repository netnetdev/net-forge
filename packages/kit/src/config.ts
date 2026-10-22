// netnet.config.json: the one file that describes a game's economy to the
// Kit's tooling (CLI, MCP server, doctor). Plain data, so a CLI and an agent
// can both edit it safely. No addresses ever go in it: per-game contracts are
// looked up on GameFactory by the slug.
//
// Dependency-free on purpose: this module ships in browser bundles too.

export const CONFIG_FILE = "netnet.config.json";

/** Game slug: the id on GameFactory and in play.netnet.capital/g/<slug>. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/;
/** SKU, earn-rule and spend-reason ids: fit in bytes32 as ASCII. */
export const ID_RE = /^[a-z][a-z0-9_]{1,30}$/;
/** A decimal amount in whole units, e.g. "0.50" or "10". */
export const DECIMAL_RE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export type StoreItemKind = "consumable" | "permanent" | "pass";

export interface StoreItemConfig {
  /** Stable id, lowercase snake case, max 31 characters. */
  id: string;
  /** What the player sees. */
  label: string;
  /** consumable: can be bought again and used up (revives). permanent: owned once (skins). pass: runs for `duration` seconds, buying again extends it. */
  kind: StoreItemKind;
  /** Pass length in seconds. Required for kind "pass", absent otherwise. */
  duration?: number;
  /** Price in dollars (USDG), e.g. "0.50". At least one price is required. */
  priceUsdg?: string;
  /** Price in the game's token, e.g. "10". */
  priceToken?: string;
}

export interface EarnRuleConfig {
  /** Event id the game reports, e.g. "wave_cleared". */
  id: string;
  /** Plain-language rule shown on the store page, e.g. "Clear a wave". */
  label: string;
  /** How the referee decides it, for the human reviewing the rule set. */
  description?: string;
}

export interface KitProjectConfig {
  $schema?: string;
  /** The game's slug on GameFactory. */
  game: string;
  /** Display name. */
  name?: string;
  /** Referee endpoint that signs earn attestations (the room server for engine games). */
  referee?: string;
  /** Store items (SKUs). Prices register on the game's GameVault at launch. */
  store: StoreItemConfig[];
  /** Earn rules. At least one is mandatory (cabinet-launcher.md §0.2). */
  earn: EarnRuleConfig[];
}

/** Identity helper so a hand-written config gets types. */
export function defineConfig(config: KitProjectConfig): KitProjectConfig {
  return config;
}

export interface ConfigCheck {
  config: KitProjectConfig | null;
  problems: string[];
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Validate parsed JSON. Returns every problem, not just the first. */
export function validateConfig(raw: unknown): ConfigCheck {
  const problems: string[] = [];
  if (!isRecord(raw)) return { config: null, problems: ["the config must be a JSON object"] };
  const game = raw["game"];
  if (typeof game !== "string" || !SLUG_RE.test(game)) problems.push(`"game" must be a slug (lowercase letters, digits, dashes; 3 to 32 characters), got ${JSON.stringify(game)}`);
  const referee = raw["referee"];
  if (referee !== undefined && (typeof referee !== "string" || !/^https?:\/\//.test(referee))) problems.push(`"referee" must be an http(s) URL`);

  const store: StoreItemConfig[] = [];
  const rawStore = raw["store"] ?? [];
  if (!Array.isArray(rawStore)) problems.push(`"store" must be an array`);
  else {
    const seen = new Set<string>();
    rawStore.forEach((item, i) => {
      if (!isRecord(item)) return void problems.push(`store[${i}] must be an object`);
      const { id, label, kind, priceUsdg, priceToken, duration } = item;
      if (typeof id !== "string" || !ID_RE.test(id)) problems.push(`store[${i}].id must match ${ID_RE}`);
      else if (seen.has(id)) problems.push(`store id "${id}" is duplicated`);
      else seen.add(id);
      if (typeof label !== "string" || label.trim() === "") problems.push(`store[${i}].label is required`);
      if (kind !== "consumable" && kind !== "permanent" && kind !== "pass") problems.push(`store[${i}].kind must be "consumable", "permanent" or "pass"`);
      const goodDuration = typeof duration === "number" && Number.isInteger(duration) && duration > 0;
      if (kind === "pass" && !goodDuration) problems.push(`store[${i}].duration (whole seconds) is required for a pass`);
      if (kind !== "pass" && duration !== undefined) problems.push(`store[${i}].duration only applies to kind "pass"`);
      if (priceUsdg !== undefined && (typeof priceUsdg !== "string" || !DECIMAL_RE.test(priceUsdg))) problems.push(`store[${i}].priceUsdg must be a decimal string like "0.50"`);
      if (priceToken !== undefined && (typeof priceToken !== "string" || !DECIMAL_RE.test(priceToken))) problems.push(`store[${i}].priceToken must be a decimal string like "10"`);
      if (priceUsdg === undefined && priceToken === undefined) problems.push(`store[${i}] needs priceUsdg, priceToken or both`);
      if (typeof id === "string" && typeof label === "string" && (kind === "consumable" || kind === "permanent" || kind === "pass")) {
        store.push({ id, label, kind, ...(typeof priceUsdg === "string" ? { priceUsdg } : {}), ...(typeof priceToken === "string" ? { priceToken } : {}), ...(kind === "pass" && typeof duration === "number" ? { duration } : {}) });
      }
    });
  }

  const earn: EarnRuleConfig[] = [];
  const rawEarn = raw["earn"] ?? [];
  if (!Array.isArray(rawEarn)) problems.push(`"earn" must be an array`);
  else {
    const seen = new Set<string>();
    rawEarn.forEach((rule, i) => {
      if (!isRecord(rule)) return void problems.push(`earn[${i}] must be an object`);
      const { id, label, description } = rule;
      if (typeof id !== "string" || !ID_RE.test(id)) problems.push(`earn[${i}].id must match ${ID_RE}`);
      else if (seen.has(id)) problems.push(`earn id "${id}" is duplicated`);
      else seen.add(id);
      if (typeof label !== "string" || label.trim() === "") problems.push(`earn[${i}].label is required`);
      if (description !== undefined && typeof description !== "string") problems.push(`earn[${i}].description must be a string`);
      if (typeof id === "string" && typeof label === "string") earn.push({ id, label, ...(typeof description === "string" ? { description } : {}) });
    });
  }

  if (problems.length > 0 || typeof game !== "string") return { config: null, problems };
  const config: KitProjectConfig = {
    ...(typeof raw["$schema"] === "string" ? { $schema: raw["$schema"] } : {}),
    game,
    ...(typeof raw["name"] === "string" ? { name: raw["name"] } : {}),
    ...(typeof referee === "string" ? { referee } : {}),
    store,
    earn,
  };
  return { config, problems };
}

/** Turn any name into a valid slug, for defaults. */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/^@[^/]+\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return SLUG_RE.test(s) ? s : `game-${s || "new"}`.slice(0, 32).replace(/-+$/g, "");
}
