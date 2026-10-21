/**
 * The terminal of one tab.
 *
 * The hook owns everything that lives outside React: the xterm.js instance,
 * the fit, web links and WebGL addons, the PTY session, the resize observer
 * and the machine that tracks the session. The component only renders the
 * host element and reads the report.
 *
 * The PTY opens when the tab is on screen and the panel is visible. A tab that
 * is mounted while hidden keeps its terminal instance but opens no session,
 * and a terminal that has started stays alive when its tab is hidden, because
 * hiding a panel is not a reason to kill a shell.
 */

import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTerm } from "@xterm/xterm";
import { useEffect, useRef, useState, type RefObject } from "react";
import { createActor } from "xstate";

import {
  createPty,
  killPty,
  onPtyData,
  onPtyExit,
  resizePty,
  writePty,
  type UnlistenFn,
} from "../../lib/tauri";
import { terminalMachine, type TerminalStatus } from "./machine";
import { decodeBase64 } from "./protocol";
import { arrowTerminalTheme, terminalFontFamily } from "./theme";

/** The renderer xterm.js paints with. */
export type TerminalRenderer = "webgl" | "dom";

/** The options of one terminal tab. */
export interface TerminalOptions {
  /** True when the tab is the one on screen. */
  readonly active: boolean;
  /** True when the bottom panel is open. */
  readonly visible: boolean;
}

/** What the component reads about its terminal. */
export interface TerminalReport {
  /** The state of the PTY machine. */
  readonly status: TerminalStatus;
  /** The id of the PTY, or null before it exists. */
  readonly sessionId: string | null;
  /** The columns the terminal last fitted. */
  readonly cols: number;
  /** The rows the terminal last fitted. */
  readonly rows: number;
  /** The chunks of the stream that never arrived. */
  readonly gaps: number;
  /** The sequence number of the last chunk that arrived. */
  readonly lastSeq: number;
  /** The renderer xterm paints with. */
  readonly renderer: TerminalRenderer;
  /** The text of the scrollback, as the screen shows it. */
  readonly buffer: () => string;
}

/** What the hook keeps outside React. */
interface TerminalRuntime {
  /** Opens the session when the tab can be seen, and fits the screen. */
  readonly sync: () => void;
}

/** The report before the terminal mounts. */
function emptyReport(): TerminalReport {
  return {
    status: "idle",
    sessionId: null,
    cols: 0,
    rows: 0,
    gaps: 0,
    lastSeq: 0,
    renderer: "dom",
    buffer: () => "",
  };
}

/**
 * Mounts one terminal, its addons and its PTY session on a host element.
 *
 * The cleanup kills the PTY, so closing a tab never leaves a shell behind.
 */
