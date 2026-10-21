import { motion } from "motion/react";
import {
  createContext,
  useContext,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
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

/**
 * The number of pixels one arrow key press moves a handle.
 *
 * The step is the size of one text line, so the panel follows the keyboard at
 * the speed a reader expects. Holding shift moves it four times as far.
 */
export const HANDLE_KEY_STEP = 16;

/** The number of pixels one shift and arrow key press moves a handle. */
export const HANDLE_KEY_STEP_LARGE = 64;

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

  /**
   * The keyboard resize.
   *
   * A handle that a keyboard can reach has to move under the keyboard too,
   * or the reach is a trap. The arrow keys move the panel along the axis of
   * the group, and the same bounds hold as for a drag.
   */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? HANDLE_KEY_STEP_LARGE : HANDLE_KEY_STEP;
    let delta = 0;

    if (orientation === "horizontal") {
      if (event.key === "ArrowLeft") delta = -step;
      else if (event.key === "ArrowRight") delta = step;
    } else {
      if (event.key === "ArrowUp") delta = -step;
      else if (event.key === "ArrowDown") delta = step;
    }

    if (delta === 0) return;
    event.preventDefault();
    onResize(Math.min(Math.max(size + delta, min), max));
  };

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={orientation === "horizontal" ? "vertical" : "horizontal"}
      aria-valuenow={size}
      aria-valuemin={min}
      aria-valuemax={Number.isFinite(max) ? max : undefined}
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
      onKeyDown={onKeyDown}
    />
  );
}
