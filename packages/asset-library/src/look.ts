/**
 * The look composer (internal): base model + palette + scale + a few parts.
 * This is how the builder turns a description ("a yellow electric critter
 * with long ears") into a consistent, animated original from the library.
 * Creators never see it; they describe what they want or pick from the
 * gallery, and the model writes the look.
 *
 * `resolveLook` is pure and deterministic: the same model id and look give
 * the same result on every client and in every test.
 */
import { appearanceSchema, type AppearanceDef, type AppearancePart } from "@netforge/engine";
import { assetById, baseAsset } from "./library.js";
import type { AssetDef, BodyPlan } from "./schema.js";

/** Where a part goes, per body plan: an anchor and an offset in model units (0..1 of height). */
export type AnchorName = "head" | "back" | "tail" | "face" | "wheels" | "body";

export const PART_ANCHOR: Readonly<Record<AppearancePart, AnchorName>> = {
  horns: "head",
  ears_long: "head",
  ears_round: "head",
  antenna: "head",
  crown: "head",
  hat_cap: "head",
  hat_top: "head",
  mustache: "face",
  tail: "tail",
  tail_bolt: "tail",
  wings: "back",
  armor: "body",
  backpack: "back",
  big_wheels: "wheels",
};

/** Parts that make no sense on a plan are dropped (a mustache on a truck), with a note. */
const PLAN_PARTS: Readonly<Record<BodyPlan, ReadonlySet<AnchorName>>> = {
  biped: new Set(["head", "back", "tail", "face", "body"]),
  quadruped: new Set(["head", "back", "tail", "face", "body"]),
  flyer: new Set(["head", "back", "tail", "face", "body"]),
  blob: new Set(["head", "back", "tail", "face", "body"]),
  wheeled: new Set(["wheels", "body", "back"]),
  static: new Set(["body"]),
};

export interface ResolvedPart {
  readonly part: AppearancePart;
  readonly anchor: AnchorName;
}

export interface ResolvedLook {
  /** The asset whose file is drawn. */
  readonly asset: AssetDef;
  /** The id the game asked for (may be a variant or an alias). */
  readonly requested: string;
  readonly tint: number | null;
  readonly accent: number;
  readonly scale: number;
  readonly parts: readonly ResolvedPart[];
  /** Parts dropped because the body plan has no place for them. */
  readonly dropped: readonly AppearancePart[];
  /** Stable key: identical looks share one loaded model and one instanced draw. */
  readonly key: string;
}

const hex = (s: string): number => Number.parseInt(s.slice(1), 16);

/** Darken a colour for a default accent. */
function shade(c: number, f: number): number {
  const r = Math.round(((c >> 16) & 0xff) * f);
  const g = Math.round(((c >> 8) & 0xff) * f);
  const b = Math.round((c & 0xff) * f);
  return (r << 16) | (g << 8) | b;
}

/** Merge a variant's built-in look under the game's own look: the game's fields win, parts are unioned. */
function mergeLooks(base: AppearanceDef | undefined, top: AppearanceDef | undefined): AppearanceDef {
  const parts = [...new Set([...(base?.parts ?? []), ...(top?.parts ?? [])])].slice(0, 4);
  return appearanceSchema.parse({
    ...(base?.tint ? { tint: base.tint } : {}),
    ...(base?.accent ? { accent: base.accent } : {}),
    ...(base?.scale !== undefined ? { scale: base.scale } : {}),
    ...(top?.tint ? { tint: top.tint } : {}),
    ...(top?.accent ? { accent: top.accent } : {}),
    ...(top?.scale !== undefined ? { scale: (base?.scale ?? 1) * top.scale } : {}),
    parts,
  });
}

/** Resolve a model id and an optional look into what to draw. Throws on an unknown id. */
export function resolveLook(modelId: string, look?: AppearanceDef): ResolvedLook {
  const requested = assetById(modelId);
  if (!requested) throw new Error(`unknown library id ${modelId}`);
  const asset = baseAsset(requested);
  const builtIn = "base" in requested.source ? requested.source.appearance : undefined;
  const l = mergeLooks(builtIn, look);
  const allowed = PLAN_PARTS[asset.plan];
  const parts: ResolvedPart[] = [];
  const dropped: AppearancePart[] = [];
  for (const p of l.parts) {
    const anchor = PART_ANCHOR[p];
    if (!allowed.has(anchor)) {
      dropped.push(p);
      continue;
    }
    parts.push({ part: p, anchor });
  }
  const tint = l.tint ? hex(l.tint) : null;
  const accent = l.accent ? hex(l.accent) : tint !== null ? shade(tint, 0.45) : 0x2a2a2a;
  const scale = l.scale ?? 1;
  const key = `${asset.id}|${tint ?? "-"}|${accent}|${scale}|${parts.map((p) => p.part).join(",")}`;
  return { asset, requested: modelId, tint, accent, scale, parts, dropped, key };
}
