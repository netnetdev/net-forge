/**
 * The engine-sim SimAdapter: the netcode's seam (net/sim-adapter.ts) over
 * @netnetcapital/engine-sim, used identically by the room server
 * (authority, with a GameRunner) and the browser (prediction of its own
 * character only).
 *
 * Wire schema: players carry their whole state at full precision (1/1024 m)
 * so prediction replays exactly; enemies, gems and projectiles carry only
 * x/z at 1/16 m plus type, health and flags, which keeps a crowd of 2,000
 * at a few bits per moving entity.
 */
import {
  addPlayer,
  applyBeamHit,
  applyState,
  arenaHitboxes,
  arenaSpawn,
  beamShot,
  captureState,
  createWorld,
  destroyWorld,
  grantUpgrade,
  removePlayer,
  revivePlayer,
  setCosmetic,
  setMetaBonus,
  step,
  EntityKind,
  KEEPER_MASK,
  KEEPER_SHIFT,
} from "@netnetcapital/engine-sim";
import type { BeamShot, EntityKindId, EntityState as SimEntityState, InputCommand, SimConfig, SimWorld } from "@netnetcapital/engine-sim";
import type { BitReader, BitWriter } from "../net/bits.js";
import type { EntitySchema, EntityState } from "../net/schema.js";
import type { Hitbox, HitscanRequest, PlayerId, PlayerRights, SimAdapter, SimCommand, SimEvent } from "../net/sim-adapter.js";
import type { CompiledGame } from "./compile.js";
import { GameRunner } from "./runner.js";
import type { RunnerOptions } from "./runner.js";
import { metaBonus, profileSpec, unpackMeta } from "./profile.js";

/** Field indices of the engine wire schema. */
export const F = {
  px: 0,
  py: 1,
  pz: 2,
  vx: 3,
  vy: 4,
  vz: 5,
  yaw: 6,
  health: 7,
  flags: 8,
  cooldown: 9,
  buttons: 10,
  timers: 11,
  type: 12,
  level: 13,
  xp: 14,
  weapons: 15,
  wcd: 16,
  stats: 17,
  choices: 18,
  bleed: 19,
  revive: 20,
  iframes: 21,
  dash: 22,
  ex: 23,
  ez: 24,
  /** Players: rerolls used | reroll counter << 4 | keeper << 12 | revive buff ticks << 16 (prediction draws the same cards, moves at the buffed speed). */
  value: 25,
} as const;

/** Units per metre of the crowd position fields (ex, ez): 1/16 m (6 cm) is below what a crowd shows on screen. */
export const CROWD_UNITS = 16;
/** Units per metre of player positions (px, py, pz): engine-sim's own fixed point. */
export const PLAYER_UNITS = 1024;

const playerFields = [
  F.px, F.py, F.pz, F.vx, F.vy, F.vz, F.yaw, F.health, F.flags, F.cooldown, F.buttons, F.timers,
  F.type, F.level, F.xp, F.weapons, F.wcd, F.stats, F.choices, F.bleed, F.revive, F.iframes, F.dash, F.value,
];

export const engineSchema: EntitySchema = {
  fields: [
    { name: 'px', kind: 'int', bits: 19, deltaBits: 12 },
    { name: 'py', kind: 'int', bits: 15, deltaBits: 10 },
    { name: 'pz', kind: 'int', bits: 19, deltaBits: 12 },
    { name: 'vx', kind: 'int', bits: 17, deltaBits: 10 },
    { name: 'vy', kind: 'int', bits: 17, deltaBits: 10 },
    { name: 'vz', kind: 'int', bits: 17, deltaBits: 10 },
    { name: 'yaw', kind: 'angle16', deltaBits: 10 },
    { name: 'health', kind: 'uint', bits: 20, interp: 'step', deltaBits: 8 },
    { name: 'flags', kind: 'uint', bits: 8, interp: 'step' },
    { name: 'cooldown', kind: 'uint', bits: 16, interp: 'step', deltaBits: 6 },
    { name: 'buttons', kind: 'uint', bits: 16, interp: 'step' },
    { name: 'timers', kind: 'uint', bits: 16, interp: 'step' },
    { name: 'type', kind: 'uint', bits: 8, interp: 'step' },
    { name: 'level', kind: 'uint', bits: 16, interp: 'step', deltaBits: 4 },
    { name: 'xp', kind: 'uint', bits: 24, interp: 'step', deltaBits: 8 },
    { name: 'weapons', kind: 'uint', bits: 32, interp: 'step' },
    { name: 'wcd', kind: 'uint', bits: 32, interp: 'step' },
    { name: 'stats', kind: 'uint', bits: 32, interp: 'step' },
    { name: 'choices', kind: 'uint', bits: 32, interp: 'step' },
    { name: 'bleed', kind: 'uint', bits: 16, interp: 'step', deltaBits: 6 },
    { name: 'revive', kind: 'uint', bits: 16, interp: 'step', deltaBits: 6 },
    { name: 'iframes', kind: 'uint', bits: 16, interp: 'step', deltaBits: 6 },
    { name: 'dash', kind: 'uint', bits: 24, interp: 'step' },
    { name: 'ex', kind: 'int', bits: 13, deltaBits: 5 },
    { name: 'ez', kind: 'int', bits: 13, deltaBits: 5 },
    { name: 'value', kind: 'uint', bits: 28, interp: 'step' },
  ],
  xField: F.px,
  yField: F.pz,
  unitsPerWorld: PLAYER_UNITS,
  kindFields: {
    [EntityKind.Player]: playerFields,
    // level: the telegraph word (engine-sim Telegraph), 0 except while an attack winds up.
    [EntityKind.Enemy]: [F.health, F.flags, F.type, F.level, F.ex, F.ez],
    // flags: Hostile (an enemy's shot) and hazards; level: a hazard's telegraph.
    [EntityKind.Projectile]: [F.type, F.flags, F.level, F.ex, F.ez],
    [EntityKind.Pickup]: [F.type, F.ex, F.ez],
  },
};

