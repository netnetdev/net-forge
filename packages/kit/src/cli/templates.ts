// What `kit add` writes. Kept small: one config file, one bootstrap module
// next to the entry point, and two lines in the entry (or one script tag).

import type { KitProjectConfig } from "../config.js";
import { KIT_VERSION } from "../version.js";

export const GEN_START = "// <kit:generated>";
export const GEN_END = "// </kit:generated>";
export const ENTRY_MARKER = "// netnet-kit";
export const BOOTSTRAP_BASENAME = "netnet";
export const CDN_URL = `https://cdn.jsdelivr.net/npm/@netforge/kit@${KIT_VERSION}/+esm`;
export const DOCS_URL = `https://cdn.jsdelivr.net/npm/@netforge/kit@${KIT_VERSION}/llms.txt`;

function union(ids: string[]): string {
  return ids.length === 0 ? "never" : ids.map((i) => JSON.stringify(i)).join(" | ");
}

/** The block `kit sync` rewrites from netnet.config.json. */
export function generatedBlock(config: KitProjectConfig, ts: boolean): string {
  const store = config.store.map((s) => ({ id: s.id, kind: s.kind, ...(s.priceUsdg ? { priceUsdg: s.priceUsdg } : {}), ...(s.priceToken ? { priceToken: s.priceToken } : {}), ...(s.duration ? { duration: s.duration } : {}) }));
  const lines = [
    `${GEN_START} from netnet.config.json by \`npx @netforge/kit sync\`. Do not edit inside this block.`,
    `export const GAME = ${JSON.stringify(config.game)};`,
    `export const REFEREE = ${config.referee ? JSON.stringify(config.referee) : "undefined"};`,
  ];
  if (ts) {
    lines.push(`export type EarnEvent = ${union(config.earn.map((e) => e.id))};`);
    lines.push(`export type SkuId = ${union(config.store.map((s) => s.id))};`);
    lines.push(`export const STORE = ${JSON.stringify(store)} as const;`);
  } else {
    lines.push(`export const EARN_EVENTS = ${JSON.stringify(config.earn.map((e) => e.id))};`);
    lines.push(`export const STORE = ${JSON.stringify(store)};`);
  }
  lines.push(GEN_END);
  return lines.join("\n");
}

/** Replace the generated block in an existing bootstrap. */
export function replaceGenerated(source: string, block: string): string | null {
  const start = source.indexOf(GEN_START);
  const end = source.indexOf(GEN_END);
  if (start < 0 || end < start) return null;
  return source.slice(0, start) + block + source.slice(end + GEN_END.length);
}

/** Bootstrap for bundler projects (Vite, React, Phaser, three.js). */
export function bundlerBootstrap(config: KitProjectConfig, ts: boolean): string {
  const t = (typed: string, plain: string) => (ts ? typed : plain);
  return `// NetNet Kit bootstrap, written by \`npx @netforge/kit add\`.
// Edit freely outside the generated block. Guide for agents: ${DOCS_URL}
import { kit } from "@netforge/kit";

${generatedBlock(config, ts)}

// Mock mode runs everything with no chain: set VITE_NETNET_KIT_MOCK=1, or open the page with ?kit=mock.
const env = ${t("(import.meta as { env?: Record<string, string | undefined> }).env", "import.meta.env")};
const MOCK = env?.VITE_NETNET_KIT_MOCK === "1" || (typeof location !== "undefined" && new URLSearchParams(location.search).get("kit") === "mock");

/** Call once when the game opens. One chain read, then none until the player transacts. */
export function startKit() {
  return kit.init({ game: GAME, mock: MOCK, referee: REFEREE, store: STORE });
}

/** Report an earn event where the player earns it, e.g. earn("${config.earn[0]?.id ?? "level_complete"}"). The referee decides the payout. */
let noticed = false;
export function earn(event${t(": EarnEvent", "")}, n = 1) {
  return kit.earn.report({ event, n }).then((r) => {
    // "Rewards need a verified build.": this game earns no tokens (the referee decides; see llms.txt).
    if (r.notice && !noticed) {
      noticed = true;
      console.info("[netnet-kit]", r.notice);
    }
    return r;
  }).catch((err${t(": unknown", "")}) => {
    console.warn("[netnet-kit]", err);
    return null;
  });
}

export { kit };
`;
}

/** Bootstrap for a static page (plain HTML, Godot, Unity, Emscripten exports). */
export function htmlBootstrap(config: KitProjectConfig): string {
  return `// NetNet Kit bootstrap, written by \`npx @netforge/kit add\`.
// Edit freely outside the generated block. Guide for agents: ${DOCS_URL}
import { kit } from "${CDN_URL}";

${generatedBlock(config, false)}

// Mock mode runs everything with no chain: open the page with ?kit=mock.
const MOCK = new URLSearchParams(location.search).get("kit") === "mock";

/** One chain read when the page opens, then none until the player transacts. */
export function startKit() {
  return kit.init({ game: GAME, mock: MOCK, referee: REFEREE, store: STORE });
}

/** Report an earn event where the player earns it, e.g. netnetEarn("${config.earn[0]?.id ?? "level_complete"}"). */
let noticed = false;
export function earn(event, n = 1) {
  return kit.earn.report({ event, n }).then((r) => {
    // "Rewards need a verified build.": this game earns no tokens (the referee decides; see llms.txt).
    if (r.notice && !noticed) {
      noticed = true;
      console.info("[netnet-kit]", r.notice);
    }
    return r;
  }).catch((err) => {
    console.warn("[netnet-kit]", err);
    return null;
  });
}

// Classic scripts and engine bridges (Godot JavaScriptBridge, Unity .jslib) reach the Kit here.
window.kit = kit;
window.netnetEarn = earn;
startKit();
`;
}

/** Lines added to a bundler entry, right after its imports. */
export function entryLines(): string {
  return `import { startKit } from "./${BOOTSTRAP_BASENAME}"; ${ENTRY_MARKER}\nvoid startKit(); ${ENTRY_MARKER}\n`;
}

export const HTML_TAG = `<script type="module" src="./${BOOTSTRAP_BASENAME}.js"></script>`;

export function defaultConfig(game: string, name: string | undefined, earnId: string, earnLabel: string): KitProjectConfig {
  return {
    $schema: `https://cdn.jsdelivr.net/npm/@netforge/kit@${KIT_VERSION}/netnet.config.schema.json`,
    game,
    ...(name ? { name } : {}),
    store: [],
    earn: [{ id: earnId, label: earnLabel }],
  };
}
