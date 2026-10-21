import type { FileEntry } from "@arrow/types";

import type { DirectoryCache } from "../../hooks/useFileTree";

/**
 * The changes of the watcher, as the tree of the frontend holds them.
 *
 * The watcher of the shell reports that a file appeared, that a file changed
 * and that a file is gone. A change of the content of a file is a change of
 * the disk, so the tree reads the directory again. An appearance and a
 * disappearance are changes of the shape of the tree, so the tree holds them
 * until it reads the directory again.
 *
 * The overlay is what the watcher told the tree, and it is merged into the
 * listing of the disk. The disk is the truth of what exists, and the overlay
 * is the truth of what changed since the last read.
 */

/** The changes of the watcher that the tree holds. */
export interface WatcherOverlay {
  /** The entries that appeared, keyed by the directory that holds them. */
  readonly created: ReadonlyMap<string, readonly FileEntry[]>;
  /** The paths that are gone. */
  readonly deleted: ReadonlySet<string>;
}

/** The overlay of a tree that has not seen a change yet. */
export const EMPTY_OVERLAY: WatcherOverlay = {
  created: new Map(),
  deleted: new Set(),
};

/**
 * The order of the entries of a directory.
 *
 * A directory comes before a file, and two entries of the same kind are
 * ordered by their name. The listing of the disk follows the same order, so
 * a file that the watcher reported lands between its neighbours instead of
 * at the end of the list.
 */
export function sortEntries(entries: readonly FileEntry[]): readonly FileEntry[] {
  return [...entries].sort(
    (left, right) =>
      Number(right.isDirectory) - Number(left.isDirectory) ||
      left.name.toLowerCase().localeCompare(right.name.toLowerCase()),
  );
}

/** True when a path is gone, or lies inside a path that is gone. */
function isGone(path: string, deleted: ReadonlySet<string>): boolean {
  for (const gone of deleted) {
    if (path === gone || path.startsWith(`${gone}/`)) return true;
  }

  return false;
}

/**
 * The entries of one directory, with the changes of the watcher in them.
 *
 * A file that is gone is dropped, a file that appeared is added, and a file
 * that the disk already holds is never added twice.
 */
export function mergeEntries(
  entries: readonly FileEntry[],
  overlay: WatcherOverlay,
  directory: string,
): readonly FileEntry[] {
  const kept = entries.filter((entry) => !isGone(entry.path, overlay.deleted));
  const appeared = (overlay.created.get(directory) ?? []).filter(
    (entry) => !kept.some((keptEntry) => keptEntry.path === entry.path),
  );

  if (appeared.length === 0) return kept;

  return sortEntries([...kept, ...appeared]);
}

/**
 * The listing of every directory the tree has read, with the changes of the
 * watcher in it.
 *
 * The tree reads a directory once and holds the listing, and the watcher
 * changes the tree behind its back. The merge puts the two together, so a
 * reader sees the file that appeared and does not see the file that is gone.
 */
export function mergeTreeCache(cache: DirectoryCache, overlay: WatcherOverlay): DirectoryCache {
  const merged: Record<string, readonly FileEntry[]> = {};

  for (const [directory, entries] of Object.entries(cache)) {
    merged[directory] = mergeEntries(entries, overlay, directory);
  }

  return merged;
}
