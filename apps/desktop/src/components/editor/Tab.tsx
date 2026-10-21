import { X } from "lucide-react";

import { baseName } from "../../hooks/fileSystem";

/**
 * One tab of the editor.
 *
 * The tab shows the name of the file, a dot when the file is dirty and a close
 * button. The close button asks the area first, because a dirty file must not
 * disappear when the reader clicks the cross.
 */

/** The props of one tab. */
export interface TabProps {
  /** The path of the file the tab holds. */
  readonly path: string;
  /** True when the tab is the active one. */
  readonly active: boolean;
  /** True when the file differs from the disk. */
  readonly dirty: boolean;
  /** The callback that activates the tab. */
  readonly onSelect: (path: string) => void;
  /** The callback that asks to close the tab. */
  readonly onClose: (path: string) => void;
}

/** One tab of the editor. */
export function Tab({ path, active, dirty, onSelect, onClose }: TabProps) {
  const name = baseName(path);

  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      data-testid={`tab-${path}`}
      data-active={active}
      data-dirty={dirty}
      className={[
        "group flex h-8 max-w-48 shrink-0 items-center gap-1 border-r border-border pr-1 pl-2 text-xs",
        active ? "bg-canvas text-ink" : "bg-canvas-soft text-ink-secondary hover:text-ink",
      ].join(" ")}
      onClick={() => onSelect(path)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect(path);
      }}
    >
      <span className="truncate" title={path}>
        {name}
      </span>
      {dirty ? (
        <span
          aria-label="Unsaved changes"
          className="size-2 shrink-0 rounded-full bg-warning"
          data-testid={`tab-dirty-${path}`}
          title="Unsaved changes"
        />
      ) : null}
      <button
        type="button"
        aria-label={`Close ${name}`}
        className="ml-1 flex size-4 shrink-0 items-center justify-center rounded-sm text-ink-tertiary hover:bg-surface-hover hover:text-ink focus-visible:ring-1 focus-visible:ring-focus-ring focus-visible:outline-none"
        data-testid={`tab-close-${path}`}
        onClick={(event) => {
          event.stopPropagation();
          onClose(path);
        }}
      >
        <X aria-hidden className="size-3" />
      </button>
    </div>
  );
}
