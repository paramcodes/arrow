import { Fragment } from "react";

/**
 * The breadcrumbs of the active file.
 *
 * The breadcrumbs show the path of the file from its root to its name, so a
 * reader can see where the file sits without reading the tree. The last
 * segment is the name of the file and the ones before it are the directories.
 */

/** The props of the breadcrumbs. */
export interface BreadcrumbsProps {
  /** The path of the active file, or null when no file is open. */
  readonly path: string | null;
}

/** The segments of a path. */
export function pathSegments(path: string): string[] {
  return path.split(/[\\/]/).filter((segment) => segment.length > 0);
}

/** The breadcrumbs of the active file. */
export function Breadcrumbs({ path }: BreadcrumbsProps) {
  if (!path) return null;

  const segments = pathSegments(path);

  return (
    <nav
      aria-label="Breadcrumbs"
      className="flex h-7 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-canvas px-2 text-[11px] text-ink-tertiary"
      data-testid="breadcrumbs"
      data-path={path}
    >
      {segments.map((segment, index) => (
        <Fragment key={`${segment}-${index}`}>
          {index > 0 ? <span aria-hidden>›</span> : null}
          <span
            className={index === segments.length - 1 ? "text-ink-secondary" : undefined}
            data-testid={`breadcrumb-${index}`}
          >
            {segment}
          </span>
        </Fragment>
      ))}
    </nav>
  );
}
