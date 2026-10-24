// The Net Forge templates an agent can start a game from. Package names,
// seat counts and the room wiring come from kit-play (the one table local
// play runs from); the titles and pitches are the templates' own.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TEMPLATES, templateFor, type TemplateId } from "@netforge/kit-play";
import { templateRoot } from "./locate.js";

export interface TemplateInfo {
  /** The id to pass to create_game and to write in netnet.json "template". */
  readonly id: TemplateId;
  /** The template's own game title. */
  readonly title: string;
  readonly genre: string;
  /** Most players one room seats. */
  readonly players: number;
  readonly pitch: string;
  /** The npm package that holds the game module, its client and its bots. */
  readonly package: string;
  /** "action" templates run on the physics sim; "board" templates run on a rules module. */
  readonly kind: "action" | "board";
  /** What the template's own src/game.ts imports from @netforge/engine: the declarations this genre uses. */
  readonly declarations: readonly string[];
}

const EXTRA: Readonly<Record<TemplateId, { title: string; pitch: string; kind: "action" | "board" }>> = {
  survivor: {
    title: "EMBERWATCH",
    kind: "action",
    pitch: "Four players hold a field at night against a swarm that grows every wave, up to 2,000 enemies at once. Weapons fire by themselves, gems level you up, and you pick one of three upgrades.",
  },
  arena: {
    title: "VOLTYARD",
    kind: "action",
    pitch: "A twin-stick arena shooter for up to 16 players. Rounds last three minutes or end at 25 kills, and bots fill empty seats.",
  },
  "tower-defense": {
    title: "COGSPIRE",
    kind: "board",
    pitch: "Up to four players build and upgrade towers on a shared board while waves crawl along a road. Hold twenty waves to win.",
  },
  dungeon: {
    title: "CRYPTWICK",
    kind: "action",
    pitch: "A co-op dungeon crawl for four. The crypt is grown from a seed with dungeon(...), rooms wake as the party nears them, and the boss waits in the deepest room.",
  },
  idle: {
    title: "BRINEWORKS",
    kind: "board",
    pitch: "Up to eight players each run a salt works: plants produce, products buy more plants, and everyone fills a shared contract. A shift lasts fifteen minutes.",
  },
  platformer: {
    title: "SKYLEDGE",
    kind: "action",
    pitch: "Up to eight players race along cliffside courses to the flag: run, jump, dash, ride moving platforms and collect coins.",
  },
  cards: {
    title: "INKWRIT",
    kind: "board",
    pitch: "A one-against-one card battler. A run is four duels with a draft of one of three cards after each.",
  },
  collector: {
    title: "MOSSBOUND",
    kind: "board",
    pitch: "A monster collector for up to eight players. Meet wild creatures in the grass, battle them turn by turn with a team of three and keep the ones worth keeping.",
  },
  racer: {
    title: "TORQUEBAY",
    kind: "action",
    pitch: "A kart racer for up to eight players: drift to charge a turbo, hit boost pads and collect coins. Bots fill the grid.",
  },
  party: {
    title: "ROMPHOUSE",
    kind: "action",
    pitch: "A party co-op for two to eight friends: five quick minigame rounds a show, each with one goal for the whole team.",
  },
};

/** The names the template's src/game.ts imports from @netforge/engine. */
function declarationsOf(pkg: string): string[] {
  const root = templateRoot(pkg);
  const file = root ? join(root, "src", "game.ts") : null;
  if (!file || !existsSync(file)) return [];
  const m = /import\s*\{([^}]*)\}\s*from\s*["']@netforge\/engine["']/.exec(readFileSync(file, "utf8"));
  return (m?.[1] ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 0 && !s.startsWith("type "));
}

export function listTemplates(): TemplateInfo[] {
  return (Object.keys(TEMPLATES) as TemplateId[]).map((id) => {
    const t = TEMPLATES[id];
    const x = EXTRA[id];
    return { id, title: x.title, genre: t.label, players: t.seats, pitch: x.pitch, package: t.pkg, kind: x.kind, declarations: declarationsOf(t.pkg) };
  });
}

export const TEMPLATE_IDS = Object.keys(TEMPLATES) as [TemplateId, ...TemplateId[]];

export { templateFor };
