import { useMemo, useState } from "react";

import type { FileEntry } from "@arrow/types";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@arrow/ui";

import {
  baseName,
  createEntry,
  deleteEntry,
  dirName,
  joinPath,
  renameEntry,
} from "../../hooks/fileSystem";
import { useFileTree } from "../../hooks/useFileTree";
import { gitBadges } from "../../lib/git";
import { useEditorStore } from "../../stores/editor";
import { useProjectStore } from "../../stores/project";
import { mergeEntries, mergeTreeCache } from "./treeOverlay";
import { useProjectRoot } from "./useProjectRoot";
import { useWatcherOverlay } from "./useWatcherOverlay";
import { DiscardChangesDialog } from "../editor/DiscardChangesDialog";
import type { FileTreeAction } from "./FileTreeContextMenu";
import { FileTreeItem } from "./FileTreeItem";

/**
 * The tree of the workspace.
 *
 * The tree reads a directory through the file system of the shell and shows
 * its entries. A directory opens on click and is read the first time it opens,
 * a file opens in a tab, and a right click offers a new file, a new folder, a
 * rename and a delete.
 *
 * The tree owns the dialog of those four actions. The dialog asks for one name
 * and calls the disk once, then reads the directory again, so the tree always
 * shows what the disk holds and never a guess of what the call did.
 */

/** The action the tree is asking about in its dialog. */
interface TreeRequest {
  readonly action: FileTreeAction;
  readonly entry: FileEntry;
}

/** The title of every dialog of the tree. */
const TITLES: Record<FileTreeAction, string> = {
  "new-file": "New File",
  "new-folder": "New Folder",
  rename: "Rename",
  delete: "Delete",
};

/** The label of the button that confirms the dialog. */
const CONFIRMS: Record<FileTreeAction, string> = {
  "new-file": "Create file",
  "new-folder": "Create folder",
  rename: "Rename",
  delete: "Delete",
};

