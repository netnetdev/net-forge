/**
 * Shared rigs and the common clip set (game-runtime.md §10: "all humanoids
 * in a style use one skeleton, so any animation plays on any character").
 *
 * Every animated asset names a rig. A rig maps the runtime's canonical
 * clips (idle, walk, run, jump, attack, shoot, hit, die) to the clip names
 * its files carry, as a list of candidates: the first one a file has wins.
 * "Armature|Idle" matches "Idle" (the armature prefix is ignored), and a
 * candidate that starts with "*" matches by suffix ("*_Idle" matches
 * "TRex_Idle"). A clip a file lacks falls back along CLIP_FALLBACK, then to
 * a procedural move the renderer does itself (a hit flash, a sink on death).
 *
 * Body plans (biped, quadruped, flyer, blob, wheeled, static) pick the
 * fallbacks and the crowd motion when hundreds share one instanced draw.
 */
import type { BodyPlan } from "./schema.js";

export const CLIPS = ["idle", "walk", "run", "jump", "attack", "shoot", "hit", "die"] as const;
export type Clip = (typeof CLIPS)[number];

/** Where a missing clip borrows from. Null: the renderer plays it procedurally. */
export const CLIP_FALLBACK: Readonly<Record<Clip, Clip | null>> = {
  idle: null,
  walk: "run",
  run: "walk",
  jump: "idle",
  attack: "shoot",
  shoot: "attack",
  hit: null,
  die: null,
};

export interface RigDef {
  readonly id: string;
  /** Canonical clip -> candidate clip names, best first. */
  readonly clips: Readonly<Record<Clip, readonly string[]>>;
  /** Bone or node name patterns for the head and the right hand (parts and held weapons). */
  readonly headBone: RegExp | null;
  readonly handBone: RegExp | null;
  /** Ground speed in m/s at which the walk and run clips look right at 1x. */
  readonly walkSpeed: number;
  readonly runSpeed: number;
}

export const RIGS: Readonly<Record<string, RigDef>> = {
  /** Kenney Mini Characters and Blocky Characters: the same node names and the same 30-clip set. */
  kenney_humanoid: {
    id: "kenney_humanoid",
    clips: {
      idle: ["idle"],
      walk: ["walk"],
      run: ["sprint"],
      jump: ["jump"],
      attack: ["attack-melee-right"],
      shoot: ["holding-right-shoot"],
      hit: [],
      die: ["die"],
    },
    headBone: /^head$/,
    handBone: /^arm-right$/,
    walkSpeed: 1.6,
    runSpeed: 4.5,
  },
  /**
   * Quaternius animated models. One naming family across the packs on the
   * library (characters, big monsters, blobs, flyers, animals, dinosaurs),
   * with per-family spellings ("HitRecieve", "Bat_Flying").
   */
  quaternius: {
    id: "quaternius",
    clips: {
      idle: ["Idle", "Flying_Idle", "*_Idle", "Flying", "*_Flying", "Idle_2"],
      walk: ["Walk", "*_Walk", "Flying_Idle", "Flying", "*_Flying", "*_Forward", "Run", "*_Running", "*_Run"],
      run: ["Run", "*_Run", "*_Running", "Gallop", "Fast_Flying", "Flying", "*_Flying", "*_Forward", "Walk", "*_Walk"],
      jump: ["Jump", "*_Jump", "Gallop_Jump"],
      attack: ["Punch", "Attack", "*_Attack", "Bite_Front", "Headbutt", "Attack_Headbutt", "Dagger_Attack", "Sword_Slash"],
      shoot: ["Gun_Shoot", "Idle_Gun_Shoot", "Idle_Shoot", "Shoot", "Punch", "Attack"],
      hit: ["HitReact", "HitRecieve", "RecieveHit", "*_Hit", "Idle_HitReact_Left", "HitRecieve_1"],
      die: ["Death", "*_Death", "Dead"],
    },
    headBone: /^head$/i,
    handBone: /^(fist|hand|wrist|lowerarm)[._]?r$/i,
    walkSpeed: 1.6,
    runSpeed: 5,
  },
};

/** The clip name after any "Armature|" prefixes. */
export function bareClipName(name: string): string {
  const i = name.lastIndexOf("|");
  return i >= 0 ? name.slice(i + 1) : name;
}

function matches(candidate: string, name: string): boolean {
  const bare = bareClipName(name);
  if (candidate.startsWith("*")) return bare.endsWith(candidate.slice(1));
  return bare === candidate;
}

/**
 * The file's clip to play for a canonical clip, following fallbacks; null
 * means the renderer plays it procedurally. `names` are the clips the file has.
 */
export function clipFor(rig: RigDef | undefined, clip: Clip, names: readonly string[]): string | null {
  if (!rig) return null;
  let c: Clip | null = clip;
  const seen = new Set<Clip>();
  while (c && !seen.has(c)) {
    seen.add(c);
    for (const cand of rig.clips[c]) {
      // Prefer the shortest match: "CharacterArmature|Idle" over a doubled export of the same clip.
      const hit = names.filter((n) => matches(cand, n)).sort((a, b) => a.length - b.length)[0];
      if (hit) return hit;
    }
    c = CLIP_FALLBACK[c];
  }
  return null;
}

/** Procedural crowd motion per body plan (used where hundreds share one instanced draw). */
export interface PlanMotion {
  /** Vertical bob, as a share of height, and its rate in cycles per metre walked. */
  readonly bob: number;
  readonly bobRate: number;
  /** Side-to-side lean, radians. */
  readonly waddle: number;
  /** Hover height above the floor, as a share of height (flyers). */
  readonly hover: number;
  /** Squash and stretch on the bob (blobs). */
  readonly squash: number;
}

export const PLAN_MOTION: Readonly<Record<BodyPlan, PlanMotion>> = {
  biped: { bob: 0.04, bobRate: 1.5, waddle: 0.1, hover: 0, squash: 0 },
  quadruped: { bob: 0.03, bobRate: 1.8, waddle: 0.04, hover: 0, squash: 0 },
  flyer: { bob: 0.08, bobRate: 0.7, waddle: 0.16, hover: 0.55, squash: 0 },
  blob: { bob: 0.06, bobRate: 1.3, waddle: 0.04, hover: 0, squash: 0.18 },
  wheeled: { bob: 0.01, bobRate: 3, waddle: 0, hover: 0, squash: 0 },
  static: { bob: 0, bobRate: 0, waddle: 0, hover: 0, squash: 0 },
};
