import { useEffect, useRef } from "react";

import { useTerminalStore } from "../../stores/terminal";
import { Terminal } from "./Terminal";
import { TerminalTabs } from "./TerminalTabs";

/** The props of the terminal panel. */
export interface TerminalManagerProps {
  /** True when the bottom panel is open. */
  readonly visible: boolean;
}

/**
 * The terminal half of the bottom panel.
 *
 * The manager owns the tabs and renders one terminal per tab. A terminal that
 * is not on screen keeps its session, so switching tabs does not kill a shell
 * and does not lose the scrollback of the other one.
 *
 * The first tab opens when the panel opens, and only then, so a closed panel
 * never starts a process. `Ctrl+Shift+`` ` `` opens a new terminal from
 * anywhere in the window.
 */
export function TerminalManager({ visible }: TerminalManagerProps) {
  const tabs = useTerminalStore((state) => state.tabs);
  const activeId = useTerminalStore((state) => state.activeId);
  const openTab = useTerminalStore((state) => state.openTab);
  const wasVisible = useRef(false);

  useEffect(() => {
    if (visible && !wasVisible.current && tabs.length === 0) openTab();
    wasVisible.current = visible;
  }, [visible, tabs.length, openTab]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
      // Shift turns the backquote into a tilde on most layouts, so the binding
      // reads the physical key and never the character it produces.
      if (event.code !== "Backquote") return;

      event.preventDefault();
      openTab();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openTab]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="terminal-manager">
      <TerminalTabs />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {tabs.length === 0 ? (
          <p className="p-2 text-xs text-ink-tertiary">No terminal is open.</p>
        ) : null}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={tab.id === activeId ? "absolute inset-0" : "hidden"}
            data-testid={`terminal-host-${tab.id}`}
          >
            <Terminal active={tab.id === activeId} tabId={tab.id} visible={visible} />
          </div>
        ))}
      </div>
    </div>
  );
}
