import { TooltipProvider } from "@arrow/ui";

import { useCommandShortcuts, useCommands } from "../../components/command-palette/useCommands";
import { CommandPalette } from "../../components/command-palette/CommandPalette";
import { SettingsDialog } from "../../components/settings/SettingsDialog";
import { useSettingsPersistence } from "../../components/settings/useSettings";
import { useOverlayStore } from "../../stores/overlay";
import { ActivityBar } from "./ActivityBar";
import { StatusBar } from "./StatusBar";
import { Workspace } from "./Workspace";

/**
 * The shell of Arrow.
 *
 * The shell is the frame of the window: the activity bar on the far left, the
 * sidebar next to it, the editor area in the middle, the bottom panel under
 * the editor and the status bar along the bottom. Every region of the plan
 * renders at once, so the frame of the product is visible before the first
 * file is.
 *
 * The shell also owns the two overlays of the window and the one key handler
 * of the command registry, so every shortcut of the product runs a registered
 * command and no shortcut lives in a handler of its own.
 */
export function AppShell() {
  const commands = useCommands();
  const settingsOpen = useOverlayStore((state) => state.settingsOpen);
  const closeSettings = useOverlayStore((state) => state.closeSettings);

  useCommandShortcuts(commands);
  useSettingsPersistence();

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="flex h-full w-full flex-col overflow-hidden bg-canvas text-ink"
        data-testid="app-shell"
      >
        <div className="flex min-h-0 flex-1">
          <ActivityBar />
          <Workspace />
        </div>
        <StatusBar />
        <CommandPalette />
        <SettingsDialog open={settingsOpen} onClose={closeSettings} />
      </div>
    </TooltipProvider>
  );
}
