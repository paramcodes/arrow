import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../lib/cn";

/** The provider every tooltip of the app shares. */
export const TooltipProvider = TooltipPrimitive.Provider;

/** The root of a tooltip. */
export const Tooltip = TooltipPrimitive.Root;

/** The element that opens a tooltip. */
export const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * The body of a tooltip.
 *
 * A tooltip names a control that has no visible label, so it stays small and
 * it never takes the pointer.
 */
export function TooltipContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        className={cn(
          "z-50 rounded-sm border border-border bg-surface px-2 py-1 text-xs text-ink shadow-md",
          className,
        )}
        sideOffset={sideOffset}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
