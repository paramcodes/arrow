/**
 * The lifecycle of one terminal's PTY.
 *
 * ADR-0004 puts the asynchronous lifecycle of a PTY under a machine: the
 * states are few, the orderings are constrained and a terminal that is
 * running cannot also be exited. The machine also holds the sequence number
 * of the stream, so a chunk that never arrived is a fact of the machine and
 * not a number in a component.
 *
 * The machine is pure. It never calls the boundary and never touches the
 * terminal, so a test drives every state without a browser.
 */

import { assign, setup } from "xstate";

/** The states a terminal's PTY can be in. */
export type TerminalStatus = "idle" | "starting" | "running" | "exited" | "failed" | "killed";

/** What the machine knows about the session. */
export interface TerminalContext {
  /** The id the backend gave the PTY, or null before it exists. */
  readonly sessionId: string | null;
  /** The sequence number of the last chunk that arrived. */
  readonly lastSeq: number;
  /** The number of chunks that never arrived. */
  readonly gaps: number;
  /** The code the shell exited with, or null while it runs. */
  readonly exitCode: number | null;
  /** The message of the failure that ended the session, or null. */
  readonly error: string | null;
}

/** The events the machine answers. */
export type TerminalEvent =
  | { readonly type: "start" }
  | { readonly type: "started"; readonly sessionId: string }
  | { readonly type: "data"; readonly seq: number }
  | { readonly type: "exit"; readonly code: number }
  | { readonly type: "fail"; readonly error: string }
  | { readonly type: "kill" };

/** The context a terminal opens with. */
export const INITIAL_TERMINAL_CONTEXT: TerminalContext = {
  sessionId: null,
  lastSeq: 0,
  gaps: 0,
  exitCode: null,
  error: null,
};

/**
 * The gap of one chunk.
 *
 * The first chunk is sequence 1. A chunk at or below the last number is a
 * replay, so it does not move the stream and it is not a gap.
 */
export function gapOfChunk(lastSeq: number, seq: number): number {
  const lost = seq - lastSeq - 1;
  return lost > 0 ? lost : 0;
}

/**
 * The machine of one terminal's PTY.
 *
 * `kill` reaches `killed` from every live state, because a tab can close while
 * the PTY is still starting and the session must not be left behind. `killed`
 * is final: a session that was killed cannot return.
 */
export const terminalMachine = setup({
  types: {
    context: {} as TerminalContext,
    events: {} as TerminalEvent,
  },
  actions: {
    recordChunk: assign({
      lastSeq: ({ context, event }) => {
        if (event.type !== "data") return context.lastSeq;
        return Math.max(context.lastSeq, event.seq);
      },
      gaps: ({ context, event }) => {
        if (event.type !== "data") return context.gaps;
        return context.gaps + gapOfChunk(context.lastSeq, event.seq);
      },
    }),
    recordSession: assign({
      sessionId: ({ event }) => (event.type === "started" ? event.sessionId : null),
    }),
    recordExit: assign({
      exitCode: ({ event }) => (event.type === "exit" ? event.code : null),
    }),
    recordError: assign({
      error: ({ event }) => (event.type === "fail" ? event.error : null),
    }),
  },
}).createMachine({
  id: "terminal",
  initial: "idle",
  context: INITIAL_TERMINAL_CONTEXT,
  states: {
    idle: {
      on: { start: { target: "starting" } },
    },
    starting: {
      on: {
        started: { target: "running", actions: "recordSession" },
        fail: { target: "failed", actions: "recordError" },
        kill: { target: "killed" },
      },
    },
    running: {
      on: {
        data: { actions: "recordChunk" },
        exit: { target: "exited", actions: "recordExit" },
        fail: { target: "failed", actions: "recordError" },
        kill: { target: "killed" },
      },
    },
    exited: {
      on: { kill: { target: "killed" } },
    },
    failed: {
      on: { kill: { target: "killed" } },
    },
    killed: {
      type: "final",
    },
  },
});
