import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../lib/cn";

/** The root of a dropdown menu. */
export const DropdownMenu = DropdownMenuPrimitive.Root;

/** The element that opens a dropdown menu. */
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

/** The group of items of a dropdown menu. */
export function DropdownMenuGroup({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group className={cn(className)} {...props} />;
}

/** The label of a group of items. */
export function DropdownMenuLabel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn("px-2 py-1 text-[11px] text-ink-tertiary", className)}
      {...props}
    />
  );
}

/** One item of a dropdown menu. */
export function DropdownMenuItem({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "flex cursor-default select-none items-center gap-2 px-2 py-1 text-xs text-ink outline-none data-[highlighted]:bg-surface-hover",
        className,
      )}
      {...props}
    />
  );
}

/** The hairline between two groups of items. */
export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator className={cn("my-1 h-px bg-border", className)} {...props} />
  );
}

/**
 * The body of a dropdown menu.
 *
 * The menu is dense: the items are one line tall and they carry no radius,
 * because a menu is a list and a list is not a card.
 */
export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        className={cn(
          "z-50 min-w-40 rounded-sm border border-border bg-surface p-1 text-ink shadow-md",
          className,
        )}
        sideOffset={sideOffset}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}
