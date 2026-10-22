// Starts the local host for one game module. `kit play` bundles this file
// together with the template's src/manifest.ts (the creator's src/game.ts in
// place of the template's), so the sim, the engine and the host share one
// copy of every module, and imports the bundle.

import { initSim } from "@netnetcapital/engine-sim";
import { profileSpec } from "@netnetcapital/engine/game";
import type { GameManifest } from "@netnetcapital/engine";
import type { SimAdapter } from "@netnetcapital/engine/net";
import type { LocalAoi } from "./core.js";
import { LocalProfiles } from "./profile.js";
import { startServer, type RunningHost } from "./server.js";

export interface EntryOptions {
  readonly adapter: string;
  readonly manifest: { readonly fn: string; readonly field?: "manifest" };
  readonly seats: number;
  readonly aoi: LocalAoi;
  readonly port: number;
  readonly host: string;
  readonly clientDir: string;
  readonly libraryDir: string | null;
}

type Fn = (...args: unknown[]) => unknown;

export async function startHost(tpl: Readonly<Record<string, unknown>>, o: EntryOptions): Promise<RunningHost & { readonly template: string; readonly place: string; readonly title: string }> {
  await initSim();
  const make = tpl[o.adapter];
  const get = tpl[o.manifest.fn];
  if (typeof make !== "function" || typeof get !== "function") throw new Error(`the template does not export ${o.adapter} and ${o.manifest.fn}`);
  const sim = (make as Fn)() as SimAdapter<unknown, unknown>;
  const got = (get as Fn)() as Record<string, unknown>;
  const manifest = (o.manifest.field ? got[o.manifest.field] : got) as GameManifest;
  const template = typeof tpl.TEMPLATE === "string" ? tpl.TEMPLATE : "";
  const place = typeof tpl.PLACE === "string" ? tpl.PLACE : "local";
  const spec = profileSpec(manifest);
  const storeCommands = new Set<string>();
  for (const [id, s] of manifest.skus) if (!s.grants && s.coins !== undefined) storeCommands.add(id);
  const gameName = typeof tpl.GAME_NAME === "string" ? tpl.GAME_NAME : template;
  const running = await startServer(
    {
      sim,
      template,
      place,
      instanceCap: o.seats,
      aoi: o.aoi,
      profile: spec,
      profiles: new LocalProfiles(gameName, spec),
      storeCommands,
    },
    { port: o.port, host: o.host, clientDir: o.clientDir, libraryDir: o.libraryDir },
  );
  return { ...running, template, place, title: gameName };
}
