import { describe, expect, it } from "vitest";
import * as cards from "@netforge/template-cards";
import { MSG_SNAPSHOT } from "@netforge/engine/net";
import { SoloHost } from "../solo/host.js";
import type { ToPage } from "../solo/protocol.js";
import { SOLO_ENDPOINT } from "../src/demo.js";
import { SOLO_ENDPOINT as PAGE_ENDPOINT } from "../solo/protocol.js";
import { TEMPLATES } from "../src/templates.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("the solo host", () => {
  it("is compiled against the endpoint the page answers", () => {
    expect(SOLO_ENDPOINT).toBe(PAGE_ENDPOINT);
    expect(new URL(SOLO_ENDPOINT).hostname.endsWith(".invalid")).toBe(true);
  });

  it("seats a player through /world/join, welcomes them and streams snapshots, with money routes refused", async () => {
    const got: ToPage[] = [];
    const t = TEMPLATES.cards;
    const host = await SoloHost.create(cards as unknown as Record<string, unknown>, { id: t.id, label: t.label, adapter: t.adapter, manifest: t.manifest, seats: t.seats, aoi: t.aoi }, (m) => got.push(m));
    host.handle({ t: "http", id: 1, method: "POST", path: "/auth/sign-in", headers: {}, body: "{}" });
    host.handle({ t: "http", id: 2, method: "POST", path: "/world/join", headers: {}, body: JSON.stringify({ template: cards.TEMPLATE, place: cards.PLACE }) });
    const auth = got.find((m) => m.t === "http" && m.id === 1);
    expect(auth && auth.t === "http" ? auth.status : 0).toBe(403);
    const join = got.find((m) => m.t === "http" && m.id === 2);
    expect(join && join.t === "http" ? join.status : 0).toBe(200);
    const token = join && join.t === "http" ? (JSON.parse(join.body) as { reservations: { sessionId: string }[] }).reservations[0]?.sessionId : undefined;
    expect(token).toBeTruthy();
    host.handle({ t: "open", id: 3, token: token ?? "" });
    const opened = got.find((m) => m.t === "opened");
    expect(opened && opened.t === "opened" ? opened.ok : false).toBe(true);
    const session = opened && opened.t === "opened" ? (opened.session ?? "") : "";
    expect(got.some((m) => m.t === "msg" && m.type === "welcome")).toBe(true);
    // A reservation is good once.
    host.handle({ t: "open", id: 4, token: token ?? "" });
    const again = got.find((m) => m.t === "opened" && m.id === 4);
    expect(again && again.t === "opened" ? again.ok : true).toBe(false);
    host.handle({ t: "send", session, type: "stake", data: {} });
    const stake = got.find((m) => m.t === "msg" && m.type === "stake");
    expect(stake && stake.t === "msg" ? (stake.data as { state: string }).state : "").toBe("refused");
    await sleep(600);
    const snaps = got.filter((m) => m.t === "bytes" && m.type === MSG_SNAPSHOT);
    expect(snaps.length).toBeGreaterThan(3);
    host.handle({ t: "leave", session });
    const n = got.length;
    await sleep(200);
    expect(got.slice(n).some((m) => m.t === "bytes")).toBe(false);
  });
});
