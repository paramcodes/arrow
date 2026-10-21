import { useEffect, useMemo } from "react";

import { matchesShortcut } from "../../lib/shortcuts";
import { useEditorStore } from "../../stores/editor";
import { useLayoutStore, type ActivePanel } from "../../stores/layout";
import { useOverlayStore, type PaletteMode } from "../../stores/overlay";
import { createCommands, type Command } from "./commands";

/**
 * The commands of the window, wired to the stores.
 *
 * The registry is built once, because every action reads the store through
 * `getState` when it runs. A command therefore never holds a copy of the open
 * files or of the layout, and the table of commands does not change under a
 * reader who has the palette open.
 */
export function useCommands(): readonly Command[] {
  return useMemo(
    () =>
      createCommands({
        openPalette: (mode: PaletteMode) => useOverlayStore.getState().openPalette(mode),
        openSettings: () => useOverlayStore.getState().openSettings(),
        toggleSidebar: () => useLayoutStore.getState().toggleSidebar(),
        toggleBottomPanel: () => useLayoutStore.getState().toggleBottomPanel(),
        showPanel: (panel: ActivePanel) => {
          const layout = useLayoutStore.getState();
          layout.setActivePanel(panel);
          if (!layout.sidebarOpen) layout.toggleSidebar();
        },
        saveActiveFile: () => {
          const editor = useEditorStore.getState();
          if (editor.activePath) void editor.saveFile(editor.activePath);
        },
        saveAllFiles: () => {
          void useEditorStore.getState().saveAll();
        },
      }),
    [],
  );
}

/**
 * The keyboard shortcuts of the commands.
 *
 * One listener answers every binding of the registry, so a shortcut that the
 * palette shows is the shortcut that runs. The listener reads the shortcut of
 * the command and not a table of its own, which is what keeps the two in step.
 */
export function useCommandShortcuts(commands: readonly Command[]): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      for (const command of commands) {
        if (!command.shortcut) continue;
        if (!matchesShortcut(command.shortcut, event)) continue;

        event.preventDefault();
        command.action();
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commands]);
}
