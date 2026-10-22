// Every game's five contracts (token, curve, buyback vault, reward vault,
// store) sit at CREATE3 addresses that depend only on
// the factory and the slug (contracts/src/games/Create3.sol and
// GameFactory._addresses). The Kit derives them locally, so finding a game
// costs zero calls; the snapshot then checks the factory's own record
// (gameOfToken(token).token == token, and the rest match) before trusting
// any of them.

import { encodeAbiParameters, getContractAddress, keccak256, stringToBytes, type Address, type Hex } from "viem";

/** Create3.PROXY_INITCODE: PUSH8 runtime, MSTORE, RETURN 8 bytes. */
const PROXY_INITCODE: Hex = "0x67363d3d37363d34f03d5260086018f3";
const PROXY_INITCODE_HASH = keccak256(PROXY_INITCODE);

/** GameFactory.Role, in declaration order. */
export const Role = { Token: 0, Curve: 1, BuybackVault: 2, RewardVault: 3, Store: 4 } as const;

export interface GameAddresses {
  token: Address;
  /** GameCurve: the bonding curve until graduation. */
  curve: Address;
  /** BuybackVault: the 12-hour buy-and-burn, then the drip. */
  buybackVault: Address;
  rewardVault: Address;
  store: Address;
}

/** GameFactory.slugHashOf: keccak256(bytes(slug)). */
export function slugHash(slug: string): Hex {
  return keccak256(stringToBytes(slug));
}

/** Create3.predict(deployer, salt). */
export function create3Address(deployer: Address, salt: Hex): Address {
  const proxy = getContractAddress({ opcode: "CREATE2", from: deployer, salt, bytecodeHash: PROXY_INITCODE_HASH });
  return getContractAddress({ opcode: "CREATE", from: proxy, nonce: 1n });
}

/** GameFactory.predict(slugHash), computed locally. */
export function deriveGame(factory: Address, slug: string): GameAddresses {
  const h = slugHash(slug);
  const at = (role: number) => create3Address(factory, keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint8" }], [h, role])));
  return {
    token: at(Role.Token),
    curve: at(Role.Curve),
    buybackVault: at(Role.BuybackVault),
    rewardVault: at(Role.RewardVault),
    store: at(Role.Store),
  };
}
