/**
 * The buy-in run in the store panel (earn.stake, the mandatory sink loop).
 * The player picks an amount inside the game's terms and stakes it: the Kit
 * spends it under the reason "stake" (earned coins first, then the wallet),
 * then the room is told. The room fixes the stake from its own ledger when
 * the next run starts (or this one, if it only just began) and says so.
 */
import type { PotMessage, StakeMessage, StakeTermsView } from "@netnetcapital/engine/net";
import type { KitStoreBridge } from "./kit.js";

export interface StakeConn {
  readonly welcome: { readonly stake?: StakeTermsView };
  stake(amount?: number): void;
  onStake(cb: (m: StakeMessage) => void): void;
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US");

/** Wires #stake-amount, #stake-go and #stake-line; hides #stake-row when the game takes no stakes. */
export function wireStake(conn: StakeConn, kit: KitStoreBridge, toast: (t: string) => void): void {
  const row = document.getElementById("stake-row");
  const input = document.getElementById("stake-amount") as HTMLInputElement | null;
  const go = document.getElementById("stake-go") as HTMLButtonElement | null;
  const line = document.getElementById("stake-line");
  const terms = conn.welcome.stake;
  if (!row || !input || !go || !line) return;
  if (!terms) {
    row.style.display = "none";
    return;
  }
  const sym = kit.coins.symbol();
  input.min = String(terms.min);
  input.max = String(terms.max);
  input.step = "any";
  input.value = String(terms.min);
  const idle = () => {
    const a = Number(input.value) || terms.min;
    line.textContent = `Up to ${fmt(a * terms.multiple)} ${sym} back`;
  };
  idle();
  input.addEventListener("input", idle);
  go.addEventListener("click", async () => {
    const a = Number(input.value);
    if (!(a >= terms.min && a <= terms.max)) return toast(`Stake ${fmt(terms.min)} to ${fmt(terms.max)} ${sym}`);
    go.disabled = true;
    try {
      await kit.coins.spend(a, "stake");
      conn.stake(a);
    } catch {
      toast(`Not enough ${sym}`);
    } finally {
      go.disabled = false;
    }
  });
  conn.onStake((m) => {
    if (m.state === "live") line.textContent = `Staked ${fmt(m.stake)}, up to ${fmt(m.ceiling ?? 0)} ${sym} this run`;
    else if (m.state === "waiting") line.textContent = m.stake > 0 ? `Next run: ${fmt(m.stake)} ${sym}` : "Stake waits for tomorrow's cap";
    else if (m.state === "closed") {
      toast(`Stake ${fmt(m.stake)} ${sym}  ${fmt(m.paid ?? 0)} back${m.lost && m.lost.length > 0 ? `  ·  gear lost` : ""}`);
      idle();
    } else toast(m.reason === "sign in to stake" ? "Sign in to stake" : "Stake not taken");
  });
}

/** One losable gear SKU (store.sku grants { gear, loseBelow }): a buy button and its loss line. Hides #gear-row without one. */
export function wireGear(gear: { id: string; name: string; coins: number; loseBelow: number } | null, kit: KitStoreBridge, toast: (t: string) => void): void {
  const row = document.getElementById("gear-row");
  const name = document.getElementById("gear-name");
  const line = document.getElementById("gear-line");
  const buy = document.getElementById("gear-buy") as HTMLButtonElement | null;
  if (!row || !name || !line || !buy) return;
  if (!gear) {
    row.style.display = "none";
    return;
  }
  const sym = kit.coins.symbol();
  name.textContent = gear.name;
  line.textContent = `Staked runs only. Lost under ${Math.round(gear.loseBelow * 100)}% of a run's earn`;
  const show = () => {
    buy.textContent = kit.store.owns(gear.id) ? "Owned" : `${gear.coins} ${sym}`;
    buy.disabled = kit.store.owns(gear.id);
  };
  show();
  buy.addEventListener("click", async () => {
    try {
      await kit.store.buy(gear.id, { pay: "coins" });
    } catch {
      toast(`Not enough ${sym}`);
    }
    show();
  });
}

/** The game's first gear SKU from its manifest, with its label. */
export function gearOf(skus: ReadonlyMap<string, { coins?: number; grants?: unknown }>, names: Readonly<Record<string, string>>): { id: string; name: string; coins: number; loseBelow: number } | null {
  for (const [id, s] of skus) {
    const g = s.grants as { gear?: string; loseBelow?: number } | undefined;
    if (g?.gear && typeof g.loseBelow === "number" && s.coins !== undefined) return { id, name: names[id] ?? id, coins: s.coins, loseBelow: g.loseBelow };
  }
  return null;
}

export interface PotConn {
  readonly welcome: { readonly pot?: { readonly entry: number; readonly recycle: number } };
  pot(): void;
  onPot(cb: (m: PotMessage) => void): void;
}

/** The round's PvP pot: #pot-go pays the entry and tells the room; #pot-line shows the pot. Hides #pot-row without one. */
export function wirePot(conn: PotConn, kit: KitStoreBridge, toast: (t: string) => void): void {
  const row = document.getElementById("pot-row");
  const go = document.getElementById("pot-go") as HTMLButtonElement | null;
  const line = document.getElementById("pot-line");
  const pot = conn.welcome.pot;
  if (!row || !go || !line) return;
  if (!pot) {
    row.style.display = "none";
    return;
  }
  const sym = kit.coins.symbol();
  const idle = `${fmt(pot.entry)} ${sym} in. The round splits it`;
  line.textContent = idle;
  go.textContent = `${fmt(pot.entry)} ${sym}`;
  go.addEventListener("click", async () => {
    go.disabled = true;
    try {
      await kit.coins.spend(pot.entry, "pot");
      conn.pot();
    } catch {
      toast(`Not enough ${sym}`);
    } finally {
      go.disabled = false;
    }
  });
  conn.onPot((m) => {
    if (m.state === "in") line.textContent = `In. Pot ${fmt(m.pot ?? m.entry)} ${sym}`;
    else if (m.state === "waiting") line.textContent = "In the next round";
    else if (m.state === "closed") {
      toast(`Pot ${fmt(m.pot ?? 0)} ${sym}  ${fmt(m.paid ?? 0)} to you`);
      line.textContent = idle;
    } else toast(m.reason === "sign in to enter" ? "Sign in to enter" : "Not entered");
  });
}
