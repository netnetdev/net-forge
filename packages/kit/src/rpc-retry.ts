// Transient-RPC retry for read paths.
//
// WHY THIS EXISTS. Robinhood Chain's public RPC is a load balancer over several
// backends, and not every backend has state for every block. A read routed to a
// backend that is behind answers with a well-formed JSON-RPC ERROR RESPONSE —
//
//   error code -32000: metadata is not found, 22676822
//
// — rather than a network failure. Retrying the identical call lands on a
// backend that does have the state and succeeds. The same shape reaches a local
// anvil fork second-hand: the fork proxies any storage slot it has not cached
// yet upstream, so an uncached slot can fail once and succeed on the retry that
// populates the cache. The failure is not a contract revert, is not the user's
// fault, and is not actionable by the user.
//
// WHY VIEM'S OWN RETRY IS NOT ENOUGH. viem's http transport retries network
// failures and a handful of HTTP statuses, and among JSON-RPC error codes it
// only retries -32603 (internal) and -32005 (limit exceeded). -32000 is a
// server-defined catch-all that viem passes straight through to the caller, so
// this class of failure surfaces as a hard error — often dressed up as a
// contract revert, because it arrives on the same eth_call that was reading a
// contract. Hence an explicit predicate matched on the error TEXT, which is the
// only place the backend states what actually went wrong.
//
// SAFETY. The predicate matches specific transient phrases, never the bare
// -32000 code (nodes also use -32000 for "execution reverted" and "insufficient
// funds"), and it refuses outright to call anything a decoded contract error —
// a real revert must reach the user as the store's own language, immediately,
// not after three pointless retries. Retries are bounded by BOTH an attempt
// count and a wall-clock deadline, so a genuinely dead RPC fails fast instead of
// hanging a page behind a retry ladder.
//
// Read-only use ONLY. Nothing here may wrap a state-changing send: a retried
// write is a double spend. `simulateContract` and `waitForTransactionReceipt`
// are fair game (both are reads).

/** Backend phrases that mean "ask again", not "this cannot work". */
const TRANSIENT_PATTERNS: readonly RegExp[] = [
  // Robinhood Chain load balancer: backend lacks state for this block.
  /metadata is not found/i,
  /failed to get (storage|account|state|code)/i,
  // Geth / Erigon / Nethermind pruned-or-lagging-state shapes.
  /missing trie node/i,
  /header not found/i,
  /(state|storage) (is )?not available/i,
  /missing state for block/i,
  /no state available/i,
  /state is not available/i,
  /unknown block/i,
  /block (is )?not found/i,
  /block not available/i,
  /required historical state unavailable/i,
  // Cloudflare / rate limiting in front of the same load balancer. The
  // Cloudflare challenge answers a BURST of reads with 403 (documented for
  // this RPC in the repo manual), so 403 is transient here, not auth. Both
  // spellings: node text says "status code 429", viem's HttpRequestError
  // metaMessages say "Status: 403".
  /too many requests/i,
  /rate ?limit/i,
  /status(?: code)?:? (403|429|502|503|504)/i,
  // Network-level shapes viem may surface without retrying them itself.
  //
  // `HTTP request failed` is viem's HttpRequestError shortMessage and it is
  // the shape a player actually sees when Cloudflare bounces the browser
  // (reported live 2026-08-25 on THE BUTTON's approve, at 38 pressers). It
  // was absent here, so the whole class was graded PERMANENT and rethrown on
  // the first attempt — the retry ladder never ran for the one error the
  // public hits most. The status-code patterns above do not cover it: when
  // the challenge answers with a non-JSON body, or the fetch dies before a
  // response, there is no status to match on.
  /HTTP request failed/i,
  /fetch failed/i,
  /socket hang ?up/i,
  /network (request )?failed/i,
  /(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR)/,
  /request timed out/i,
];

/** Depth guard for the cause chain — viem nests several layers deep. */
const MAX_CAUSE_DEPTH = 12;

interface ErrorLike {
  message?: unknown;
  shortMessage?: unknown;
  details?: unknown;
  reason?: unknown;
  metaMessages?: unknown;
  data?: unknown;
  cause?: unknown;
}

function isRecord(x: unknown): x is ErrorLike {
  return typeof x === "object" && x !== null;
}

