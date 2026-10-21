import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../lib/cn";

/** The bar of a scroll area. */
export function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      className={cn(
        "flex touch-none select-none p-px transition-colors",
        orientation === "vertical"
          ? "h-full w-2.5 border-l border-l-transparent"
          : "h-2.5 flex-col border-t border-t-transparent",
        className,
      )}
      orientation={orientation}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-sm bg-border-strong" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

/**
 * A scroll area.
 *
 * The panels of the shell scroll on their own, so a scrollbar never reaches
 * the window itself.
 */
export function ScrollArea({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root className={cn("relative overflow-hidden", className)} {...props}>
      <ScrollAreaPrimitive.Viewport className="h-full w-full">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}
