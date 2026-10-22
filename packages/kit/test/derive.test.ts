// Local CREATE3 derivation against vectors computed independently with
// foundry's `cast compute-address` (CREATE2 with the Create3 proxy init code
// hash, then CREATE at nonce 1), for factory 0x…fa and slug "comet-sweep".
// Roles (GameFactory.Role): Token 0, Curve 1, BuybackVault 2, RewardVault 3,
// Store 4.

import { expect, it } from "vitest";
import { deriveGame, slugHash } from "../src/derive.js";

it("matches GameFactory.predict for every role", () => {
  expect(slugHash("comet-sweep")).toBe("0x3edf488baf6ad32d5140ae9ddfd372a282afe2f6f03f5d06c1dcdf756c43e647");
  expect(deriveGame("0x00000000000000000000000000000000000000fa", "comet-sweep")).toEqual({
    token: "0xB1e5850F0a94CCC2379f2FC5Ff188613aA50b9F3",
    curve: "0xBcF7e12974Bb4289B424216CA58c2F6Ff1D4aA78",
    buybackVault: "0xaFE3CB6Dc96Bb1a2923dbC86a54628e855d02f6C",
    rewardVault: "0xa3ea99a5b8d4C7742A8ee68Fe6C443200aE7d853",
    store: "0x02FDf02a958e0D9223E666F8De446796991A7970",
  });
});
