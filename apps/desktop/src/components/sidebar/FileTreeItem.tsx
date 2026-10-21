import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";

import type { FileEntry } from "@arrow/types";

import type { DirectoryCache } from "../../hooks/useFileTree";
import { FileTreeContextMenu, type FileTreeAction } from "./FileTreeContextMenu";

/**
 * One row of the file tree.
 *
 * A directory row opens and closes its children. A file row opens the file in
 * a tab. Every row carries the same context menu, so a right click on a file
 * can create a sibling and a right click on a folder can create a child.
 */

/** The props of one row. */
export interface FileTreeItemProps {
  /** The entry the row shows. */
  readonly entry: FileEntry;
  /** How deep the row sits, used for its indent. */
  readonly depth: number;
  /** The children of the directories that have been read. */
  readonly cache: DirectoryCache;
  /** The directories that are open. */
  readonly expanded: ReadonlySet<string>;
  /** The callback that opens or closes a directory. */
  readonly onToggle: (path: string) => void;
  /** The callback that opens a file in a tab. */
  readonly onOpen: (path: string) => void;
  /** The callback that receives the chosen action of the context menu. */
  readonly onAction: (action: FileTreeAction, entry: FileEntry) => void;
}

/** One row of the file tree, with the rows of its children. */
export function FileTreeItem({
  entry,
  depth,
  cache,
  expanded,
  onToggle,
  onOpen,
  onAction,
}: FileTreeItemProps) {
  const open = entry.isDirectory && expanded.has(entry.path);
  const children = cache[entry.path] ?? [];

  return (
    <li role="treeitem" aria-expanded={entry.isDirectory ? open : undefined} aria-selected={false}>
      <FileTreeContextMenu entry={entry} onAction={onAction}>
        <button
          type="button"
          className="flex h-6 w-full items-center gap-1 rounded-sm pr-1 text-left text-xs text-ink-secondary hover:bg-surface-hover hover:text-ink focus-visible:ring-1 focus-visible:ring-focus-ring focus-visible:outline-none"
          data-testid={`tree-item-${entry.path}`}
          data-kind={entry.isDirectory ? "directory" : "file"}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={() => (entry.isDirectory ? onToggle(entry.path) : onOpen(entry.path))}
        >
          {entry.isDirectory ? (
            open ? (
              <ChevronDown aria-hidden className="size-3 shrink-0" />
            ) : (
              <ChevronRight aria-hidden className="size-3 shrink-0" />
            )
          ) : (
            <span aria-hidden className="size-3 shrink-0" />
          )}
          {entry.isDirectory ? (
            open ? (
              <FolderOpen aria-hidden className="size-3.5 shrink-0 text-accent" />
            ) : (
              <Folder aria-hidden className="size-3.5 shrink-0 text-accent" />
            )
          ) : (
            <FileText aria-hidden className="size-3.5 shrink-0 text-ink-tertiary" />
          )}
          <span className="truncate">{entry.name}</span>
        </button>
      </FileTreeContextMenu>

      {open ? (
        <ul role="group">
          {children.map((child) => (
            <FileTreeItem
              key={child.path}
              entry={child}
              depth={depth + 1}
              cache={cache}
              expanded={expanded}
              onToggle={onToggle}
              onOpen={onOpen}
              onAction={onAction}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
