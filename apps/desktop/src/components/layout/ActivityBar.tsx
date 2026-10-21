import { Files, GitBranch, MessageSquare, Search, Settings, Terminal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, cn } from "@arrow/ui";

import { useLayoutStore, type ActivePanel } from "../../stores/layout";

/** One panel of the activity bar. */
interface ActivityItem {
  readonly panel: ActivePanel;
  readonly label: string;
  readonly icon: LucideIcon;
}

const ITEMS: readonly ActivityItem[] = [
  { panel: "explorer", label: "Explorer", icon: Files },
  { panel: "search", label: "Search", icon: Search },
  { panel: "git", label: "Source Control", icon: GitBranch },
  { panel: "chat", label: "Chat", icon: MessageSquare },
  { panel: "settings", label: "Settings", icon: Settings },
];

/**
 * The activity bar.
 *
 * The bar is the map of the shell: it names the panel that is open in the
 * sidebar and it toggles the bottom panel. The panel that is open carries an
 * accent bar on its left edge, so the state of the shell is readable without
 * a tooltip.
 */
export function ActivityBar() {
  const activePanel = useLayoutStore((state) => state.activePanel);
  const sidebarOpen = useLayoutStore((state) => state.sidebarOpen);
  const bottomPanelOpen = useLayoutStore((state) => state.bottomPanelOpen);
  const setActivePanel = useLayoutStore((state) => state.setActivePanel);
  const toggleSidebar = useLayoutStore((state) => state.toggleSidebar);
  const toggleBottomPanel = useLayoutStore((state) => state.toggleBottomPanel);

  return (
    <nav
      aria-label="Activity"
      className="flex w-12 shrink-0 flex-col items-center justify-between border-r border-border bg-canvas-soft py-1"
      data-testid="activity-bar"
    >
      <div className="flex flex-col items-center gap-0.5">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activePanel === item.panel && sidebarOpen;

          return (
            <Tooltip key={item.panel}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={item.label}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "relative flex h-9 w-9 items-center justify-center rounded-sm transition-colors",
                    active
                      ? "text-ink"
                      : "text-ink-tertiary hover:bg-surface-hover hover:text-ink-secondary",
                  )}
                  data-active={active ? "true" : "false"}
                  data-testid={`activity-${item.panel}`}
                  onClick={() => {
                    setActivePanel(item.panel);
                    if (!sidebarOpen) toggleSidebar();
                  }}
                >
                  <Icon className="h-4 w-4" />
                  {active ? (
                    <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-sm bg-accent" />
                  ) : null}
                </button>
              </TooltipTrigger>
              <TooltipContent>{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Terminal"
            aria-current={bottomPanelOpen ? "true" : undefined}
            className={cn(
              "relative flex h-9 w-9 items-center justify-center rounded-sm transition-colors",
              bottomPanelOpen
                ? "text-ink"
                : "text-ink-tertiary hover:bg-surface-hover hover:text-ink-secondary",
            )}
            data-active={bottomPanelOpen ? "true" : "false"}
            data-testid="activity-terminal"
            onClick={toggleBottomPanel}
          >
            <Terminal className="h-4 w-4" />
            {bottomPanelOpen ? (
              <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-sm bg-accent" />
            ) : null}
          </button>
        </TooltipTrigger>
        <TooltipContent>Terminal</TooltipContent>
      </Tooltip>
    </nav>
  );
}
