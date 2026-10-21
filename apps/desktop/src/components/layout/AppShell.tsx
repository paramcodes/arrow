import { TooltipProvider } from "@arrow/ui";

import { useLayoutShortcuts } from "../../hooks/useLayoutShortcuts";
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
 */
export function AppShell() {
  useLayoutShortcuts();

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
      </div>
    </TooltipProvider>
  );
}
