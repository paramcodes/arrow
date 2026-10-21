import { Plus, X } from "lucide-react";
import { cn } from "@arrow/ui";

import { useTerminalStore } from "../../stores/terminal";

/**
 * The tab bar of the terminal panel.
 *
 * The bar is the map of the open shells: it names every tab, marks the one on
 * screen and closes a tab. The plus button opens a shell, the same way the
 * shortcut does.
 */
export function TerminalTabs() {
  const tabs = useTerminalStore((state) => state.tabs);
  const activeId = useTerminalStore((state) => state.activeId);
  const openTab = useTerminalStore((state) => state.openTab);
  const closeTab = useTerminalStore((state) => state.closeTab);
  const setActive = useTerminalStore((state) => state.setActive);

  return (
    <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border px-2">
      <div aria-label="Terminal tabs" className="flex min-w-0 items-center gap-1" role="tablist">
        {tabs.map((tab) => {
          const selected = tab.id === activeId;

          return (
            <div
              key={tab.id}
              className={cn(
                "flex h-5 items-center rounded-sm pr-0.5 text-[11px] transition-colors",
                selected
                  ? "bg-canvas text-ink"
                  : "text-ink-secondary hover:bg-surface-hover hover:text-ink",
              )}
              data-active={selected ? "true" : "false"}
              data-testid={`terminal-tab-${tab.id}`}
            >
              <button
                aria-selected={selected}
                className="h-full min-w-0 truncate px-1.5"
                data-testid={`terminal-select-${tab.id}`}
                onClick={() => setActive(tab.id)}
                role="tab"
                type="button"
              >
                {tab.title}
              </button>
              <button
                aria-label={`Close ${tab.title}`}
                className="flex h-4 w-4 items-center justify-center rounded-sm text-ink-tertiary hover:bg-surface-hover hover:text-ink"
                data-testid={`terminal-close-${tab.id}`}
                onClick={() => closeTab(tab.id)}
                type="button"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      <button
        aria-label="New terminal"
        className="flex h-5 w-5 items-center justify-center rounded-sm text-ink-tertiary hover:bg-surface-hover hover:text-ink"
        data-testid="terminal-new"
        onClick={() => openTab()}
        type="button"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
