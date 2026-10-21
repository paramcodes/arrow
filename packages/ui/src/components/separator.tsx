import * as SeparatorPrimitive from "@radix-ui/react-separator";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../lib/cn";

/**
 * A hairline rule. The editor uses one instead of a gap, because a gap does
 * not say where one region ends and the next begins.
 */
export function Separator({
  className,
  orientation = "horizontal",
  ...props
}: ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      className={cn(
        "shrink-0 bg-border",
        orientation === "vertical" ? "h-full w-px" : "h-px w-full",
        className,
      )}
      orientation={orientation}
      {...props}
    />
  );
}
