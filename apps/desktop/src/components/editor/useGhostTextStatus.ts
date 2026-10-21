import { useSyncExternalStore } from "react";

import { ghostTextActor, type GhostTextStatus } from "./ghostTextMachine";

/**
 * The state of the ghost text of the window.
 *
 * The hook reads the value of the machine and nothing else, so a keystroke
 * that does not change the state does not repaint the bar that shows it. The
 * workflow belongs to the window and not to a file: the window has one
 * provider, one model and one key, and the status bar shows one state.
 */
export function useGhostTextStatus(): GhostTextStatus {
  return useSyncExternalStore(
    (onChange) => {
      const subscription = ghostTextActor().subscribe(() => onChange());
      return () => subscription.unsubscribe();
    },
    () => ghostTextActor().getSnapshot().value as GhostTextStatus,
  );
}