const TAU = Math.PI * 2;
const YAW_UNITS = 65536;

/** The world each side of the netcode holds. */
export interface EngineRoomWorld {
  readonly sim: SimWorld;
  readonly role: 'server' | 'client';
  /** Server only, and only for games (the bare arena has none). */
  readonly runner: GameRunner | null;
  /** Arena: beams fired this tick by human players, awaiting the room's lag-compensated hit. */
  readonly shots: Map<PlayerId, BeamShot>;
}

export interface EngineAdapterOptions {
  readonly name: string;
  /** Content version (hot swap compares these). */
  readonly version: string;
  /** A compiled game, or omit for the bare week-2 arena (Fire = pulse). */
  readonly game?: CompiledGame;
  /** Arena-only sim config (ignored when `game` is set). */
  readonly arena?: SimConfig;
  /** Server-side runner options (measurement modes). */
  readonly runner?: RunnerOptions;
}

const idleInput: InputCommand = { seq: 0, tick: 0, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 };

/** The engine InputCommand on the wire: moves as int8, yaw as u16 turn, buttons u16 (48 bits). */
const inputCodec = {
  idle: idleInput,
  write(w: BitWriter, i: InputCommand): void {
    w.writeSigned(axis(i.moveX), 8);
    w.writeSigned(axis(i.moveZ), 8);
    w.writeBits(Number.isFinite(i.yaw) ? Math.round((((i.yaw % TAU) + TAU) % TAU) / TAU * YAW_UNITS) & 0xffff : 0, 16);
    w.writeBits(i.buttons & 0xffff, 16);
  },
  read(r: BitReader): InputCommand {
    const moveX = r.readSigned(8) / 127;
    const moveZ = r.readSigned(8) / 127;
    const yaw = (r.readBits(16) / YAW_UNITS) * TAU;
    const buttons = r.readBits(16);
    return { seq: 0, tick: 0, moveX, moveZ, yaw, buttons };
  },
};

function axis(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(Math.max(-1, Math.min(1, v)) * 127);
}

/** engine-sim entity → netcode values in schema order. */
function toValues(e: SimEntityState): number[] {
  const v = new Array<number>(26).fill(0);
  v[F.px] = e.px;
  v[F.pz] = e.pz;
  v[F.type] = e.type;
  v[F.health] = e.health;
  v[F.flags] = e.flags;
  v[F.ex] = Math.round((e.px * CROWD_UNITS) / PLAYER_UNITS);
  v[F.ez] = Math.round((e.pz * CROWD_UNITS) / PLAYER_UNITS);
  v[F.level] = e.level;
  // Enemies: the crit counter (timers bits 8..11) so clients can mark crit numbers.
  if (e.kind === EntityKind.Enemy) v[F.timers] = (e.timers >>> 8) & 0xf;
  if (e.kind !== EntityKind.Player) return v;
  v[F.py] = e.py;
  v[F.vx] = e.vx;
  v[F.vy] = e.vy;
  v[F.vz] = e.vz;
  v[F.yaw] = (e.yaw / YAW_UNITS) * TAU;
  v[F.cooldown] = e.cooldown;
  v[F.buttons] = e.buttons;
  v[F.timers] = e.timers;
  v[F.level] = e.level;
  v[F.xp] = e.xp;
  v[F.weapons] = e.weapons;
  v[F.wcd] = e.wcd;
  v[F.stats] = e.stats;
  v[F.choices] = e.choices;
  v[F.bleed] = e.bleed;
  v[F.revive] = e.revive;
  v[F.iframes] = e.iframes;
  v[F.dash] = e.dash;
  v[F.value] = e.value & 0xfffffff;
  return v;
}