export function useTerminal(
  containerRef: RefObject<HTMLDivElement | null>,
  { active, visible }: TerminalOptions,
): TerminalReport {
  const [report, setReport] = useState<TerminalReport>(emptyReport);
  const runtimeRef = useRef<TerminalRuntime | null>(null);
  const activeRef = useRef(active);
  const visibleRef = useRef(visible);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let sessionId: string | null = null;
    let opening = false;
    let dataUnlisten: UnlistenFn | null = null;
    let exitUnlisten: UnlistenFn | null = null;
    let frame = 0;

    const actor = createActor(terminalMachine);
    const subscription = actor.subscribe((snapshot) => {
      if (disposed) return;
      setReport((previous) => ({
        ...previous,
        status: snapshot.value as TerminalStatus,
        sessionId: snapshot.context.sessionId,
        gaps: snapshot.context.gaps,
        lastSeq: snapshot.context.lastSeq,
      }));
    });
    actor.start();
    actor.send({ type: "start" });

    const theme = arrowTerminalTheme();
    const term = new XTerm({
      theme,
      fontFamily: terminalFontFamily(),
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
    });

    const fit = new FitAddon();
    const links = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(links);
    term.open(container);
    term.focus();

    let renderer: TerminalRenderer = "dom";
    try {
      const webgl = new WebglAddon();
      term.loadAddon(webgl);
      renderer = "webgl";
    } catch {
      // A browser without WebGL paints with the DOM renderer. The terminal
      // still works, so the report names the renderer the screen has.
      renderer = "dom";
    }

    /** Fits the screen when the host has a size to fit. */
    const fitNow = (): void => {
      if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
      try {
        fit.fit();
      } catch {
        // A terminal inside a collapsed panel has no grid to fit. The next
        // resize of the panel fits it again.
      }
    };

    /** Fits at most once per frame, so a panel drag is one fit per frame. */
    const scheduleFit = (): void => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!activeRef.current || !visibleRef.current) return;
        fitNow();
      });
    };

    const readBuffer = (): string => {
      const buffer = term.buffer.active;
      const lines: string[] = [];
      for (let index = 0; index < buffer.length; index += 1) {
        lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
      }
      return lines.join("\n");
    };

    setReport((previous) => ({
      ...previous,
      renderer,
      cols: term.cols,
      rows: term.rows,
      buffer: readBuffer,
    }));

    const dataSubscription = term.onData((data) => {
      if (sessionId) void writePty(sessionId, data);
    });

    const resizeSubscription = term.onResize(({ cols, rows }) => {
      setReport((previous) => ({ ...previous, cols, rows }));
      if (sessionId) void resizePty(sessionId, cols, rows);
    });

    /**
     * Opens the session of the tab.
     *
     * The session opens once, when the tab is on screen. A second call while
     * the first is in flight returns, so a strict double mount never starts
     * two shells and then kills one of them silently.
     */
    const openSession = async (): Promise<void> => {
      if (disposed || opening || sessionId !== null) return;
      if (!activeRef.current || !visibleRef.current) return;

      opening = true;
      try {
        // The tab mounts in the same commit that opens the panel, so the host
        // has no size until the panel has grown. Waiting for the first sized
        // frame gives the PTY the size of the panel it lands in instead of a
        // one-row default that the reader sees for a frame.
        for (let attempt = 0; attempt < 10; attempt += 1) {
          if (container.clientWidth > 0 && container.clientHeight > 0) break;
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve());
          });
        }
        if (disposed) return;

        fitNow();
        const created = await createPty(term.cols, term.rows);
        if (!created) {
          actor.send({ type: "fail", error: "The backend did not answer create_pty." });
          return;
        }
        if (disposed) {
          void killPty(created);
          return;
        }

        sessionId = created;
        actor.send({ type: "started", sessionId: created });

        void onPtyData(created, (payload) => {
          if (disposed) return;
          const bytes = decodeBase64(payload.data);
          if (!bytes) return;

          const gapsBefore = actor.getSnapshot().context.gaps;
          actor.send({ type: "data", seq: payload.seq });
          const lost = actor.getSnapshot().context.gaps - gapsBefore;
          if (lost > 0) {
            term.write(`\r\n\x1b[33m[arrow] terminal stream gap: ${lost} chunk(s) lost\x1b[0m\r\n`);
          }

          term.write(bytes);
        }).then((unlisten) => {
          if (disposed) {
            unlisten();
            return;
          }
          dataUnlisten = unlisten;
        });

        void onPtyExit(created, (payload) => {
          if (disposed) return;
          actor.send({ type: "exit", code: payload.code });
          term.writeln(`\r\n\x1b[90m[arrow] the shell exited with code ${payload.code}\x1b[0m`);
        }).then((unlisten) => {
          if (disposed) {
            unlisten();
            return;
          }
          exitUnlisten = unlisten;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        actor.send({ type: "fail", error: message });
        term.writeln(`\r\n\x1b[31m[arrow] the terminal failed: ${message}\x1b[0m`);
      } finally {
        opening = false;
      }
    };

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => scheduleFit());
    observer?.observe(container);

    runtimeRef.current = {
      sync: () => {
        if (!activeRef.current || !visibleRef.current) return;
        void openSession();
        scheduleFit();
      },
    };

    return () => {
      disposed = true;
      if (frame !== 0) cancelAnimationFrame(frame);
      observer?.disconnect();
      dataUnlisten?.();
      exitUnlisten?.();
      dataSubscription.dispose();
      resizeSubscription.dispose();
      subscription.unsubscribe();
      actor.stop();
      term.dispose();

      const killed = sessionId;
      sessionId = null;
      if (killed) void killPty(killed);

      runtimeRef.current = null;
    };
  }, [containerRef]);

  useEffect(() => {
    activeRef.current = active;
    visibleRef.current = visible;
    runtimeRef.current?.sync();
  }, [active, visible]);

  return report;
}
