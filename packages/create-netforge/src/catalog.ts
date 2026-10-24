// The ten Net Forge templates a new game can start from. Each one is a
// published package (@netforge/template-*) holding the game module, its
// browser client and its playtest bots; the starter copies only its
// src/game.ts and llms.txt and installs the package for the rest.
//
// Ids match netnet.json "template" and @netforge/kit-play's TEMPLATES.

export type StarterId = "survivor" | "arena" | "tower-defense" | "dungeon" | "idle" | "platformer" | "cards" | "collector" | "racer" | "party";

export interface Starter {
  readonly id: StarterId;
  /** The template's own game, shown in lists. */
  readonly title: string;
  /** The genre, in plain words. */
  readonly genre: string;
  /** One sentence on what the game is. */
  readonly line: string;
  /** Most players one room seats. */
  readonly seats: number;
  /** The npm package holding the template. */
  readonly pkg: string;
  /** Its folder in the source repository (packages/<dir>). */
  readonly dir: string;
}

const s = (id: StarterId, title: string, genre: string, seats: number, dir: string, line: string): Starter => ({ id, title, genre, seats, dir, pkg: `@netforge/${dir}`, line });

/** In the order the picker shows them. */
export const STARTERS: readonly Starter[] = [
  s("survivor", "EMBERWATCH", "survivor-like co-op", 4, "template-survivor", "Hold a field at night against a swarm that grows every wave. Weapons fire by themselves and you pick upgrades as you level."),
  s("arena", "VOLTYARD", "arena shooter", 16, "template-arena", "Rounds of beam combat with loadouts, and bots that fill the empty seats."),
  s("tower-defense", "COGSPIRE", "tower defense", 4, "template-tower", "Build and upgrade towers on a shared board while the waves march in."),
  s("dungeon", "CRYPTWICK", "co-op dungeon crawl", 4, "template-dungeon", "Fight through procedural rooms, collect loot and survive a permadeath run."),
  s("idle", "BRINEWORKS", "idle", 8, "template-idle", "Pump brine, boil salt and cut crystals on a shared flat to fill a contract together."),
  s("platformer", "SKYLEDGE", "platformer", 8, "template-platformer", "Race to the flag over cliffside courses with dashes, springs and moving platforms."),
  s("cards", "INKWRIT", "card battler", 2, "template-cards", "Duel one against one or against the AI, with a draft between duels."),
  s("collector", "MOSSBOUND", "monster collector", 8, "template-collector", "Catch spirits in a shared marsh, battle turn by turn with a team of three and bring down the warden."),
  s("racer", "TORQUEBAY", "kart racer", 8, "template-racer", "Kart races on harbour circuits with drift boosts, boost pads, coins and laps."),
  s("party", "ROMPHOUSE", "party co-op", 8, "template-party", "Two to eight friends in one playroom, five quick minigame rounds a show."),
];

/** Other names people type for a template. */
const ALIASES: Readonly<Record<string, StarterId>> = {
  survivors: "survivor",
  horde: "survivor",
  shooter: "arena",
  io: "arena",
  tower: "tower-defense",
  towers: "tower-defense",
  td: "tower-defense",
  crawler: "dungeon",
  card: "cards",
  "card-game": "cards",
  monsters: "collector",
  kart: "racer",
  racing: "racer",
  platform: "platformer",
};

/** The starter a name means: an id, an alias, a title or a package name, any case. */
export function findStarter(name: string): Starter | null {
  const n = name.trim().toLowerCase();
  const id = ALIASES[n] ?? n.replace(/^@netforge\/template-/, "").replace(/^template-/, "");
  const byId = STARTERS.find((t) => t.id === id || t.dir === `template-${id}`);
  return byId ?? STARTERS.find((t) => t.title.toLowerCase() === n) ?? null;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j] ?? 0;
      row[j] = Math.min(cur + 1, (row[j - 1] ?? 0) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length] ?? 0;
}

/** The closest template id to a mistyped name, or null when nothing is close. */
export function suggestStarter(name: string): StarterId | null {
  const n = name.trim().toLowerCase();
  let best: { id: StarterId; d: number } | null = null;
  for (const t of STARTERS) {
    for (const candidate of [t.id, t.title.toLowerCase()]) {
      const d = candidate.startsWith(n) && n.length >= 2 ? 0 : distance(n, candidate);
      if (!best || d < best.d) best = { id: t.id, d };
    }
  }
  return best && best.d <= Math.max(2, Math.floor(n.length / 3)) ? best.id : null;
}
