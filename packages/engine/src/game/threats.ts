/**
 * Telegraphs as shapes on the ground: what an attack about to land covers.
 * One reader for the client's decals and the playtest bots' dodging, so
 * what players see is exactly what the bots react to.
 */
import { decodeTelegraph, EntityFlag, EntityKind, ROLE_DEFAULTS, Telegraph } from "@netnetcapital/engine-sim";
import type { EnemyTypeDef } from "@netnetcapital/engine-sim";

/** One warning on the ground. Lanes run from (x, z) along (dx, dz) for `len` m with half width `r`. */
export interface ThreatShape {
  readonly kind: "circle" | "lane" | "aura";
  readonly x: number;
  readonly z: number;
  readonly r: number;
  readonly dx?: number;
  readonly dz?: number;
  readonly len?: number;
  /** 0 when it appears, 1 when it lands. */
  readonly progress: number;
  /** True for an enemy shot in flight (a small moving circle). */
  readonly shot?: boolean;
}

/** Boss dash lane length, m (engine-sim roles.ts BOSS.dash.length). */
const BOSS_DASH = 11;

/** Lane length for an enemy type's telegraphed lane. */
export function laneLength(def: EnemyTypeDef | undefined): number {
  if (!def) return 6;
  if (def.pattern) return BOSS_DASH;
  // An aim line shows the direction, not the whole flight: 5 m is enough to read and dodge.
  if (def.ai === "ranged") return Math.min(5, (def.attack?.range ?? ROLE_DEFAULTS.ranged.range) * 1.6);
  const C = ROLE_DEFAULTS.charger;
  return def.speed * (def.attack?.speed ?? C.speed) * C.act + def.radius;
}

/**
 * The warning an entity shows now, or null. `kind`, `flags`, `type` and
 * `level` are its snapshot fields; (x, z) its position, (vx, vz) its
 * velocity (shots).
 */
export function threatOf(
  enemyTypes: readonly EnemyTypeDef[],
  kind: number,
  flags: number,
  type: number,
  level: number,
  x: number,
  z: number,
  vx = 0,
  vz = 0,
): ThreatShape | null {
  if (kind === EntityKind.Projectile) {
    if ((flags & EntityFlag.Hostile) === 0) return null;
    if ((flags & EntityFlag.Elite) !== 0) {
      const t = decodeTelegraph(level);
      return { kind: "circle", x, z, r: t.radius, progress: t.progress };
    }
    return { kind: "circle", x: x + vx * 0.3, z: z + vz * 0.3, r: 0.6, progress: 1, shot: true };
  }
  if (kind !== EntityKind.Enemy || level === 0 || (flags & EntityFlag.Dead) !== 0) return null;
  const t = decodeTelegraph(level);
  const def = enemyTypes[type];
  if (t.kind === Telegraph.Circle) return { kind: "circle", x, z, r: t.radius, progress: t.progress };
  if (t.kind === Telegraph.Aura) return { kind: "aura", x, z, r: t.radius, progress: t.progress };
  if (t.kind === Telegraph.Lane) {
    const width = (def?.radius ?? 0.4) + 0.3;
    return { kind: "lane", x, z, r: width, dx: Math.cos(t.angle), dz: Math.sin(t.angle), len: laneLength(def), progress: t.progress };
  }
  return null;
}
