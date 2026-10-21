import { ScrollArea } from "@arrow/ui";

import { joinPath, workspaceRoot } from "../../hooks/fileSystem";
import type { ProjectSearchMatch } from "../../lib/search";
import { useEditorStore } from "../../stores/editor";
import { SearchResult } from "./SearchResult";
import { MIN_QUERY_LENGTH, useSearch } from "./useSearch";

/**
 * The search panel of the sidebar.
 *
 * The panel searches the text of every file of the workspace, through the
 * shell in the window and through the fixture workspace in a browser. A match
 * opens its file at the line of the match, so the reader lands on the word
 * they searched for.
 */
export function SearchPanel() {
  const { query, setQuery, results, loading, error } = useSearch();
  const openAt = useEditorStore((state) => state.openFileAt);

  const open = (match: ProjectSearchMatch) => {
    void openAt(joinPath(workspaceRoot(), match.path), match.line, match.column);
  };

  const summary = (() => {
    if (error) return error;
    if (loading) return "Searching…";
    if (!results) return "Search the text of every file.";
    const count = results.matches.length;
    if (count === 0) return "No match.";
    return results.truncated
      ? `${count}+ matches`
      : `${count} ${count === 1 ? "match" : "matches"}`;
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="search-panel">
      <div className="shrink-0 p-2">
        <input
          aria-label="Search the workspace"
          className="h-7 w-full rounded-sm border border-border bg-canvas px-2 text-xs text-ink outline-none placeholder:text-ink-tertiary focus:border-accent"
          data-testid="search-input"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          spellCheck={false}
          type="search"
          value={query}
        />
        <p
          className={`mt-1 text-[11px] ${error ? "text-error" : "text-ink-tertiary"}`}
          data-testid="search-summary"
        >
          {query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH
            ? `Type at least ${MIN_QUERY_LENGTH} characters.`
            : summary}
        </p>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {results && results.matches.length > 0 ? (
          <div data-testid="search-results">
            {results.matches.map((match, index) => (
              <SearchResult
                index={index}
                key={`${match.path}:${match.line}:${match.column}`}
                match={match}
                onOpen={open}
              />
            ))}
          </div>
        ) : null}
      </ScrollArea>
    </div>
  );
}
