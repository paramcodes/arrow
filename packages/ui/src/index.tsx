import type { ReactNode } from "react";

import { cn } from "./lib/cn";

export { Button, buttonVariants, type ButtonProps } from "./components/button";
export {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./components/command";
export {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./components/context-menu";
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./components/dialog";
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/dropdown-menu";
export {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  panelSpring,
  type ResizableHandleProps,
  type ResizableOrientation,
  type ResizablePanelGroupProps,
  type ResizablePanelProps,
} from "./components/resizable";
export { ScrollArea, ScrollBar } from "./components/scroll-area";
export { Separator } from "./components/separator";
export { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/tabs";
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/tooltip";
export { cn } from "./lib/cn";

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
