/**
 * @netforge/engine/rules: the board genres (tower defense, idle, card
 * battler, monster collector) on the room server's SimAdapter seam. Used by
 * the room server, the headless harness and the template clients; game code
 * declares content through @netforge/engine and never imports this.
 */
export * from "./kit.js";
export { rulesAdapter } from "./adapter.js";
export type { RulesAdapterOptions, RulesWorld } from "./adapter.js";
export { playRules } from "./harness.js";
export type { RulesPlaytest } from "./harness.js";
export { genreFor, isRulesTemplate, labelledContent } from "./genres.js";
export * from "./tower.js";
export * from "./idle.js";
export * from "./cards.js";
export * from "./collector.js";
