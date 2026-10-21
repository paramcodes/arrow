import { useEffect, useRef, useState } from "react";

import type { FileEntry } from "@arrow/types";

import { baseName, dirName } from "../../hooks/fileSystem";
import { onFsEvent, type FsEvent, type UnlistenFn } from "../../lib/tauri";
import { EMPTY_OVERLAY, type WatcherOverlay } from "./treeOverlay";

/**
 * The changes of the watcher, as the tree of the frontend holds them.
 *
 * The hook listens for the three changes the shell reports and keeps the
 * ones that change the shape of the tree: a file that appeared and a file
 * that is gone. A change of the content of a file changes nothing in the
 * shape of the tree, so the hook asks the tree to read the directory again.
 *
 * The hook never reads the disk itself. It holds what the watcher said, and
 * the tree merges that with the listing of the disk.
 */

/** The overlay a change of the watcher produces. */
function applyEvent(overlay: WatcherOverlay, event: FsEvent): WatcherOverlay {
  const parent = dirName(event.path);

  if (event.kind === "changed") return overlay;

  if (event.kind === "deleted") {
    const created = new Map(overlay.created);
    created.delete(parent);

    const deleted = new Set(overlay.deleted);
    deleted.add(event.path);

    return { created, deleted };
  }

  const created = new Map(overlay.created);
  const entries = created.get(parent) ?? [];
  const entry: FileEntry = { name: baseName(event.path), path: event.path, isDirectory: false };
  created.set(parent, [...entries.filter((held) => held.path !== entry.path), entry]);

  const deleted = new Set(overlay.deleted);
  deleted.delete(event.path);

  return { created, deleted };
}

/**
 * The changes of the watcher, as the tree holds them.
 *
 * The `refresh` callback is called with the directory that holds the file
 * that changed, so the tree reads the directory again and shows what the
 * disk holds.
 */
export function useWatcherOverlay(refresh: (path: string) => void): WatcherOverlay {
  const [overlay, setOverlay] = useState<WatcherOverlay>(EMPTY_OVERLAY);
  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    let stop: UnlistenFn | undefined;

    void onFsEvent((event) => {
      setOverlay((current) => applyEvent(current, event));
      refreshRef.current(dirName(event.path));
    }).then((unlisten) => {
      stop = unlisten;
    });

    return () => {
      stop?.();
    };
  }, []);

  return overlay;
}
