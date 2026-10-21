import type { ReactNode } from "react";

import type { FileEntry } from "@arrow/types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@arrow/ui";

/**
 * The context menu of one row of the file tree.
 *
 * The menu offers the four actions of the session: a new file, a new folder, a
 * rename and a delete. The menu itself does nothing: it names the action and
 * the row, and the tree owns the dialog and the call to the disk.
 */

/** The action the context menu offers. */
export type FileTreeAction = "new-file" | "new-folder" | "rename" | "delete";

/** The props of the context menu of a row. */
export interface FileTreeContextMenuProps {
  /** The entry the menu belongs to. */
  readonly entry: FileEntry;
  /** The row the menu wraps. */
  readonly children: ReactNode;
  /** The callback that receives the chosen action. */
  readonly onAction: (action: FileTreeAction, entry: FileEntry) => void;
}

/** The context menu of a row of the file tree. */
export function FileTreeContextMenu({ entry, children, onAction }: FileTreeContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent data-testid="tree-context-menu">
        <ContextMenuItem onSelect={() => onAction("new-file", entry)}>New File</ContextMenuItem>
        <ContextMenuItem onSelect={() => onAction("new-folder", entry)}>New Folder</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onAction("rename", entry)}>Rename</ContextMenuItem>
        <ContextMenuItem onSelect={() => onAction("delete", entry)}>Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
