// Shape check for attestations from the referee: untrusted JSON, matched
// to the JSON the Net Forge room server's referee sends.

import type { Address, KitAttestation } from "./types.js";

const isAddr = (x: unknown): x is Address => typeof x === "string" && /^0x[0-9a-fA-F]{40}$/.test(x);

/** Shape check for an attestation from the referee (untrusted JSON). */
export function isAttestation(x: unknown): x is KitAttestation {
  if (typeof x !== "object" || x === null) return false;
  const a = x as Record<string, unknown>;
  const hex = (v: unknown, n?: number) => typeof v === "string" && /^0x[0-9a-fA-F]*$/.test(v) && (n === undefined || v.length === 2 + n * 2);
  return isAddr(a["vault"]) && isAddr(a["player"]) && typeof a["rule"] === "string" && hex(a["runId"]) && typeof a["ruleId"] === "number"
    && Number.isInteger(a["ruleId"]) && typeof a["amount"] === "string" && /^\d+$/.test(a["amount"]) && hex(a["nonce"], 32)
    && typeof a["paidEntry"] === "boolean" && typeof a["expiry"] === "string" && /^\d+$/.test(a["expiry"]) && typeof a["verified"] === "boolean"
    && hex(a["signature"]);
}
