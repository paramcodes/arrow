import { FolderOpen } from "lucide-react";
import { ScrollArea } from "@arrow/ui";

import { useLayoutStore, type ActivePanel } from "../../stores/layout";
import { chooseProject } from "../../stores/project";
import { FileTree } from "../sidebar/FileTree";
import { SearchPanel } from "../sidebar/SearchPanel";

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
  explorer: "The files of the workspace.",
  search: "The text of every file of the workspace.",
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
      <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-2 text-xs font-medium text-ink">
        <span className="truncate">{TITLES[activePanel]}</span>
        <button
          type="button"
          className="shrink-0 rounded-sm p-1 text-ink-tertiary hover:bg-surface-hover hover:text-ink focus-visible:ring-1 focus-visible:ring-focus-ring focus-visible:outline-none"
          data-testid="open-folder"
          title="Open Folder"
          aria-label="Open Folder"
          onClick={() => {
            void chooseProject();
          }}
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </button>
      </header>
      {activePanel === "search" ? (
        <SearchPanel />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          {activePanel === "explorer" ? (
            <FileTree />
          ) : (
            <p className="p-2 text-xs text-ink-tertiary">{NOTES[activePanel]}</p>
          )}
        </ScrollArea>
      )}
    </div>
  );
}
