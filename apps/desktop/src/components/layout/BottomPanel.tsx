import { ScrollArea } from "@arrow/ui";

/**
 * The bottom panel of the shell.
 *
 * The panel holds the terminal and the output of the last run. The terminal
 * itself lands in a later session, so the panel shows the empty state of the
 * terminal.
 */
export function BottomPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas-soft" data-testid="bottom-panel">
      <header className="flex h-7 shrink-0 items-center gap-4 border-b border-border px-2 text-[11px] text-ink-secondary">
        <span className="text-ink">Terminal</span>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <p className="p-2 font-mono text-xs text-ink-tertiary">
          The terminal lands in a later session.
        </p>
      </ScrollArea>
    </div>
  );
}
