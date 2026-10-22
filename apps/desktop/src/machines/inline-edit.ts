import { assign, setup } from "xstate";
import { createActor, type ActorRefFrom } from "xstate";

/**
 * The lifecycle of the inline edit.
 *
 * ADR-0004 puts the asynchronous lifecycle of a feature under a machine: the
 * states are few, the orderings are constrained, and a request that is in
 * flight cannot also be an edit the reader already threw away.
 *
 * The machine is pure. It never calls the shell and never touches the editor,
 * so a test drives every state without a browser. The driver that sits beside
 * it starts the request, listens for the tokens and puts the diff into the
 * document.
 */

/** The states the inline edit of one document can be in. */
export type InlineEditStatus = "idle" | "prompting" | "streaming" | "reviewing";

/** What the machine knows about the request. */
export interface InlineEditContext {
  /** The id of the request in flight, or null when no request runs. */
  readonly requestId: string | null;
  /** The instruction the reader wrote. */
  readonly instruction: string;
  /** The text the model proposed, built from the tokens that arrived. */
  readonly proposed: string;
  /** The text the edit applies to. */
  readonly original: string;
  /** The first position of the range the edit applies to. */
  readonly from: number;
  /** The last position of the range the edit applies to. */
  readonly to: number;
  /** The message of a failure, or null when nothing failed. */
  readonly error: string | null;
}

/** The events the machine answers. */
export type InlineEditEvent =
  /** The reader asked for the prompt. */
  | {
      readonly type: "CMD_K";
      readonly from: number;
      readonly to: number;
      readonly original: string;
    }
  /** The reader sent the instruction. The request goes out. */
  | { readonly type: "SUBMIT"; readonly instruction: string; readonly requestId: string }
  /** A token of the stream arrived. */
  | { readonly type: "TOKEN"; readonly token: string }
  /** The stream ended. The edit waits for the reader. */
  | { readonly type: "COMPLETE" }
  /** The reader took the edit. */
  | { readonly type: "ACCEPT" }
  /** The reader threw the edit away. */
  | { readonly type: "REJECT" }
  /** The reader left the edit, or the request failed. */
  | { readonly type: "CANCEL"; readonly error?: string | undefined };

/** The context the machine opens with. */
export const INITIAL_INLINE_EDIT_CONTEXT: InlineEditContext = {
  requestId: null,
  instruction: "",
  proposed: "",
  original: "",
  from: 0,
  to: 0,
  error: null,
};

/**
 * The machine of the inline edit.
 *
 * The prompt opens only when the reader has something to edit, and the
 * request goes out only when the instruction says something. The tokens build
 * the proposal, and the proposal waits for the reader until it is taken or
 * thrown away.
 */
export const inlineEditMachine = setup({
  types: {
    context: {} as InlineEditContext,
    events: {} as InlineEditEvent,
  },
  guards: {
    hasSelection: ({ event }) => event.type === "CMD_K" && event.original.trim() !== "",
    hasPromptText: ({ event }) => event.type === "SUBMIT" && event.instruction.trim() !== "",
  },
  actions: {
    openPrompt: assign({
      from: ({ event }) => (event.type === "CMD_K" ? event.from : 0),
      to: ({ event }) => (event.type === "CMD_K" ? event.to : 0),
      original: ({ event }) => (event.type === "CMD_K" ? event.original : ""),
      instruction: "",
      proposed: "",
      requestId: null,
      error: null,
    }),
    recordRequest: assign({
      requestId: ({ event }) => (event.type === "SUBMIT" ? event.requestId : null),
      instruction: ({ event }) => (event.type === "SUBMIT" ? event.instruction : ""),
    }),
    recordToken: assign({
      proposed: ({ context, event }) =>
        event.type === "TOKEN" ? context.proposed + event.token : context.proposed,
    }),
    forget: assign({
      requestId: null,
      instruction: "",
      proposed: "",
      original: "",
      from: 0,
      to: 0,
    }),
    recordError: assign({
      error: ({ event }) => (event.type === "CANCEL" ? (event.error ?? null) : null),
    }),
  },
}).createMachine({
  id: "inline-edit",
  initial: "idle",
  context: INITIAL_INLINE_EDIT_CONTEXT,
  states: {
    idle: {
      on: {
        CMD_K: { guard: "hasSelection", target: "prompting", actions: "openPrompt" },
      },
    },
    prompting: {
      on: {
        SUBMIT: {
          guard: "hasPromptText",
          target: "streaming",
          actions: "recordRequest",
        },
        CANCEL: { target: "idle", actions: ["forget", "recordError"] },
      },
    },
    streaming: {
      on: {
        TOKEN: { actions: "recordToken" },
        COMPLETE: { target: "reviewing" },
        CANCEL: { target: "idle", actions: ["forget", "recordError"] },
      },
    },
    reviewing: {
      on: {
        ACCEPT: { target: "idle", actions: "forget" },
        REJECT: { target: "idle", actions: "forget" },
        CANCEL: { target: "idle", actions: ["forget", "recordError"] },
      },
    },
  },
});

/** The actor of the machine. */
export type InlineEditActor = ActorRefFrom<typeof inlineEditMachine>;

/**
 * A machine of the inline edit, ready to answer.
 *
 * The workflow belongs to a document and not to the window: the diff lives in
 * the document of the reader, and two documents can hold two edits at the
 * same time. The actor is created once and started when the caller asks for
 * it, so no module starts a machine at import time.
 */
export function createInlineEditActor(): InlineEditActor {
  const actor = createActor(inlineEditMachine);
  actor.start();
  return actor;
}
