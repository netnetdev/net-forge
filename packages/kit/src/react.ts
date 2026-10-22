// React binding: `const state = useKit()` re-renders on every Kit state
// change. No RPC of its own; it only subscribes to the snapshot.

import { useSyncExternalStore } from "react";
import { kit as defaultKit } from "./index.js";
import type { Kit } from "./kit.js";
import type { KitState } from "./types.js";

export function useKit(instance: Kit = defaultKit): KitState {
  return useSyncExternalStore(instance.subscribe, instance.getState, instance.getState);
}
