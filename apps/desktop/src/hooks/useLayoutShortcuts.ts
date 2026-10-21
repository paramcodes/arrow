import { useEffect } from "react";

import { useLayoutStore } from "../stores/layout";

/**
 * The name of the event the shell sends when the command palette is asked
 * for. The palette itself lands in a later session, so the shortcut only
 * announces the request.
 */
export const COMMAND_PALETTE_EVENT = "arrow:command-palette";

/**
 * The name of the event the shell sends when the settings are asked for.
 */
export const SETTINGS_EVENT = "arrow:settings";

/**
 * The keyboard shortcuts of the shell.
 *
 * The shortcuts read the store, so they behave the same way as the buttons
 * of the activity bar.
 */
export function useLayoutShortcuts(): void {
  const toggleSidebar = useLayoutStore((state) => state.toggleSidebar);
  const toggleBottomPanel = useLayoutStore((state) => state.toggleBottomPanel);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;

      const key = event.key.toLowerCase();

      if (key === "b") {
        event.preventDefault();
        toggleSidebar();
        return;
      }

      if (key === "`") {
        event.preventDefault();
        toggleBottomPanel();
        return;
      }

      if (key === "p" && event.shiftKey) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_EVENT));
        return;
      }

      if (key === ",") {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(SETTINGS_EVENT));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar, toggleBottomPanel]);
}
