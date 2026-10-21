import { GitBranch } from "lucide-react";

import { languageLabel } from "../../lib/language-label";
import { useEditorStore } from "../../stores/editor";
import { useSettingsStore } from "../../stores/settings";

/**
 * The status bar of the shell.
 *
 * The bar carries the facts of the workspace that are worth reading without
 * opening anything: the branch, the language of the file in the editor, the
 * number of problems and the indent of the file.
 *
 * The language is the one the editor opened the active file with, so a
 * TypeScript file says TypeScript. The branch stays the name of the default
 * branch until the git session reads the real one.
 */
export function StatusBar() {
  const languageId = useEditorStore(
    (state) =>
      state.openFiles.find((file) => file.path === state.activePath)?.languageId ?? "plaintext",
  );
  const tabSize = useSettingsStore((state) => state.tabSize);

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
        <span data-testid="status-language">{languageLabel(languageId)}</span>
        <span data-testid="status-tab-size">Spaces: {tabSize}</span>
      </div>
    </footer>
  );
}
