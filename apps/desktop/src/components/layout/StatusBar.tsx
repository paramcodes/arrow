import { Check, Circle, GitBranch, X } from "lucide-react";
import { useEffect } from "react";

import { languageLabel } from "../../lib/language-label";
import { hasApiKey } from "../../lib/ai";
import { aiConnectionState } from "../editor/ghostTextMachine";
import { useGhostTextStatus } from "../editor/useGhostTextStatus";
import { useAiStore } from "../../stores/ai";
import { useEditorStore } from "../../stores/editor";
import { useProjectStore } from "../../stores/project";
import { useSettingsStore } from "../../stores/settings";

/**
 * The status bar of the shell.
 *
 * The bar carries the facts of the workspace that are worth reading without
 * opening anything: the branch of the project, the number of files that
 * changed, the language of the file in the editor, the number of problems,
 * the indent of the file and the state of the AI feature.
 *
 * The language is the one the editor opened the active file with, so a
 * TypeScript file says TypeScript. The branch and the counts come from the
 * project store, which read them from the shell once, so the bar never asks
 * the shell for the state of the repository while the reader works.
 *
 * The state of the AI feature is the one the workflow of the suggestion
 * reports, and the key of the provider is the one the store holds. The bar
 * asks the shell for the key once and never holds the key itself: the shell
 * answers with a boolean.
 */
export function StatusBar() {
  const languageId = useEditorStore(
    (state) =>
      state.openFiles.find((file) => file.path === state.activePath)?.languageId ?? "plaintext",
  );
  const tabSize = useSettingsStore((state) => state.tabSize);
  const branch = useProjectStore((state) => state.branch);
  const modified = useProjectStore((state) => state.status.modified);
  const untracked = useProjectStore((state) => state.status.untracked);
  const insertions = useProjectStore((state) => state.diffStat.insertions);
  const deletions = useProjectStore((state) => state.diffStat.deletions);

  const provider = useAiStore((state) => state.provider);
  const hasKey = useAiStore((state) => state.hasKey);
  const setHasKey = useAiStore((state) => state.setHasKey);
  const ghostText = useGhostTextStatus();
  const ai = aiConnectionState(ghostText, hasKey);

  useEffect(() => {
    let cancelled = false;

    void hasApiKey(provider).then((exists) => {
      if (cancelled) return;
      setHasKey(exists);
    });

    return () => {
      cancelled = true;
    };
  }, [provider, setHasKey]);

  return (
    <footer
      className="flex h-6 shrink-0 items-center justify-between gap-4 border-t border-border bg-canvas-soft px-2 text-[11px] text-ink-secondary"
      data-testid="status-bar"
    >
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1 text-ink" data-testid="status-branch">
          <GitBranch className="h-3 w-3" />
          {branch ?? "no project"}
        </span>
        <span data-testid="status-modified" title="Files whose content changed">
          {modified}M
        </span>
        <span data-testid="status-untracked" title="Files the repository does not track">
          {untracked}U
        </span>
        <span data-testid="status-diff" title="Lines the diff adds and removes">
          ↑{insertions} ↓{deletions}
        </span>
        <span>0 problems</span>
      </div>
      <div className="flex items-center gap-3">
        <span
          className="flex items-center gap-1"
          data-state={ai}
          data-testid="status-ai"
          title={
            ai === "no-key"
              ? "The provider has no key in the keychain of the operating system"
              : ai === "loading"
                ? "The AI feature is working on a suggestion"
                : "The AI feature is ready"
          }
        >
          {ai === "loading" ? (
            <Circle className="h-3 w-3 text-accent" />
          ) : ai === "ready" ? (
            <Check className="h-3 w-3 text-success" />
          ) : (
            <X className="h-3 w-3 text-error" />
          )}
          AI
        </span>
        <span data-testid="status-language">{languageLabel(languageId)}</span>
        <span data-testid="status-tab-size">Spaces: {tabSize}</span>
      </div>
    </footer>
  );
}
