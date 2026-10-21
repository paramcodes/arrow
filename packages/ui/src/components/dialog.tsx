import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../lib/cn";

/** The root of a dialog. */
export const Dialog = DialogPrimitive.Root;

/** The element that opens a dialog. */
export const DialogTrigger = DialogPrimitive.Trigger;

/** The element that closes a dialog. */
export const DialogClose = DialogPrimitive.Close;

/** The title of a dialog. */
export function DialogTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title className={cn("text-sm font-medium text-ink", className)} {...props} />
  );
}

/** The description of a dialog. */
export function DialogDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-xs text-ink-secondary", className)}
      {...props}
    />
  );
}

/**
 * The body of a dialog.
 *
 * A dialog is the one surface of the shell that floats above the canvas, so it
 * carries a shadow and a border.
 */
export function DialogContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 bg-canvas-strong/70" />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-surface p-4 text-ink shadow-lg",
          className,
        )}
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}