/** The tree of the workspace. */
export function FileTree() {
  const tree = useFileTree();
  const openFile = useEditorStore((state) => state.openFile);
  const closeFile = useEditorStore((state) => state.closeFile);
  const remapPath = useEditorStore((state) => state.remapPath);
  const rootPath = useProjectStore((state) => state.rootPath);
  const files = useProjectStore((state) => state.status.files);

  const [request, setRequest] = useState<TreeRequest | null>(null);
  const [discard, setDiscard] = useState<{ entry: FileEntry; names: string[] } | null>(null);
  const [name, setName] = useState("");
  const [failure, setFailure] = useState<string | null>(null);

  // The watcher changes the tree behind its back, so the tree holds what the
  // watcher said and merges it with the listing of the disk.
  const overlay = useWatcherOverlay((path) => {
    void tree.refresh(path);
  });
  const cache = useMemo(() => mergeTreeCache(tree.cache, overlay), [tree.cache, overlay]);

  // The root of the project is the root the reader picked. The tree of the
  // frontend knows the root of the workspace it was built for, and the hook
  // reads the root of the project when the two are not the same.
  const root = rootPath ?? tree.root;
  const projectRoot = useProjectRoot(root, tree.root);

  // The badge of every file of the repository is built once, so a row of the
  // tree reads its badge out of a map and never asks the shell for the state
  // of its own file.
  const badges = useMemo(() => gitBadges(root, files), [root, files]);

  const children =
    root === tree.root
      ? (cache[tree.root] ?? [])
      : mergeEntries(projectRoot.entries, overlay, root);
  const deleting = request?.action === "delete";
  const error = root === tree.root ? tree.error : projectRoot.error;
  const loading = root === tree.root ? tree.loading : projectRoot.loading;

  const ask = (action: FileTreeAction, entry: FileEntry) => {
    setRequest({ action, entry });
    setName(action === "rename" ? entry.name : "");
    setFailure(null);
  };

  const close = () => {
    setRequest(null);
    setName("");
    setFailure(null);
  };

  const confirm = async () => {
    if (!request) return;

    const { action, entry } = request;
    const trimmed = name.trim();
    if (!deleting && trimmed.length === 0) return;

    if (action === "delete") {
      const dirty = useEditorStore
        .getState()
        .openFiles.filter(
          (file) =>
            file.dirty && (file.path === entry.path || file.path.startsWith(`${entry.path}/`)),
        )
        .map((file) => baseName(file.path));

      // A delete of open and dirty work asks the same question a tab close
      // asks, because both throw the same work away.
      if (dirty.length > 0) {
        close();
        setDiscard({ entry, names: dirty });
        return;
      }
    }

    try {
      if (action === "delete") {
        await remove(entry);
      } else if (action === "rename") {
        const parent = dirName(entry.path);
        const target = joinPath(parent, trimmed);
        await renameEntry(entry.path, target);
        remapPath(entry.path, target);
        await tree.refresh(parent);
      } else {
        const directory = entry.isDirectory ? entry.path : dirName(entry.path);
        const target = joinPath(directory, trimmed);
        await createEntry(target, action === "new-folder");
        await tree.refresh(directory);
        if (action === "new-file") await openFile(target);
      }

      close();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  };

  /** Delete an entry and drop every tab it owned, dirty or not. */
  const remove = async (entry: FileEntry) => {
    const parent = dirName(entry.path);
    await deleteEntry(entry.path);
    for (const file of useEditorStore.getState().openFiles) {
      if (file.path === entry.path || file.path.startsWith(`${entry.path}/`)) {
        closeFile(file.path);
      }
    }
    await tree.refresh(parent);
  };

  return (
    <div className="flex min-h-0 flex-col" data-testid="file-tree">
      {error ? (
        <p className="p-2 text-xs text-error" data-testid="file-tree-error">
          {error}
        </p>
      ) : null}

      {children.length === 0 && loading ? (
        <p className="p-2 text-xs text-ink-tertiary">Reading the workspace…</p>
      ) : (
        <ul role="tree" aria-label="Files" className="p-1">
          {children.map((entry) => (
            <FileTreeItem
              key={entry.path}
              entry={entry}
              depth={0}
              cache={cache}
              badges={badges}
              expanded={tree.expanded}
              onToggle={tree.toggle}
              onOpen={(path) => {
                void openFile(path);
              }}
              onAction={ask}
            />
          ))}
        </ul>
      )}

      <Dialog
        open={request !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent data-testid="tree-dialog">
          <DialogTitle>{request ? TITLES[request.action] : ""}</DialogTitle>
          <DialogDescription>
            {request && deleting
              ? `Delete ${request.entry.name}? This cannot be undone.`
              : request
                ? `${TITLES[request.action]}: ${request.entry.name}`
                : ""}
          </DialogDescription>

          {deleting ? null : (
            <input
              aria-label="Name"
              className="mt-3 h-7 w-full rounded-sm border border-border bg-canvas px-2 text-xs text-ink focus-visible:ring-1 focus-visible:ring-focus-ring focus-visible:outline-none"
              data-testid="tree-dialog-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}

          {failure ? (
            <p className="mt-2 text-xs text-error" data-testid="tree-dialog-error">
              {failure}
            </p>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={close} data-testid="tree-dialog-cancel">
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                void confirm();
              }}
              disabled={!deleting && name.trim().length === 0}
              data-testid="tree-dialog-confirm"
            >
              {request ? CONFIRMS[request.action] : ""}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <DiscardChangesDialog
        open={discard !== null}
        names={discard?.names ?? []}
        confirmLabel="Discard and delete"
        onCancel={() => setDiscard(null)}
        onConfirm={() => {
          if (!discard) return;
          const entry = discard.entry;
          setDiscard(null);
          remove(entry).catch((error: unknown) => {
            setFailure(error instanceof Error ? error.message : String(error));
          });
        }}
      />
    </div>
  );
}
