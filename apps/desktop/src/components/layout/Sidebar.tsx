import { ScrollArea } from "@arrow/ui";

import { useLayoutStore, type ActivePanel } from "../../stores/layout";

/** The title of every panel of the sidebar. */
const TITLES: Record<ActivePanel, string> = {
  explorer: "Explorer",
  search: "Search",
  git: "Source Control",
  chat: "Chat",
  settings: "Settings",
};

/** The line each panel shows while it waits for its own session. */
const NOTES: Record<ActivePanel, string> = {
  explorer: "The file tree lands in a later session.",
  search: "The search across the workspace lands in a later session.",
  git: "The source control view lands in a later session.",
  chat: "The chat with the assistant lands in a later session.",
  settings: "The settings of the workspace land in a later session.",
};

/**
 * The sidebar of the shell.
 *
 * The sidebar holds the panel of the activity bar that is active. Its width
 * belongs to the layout store, so the width survives a reload and the
 * keyboard shortcuts can close it.
 */
export function Sidebar() {
  const activePanel = useLayoutStore((state) => state.activePanel);

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas-soft" data-testid="sidebar">
      <header className="flex h-8 shrink-0 items-center border-b border-border px-2 text-xs font-medium text-ink">
        {TITLES[activePanel]}
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <p className="p-2 text-xs text-ink-tertiary">{NOTES[activePanel]}</p>
      </ScrollArea>
    </div>
  );
}
