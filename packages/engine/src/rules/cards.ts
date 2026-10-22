/**
 * The card battler genre (template "cards"): one against one, a person
 * against a person or against the AI (a seat bot that fills the second
 * seat after a player has been alone a few seconds, and never earns). A
 * run is a gauntlet of duels with a draft between them.
 *
 * Hidden information stays on the server: decks are shuffled here from the
 * room's seeded PRNG, the deck order never leaves this module, and a hand
 * (and a draft offer) appears only in its owner's view. Snapshots carry the
 * avatars (the quills) only; the public view carries counts.
 */
import type { GameManifest } from "../api/registry.js";
import { cardsContent, type CardDef, type CardTableDef } from "../api/cards.js";
import type { GameEvent } from "../game/earn.js";
import type { EntityState } from "../net/schema.js";
import { randInt, shuffle, UNITS } from "./kit.js";
import type { Avatar, RulesCheck, RulesContext, RulesGenre, RulesHarnessRun, RulesInput, RulesStats, RunOutcome } from "./kit.js";

/** Actions (RulesInput.act). */
export const CardAct = { Play: 1, Attack: 2, End: 3, Draft: 4 } as const;
/** Target codes (RulesInput.b): 0 none, 1 the enemy hero, 2 your hero, 10+i enemy unit i, 20+i your unit i. */
export const Target = { None: 0, EnemyHero: 1, OwnHero: 2, EnemyUnit: 10, OwnUnit: 20 } as const;

interface Unit {
  type: number;
  attack: number;
  health: number;
  maxHealth: number;
  guard: boolean;
  /** May attack this turn. */
  ready: boolean;
}

interface Side {
  player: number;
  hero: number;
  heroMax: number;
  mana: number;
  maxMana: number;
  /** Server only: the shuffled deck, top first. Never sent. */
  deck: number[];
  hand: number[];
  board: Unit[];
  fatigue: number;
}

interface Duel {
  sides: [Side, Side];
  /** Index into sides of whose turn it is. */
  turn: 0 | 1;
  turnNo: number;
  timer: number;
  /** A bot's think clock: ticks since the turn began. */
  turnTicks: number;
  /** The AI tier when one side is a bot, else -1. */
  tier: number;
}

interface CardPlayer {
  /** The player's deck list (their collection), card type indices. */
  list: number[];
  wins: number;
  losses: number;
  draws: number;
  aiWins: number;
  /** Draft offer (private), or null. */
  offer: number[] | null;
  joinedAt: number;
}

interface LogLine {
  p: number;
  kind: "play" | "attack" | "win" | "draw" | "end";
  card: number;
  target: number;
}

export interface CardsState {
  rng: { s: number };
  ctx: RulesContext;
  tick: number;
  stage: "waiting" | "duel" | "draft" | "done";
  /** Duels started this run (1-based once one has). */
  duelNo: number;
  duel: Duel | null;
  /** Ticks left in the draft or the pause before the next duel. */
  countdown: number;
  players: Map<number, CardPlayer>;
  /** Ticks a person has been alone (a seat bot comes after a few seconds). */
  alone: number;
  log: LogLine[];
  finished: number;
  draws: number;
  peakBoard: number;
  activity: number;
  /** Turns of every finished duel (checks). */
  turnsPlayed: number[];
}

export interface CompiledCards {
  readonly table: CardTableDef;
  readonly cards: readonly { readonly id: string; readonly def: CardDef }[];
  readonly starter: readonly number[];
  readonly pool: readonly number[];
}

export function compileCards(m: GameManifest): CompiledCards {
  const c = cardsContent(m);
  const ids = c.cards.map(([id]) => id);
  return {
    table: c.table,
    cards: c.cards.map(([id, def]) => ({ id, def })),
    starter: c.table.starter.map((id) => ids.indexOf(id)),
    pool: (c.table.pool ?? ids).map((id) => ids.indexOf(id)),
  };
}

const TICK = 30;
const ALONE_TICKS = 3 * TICK;
const PAUSE_TICKS = 3 * TICK;

