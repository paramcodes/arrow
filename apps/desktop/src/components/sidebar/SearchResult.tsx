import { baseName } from "../../hooks/fileSystem";
import type { ProjectSearchMatch } from "../../lib/search";

/**
 * One match of the project search.
 *
 * The row names the file, the line and the text of the match. A click opens
 * the file through the editor store at the line of the match, so the search
 * and the tabs share one list of open files.
 */
export function SearchResult({
  match,
  index,
  onOpen,
}: {
  readonly match: ProjectSearchMatch;
  readonly index: number;
  readonly onOpen: (match: ProjectSearchMatch) => void;
}) {
  const preview = match.text.trim();

  return (
    <button
      type="button"
      className="flex w-full flex-col gap-0.5 border-b border-border/60 px-2 py-1 text-left transition-colors last:border-b-0 hover:bg-surface-hover"
      data-column={match.column}
      data-line={match.line}
      data-path={match.path}
      data-testid={`search-result-${index}`}
      onClick={() => onOpen(match)}
    >
      <span className="flex items-baseline gap-1 text-[11px] text-ink-tertiary">
        <span className="truncate text-ink-secondary">{baseName(match.path)}</span>
        <span>{match.line}</span>
      </span>
      <span className="w-full truncate font-mono text-xs text-ink">{preview}</span>
    </button>
  );
}
