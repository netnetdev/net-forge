/**
 * Net Forge as host. Framed by Net Forge, the page URL carries
 * the Kit flags and the host posts one message; played on its own, none of
 * this applies and the game behaves exactly as before.
 *
 *   ?host=netnet       the host draws Invite and sign-in; the game hides its own
 *   ?coin=TICKER       the coin the HUD names (2 to 6 capitals or digits)
 *   ?title=NAME        the game's own name for the wordmark and the tab title
 *   ?player=guest      no wallet is connected: play pays nothing, and the HUD
 *                      says "not earning" instead of a balance
 *   ?player=play       the token has not launched: coins are play money
 *
 * The player flag changes while the game runs (a wallet connects), so the
 * host also posts { kind: "netnet-kit", type: "player", mode }. Only the
 * parent window is listened to, and only when the URL says it is the host.
 */

export type PlayerMode = "earning" | "guest" | "play";

export interface HostFlags {
  /** Framed by Net Forge. */
  readonly framed: boolean;
  /** The coin's ticker, when the host names one. */
  readonly coin: string | null;
  /** The game's own name, when the host names one. */
  readonly title: string | null;
  /** What play pays the person at the screen. Standalone play is "earning" (the game's own kit decides). */
  readonly player: PlayerMode;
}

const TICKER_RE = /^[A-Z0-9]{2,6}$/;

export function hostFlags(params: URLSearchParams): HostFlags {
  const framed = params.get("host") === "netnet";
  const coin = params.get("coin");
  // eslint-disable-next-line no-control-regex
  const title = (params.get("title") ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  const player = params.get("player");
  return {
    framed,
    coin: coin && TICKER_RE.test(coin) ? coin : null,
    title: title || null,
    player: framed && (player === "guest" || player === "play") ? player : "earning",
  };
}

/**
 * The player mode the host named on the URL, or null when it named none (a
 * connected player on a live game gets no flag, only the posted message) or
 * the page is not framed by Net Forge.
 */
export function namedPlayer(params: URLSearchParams): PlayerMode | null {
  if (params.get("host") !== "netnet") return null;
  const player = params.get("player");
  return player === "earning" || player === "guest" || player === "play" ? player : null;
}

/**
 * The store's note under its prices, from one source of truth. Once the host
 * has named the player mode (on the URL or in a message), that mode decides,
 * exactly as it does for the coin box: a live game never calls its coins play
 * money. Standalone play, or a host that names no mode (the studio's drafts),
 * keeps the room's own word (`welcome.earnLive`).
 */
export function storeNote(hostMode: PlayerMode | null, earnLive: boolean, symbol: string): string {
  if (hostMode === "play") return "Play money until launch";
  if (hostMode === "guest") return `Connect a wallet to earn ${symbol}`;
  if (hostMode === "earning") return "";
  return earnLive ? "" : "Play money until launch";
}

/** A host message, checked: anything else is ignored. */
export function playerFrom(data: unknown): PlayerMode | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m["kind"] !== "netnet-kit" || m["type"] !== "player") return null;
  const mode = m["mode"];
  return mode === "earning" || mode === "guest" || mode === "play" ? mode : null;
}

/** Calls `cb` with each player mode the host posts. Framed pages only. */
export function onHostPlayer(flags: HostFlags, cb: (mode: PlayerMode) => void): void {
  if (!flags.framed || window.parent === window) return;
  window.addEventListener("message", (e: MessageEvent<unknown>) => {
    if (e.source !== window.parent) return;
    const mode = playerFrom(e.data);
    if (mode) cb(mode);
  });
}

/** Tells the host the game is up, so it can post the current player mode. */
export function postReady(flags: HostFlags): void {
  if (!flags.framed || window.parent === window) return;
  // The host's origin is not known to an opaque-origin frame; the message is one public flag.
  window.parent.postMessage({ kind: "netnet-kit", type: "ready" }, "*");
}