/** Netcode values → an engine-sim entity (players exact; crowd positions at 1/16 m). */
function fromValues(s: EntityState): SimEntityState {
  const v = s.values;
  const n = (i: number) => Math.round(v[i] ?? 0);
  const player = s.kind === EntityKind.Player;
  return {
    netId: s.id,
    kind: s.kind as EntityKindId,
    owner: s.owner,
    px: player ? n(F.px) : (n(F.ex) * PLAYER_UNITS) / CROWD_UNITS,
    py: n(F.py),
    pz: player ? n(F.pz) : (n(F.ez) * PLAYER_UNITS) / CROWD_UNITS,
    vx: n(F.vx),
    vy: n(F.vy),
    vz: n(F.vz),
    yaw: Math.round(((((v[F.yaw] ?? 0) % TAU) + TAU) % TAU) / TAU * YAW_UNITS) % YAW_UNITS,
    health: n(F.health),
    flags: n(F.flags),
    ack: 0,
    cooldown: n(F.cooldown),
    buttons: n(F.buttons),
    timers: player ? n(F.timers) : s.kind === EntityKind.Enemy ? (n(F.timers) & 0xf) << 8 : 0,
    type: n(F.type),
    value: player ? n(F.value) : 0,
    level: n(F.level),
    xp: n(F.xp),
    weapons: n(F.weapons) >>> 0,
    wcd: n(F.wcd) >>> 0,
    stats: n(F.stats),
    choices: n(F.choices) >>> 0,
    bleed: n(F.bleed),
    revive: n(F.revive),
    iframes: n(F.iframes),
    dash: n(F.dash),
  };
}

/**
 * Build the SimAdapter. One instance serves every room of a template; each
 * room gets its own world from `createWorld`. `maxInputsPerTick: 1`:
 * engine-sim steps exactly one command per player per tick.
 */
