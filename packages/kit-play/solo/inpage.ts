// The room host in the page itself: the fallback when a module worker
// cannot start. Same host, same messages, delivered on the next task so the
// order matches the worker's.

import { entry, template } from "virtual:kit-play-solo";
import { SoloHost } from "./host.js";
import type { ToHost, ToPage } from "./protocol.js";

export async function startInPage(receive: (m: ToPage) => void): Promise<{ post(m: ToHost): void }> {
  const channel = new MessageChannel();
  channel.port2.onmessage = (e: MessageEvent<ToPage>) => receive(e.data);
  const host = await SoloHost.create(template, entry, (m, transfer) => channel.port1.postMessage(m, transfer ?? []));
  return { post: (m) => host.handle(m) };
}