/** Every text an error and its cause chain carry, flattened for matching. */
function errorTexts(err: unknown): string[] {
  const out: string[] = [];
  let node: unknown = err;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && node !== undefined && node !== null; depth++) {
    if (typeof node === "string") {
      out.push(node);
      break;
    }
    if (!isRecord(node)) break;
    for (const key of ["message", "shortMessage", "details", "reason"] as const) {
      const v = node[key];
      if (typeof v === "string") out.push(v);
    }
    const meta = node.metaMessages;
    if (Array.isArray(meta)) {
      for (const m of meta) if (typeof m === "string") out.push(m);
    }
    node = node.cause;
  }
  return out;
}

/** True when the chain carries a DECODED contract error — a real revert, which
 *  must never be retried or dressed up as a network hiccup. */
function isDecodedContractError(err: unknown): boolean {
  let node: unknown = err;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && isRecord(node); depth++) {
    const data = node.data;
    if (isRecord(data) && typeof (data as { errorName?: unknown }).errorName === "string") {
      return true;
    }
    node = node.cause;
  }
  return false;
}

/**
 * Is this failure the transient backend class that a retry fixes?
 *
 * Exported for tests and for any driver that needs to decide the same thing.
 */
export function isTransientRpcError(err: unknown): boolean {
  if (isDecodedContractError(err)) return false;
  const texts = errorTexts(err);
  if (texts.length === 0) return false;
  return texts.some((t) => TRANSIENT_PATTERNS.some((p) => p.test(t)));
}

/** Retry budget. Deliberately small: three tries inside six seconds, so a busy
 *  backend gets a second chance and a dead one is reported promptly. */
export const RPC_RETRY_DEFAULTS = {
  attempts: 3,
  baseDelayMs: 150,
  deadlineMs: 6_000,
} as const;

export interface RpcRetryOptions {
  /** Total tries including the first. Default 3. */
  attempts?: number;
  /** First backoff, doubled each retry. Default 150 ms (so 150, 300). */
  baseDelayMs?: number;
  /** Wall-clock ceiling for the whole ladder. Default 6000 ms. */
  deadlineMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests. */
  now?: () => number;
  /** An EXTRA retry predicate, ORed with the built-in transient check. The
   *  caller uses it for a failure only IT can recognise as retryable — above
   *  all a revert that carried NO data, where the node echoes the caller's own
   *  calldata selector and there is nothing to decode. That is an opaque
   *  RPC/node result, not a real contract revert (those carry data), and the
   *  caller knows which function it invoked; see `isNoDataRevert`. */
  alsoRetryIf?: (err: unknown) => boolean;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run a READ and retry it while it fails with a transient backend error.
 *
 * Anything else — a contract revert, a bad argument, a placeholder address —
 * is rethrown on the first attempt, untouched. The last transient error is
 * rethrown once the budget is spent, so callers still get the real cause.
 */
export async function retryTransientRead<T>(
  fn: () => Promise<T>,
  options: RpcRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? RPC_RETRY_DEFAULTS.attempts);
  const baseDelayMs = options.baseDelayMs ?? RPC_RETRY_DEFAULTS.baseDelayMs;
  const deadlineMs = options.deadlineMs ?? RPC_RETRY_DEFAULTS.deadlineMs;
  const sleep = options.sleep ?? wait;
  const now = options.now ?? Date.now;

  const startedAt = now();
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransientRpcError(err) && !(options.alsoRetryIf?.(err) ?? false)) throw err;
      if (attempt === attempts - 1) break;
      const delay = baseDelayMs * 2 ** attempt;
      // Do not START a retry we cannot finish inside the budget. A first
      // attempt that burned the whole deadline (a hung backend) stops here.
      if (now() - startedAt + delay >= deadlineMs) break;
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * viem `http()` options for a consumer app on this chain. Kept tight on
 * purpose: the transport handles network-level failure, `retryTransientRead`
 * handles the error-RESPONSE class the transport will not, and neither budget
 * is allowed to grow into a page-length hang.
 */
export const RPC_HTTP_OPTIONS = {
  retryCount: 2,
  retryDelay: 200,
  timeout: 8_000,
} as const;
