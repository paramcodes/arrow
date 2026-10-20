import type { ReactNode } from "react";

/**
 * Join class names and drop the empty ones.
 */
export function cn(...names: readonly (string | false | null | undefined)[]): string {
  return names.filter((name): name is string => Boolean(name)).join(" ");
}

/** The props of a surface. */
export interface SurfaceProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly quiet?: boolean;
}

/**
 * A themed surface. The color comes from the theme tokens, never from this
 * component.
 */
export function Surface({ children, className, quiet = false }: SurfaceProps) {
  return (
    <div className={cn("ui-surface", quiet && "ui-surface--quiet", className)}>{children}</div>
  );
}
