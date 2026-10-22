/**
 * Idle declarations (game({ template: "idle" })). The template already runs
 * the works, the production chain (pumps make brine, pans boil it into salt,
 * kilns cut crystals), buying and levelling plants, raking, the shared
 * contract, the shift clock and the referee. A game declares its flat (the
 * shift, the tending window, raking, the chain's ratios, the contract) and
 * its plants.
 *
 *   saltFlat({ shift: 900, tend: 120, start: 20, rake: { salt: 3, cooldown: 0.4 }, contract: { crystals: 60 } });
 *   plant("hand_pump", { model: "style.lowpoly.barrel", kind: "pump", cost: 15, growth: 1.15, rate: 2 });
 *
 * Production runs only on the room's ticks while the player is in the room
 * and has tended the works within `tend` seconds: there is no offline
 * production and nothing a client reports counts.
 */
import { z } from "zod";
import { contentOf, declareContent } from "./registry.js";
import type { GameManifest } from "./registry.js";
import { assetIdSchema, GameDefinitionError, idSchema, parseOrThrow } from "./schemas.js";

/** The shortest shift (seconds): earn rules pay once a shift, so this bounds what one seat can earn an hour. */
export const IDLE_MIN_SHIFT = 600;
/** The longest tending window (seconds): a works nobody touches for this long stops. */
export const IDLE_MAX_TEND = 300;

export const saltFlatSchema = z
  .object({
    /** Seconds in a shift. The shift ends for everyone, the end screen shows, a new shift starts from nothing. */
    shift: z.number().min(IDLE_MIN_SHIFT, `a shift is at least ${IDLE_MIN_SHIFT} seconds (earn pays once a shift)`).max(3600),
    /** Seconds the works keep running after the player last tended them (raked, bought, shipped). */
    tend: z.number().min(30).max(IDLE_MAX_TEND, `the works stop at most ${IDLE_MAX_TEND} seconds after the last tend`).default(120),
    /** Salt (kg) each player starts a shift with. */
    start: z.number().min(0).max(10_000).default(20),
    /** Raking: salt (kg) a rake brings in, and seconds between rakes. */
    rake: z.object({ salt: z.number().min(0.1).max(1000), cooldown: z.number().min(0.2).max(10) }).strict().default({ salt: 3, cooldown: 0.4 }),
    /** Litres of brine a pan boils into one kg of salt. */
    brinePerSalt: z.number().min(0.5).max(100).default(3),
    /** Kg of salt a kiln cuts into one crystal. */
    saltPerCrystal: z.number().min(1).max(10_000).default(25),
    /** Every this many kg of salt a player makes raises "salt.packed" (one crate). */
    packEvery: z.number().min(10).max(100_000).default(100),
    /** The shared contract: crystals everyone ships together this shift. */
    contract: z.object({ crystals: z.number().int().min(1).max(100_000) }).strict().default({ crystals: 60 }),
  })
  .strict();

export const PLANT_KINDS = ["pump", "pan", "kiln"] as const;

/**
 * A plant a player buys and levels with salt. kind "pump" makes `rate`
 * litres of brine a second a level; "pan" boils up to `rate` kg of salt a
 * second a level (from brine); "kiln" cuts up to `rate` crystals a second a
 * level (from salt). The first level costs `cost` kg of salt, each next one
 * `growth` times the last.
 */
export const plantSchema = z
  .object({
    model: assetIdSchema,
    kind: z.enum(PLANT_KINDS, { error: `plant kinds are: ${PLANT_KINDS.join(", ")}` }),
    cost: z.number().min(1).max(10_000_000),
    growth: z.number().min(1.05, "growth is at least 1.05 (costs rise every level)").max(3).default(1.15),
    rate: z.number().positive().max(100_000),
    /** Most levels a player can buy in a shift. */
    max: z.number().int().min(1).max(100).default(30),
  })
  .strict();

export type SaltFlatInput = z.input<typeof saltFlatSchema>;
export type SaltFlatDef = z.output<typeof saltFlatSchema>;
export type PlantInput = z.input<typeof plantSchema>;
export type PlantDef = z.output<typeof plantSchema>;

/** The flat: shift length, tending, raking, the chain's ratios and the shared contract (one per game). */
export function saltFlat(def: SaltFlatInput): SaltFlatDef {
  const parsed = parseOrThrow(saltFlatSchema, def, "saltFlat()");
  declareContent("saltFlat", "flat", parsed);
  return parsed;
}

/** A plant players buy and level (at most 8). */
export function plant(id: string, def: PlantInput): PlantDef {
  parseOrThrow(idSchema, id, "plant id");
  const parsed = parseOrThrow(plantSchema, def, `plant("${id}")`);
  declareContent("plant", id, parsed);
  return parsed;
}

/** Store upgrade stats an idle game reads: plant output (might), raking speed (haste), salt a rake (amount). */
export const IDLE_STATS = ["might", "haste", "amount"] as const;

/** The idle content of a manifest, cross-checked (one line per issue). */
export function idleContent(m: GameManifest): { flat: SaltFlatDef; plants: [string, PlantDef][] } {
  const issues: string[] = [];
  const flat = contentOf<SaltFlatDef>(m, "saltFlat")[0]?.[1];
  const plants = contentOf<PlantDef>(m, "plant");
  if (!flat) issues.push("declare the flat: saltFlat({ shift, tend, start, rake, contract })");
  if (plants.length === 0) issues.push('declare at least one plant: plant("hand_pump", { model, kind: "pump", cost, growth, rate })');
  if (plants.length > 8) issues.push("at most 8 plants per game");
  for (const k of PLANT_KINDS) if (plants.length > 0 && !plants.some(([, p]) => p.kind === k)) issues.push(`declare a "${k}" plant: the chain is pump (brine), pan (salt), kiln (crystals)`);
  if (m.weapons.size > 0) issues.push("weapon(...) is for the survivor and arena templates; an idle game declares plant(...)");
  if (m.prefabs.size > 0) issues.push("prefab(...) is not used by the idle template; plants are plant(...)");
  for (const [id, u] of m.upgrades) if (!(IDLE_STATS as readonly string[]).includes(u.stat)) issues.push(`upgrade("${id}") raises ${u.stat}; the idle template reads ${IDLE_STATS.join(", ")} (plant output, raking speed, salt a rake)`);
  for (const [id, r] of m.earnRules) if (r.oncePer !== "run") issues.push(`earn.rule("${id}") must be oncePer: "run" (a run is a shift; that is what bounds an idle game's earn)`);
  if (issues.length > 0 || !flat) throw new GameDefinitionError("idle", issues);
  return { flat, plants };
}
