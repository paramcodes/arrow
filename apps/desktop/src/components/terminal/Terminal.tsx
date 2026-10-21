import { useEffect, useRef } from "react";

import "@xterm/xterm/css/xterm.css";
import "./terminal.css";

import type { TerminalStatus } from "./machine";
import { terminalVariables } from "./theme";
import { useTerminal, type TerminalRenderer } from "./useTerminal";

/** What the end to end suite reads about the terminal on screen. */
export interface ArrowTerminalDebug {
  /** The tab the terminal belongs to. */
  readonly tabId: string;
  /** The id of the PTY, or null before it exists. */
  readonly sessionId: string | null;
  /** The state of the PTY machine. */
  readonly status: TerminalStatus;
  /** The renderer xterm paints with. */
  readonly renderer: TerminalRenderer;
  /** The columns of the grid. */
  readonly cols: number;
  /** The rows of the grid. */
  readonly rows: number;
  /** The chunks of the stream that never arrived. */
  readonly gaps: number;
  /** The sequence number of the last chunk that arrived. */
  readonly lastSeq: number;
  /** The resolved colors of the theme, keyed by the CSS variable of each slot. */
  readonly variables: Readonly<Record<string, string>>;
  /** The text of the scrollback, as the screen shows it. */
  readonly buffer: () => string;
}

declare global {
  interface Window {
    /** The terminal on screen, for the end to end suite. */
    __arrowTerminal?: ArrowTerminalDebug;
  }
}

/** The props of one terminal tab. */
export interface TerminalProps {
  /** The id of the tab, used for the test id of the screen. */
  readonly tabId: string;
  /** True when the tab is the one on screen. */
  readonly active: boolean;
  /** True when the bottom panel is open. */
  readonly visible: boolean;
}

/**
 * One terminal of the bottom panel.
 *
 * The component renders the host element of xterm.js and hands the debug
 * handle to the end to end suite. Everything else lives in the hook, because
 * the terminal is an object outside React and a component cannot own it.
 */
export function Terminal({ tabId, active, visible }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const report = useTerminal(containerRef, { active, visible });
  const { buffer, cols, gaps, lastSeq, renderer, sessionId, status } = report;

  useEffect(() => {
    if (!active) return;

    window.__arrowTerminal = {
      tabId,
      sessionId,
      status,
      renderer,
      cols,
      rows: report.rows,
      gaps,
      lastSeq,
      variables: terminalVariables(),
      buffer,
    };

    return () => {
      if (window.__arrowTerminal?.tabId === tabId) delete window.__arrowTerminal;
    };
  }, [active, buffer, cols, gaps, lastSeq, renderer, report.rows, sessionId, status, tabId]);

  return (
    <div
      ref={containerRef}
      className="arrow-terminal h-full w-full"
      data-testid={`terminal-screen-${tabId}`}
      data-active={active ? "true" : "false"}
      data-renderer={renderer}
      data-status={status}
      hidden={!active}
    />
  );
}
