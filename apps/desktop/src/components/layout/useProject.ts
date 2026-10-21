import { useEffect } from "react";

import { workspaceRoot } from "../../hooks/fileSystem";
import { onFsEvent, type UnlistenFn } from "../../lib/tauri";
import { useProjectStore } from "../../stores/project";

/**
 * The project of the window.
 *
 * The hook opens the project the window starts with and keeps the state of
 * its repository fresh. A browser build starts with the fixture workspace, so
 * the tree, the status bar and the badges have something to show without a
 * Rust host. A desktop build starts with no project, because a project is a
 * folder the reader picks.
 *
 * The hook also listens for the changes of the watcher. A change of the disk
 * can change the state of the repository, so the status is read again when
 * the watcher reports one. The reads wait for the changes to settle, because
 * a save of a file often arrives as several changes.
 */

/** The quiet time the changes of the disk wait before the status is read. */
const SETTLE_MS = 80;

/** The project of the window. */
export function useProject(): void {
  const openProject = useProjectStore((state) => state.openProject);

  useEffect(() => {
    const root = workspaceRoot();

    // A desktop build opens no project on its own: a project is a folder the
    // reader picks, and the picker opens it.
    if (root === "") return;

    void openProject(root);
  }, [openProject]);

  useEffect(() => {
    let stop: UnlistenFn | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    void onFsEvent(() => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        void useProjectStore.getState().refreshGitStatus();
      }, SETTLE_MS);
    }).then((unlisten) => {
      stop = unlisten;
    });

    return () => {
      stop?.();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);
}
