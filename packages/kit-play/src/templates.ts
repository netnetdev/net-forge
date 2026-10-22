// The Net Forge templates a downloaded game can name (netnet.json
// "template"), and how local play runs each one: its package, the factory
// its manifest exports for the room sim, its manifest accessor, the room's
// seat count and what each player is sent.

import type { LocalAoi } from "./host/core.js";

export type TemplateId = "survivor" | "arena" | "tower-defense" | "dungeon" | "idle" | "platformer" | "cards" | "collector" | "racer" | "party";

export interface TemplateEntry {
  readonly id: TemplateId;
  readonly label: string;
  /** The npm package holding the template's game module (src/) and browser client (client/). */
  readonly pkg: string;
  /** The export of src/manifest.ts that builds the room sim (a SimAdapter). */
  readonly adapter: string;
  /** The export of src/manifest.ts that gives the game manifest: `fn().manifest` or `fn()`. */
  readonly manifest: { readonly fn: string; readonly field?: "manifest" };
  /** Most players one room seats. */
  readonly seats: number;
  readonly aoi: LocalAoi;
}

/** engine-sim entity kinds: player 1, enemy 2, projectile 3, pickup 4. */
const K = { player: 1, enemy: 2, projectile: 3, pickup: 4 } as const;

const crowd = (radius: number, enemies: number): LocalAoi => ({
  radius,
  maxEntities: enemies + 140,
  kindCaps: { [K.enemy]: enemies, [K.pickup]: 60, [K.projectile]: 80 },
  alwaysKinds: [K.player],
});
const board: LocalAoi = { radius: 60, maxEntities: 400, kindCaps: { [K.enemy]: 240 }, alwaysKinds: [K.player] };
const race = (radius: number): LocalAoi => ({ radius, maxEntities: 16, alwaysKinds: [K.player] });

export const TEMPLATES: Readonly<Record<TemplateId, TemplateEntry>> = {
  survivor: { id: "survivor", label: "survivor-like co-op", pkg: "@netnetcapital/template-survivor", adapter: "survivorAdapter", manifest: { fn: "survivorGame", field: "manifest" }, seats: 4, aoi: crowd(40, 250) },
  arena: { id: "arena", label: "arena shooter", pkg: "@netnetcapital/template-arena", adapter: "arenaAdapter", manifest: { fn: "arenaGame", field: "manifest" }, seats: 16, aoi: { radius: 34, maxEntities: 260, kindCaps: { [K.projectile]: 140, [K.pickup]: 40, [K.enemy]: 60 }, alwaysKinds: [K.player] } },
  "tower-defense": { id: "tower-defense", label: "tower defense", pkg: "@netnetcapital/template-tower", adapter: "towerAdapter", manifest: { fn: "towerManifest" }, seats: 4, aoi: board },
  dungeon: { id: "dungeon", label: "co-op dungeon crawl", pkg: "@netnetcapital/template-dungeon", adapter: "dungeonAdapter", manifest: { fn: "dungeonGame", field: "manifest" }, seats: 4, aoi: crowd(36, 140) },
  idle: { id: "idle", label: "idle", pkg: "@netnetcapital/template-idle", adapter: "idleAdapter", manifest: { fn: "idleManifest" }, seats: 8, aoi: board },
  platformer: { id: "platformer", label: "platformer", pkg: "@netnetcapital/template-platformer", adapter: "platformerAdapter", manifest: { fn: "platformerGame", field: "manifest" }, seats: 8, aoi: race(200) },
  cards: { id: "cards", label: "card battler", pkg: "@netnetcapital/template-cards", adapter: "cardsAdapter", manifest: { fn: "cardsManifest" }, seats: 2, aoi: board },
  collector: { id: "collector", label: "monster collector", pkg: "@netnetcapital/template-collector", adapter: "collectorAdapter", manifest: { fn: "collectorManifest" }, seats: 8, aoi: board },
  racer: { id: "racer", label: "kart racer", pkg: "@netnetcapital/template-racer", adapter: "racerAdapter", manifest: { fn: "racerGame", field: "manifest" }, seats: 8, aoi: race(400) },
  party: { id: "party", label: "party co-op", pkg: "@netnetcapital/template-party", adapter: "partyAdapter", manifest: { fn: "partyGame", field: "manifest" }, seats: 8, aoi: crowd(40, 200) },
};

/** netnet.json's template field (the room template names are accepted too). */
export function templateFor(name: unknown): TemplateEntry | null {
  if (typeof name !== "string") return null;
  const alias: Readonly<Record<string, TemplateId>> = { shooter: "arena", tower: "tower-defense" };
  const id = (alias[name] ?? name) as TemplateId;
  return Object.prototype.hasOwnProperty.call(TEMPLATES, id) ? TEMPLATES[id] : null;
}
