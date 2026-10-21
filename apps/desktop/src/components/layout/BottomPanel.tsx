import { useLayoutStore } from "../../stores/layout";
import { TerminalManager } from "../terminal/TerminalManager";

/**
 * The bottom panel of the shell.
 *
 * The panel holds the integrated terminal. It mounts the terminal manager
 * once and never unmounts it, so closing the panel hides the terminals
 * instead of killing the shells. The panel reads its own visibility from the
 * layout store, because the manager only starts a session when the panel is
 * actually on screen.
 */
export function BottomPanel() {
  const bottomPanelOpen = useLayoutStore((state) => state.bottomPanelOpen);

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas-soft" data-testid="bottom-panel">
      <TerminalManager visible={bottomPanelOpen} />
    </div>
  );
}
