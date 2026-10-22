// The Launcher's Kit flags: framed play names the game's own coin and title
// and says whether play pays; standalone play reads none of it.
import { describe, expect, it } from "vitest";
import { hostFlags, namedPlayer, playerFrom, storeNote } from "../client/host.js";

const flags = (q: string) => hostFlags(new URLSearchParams(q));

describe("host flags", () => {
  it("standalone play is untouched", () => {
    expect(flags("room=abc")).toEqual({ framed: false, coin: null, title: null, player: "earning" });
    // A player flag without the host flag is ignored.
    expect(flags("player=guest").player).toBe("earning");
  });

  it("reads the game's own coin and title from the Launcher", () => {
    const f = flags("host=netnet&coin=RG&title=Robot%20Gladiators&player=guest");
    expect(f).toEqual({ framed: true, coin: "RG", title: "Robot Gladiators", player: "guest" });
    expect(flags("host=netnet&player=play").player).toBe("play");
  });

  it("refuses a coin the token could not have and trims the title", () => {
    expect(flags("host=netnet&coin=toolong1").coin).toBeNull();
    expect(flags("host=netnet&coin=rg").coin).toBeNull();
    expect(flags(`host=netnet&title=${encodeURIComponent("  A\n\tB ")}`).title).toBe("A B");
    expect(flags(`host=netnet&title=${"x".repeat(60)}`).title).toHaveLength(40);
    expect(flags("host=netnet&player=nope").player).toBe("earning");
  });

  it("accepts only the host's player message", () => {
    expect(playerFrom({ kind: "netnet-kit", type: "player", mode: "earning" })).toBe("earning");
    expect(playerFrom({ kind: "netnet-kit", type: "player", mode: "guest" })).toBe("guest");
    expect(playerFrom({ kind: "netnet-kit", type: "player", mode: "rich" })).toBeNull();
    expect(playerFrom({ kind: "other", type: "player", mode: "guest" })).toBeNull();
    expect(playerFrom("guest")).toBeNull();
  });

  it("knows when the host has named the player mode", () => {
    expect(namedPlayer(new URLSearchParams("host=netnet&player=play"))).toBe("play");
    expect(namedPlayer(new URLSearchParams("host=netnet&player=guest"))).toBe("guest");
    // A connected player on a live game gets no flag, only the posted message.
    expect(namedPlayer(new URLSearchParams("host=netnet"))).toBeNull();
    expect(namedPlayer(new URLSearchParams("player=play"))).toBeNull();
    expect(namedPlayer(new URLSearchParams("host=netnet&player=nope"))).toBeNull();
  });

  it("the store's note follows the host's mode, not the room, once the host names one", () => {
    // Live and connected: never play money, whatever the room says.
    expect(storeNote("earning", false, "WICK")).toBe("");
    expect(storeNote("guest", false, "WICK")).toBe("Connect a wallet to earn WICK");
    expect(storeNote("play", true, "LK")).toBe("Play money until launch");
    // Standalone, or a host that names no mode (the studio): the room decides.
    expect(storeNote(null, true, "WICK")).toBe("");
    expect(storeNote(null, false, "WICK")).toBe("Play money until launch");
  });
});
