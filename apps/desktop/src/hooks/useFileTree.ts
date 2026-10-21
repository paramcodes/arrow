import { useCallback, useEffect, useRef, useState } from "react";

import type { FileEntry } from "@arrow/types";

import { readDirectory, workspaceRoot } from "./fileSystem";

/**
 * The tree of the workspace.
 *
 * A directory is read the first time it is expanded, not when the window
 * opens. A workspace holds `node_modules`, a target directory and a git
 * database, and reading all of them to show the top of the tree would make the
 * sidebar wait for the disk for no reason.
 *
 * The hook owns the listing of every directory it has read and the set of the
 * directories that are open, and it exposes a refresh for the tree after a
 * create, a rename or a delete.
 */

/** The children of the directories the hook has read. */
export type DirectoryCache = Readonly<Record<string, readonly FileEntry[]>>;

/** The tree of the workspace, as the file tree renders it. */
export interface FileTreeState {
  /** The root of the workspace. */
  readonly root: string;
  /** The children of every directory that has been read. */
  readonly cache: DirectoryCache;
  /** The directories that are open. */
  readonly expanded: ReadonlySet<string>;
  /** True while a directory is being read. */
  readonly loading: boolean;
  /** The message of the last failure, or null. */
  readonly error: string | null;
  /** Open or close a directory, reading it the first time it opens. */
  readonly toggle: (path: string) => void;
  /** Read a directory again, so a create, a rename or a delete shows up. */
  readonly refresh: (path: string) => Promise<void>;
}

/** The directories the tree opens by itself when the workspace loads. */
const INITIALLY_EXPANDED_DEPTH = 0;

function depthOf(root: string, path: string): number {
  const relative = path.slice(root.length).split(/[\\/]/).filter(Boolean);
  return relative.length;
}

/** The tree of the workspace. */
export function useFileTree(): FileTreeState {
  const root = workspaceRoot();
  const [cache, setCache] = useState<DirectoryCache>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const read = useRef<DirectoryCache>({});

  const load = useCallback(async (path: string): Promise<FileEntry[]> => {
    const entries = await readDirectory(path);
    read.current = { ...read.current, [path]: entries };
    setCache(read.current);
    return entries;
  }, []);

  const refresh = useCallback(
    async (path: string) => {
      try {
        await load(path);
        setError(null);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    },
    [load],
  );

  const toggle = useCallback(
    (path: string) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });

      if (read.current[path]) return;
      setLoading(true);
      load(path)
        .then(() => setError(null))
        .catch((failure: unknown) =>
          setError(failure instanceof Error ? failure.message : String(failure)),
        )
        .finally(() => setLoading(false));
    },
    [load],
  );

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    load(root)
      .then((entries) => {
        if (cancelled) return;
        const open = new Set<string>();
        if (depthOf(root, root) <= INITIALLY_EXPANDED_DEPTH) open.add(root);
        for (const entry of entries) {
          if (entry.isDirectory && depthOf(root, entry.path) <= INITIALLY_EXPANDED_DEPTH) {
            open.add(entry.path);
          }
        }
        setExpanded(open);
        setError(null);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setError(failure instanceof Error ? failure.message : String(failure));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [load, root]);

  return { root, cache, expanded, loading, error, toggle, refresh };
}
