import { Command as CommandPrimitive } from "cmdk";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../lib/cn";

/** The root of a command list. */
export const Command = CommandPrimitive;

/** The input of a command list. */
export function CommandInput({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof CommandPrimitive.Input>) {
  return (
    <CommandPrimitive.Input
      className={cn(
        "h-8 w-full border-b border-border bg-transparent px-3 text-xs text-ink outline-none placeholder:text-ink-tertiary",
        className,
      )}
      {...props}
    />
  );
}

/** The list of the matching commands. */
export function CommandList({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List className={cn("max-h-64 overflow-y-auto p-1", className)} {...props} />
  );
}

/** The message that shows when nothing matches. */
export function CommandEmpty({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      className={cn("px-2 py-3 text-xs text-ink-tertiary", className)}
      {...props}
    />
  );
}

/** A group of commands. */
export function CommandGroup({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn("px-2 py-1 text-[11px] text-ink-tertiary", className)}
      {...props}
    />
  );
}

/** One command. */
export function CommandItem({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1 text-xs text-ink data-[selected=true]:bg-surface-hover",
        className,
      )}
      {...props}
    />
  );
}
