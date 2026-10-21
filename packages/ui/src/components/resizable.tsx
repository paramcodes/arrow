import { motion } from "motion/react";
import {
  createContext,
  useContext,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { cn } from "../lib/cn";

/** The axis a group of panels shares. */
export type ResizableOrientation = "horizontal" | "vertical";

/**
 * The spring every panel of the shell moves on.
 *
 * A panel that collapses has to feel like a drawer and not like a jump, so
 * the motion is a spring with a little mass: it arrives without a bounce.
 */
export const panelSpring = {
  type: "spring",
  stiffness: 320,
  damping: 34,
  mass: 0.6,
} as const;

const OrientationContext = createContext<ResizableOrientation>("horizontal");

/** The props of a group of panels. */
export interface ResizablePanelGroupProps {
  /** The axis the panels of the group share. */
  readonly orientation?: ResizableOrientation;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * A group of panels that share one axis.
 *
 * The group owns no size. The panels of the shell take their size from the
 * layout store, so the group only has to line them up.
 */
export function ResizablePanelGroup({
  orientation = "horizontal",
  className,
  children,
}: ResizablePanelGroupProps) {
  return (
    <OrientationContext.Provider value={orientation}>
      <div
        className={cn(
          "flex min-h-0 min-w-0",
          orientation === "horizontal" ? "flex-row" : "flex-col",
          className,
        )}
      >
        {children}
      </div>
    </OrientationContext.Provider>
  );
}

/** The props of a panel. */
export interface ResizablePanelProps {
  /** The size of the panel in pixels along the axis of its group. */
  readonly size: number;
  readonly className?: string;
  readonly testId?: string;
  readonly children: ReactNode;
}

/**
 * A panel of a group.
 *
 * The panel moves on a spring, so a collapse reads as a drawer closing and a
 * drag reads as the panel following the pointer.
 */
export function ResizablePanel({ size, className, testId, children }: ResizablePanelProps) {
  const orientation = useContext(OrientationContext);

  return (
    <motion.div
      className={cn("min-h-0 min-w-0 overflow-hidden", className)}
      data-testid={testId}
      animate={orientation === "horizontal" ? { width: size } : { height: size }}
      transition={panelSpring}
    >
      {children}
    </motion.div>
  );
}

/** The props of a handle. */
export interface ResizableHandleProps {
  /** The size of the panel the handle resizes, in pixels. */
  readonly size: number;
  /** The smallest size the handle may leave behind. */
  readonly min?: number;
  /** The largest size the handle may leave behind. */
  readonly max?: number;
  /** The name of the handle, for a screen reader. */
  readonly label: string;
  /** Called with the new size while the handle is dragged. */
  readonly onResize: (size: number) => void;
  readonly className?: string;
  readonly testId?: string;
}

/**
 * The handle between two panels.
 *
 * The handle reads the pointer, not the panel, so the panel never fights the
 * pointer for the size. The size it reports is the size the store holds.
 */
export function ResizableHandle({
  size,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  label,
  onResize,
  className,
  testId,
}: ResizableHandleProps) {
  const orientation = useContext(OrientationContext);
  const start = useRef({ pointer: 0, size });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = {
      pointer: orientation === "horizontal" ? event.clientX : event.clientY,
      size,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const pointer = orientation === "horizontal" ? event.clientX : event.clientY;
    const moved = start.current.size + (pointer - start.current.pointer);
    onResize(Math.min(Math.max(moved, min), max));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={orientation === "horizontal" ? "vertical" : "horizontal"}
      tabIndex={0}
      data-testid={testId}
      className={cn(
        "group shrink-0 bg-border/40 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
        orientation === "horizontal" ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize",
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}
