import { useEffect, useState } from "react";

import type { FileEntry } from "@arrow/types";

import { readDirectory } from "../../hooks/fileSystem";

/**
 * The listing of the root of the project.
 *
 * The tree of the frontend reads the root of the workspace it was built for.
 * A project the reader picks is another root, and the tree has to list it.
 * The hook reads that root itself, so a project the reader picked shows its
 * files without waiting for a session that rebuilds the tree.
 *
 * The hook reads nothing when the root of the project is the root the tree
 * already knows, because the listing of that root is in the tree.
 */

/** The listing of a root, and the state of the read. */
export interface ProjectRoot {
  /** The entries of the root. */
  readonly entries: readonly FileEntry[];
  /** True while the root is read. */
  readonly loading: boolean;
  /** The message of the last failure, or null. */
  readonly error: string | null;
}

/** The listing of a root that is not read. */
const EMPTY_ROOT: ProjectRoot = { entries: [], loading: false, error: null };

/** The listing of the root of the project. */
export function useProjectRoot(root: string, treeRoot: string): ProjectRoot {
  const [state, setState] = useState<ProjectRoot>(EMPTY_ROOT);

  useEffect(() => {
    if (root === treeRoot || root === "") {
      setState(EMPTY_ROOT);
      return;
    }

    let cancelled = false;
    setState({ entries: [], loading: true, error: null });

    readDirectory(root)
      .then((entries) => {
        if (cancelled) return;
        setState({ entries, loading: false, error: null });
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setState({
          entries: [],
          loading: false,
          error: failure instanceof Error ? failure.message : String(failure),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [root, treeRoot]);

  return root === treeRoot ? EMPTY_ROOT : state;
}