export function cardsGenre(m: GameManifest): RulesGenre<CardsState> & { readonly game: CompiledCards } {
  const g = compileCards(m);
  const t = g.table;
  const tickRate = TICK;
  const AVATAR_STEP = Math.round((30 * UNITS) / tickRate);
  const HALF_W = 9;
  const HALF_H = 6;
  const def = (type: number): CardDef | undefined => g.cards[type]?.def;
  /** A card's rough worth (the AI's and the draft's sense of value). */
  const worth = (type: number): number => {
    const d = def(type);
    if (!d) return 0;
    const fx = d.effect ? d.effect.amount * (d.effect.kind === "draw" ? 2 : d.effect.target === "all_enemies" || d.effect.target === "all_own" ? 2.5 : 1.2) : 0;
    return d.attack + d.health + fx + (d.guard ? 1 : 0) + (d.rush ? 1 : 0);
  };

  const people = (s: CardsState) => [...s.players.keys()].filter((p) => !s.ctx.isBot(p));
  const log = (s: CardsState, l: LogLine) => {
    s.log.push(l);
    if (s.log.length > 8) s.log.shift();
  };

  const draw = (s: CardsState, side: Side, n: number): void => {
    for (let i = 0; i < n; i++) {
      const c = side.deck.shift();
      if (c === undefined) {
        side.fatigue++;
        side.hero -= side.fatigue;
      } else if (side.hand.length < t.handMax) side.hand.push(c);
    }
  };

  const startDuel = (s: CardsState): void => {
    const ps = people(s);
    const bots = [...s.players.keys()].filter((p) => s.ctx.isBot(p));
    let pair: [number, number] | null = null;
    if (ps.length >= 2) pair = [ps[0] as number, ps[1] as number];
    else if (ps.length === 1 && bots.length >= 1) pair = [ps[0] as number, bots[0] as number];
    if (!pair) {
      s.stage = "waiting";
      return;
    }
    s.duelNo++;
    const vsBot = pair.some((p) => s.ctx.isBot(p));
    const tier = vsBot ? Math.min(t.ai.length - 1, s.players.get(pair[0])?.aiWins ?? 0) : -1;
    // Who goes first: the seeded coin.
    if (randInt(s.rng, 2) === 1) pair = [pair[1], pair[0]];
    const mk = (p: number, idx: number): Side => {
      const pl = s.players.get(p) as CardPlayer;
      const bot = s.ctx.isBot(p);
      const heroMax = bot ? (t.ai[tier]?.health ?? t.health) : t.health + Math.floor(s.ctx.bonus(p, "maxHealth"));
      const side: Side = { player: p, hero: heroMax, heroMax, mana: 0, maxMana: 0, deck: shuffle(s.rng, [...pl.list]), hand: [], board: [], fatigue: 0 };
      draw(s, side, t.startHand + idx + Math.floor(s.ctx.bonus(p, "amount")));
      return side;
    };
    s.duel = { sides: [mk(pair[0], 0), mk(pair[1], 1)], turn: 0, turnNo: 0, timer: 0, turnTicks: 0, tier };
    s.stage = "duel";
    beginTurn(s, s.duel);
    s.activity++;
  };

  const beginTurn = (s: CardsState, d: Duel): void => {
    d.turnNo++;
    const side = d.sides[d.turn];
    side.maxMana = Math.min(t.manaMax, side.maxMana + 1);
    side.mana = side.maxMana + (d.turnNo <= 2 ? Math.floor(s.ctx.bonus(side.player, "haste")) : 0);
    for (const u of side.board) u.ready = true;
    if (d.turnNo > 1) draw(s, side, 1);
    d.timer = Math.round(t.turnSeconds * tickRate);
    d.turnTicks = 0;
  };

  const endDuel = (s: CardsState, winner: number | null, emit: (e: GameEvent) => void, forfeit = false): void => {
    const d = s.duel;
    if (!d) return;
    s.turnsPlayed.push(d.turnNo);
    const [a, b] = d.sides;
    const vsBot = s.ctx.isBot(a.player) || s.ctx.isBot(b.player);
    if (winner === null) {
      s.draws++;
      for (const side of d.sides) {
        const pl = s.players.get(side.player);
        if (pl) pl.draws++;
      }
      log(s, { p: 0, kind: "draw", card: 0, target: 0 });
    } else {
      const loser = winner === a.player ? b.player : a.player;
      const w = s.players.get(winner);
      const l = s.players.get(loser);
      if (w) w.wins++;
      if (l) l.losses++;
      log(s, { p: winner, kind: "win", card: 0, target: 0 });
      if (!s.ctx.isBot(winner)) {
        if (vsBot) {
          if (w) w.aiWins++;
          // PvE: beating the AI pays the gauntlet's rules (a forfeit by a leaving bot pays nothing).
          emit(forfeit ? { name: "ai.beaten", players: [winner], unpaid: true } : { name: "ai.beaten", players: [winner], own: true });
        } else {
          // PvP: a duel won against a person; a forfeit (the other walked out) pays nothing.
          emit(forfeit ? { name: "duel.won", players: [winner], unpaid: true } : { name: "duel.won", players: [winner], own: true });
        }
      }
    }
    s.finished++;
    s.duel = null;
    if (s.duelNo >= t.duels) {
      s.stage = "done";
      for (const [p, pl] of s.players) if (!s.ctx.isBot(p) && pl.wins > pl.losses) emit({ name: "run.won", players: [p], own: true });
    } else {
      s.stage = "draft";
      s.countdown = Math.round(t.draftSeconds * tickRate);
      for (const [p, pl] of s.players) pl.offer = offerFor(s, p);
    }
    s.activity++;
  };

  const offerFor = (s: CardsState, _p: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < 3 && g.pool.length > 0; i++) {
      let c = g.pool[randInt(s.rng, g.pool.length)] as number;
      for (let k = 0; k < 4 && out.includes(c); k++) c = g.pool[randInt(s.rng, g.pool.length)] as number;
      out.push(c);
    }
    return out;
  };

  const sideOf = (d: Duel, p: number): { me: Side; foe: Side; idx: 0 | 1 } | null => {
    if (d.sides[0].player === p) return { me: d.sides[0], foe: d.sides[1], idx: 0 };
    if (d.sides[1].player === p) return { me: d.sides[1], foe: d.sides[0], idx: 1 };
    return null;
  };

  const dealDamage = (side: Side, target: number, amount: number): void => {
    if (target === Target.EnemyHero || target === Target.OwnHero) side.hero -= amount;
    else {
      const u = side.board[target % 10];
      if (u) u.health -= amount;
    }
  };

  const sweep = (d: Duel): void => {
    for (const side of d.sides) side.board = side.board.filter((u) => u.health > 0);
  };

  /** Applies an effect; false when its target is not valid (the card is not played). */
  const effect = (s: CardsState, d: Duel, me: Side, foe: Side, fx: NonNullable<CardDef["effect"]>, target: number): boolean => {
    if (fx.kind === "draw") {
      draw(s, me, fx.amount);
      return true;
    }
    if (fx.kind === "heal") {
      me.hero = Math.min(me.heroMax, me.hero + fx.amount);
      return true;
    }
    if (fx.kind === "damage") {
      if (fx.target === "all_enemies") {
        for (const u of foe.board) u.health -= fx.amount;
      } else if (fx.target === "enemy_hero") foe.hero -= fx.amount;
      else if (fx.target === "own_hero") me.hero -= fx.amount;
      else {
        if (target === Target.EnemyHero) foe.hero -= fx.amount;
        else if (target >= Target.EnemyUnit && target < Target.OwnUnit && foe.board[target - Target.EnemyUnit]) dealDamage(foe, target, fx.amount);
        else return false;
      }
      sweep(d);
      return true;
    }
    // buff
    if (fx.target === "all_own") {
      for (const u of me.board) {
        u.attack += fx.amount;
        u.health += fx.amount;
        u.maxHealth += fx.amount;
      }
      return true;
    }
    const u = target >= Target.OwnUnit ? me.board[target - Target.OwnUnit] : undefined;
    if (!u) return me.board.length === 0;
    u.attack += fx.amount;
    u.health += fx.amount;
    u.maxHealth += fx.amount;
    return true;
  };

  const settle = (s: CardsState, d: Duel, emit: (e: GameEvent) => void): void => {
    const [a, b] = d.sides;
    if (a.hero <= 0 || b.hero <= 0) endDuel(s, a.hero <= 0 && b.hero <= 0 ? null : a.hero <= 0 ? b.player : a.player, emit);
  };

  const play = (s: CardsState, d: Duel, me: Side, foe: Side, slot: number, type: number, target: number, emit: (e: GameEvent) => void): void => {
    const c = me.hand[slot];
    const cd = c === undefined ? undefined : def(c);
    if (c === undefined || c !== type || !cd || cd.cost > me.mana) return;
    if (cd.kind === "unit" && me.board.length >= t.boardMax) return;
    if (cd.kind === "spell" && cd.effect && !effect(s, d, me, foe, cd.effect, target)) return;
    me.hand.splice(slot, 1);
    me.mana -= cd.cost;
    if (cd.kind === "unit") {
      const might = Math.floor(s.ctx.bonus(me.player, "might"));
      me.board.push({ type: c, attack: cd.attack + might, health: cd.health, maxHealth: cd.health, guard: cd.guard, ready: cd.rush });
      if (cd.effect) effect(s, d, me, foe, cd.effect, target);
    }
    log(s, { p: me.player, kind: "play", card: c, target });
    s.activity++;
    s.peakBoard = Math.max(s.peakBoard, me.board.length);
    settle(s, d, emit);
  };

  const attack = (s: CardsState, d: Duel, me: Side, foe: Side, from: number, target: number, emit: (e: GameEvent) => void): void => {
    const u = me.board[from];
    if (!u || !u.ready || u.attack <= 0) return;
    const guards = foe.board.some((x) => x.guard);
    if (target === Target.EnemyHero) {
      if (guards) return;
      foe.hero -= u.attack;
    } else {
      const v = foe.board[target - Target.EnemyUnit];
      if (target < Target.EnemyUnit || target >= Target.OwnUnit || !v) return;
      if (guards && !v.guard) return;
      v.health -= u.attack;
      u.health -= v.attack;
    }
    u.ready = false;
    log(s, { p: me.player, kind: "attack", card: u.type, target });
    sweep(d);
    s.activity++;
    settle(s, d, emit);
  };

  const endTurn = (s: CardsState, d: Duel): void => {
    log(s, { p: d.sides[d.turn].player, kind: "end", card: 0, target: 0 });
    d.turn = d.turn === 0 ? 1 : 0;
    beginTurn(s, d);
    s.activity++;
  };

  /** The AI's next move on its turn, or an end of turn. smart: chance it takes the best move. */
  const aiMove = (s: CardsState, d: Duel, me: Side, foe: Side, smart: number, salt: number): RulesInput => {
    const act = (a: number, x: number, y: number, z: number): RulesInput => ({ mx: 0, mz: 0, cx: 0, cz: 0, act: a, a: x, b: y, c: z });
    const sloppy = ((Math.imul(salt + d.turnNo * 31 + d.turnTicks, 2654435761) >>> 0) % 1000) / 1000 >= smart;
    // Play: the most valuable card it can afford (a sloppy turn plays the first it can).
    const playable = me.hand
      .map((c, i) => ({ c, i, d: def(c) }))
      .filter((x) => x.d && x.d.cost <= me.mana && !(x.d.kind === "unit" && me.board.length >= t.boardMax))
      .sort((a, b) => (sloppy ? a.i - b.i : worth(b.c) - worth(a.c)));
    for (const p of playable) {
      const fx = p.d?.effect;
      let target: number = Target.None;
      if (fx && (fx.target === "enemy" || fx.target === "own_unit")) {
        if (fx.kind === "damage") {
          // Kill the biggest enemy unit it can, else hit the hero.
          const kill = foe.board.map((u, i) => ({ u, i })).filter((x) => x.u.health <= fx.amount).sort((a, b) => b.u.attack - a.u.attack)[0];
          target = kill ? Target.EnemyUnit + kill.i : Target.EnemyHero;
        } else if (fx.kind === "buff") {
          const best = me.board.map((u, i) => ({ u, i })).sort((a, b) => b.u.attack - a.u.attack)[0];
          if (!best) continue;
          target = Target.OwnUnit + best.i;
        }
      }
      if (fx?.kind === "heal" && me.hero > me.heroMax - 3) continue;
      return act(CardAct.Play, p.i, target, p.c);
    }
    // Attack: guards first; trade up when it can; else the hero.
    const guards = foe.board.map((u, i) => ({ u, i })).filter((x) => x.u.guard);
    for (let i = 0; i < me.board.length; i++) {
      const u = me.board[i] as Unit;
      if (!u.ready || u.attack <= 0) continue;
      if (guards.length > 0) {
        const g0 = guards.sort((a, b) => a.u.health - b.u.health)[0];
        if (g0) return act(CardAct.Attack, i, Target.EnemyUnit + g0.i, 0);
      }
      const trade = foe.board.map((v, j) => ({ v, j })).find((x) => x.v.health <= u.attack && x.v.attack < u.health && x.v.attack >= u.attack - 1);
      if (trade && !sloppy) return act(CardAct.Attack, i, Target.EnemyUnit + trade.j, 0);
      return act(CardAct.Attack, i, Target.EnemyHero, 0);
    }
    return act(CardAct.End, 0, 0, 0);
  };

  const unitView = (u: Unit) => ({ type: u.type, attack: u.attack, health: u.health, maxHealth: u.maxHealth, guard: u.guard, ready: u.ready });

  return {
    template: "cards",
    tickRate,
    endSeconds: 8,
    infoEveryTicks: 3,
    game: g,

    create(seed, ctx) {
      return { rng: { s: seed | 0 }, ctx, tick: 0, stage: "waiting", duelNo: 0, duel: null, countdown: PAUSE_TICKS, players: new Map(), alone: 0, log: [], finished: 0, draws: 0, peakBoard: 0, activity: 0, turnsPlayed: [] };
    },

    spawn(_s, player) {
      return { x: Math.round(((player % 2 === 0 ? 3 : -3) + (player % 5) * 0.2) * UNITS), z: Math.round((player % 2 === 0 ? -2 : 2) * UNITS) };
    },

    moveAvatar(a: Avatar, i: RulesInput) {
      if (i.cx === 0 && i.cz === 0 && i.act === 0) return;
      const tx = Math.round(Math.max(-HALF_W, Math.min(HALF_W, i.cx / 16)) * UNITS);
      const tz = Math.round(Math.max(-HALF_H, Math.min(HALF_H, i.cz / 16)) * UNITS);
      const dx = tx - a.x;
      const dz = tz - a.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 1) return;
      if (d <= AVATAR_STEP) {
        a.x += dx;
        a.z += dz;
      } else {
        a.x += Math.round((dx * AVATAR_STEP) / d);
        a.z += Math.round((dz * AVATAR_STEP) / d);
      }
    },

    join(s, player) {
      s.players.set(player, { list: [...g.starter], wins: 0, losses: 0, draws: 0, aiWins: 0, offer: null, joinedAt: s.tick });
      s.activity++;
    },

    leave(s, player) {
      s.players.delete(player);
      const d = s.duel;
      if (d && sideOf(d, player)) {
        const other = d.sides[0].player === player ? d.sides[1].player : d.sides[0].player;
        if (s.ctx.isBot(player)) {
          // The seat bot made room for a person: the duel is called off, no result.
          s.duel = null;
          s.duelNo = Math.max(0, s.duelNo - 1);
          s.stage = "waiting";
          s.countdown = PAUSE_TICKS;
        } else {
          endDuel(s, other, () => undefined, true);
        }
      }
      s.activity++;
    },

    act(s, player, i, _a, emit) {
      const pl = s.players.get(player);
      if (!pl) return;
      if (i.act === CardAct.Draft) {
        if (s.stage !== "draft" || !pl.offer) return;
        const c = pl.offer[i.a];
        if (c === undefined) return;
        pl.list.push(c);
        pl.offer = null;
        s.activity++;
        return;
      }
      const d = s.duel;
      if (!d || s.stage !== "duel") return;
      const sd = sideOf(d, player);
      if (!sd || d.turn !== sd.idx) return;
      if (i.act === CardAct.Play) play(s, d, sd.me, sd.foe, i.a, i.c, i.b, emit);
      else if (i.act === CardAct.Attack) attack(s, d, sd.me, sd.foe, i.a, i.b, emit);
      else if (i.act === CardAct.End) endTurn(s, d);
    },

    step(s, emit) {
      s.tick++;
      const ps = people(s);
      s.alone = ps.length === 1 ? s.alone + 1 : 0;
      if (s.stage === "waiting" || s.stage === "draft") {
        if (s.stage === "draft" && [...s.players].every(([p, pl]) => s.ctx.isBot(p) || !pl.offer)) s.countdown = Math.min(s.countdown, PAUSE_TICKS / 3);
        if (s.countdown > 0) s.countdown--;
        else {
          // Unpicked offers take the best card.
          for (const pl of s.players.values()) {
            if (pl.offer) {
              const best = [...pl.offer].sort((a, b) => worth(b) - worth(a))[0];
              if (best !== undefined) pl.list.push(best);
              pl.offer = null;
            }
          }
          startDuel(s);
          if (s.stage === "waiting") s.countdown = TICK;
        }
        return;
      }
      const d = s.duel;
      if (s.stage !== "duel" || !d) return;
      d.turnTicks++;
      if (--d.timer <= 0) endTurn(s, d);
      if (d.turnNo > t.turnCap) endDuel(s, null, emit);
    },

    outcome(s): RunOutcome | null {
      if (s.stage !== "done") return null;
      return [...s.players].some(([p, pl]) => !s.ctx.isBot(p) && pl.wins > pl.losses) ? "won" : "lost";
    },

    seats(s, humans) {
      return humans === 1 && s.alone >= ALONE_TICKS ? 1 : 0;
    },

    view(s, player) {
      const d = s.duel;
      const sideView = (side: Side) => ({
        player: side.player,
        hero: side.hero,
        heroMax: side.heroMax,
        mana: side.mana,
        maxMana: side.maxMana,
        hand: side.hand.length,
        deck: side.deck.length,
        board: side.board.map(unitView),
      });
      const me = player !== null ? s.players.get(player) : undefined;
      const mySide = d && player !== null ? sideOf(d, player)?.me : undefined;
      return {
        genre: "cards",
        stage: s.stage,
        duelNo: s.duelNo,
        duels: t.duels,
        countdown: Math.ceil(s.countdown / tickRate),
        duel: d ? { turn: d.sides[d.turn].player, turnNo: d.turnNo, timer: Math.ceil(d.timer / tickRate), tier: d.tier, sides: d.sides.map(sideView) } : null,
        log: s.log.map((l) => ({ ...l })),
        players: [...s.players].map(([id, p]) => ({ id, bot: s.ctx.isBot(id), wins: p.wins, losses: p.losses, draws: p.draws, deck: p.list.length })),
        // What only this player may see: their hand, their draft offer, their own deck list (sorted, never its order in play).
        ...(me ? { hand: mySide ? [...mySide.hand] : [], offer: me.offer ? [...me.offer] : null, list: [...me.list].sort((a, b) => a - b) } : {}),
      };
    },

    entities(_s, _out: EntityState[]) {
      // Nothing but the avatars is networked: every card lives in run state.
    },

    bot(s, player, a, tick, skill) {
      const idle: RulesInput = { mx: 0, mz: 0, cx: Math.round((a.x / UNITS) * 16), cz: Math.round((a.z / UNITS) * 16), act: 0, a: 0, b: 0, c: 0 };
      const pl = s.players.get(player);
      if (!pl) return idle;
      if (s.stage === "draft" && pl.offer) {
        if ((tick + player) % 20 !== 0) return idle;
        const best = pl.offer.map((c, i) => ({ c, i })).sort((x, y) => worth(y.c) - worth(x.c))[0];
        return { ...idle, act: CardAct.Draft, a: best?.i ?? 0 };
      }
      const d = s.duel;
      if (!d) return idle;
      const sd = sideOf(d, player);
      if (!sd || d.turn !== sd.idx) return idle;
      // Think a moment at the start of a turn, then a move every few ticks.
      const think = Math.round(tickRate * (skill >= 1 ? 0.4 : 1.2));
      if (d.turnTicks < think || (d.turnTicks - think) % 6 !== 0) return idle;
      const smart = s.ctx.isBot(player) ? (t.ai[Math.max(0, d.tier)]?.smart ?? 0.5) : skill;
      return aiMove(s, d, sd.me, sd.foe, smart, player * 7919 + tick);
    },

    stats(s): RulesStats {
      let top = 0;
      let scorers = 0;
      let wins = 0;
      let losses = 0;
      for (const [p, pl] of s.players) {
        if (s.ctx.isBot(p)) continue;
        top = Math.max(top, pl.wins);
        if (pl.wins > 0) scorers++;
        wins += pl.wins;
        losses += pl.losses;
      }
      return { kills: wins, wave: Math.max(1, s.duelNo), level: top, deaths: losses, peakUnits: s.peakBoard, scorers, topScore: top };
    },

    activity(s) {
      return s.activity;
    },

    checks(run: RulesHarnessRun): RulesCheck[] {
      const min = Math.round(run.seconds / 6) / 10;
      const duels = run.stats.kills + run.stats.deaths;
      return [
        {
          ok: duels > 0 || run.seconds < 120,
          line: `no duel was decided in ${min} minutes: lower hero health (cardTable health), raise unit attack or cheapen the cards`,
        },
        {
          ok: run.stats.wave >= 2 || run.seconds < 200,
          line: `only ${run.stats.wave} duel(s) started in ${min} minutes: duels run too long (fewer turns to win: lower hero health, more damage)`,
        },
      ];
    },

    progress(run) {
      return Math.min(1, run.stats.wave / Math.max(1, t.duels)) * 0.7 + (run.stats.kills > 0 ? 0.3 : 0);
    },
  };
}
