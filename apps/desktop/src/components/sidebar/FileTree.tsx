import { useState } from "react";

import type { FileEntry } from "@arrow/types";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@arrow/ui";

import { createEntry, deleteEntry, dirName, joinPath, renameEntry } from "../../hooks/fileSystem";
import { useFileTree } from "../../hooks/useFileTree";
import { useEditorStore } from "../../stores/editor";
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

  const [request, setRequest] = useState<TreeRequest | null>(null);
  const [name, setName] = useState("");
  const [failure, setFailure] = useState<string | null>(null);

  const children = tree.cache[tree.root] ?? [];
  const deleting = request?.action === "delete";

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

    try {
      if (action === "delete") {
        const parent = dirName(entry.path);
        await deleteEntry(entry.path);
        for (const file of useEditorStore.getState().openFiles) {
          if (file.path === entry.path || file.path.startsWith(`${entry.path}/`)) {
            closeFile(file.path);
          }
        }
        await tree.refresh(parent);
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

  return (
    <div className="flex min-h-0 flex-col" data-testid="file-tree">
      {tree.error ? (
        <p className="p-2 text-xs text-error" data-testid="file-tree-error">
          {tree.error}
        </p>
      ) : null}

      {children.length === 0 && tree.loading ? (
        <p className="p-2 text-xs text-ink-tertiary">Reading the workspace…</p>
      ) : (
        <ul role="tree" aria-label="Files" className="p-1">
          {children.map((entry) => (
            <FileTreeItem
              key={entry.path}
              entry={entry}
              depth={0}
              cache={tree.cache}
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
    </div>
  );
}
