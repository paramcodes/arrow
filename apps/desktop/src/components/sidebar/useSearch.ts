import { useEffect, useState } from "react";

import { workspaceRoot } from "../../hooks/fileSystem";
import { searchProject, type ProjectSearchResult } from "../../lib/search";

/**
 * The search of the workspace, as the panel renders it.
 *
 * The hook owns the query, the answer of the last search and the state of the
 * request. A keystroke waits a moment before it reaches the shell, and an
 * answer that arrives after the query has moved on is dropped, so the list
 * never shows the matches of a word the reader has already deleted.
 */

/** How long a keystroke waits before it reaches the shell. */
const SEARCH_DELAY_MS = 120;

/** The shortest query the panel searches for. */
export const MIN_QUERY_LENGTH = 2;

/** The state of the search panel. */
export interface SearchState {
  /** The text of the field. */
  readonly query: string;
  /** Replace the text of the field. */
  readonly setQuery: (query: string) => void;
  /** The answer of the last search, or null when there is none. */
  readonly results: ProjectSearchResult | null;
  /** True while the shell is searching. */
  readonly loading: boolean;
  /** The message of the last failure, or null. */
  readonly error: string | null;
}

/** The search of the workspace. */
export function useSearch(): SearchState {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProjectSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const needle = query.trim();

    if (needle.length < MIN_QUERY_LENGTH) {
      setResults(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(() => {
      searchProject(workspaceRoot(), needle)
        .then((answer) => {
          if (cancelled) return;
          setResults(answer);
          setError(null);
        })
        .catch((failure: unknown) => {
          if (cancelled) return;
          setResults(null);
          setError(failure instanceof Error ? failure.message : String(failure));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, SEARCH_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return { query, setQuery, results, loading, error };
}
