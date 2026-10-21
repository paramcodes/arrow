import { GitBranch } from "lucide-react";

/**
 * The status bar of the shell.
 *
 * The bar carries the facts of the workspace that are worth reading without
 * opening anything: the branch, the language of the file in the editor, the
 * number of problems and the indent of the file.
 */
export function StatusBar() {
  return (
    <footer
      className="flex h-6 shrink-0 items-center justify-between gap-4 border-t border-border bg-canvas-soft px-2 text-[11px] text-ink-secondary"
      data-testid="status-bar"
    >
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1 text-ink">
          <GitBranch className="h-3 w-3" />
          main
        </span>
        <span>0 problems</span>
      </div>
      <div className="flex items-center gap-3">
        <span>Plain Text</span>
        <span>Spaces: 2</span>
      </div>
    </footer>
  );
}
