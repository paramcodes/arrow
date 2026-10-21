import { useEffect } from "react";

import { useEditorStore } from "../stores/editor";

/**
 * The keyboard shortcuts of the editor.
 *
 * `Cmd+S` writes the active file and `Cmd+Shift+S` writes every dirty file.
 * The handler reads the store when the key is pressed, so it never holds a
 * stale copy of the open files.
 */
export function useEditorShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta || event.key.toLowerCase() !== "s") return;

      event.preventDefault();
      const state = useEditorStore.getState();

      if (event.shiftKey) {
        void state.saveAll();
        return;
      }

      if (state.activePath) void state.saveFile(state.activePath);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
