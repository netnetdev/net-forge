// The solo demo's Web Worker: the room host runs here, off the page's main
// thread, exactly as `kit play` runs it in Node. The build points the
// virtual module at the template's src/manifest.ts.

import { entry, template } from "virtual:kit-play-solo";
import { SoloHost } from "./host.js";
import type { ToHost, ToPage } from "./protocol.js";

const scope = self as unknown as {
  postMessage(m: ToPage, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToHost>) => void) | null;
};

const early: ToHost[] = [];
let host: SoloHost | null = null;
scope.onmessage = (e) => {
  if (host) host.handle(e.data);
  else early.push(e.data);
};

SoloHost.create(template, entry, (m, transfer) => scope.postMessage(m, transfer ?? []))
  .then((h) => {
    host = h;
    scope.postMessage({ t: "ready" });
    for (const m of early.splice(0)) h.handle(m);
  })
  .catch((e: unknown) => scope.postMessage({ t: "fatal", message: e instanceof Error ? e.message : String(e) }));
