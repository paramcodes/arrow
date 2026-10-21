import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../lib/cn";

/** The root of a tab set. */
export const Tabs = TabsPrimitive.Root;

/** The row of tab triggers. */
export function TabsList({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("flex h-8 shrink-0 items-center bg-canvas-soft", className)}
      {...props}
    />
  );
}

/** One tab. */
export function TabsTrigger({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-8 items-center border-r border-border px-3 text-xs text-ink-secondary transition-colors hover:text-ink data-[state=active]:bg-canvas data-[state=active]:text-ink",
        className,
      )}
      {...props}
    />
  );
}

/** The panel of a tab. */
export function TabsContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content className={cn("min-h-0 flex-1 outline-none", className)} {...props} />
  );
}