export function engineSimAdapter(opts: EngineAdapterOptions): SimAdapter<EngineRoomWorld, InputCommand> {
  const game = opts.game;
  const tickHz = game?.tickRate ?? opts.arena?.tickRate ?? 30;
  const baseConfig: SimConfig = game ? game.sim : { ...opts.arena, tickRate: tickHz };
  const arena = game?.mode === 'arena';
  const spec = game ? profileSpec(game.manifest) : null;
  /** Upgrades some gear SKU brings into a staked run (the room issues these commands; the room never takes them from a client). */
  const gearUpgrades = new Set([...(game?.manifest.skus.values() ?? [])].flatMap((s) => (s.grants && "gear" in s.grants ? [s.grants.gear] : [])));
  return {
    name: opts.name,
    version: opts.version,
    tickHz,
    schema: engineSchema,
    input: inputCodec,
    maxInputsPerTick: 1,

    createWorld(seed, role) {
      // The client predicts only its own character: no spawner, no runner.
      // Arena: the client has no authority (no projectiles, hits or respawns
      // of its own); the server resolves human beams with lag compensation.
      const content = baseConfig.content;
      const arenaCfg = arena && content ? { ...content, arena: { ...content.arena, authority: role === 'server', externalHitscan: role === 'server' } } : content;
      // A prediction world holds only its own character: it takes "solo" from the server's flag.
      const clientContent = arenaCfg ? { ...arenaCfg, coop: { ...arenaCfg.coop, soloFromFlag: true } } : arenaCfg;
      const cfg: SimConfig =
        role === 'client'
          ? { ...baseConfig, seed, enemies: { ...baseConfig.enemies, target: 0 }, ...(clientContent ? { content: clientContent } : {}) }
          : { ...baseConfig, seed, ...(arenaCfg ? { content: arenaCfg } : {}) };
      const sim = createWorld(cfg);
      const runner = role === 'server' && game ? new GameRunner(game, sim, opts.runner) : null;
      return { sim, role, runner, shots: new Map() };
    },

    addPlayer(w, player) {
      const [sx, sy, sz] = w.sim.config.arena.spawn;
      if (arena) {
        const [x, z] = arenaSpawn(w.sim, player);
        return addPlayer(w.sim, player, [x, sy, z]);
      }
      return addPlayer(w.sim, player, [sx + ((player - 1) % 8) * 1.5 - 5, sy, sz]);
    },

    removePlayer(w, player) {
      removePlayer(w.sim, player);
    },

    step(w, inputsByPlayer) {
      const inputs = new Map<PlayerId, InputCommand>();
      for (const [p, list] of inputsByPlayer) {
        const cmd = list[0];
        if (cmd) inputs.set(p, cmd);
      }
      w.runner?.beforeStep(inputs);
      w.shots.clear();
      const res = step(w.sim, inputs);
      const out: SimEvent[] = [];
      if (w.runner) {
        const r = w.runner.afterStep(res.events);
        for (const a of r.awards) out.push({ type: 'earn', player: a.player, rule: a.rule, units: a.units });
        for (const p of w.runner.takeProgress()) out.push({ type: 'progress', player: p.player, kind: p.kind, id: p.id });
        if (r.reset) out.push({ type: 'run.reset' });
      } else if (w.role === 'server') {
        for (const e of res.events) if (e.type === 'enemy.killed' && e.by > 0) out.push({ type: 'earn', player: e.by, rule: 'kill', units: 1 });
      }
      return out;
    },

    snapshot(w) {
      return captureState(w.sim).entities.map((e) => ({ id: e.netId, kind: e.kind, owner: e.owner, values: toValues(e) }));
    },

    applySnapshot(w, entities) {
      applyState(w.sim, { ...captureState(w.sim), entities: entities.map(fromValues) });
    },

    info(w) {
      return w.runner?.info() ?? null;
    },

    restrictInput(input: InputCommand, rights: PlayerRights): InputCommand {
      const allowed = rights.keepers;
      if (!allowed) return input;
      const pick = ((input.buttons & KEEPER_MASK) >>> KEEPER_SHIFT) - 1;
      if (pick < 0 || allowed.includes(pick)) return input;
      // A locked keeper: play the first open one instead (the room's profile check).
      const open = allowed[0];
      const rest = input.buttons & ~KEEPER_MASK;
      return { ...input, buttons: (open === undefined ? rest : rest | (((open + 1) & 0xf) << KEEPER_SHIFT)) >>> 0 };
    },

    startRun(w, player) {
      w.runner?.startRun(player);
    },

    command(w, player, cmd: SimCommand) {
      if (cmd.name === 'revive') return revivePlayer(w.sim, player);
      // Owned meta upgrades (issued by the room from the profile, never by a client): capped again here.
      if (cmd.name === 'meta') {
        if (!spec || spec.meta.size === 0 || !spec.economy.metaUpgrades) return false;
        setMetaBonus(w.sim, player, metaBonus(spec, unpackMeta(spec, cmd.value ?? 0)));
        return true;
      }
      if (cmd.name === 'cosmetic') {
        setCosmetic(w.sim, player, cmd.value ?? 0);
        return true;
      }
      // A store upgrade: a SKU named after a declared upgrade grants one level of it for this run.
      const up = game ? game.upgradeIds.indexOf(cmd.name) : -1;
      if (game && up >= 0 && game.manifest.skus.has(cmd.name)) return grantUpgrade(w.sim, player, up);
      // Gear (issued by the room from the profile at a staked run's start, never by a client): one level of its upgrade.
      if (game && up >= 0 && gearUpgrades.has(cmd.name)) return grantUpgrade(w.sim, player, up);
      return false;
    },

    // Lag compensation (game-runtime.md §6): arena beams from human players.
    ...(arena
      ? {
          hitscans(w: EngineRoomWorld, player: PlayerId, input: InputCommand): HitscanRequest | null {
            const shot = beamShot(w.sim, player, input);
            if (!shot) return null;
            w.shots.set(player, shot);
            return { shooter: player, ox: shot.x, oy: shot.z, dx: shot.dx, dy: shot.dz, range: shot.range };
          },
          hitboxes(w: EngineRoomWorld): Hitbox[] {
            return arenaHitboxes(w.sim).map((h) => ({ entity: h.netId, owner: h.owner, x: h.x, y: h.z, r: h.r }));
          },
          applyHit(w: EngineRoomWorld, shooter: PlayerId, target: Hitbox): SimEvent[] {
            const shot = w.shots.get(shooter);
            if (shot) applyBeamHit(w.sim, shot, target.entity);
            return [];
          },
        }
      : {}),

    disposeWorld(w) {
      destroyWorld(w.sim);
    },
  };
}

/** Free a world's physics memory (rooms call this on dispose). */
export function disposeEngineWorld(w: EngineRoomWorld): void {
  destroyWorld(w.sim);
}
