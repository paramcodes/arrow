import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../lib/cn";

/** The root of a context menu. */
export const ContextMenu = ContextMenuPrimitive.Root;

/** The element that opens a context menu. */
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

/** The label of a group of items. */
export function ContextMenuLabel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label>) {
  return (
    <ContextMenuPrimitive.Label
      className={cn("px-2 py-1 text-[11px] text-ink-tertiary", className)}
      {...props}
    />
  );
}

/** One item of a context menu. */
export function ContextMenuItem({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item>) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        "flex cursor-default select-none items-center gap-2 px-2 py-1 text-xs text-ink outline-none data-[highlighted]:bg-surface-hover",
        className,
      )}
      {...props}
    />
  );
}

/** The hairline between two groups of items. */
export function ContextMenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator className={cn("my-1 h-px bg-border", className)} {...props} />
  );
}

/** The body of a context menu. */
export function ContextMenuContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        className={cn(
          "z-50 min-w-40 rounded-sm border border-border bg-surface p-1 text-ink shadow-md",
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}
