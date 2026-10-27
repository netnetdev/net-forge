// The messages between a solo demo page and its room host (a Web Worker,
// or the page itself when workers are unavailable). The page side stands in
// for the room server's HTTP routes and its WebSocket; the host side is the
// same room `kit play` runs in Node, minus Colyseus.

/** The room endpoint a solo build is compiled against. Nothing is ever sent to it: the page answers it in memory. */
export const SOLO_ENDPOINT = "http://solo.netforge.invalid";

export type MessageType = string | number;

export type ToHost =
  | { readonly t: "http"; readonly id: number; readonly method: string; readonly path: string; readonly headers: Readonly<Record<string, string>>; readonly body: string | null }
  | { readonly t: "open"; readonly id: number; readonly token: string }
  | { readonly t: "send"; readonly session: string; readonly type: MessageType; readonly data: unknown }
  | { readonly t: "bytes"; readonly session: string; readonly type: number; readonly bytes: Uint8Array }
  | { readonly t: "leave"; readonly session: string };

export type ToPage =
  | { readonly t: "ready" }
  | { readonly t: "fatal"; readonly message: string }
  | { readonly t: "http"; readonly id: number; readonly status: number; readonly body: string }
  | { readonly t: "opened"; readonly id: number; readonly ok: boolean; readonly roomId?: string; readonly session?: string; readonly error?: string }
  | { readonly t: "msg"; readonly session: string; readonly type: MessageType; readonly data: unknown }
  | { readonly t: "bytes"; readonly session: string; readonly type: number; readonly bytes: Uint8Array }
  | { readonly t: "closed"; readonly session: string };

/** What the build tells the host about its template (kit-play's TemplateEntry, minus the package name). */
export interface SoloEntry {
  readonly id: string;
  readonly label: string;
  readonly adapter: string;
  readonly manifest: { readonly fn: string; readonly field?: "manifest" };
  readonly seats: number;
  readonly aoi: {
    readonly radius: number;
    readonly maxEntities: number;
    readonly kindCaps?: Readonly<Record<number, number>>;
    readonly alwaysKinds?: readonly number[];
  };
}
