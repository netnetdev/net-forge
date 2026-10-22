// Every Kit failure is a KitError with a stable code and a one-line fix,
// written for an AI coding agent to read and act on (cabinet-launcher.md §3).

export const KIT_ERRORS = {
  NOT_INITIALIZED: "Call `await kit.init({ game: \"<slug>\" })` once when the game opens, before any other kit call.",
  ALREADY_INITIALIZED: "Call kit.init once per page. Use kit.refresh() only after an event outside the game, never on a timer.",
  BAD_GAME_SLUG: "Pass the slug from netnet.config.json: lowercase letters, digits and dashes, 3 to 32 characters.",
  PLACEHOLDER_ADDRESS: "A NetNet contract this needs is not deployed yet. Run the game with { mock: true } until it is.",
  GAME_NOT_FOUND: "No game with this slug is registered on GameFactory. Check the slug, or run in mock mode until the game launches.",
  NO_WALLET: "Call `await kit.wallet.connect()` from a click handler before buying, spending, cashing out or claiming.",
  WRONG_CHAIN: "Approve the switch to Robinhood Chain (id 4663) in the wallet, then retry.",
  USER_REJECTED: "The player declined in the wallet. Show the action again; do not retry automatically.",
  UNKNOWN_SKU: "Use a SKU id that exists in netnet.config.json \"store\" and on the game's vault.",
  SKU_NOT_PRICED: "This SKU has no price in the chosen currency. Pass { pay: \"usdg\" } or { pay: \"token\" } to match its price.",
  SKU_INACTIVE: "The creator has paused this SKU. Hide its buy button.",
  STORE_HALTED: "The store is halted by the creator. Hide buy buttons until it reopens.",
  INSUFFICIENT_BALANCE: "The wallet does not hold enough. Offer kit.token.buy(usd) or a smaller amount.",
  BAD_AMOUNT: "Pass a positive amount as a number or decimal string in whole units (tokens or dollars), or a bigint of raw units.",
  NO_LIQUIDITY: "No price is known yet (the pools hold no liquidity). Hide buy and cash out until kit.refresh() shows one.",
  WALLET_CAP: "Before graduation each wallet may put at most the curve's cap in (kit.token.curve().walletRoomUsd). Buy a smaller amount.",
  NOT_GRADUATED: "This needs the game's market, which opens when the bonding curve graduates. Until kit.token.graduated() is true, buy and sell with kit.token.buy and kit.token.cashOut (the curve).",
  NO_REFEREE: "Pass { referee: \"https://...\" } to kit.init, or run with { mock: true }. Earn is decided by the referee, never the browser.",
  REFEREE_REJECTED: "The referee did not grant this event. Nothing to claim; do not retry the same event.",
  NOTHING_TO_CLAIM: "No pending reward. Call kit.earn.report(...) when the player earns first.",
  PRELAUNCH: "Coins are play money until the game launches. Balance and spend work the same; hide buy, claim and cash out until kit.coins.mode() is \"live\".",
  TX_REVERTED: "The transaction reverted on chain. Refresh with kit.refresh() and show the error; do not resend blindly.",
  RPC_ERROR: "The chain read failed. Show a retry button that calls kit.refresh(); never retry on a timer.",
} as const;

export type KitErrorCode = keyof typeof KIT_ERRORS;

export class KitError extends Error {
  readonly code: KitErrorCode;
  /** One line telling the caller (usually an agent) what to change. */
  readonly fix: string;
  override readonly cause?: unknown;

  constructor(code: KitErrorCode, detail?: string, cause?: unknown) {
    const fix = KIT_ERRORS[code];
    super(`[${code}] ${detail ?? fix}${detail ? ` Fix: ${fix}` : ""}`);
    this.name = "KitError";
    this.code = code;
    this.fix = fix;
    this.cause = cause;
  }
}

export function isKitError(err: unknown): err is KitError {
  return err instanceof KitError;
}

/** Map a wallet or viem error onto a KitError without losing the cause. */
export function toKitError(err: unknown, fallback: KitErrorCode = "TX_REVERTED"): KitError {
  if (err instanceof KitError) return err;
  const text = errorText(err);
  if (/user (rejected|denied)|rejected the request|4001/i.test(text)) return new KitError("USER_REJECTED", undefined, err);
  if (/insufficient (funds|balance)|transfer amount exceeds balance/i.test(text)) return new KitError("INSUFFICIENT_BALANCE", undefined, err);
  if (/chain mismatch|wrong chain|does not match the target chain/i.test(text)) return new KitError("WRONG_CHAIN", undefined, err);
  return new KitError(fallback, firstLine(text), err);
}

function errorText(err: unknown): string {
  const parts: string[] = [];
  let node: unknown = err;
  for (let i = 0; i < 8 && node; i++) {
    if (typeof node === "string") {
      parts.push(node);
      break;
    }
    if (typeof node !== "object") break;
    const rec = node as { shortMessage?: unknown; message?: unknown; code?: unknown; cause?: unknown };
    if (typeof rec.shortMessage === "string") parts.push(rec.shortMessage);
    if (typeof rec.message === "string") parts.push(rec.message);
    if (typeof rec.code === "number") parts.push(String(rec.code));
    node = rec.cause;
  }
  return parts.join(" | ");
}

function firstLine(s: string): string | undefined {
  const line = s.split("\n")[0]?.trim();
  return line && line.length > 0 ? line.slice(0, 240) : undefined;
}
