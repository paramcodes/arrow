import { assign, setup } from "xstate";
import { createActor, type ActorRefFrom } from "xstate";

/**
 * The lifecycle of the ghost text.
 *
 * ADR-0004 puts the asynchronous lifecycle of a suggestion under a machine:
 * the states are few, the orderings are constrained, and a request that is in
 * flight cannot also be a suggestion the reader already threw away.
 *
 * The machine is pure. It never calls the shell and never touches the editor,
 * so a test drives every state without a browser. The driver that sits beside
 * it starts the request, listens for the tokens and puts the text into the
 * editor.
 */

/** The states the ghost text of one window can be in. */
export type GhostTextStatus = "idle" | "waiting" | "streaming" | "ready";

/** What the machine knows about the request. */
export interface GhostTextContext {
  /** The id of the request in flight, or null when no request runs. */
  readonly requestId: string | null;
  /** The text of the suggestion, built from the tokens that arrived. */
  readonly text: string;
}

/** The events the machine answers. */
export type GhostTextEvent =
  /** The reader typed. The wait for a suggestion starts again. */
  | { readonly type: "type" }
  /** The reader stopped typing and a request goes out. */
  | { readonly type: "trigger"; readonly requestId: string }
  /** A token of the stream arrived. */
  | { readonly type: "token"; readonly token: string }
  /** The stream ended. The suggestion waits for the reader. */
  | { readonly type: "complete" }
  /** The request failed. */
  | { readonly type: "fail" }
  /** The reader threw the suggestion away. */
  | { readonly type: "dismiss" }
  /** The reader took the suggestion. */
  | { readonly type: "accept" };

/** The context the machine opens with. */
export const INITIAL_GHOST_TEXT_CONTEXT: GhostTextContext = {
  requestId: null,
  text: "",
};

/**
 * The machine of the ghost text.
 *
 * A request only goes out from the state `waiting`, which the reader reaches
 * by typing. The states `streaming` and `ready` hold a suggestion the reader
 * has not answered yet, and a trigger that arrives in either of them is
 * ignored: a suggestion that is already on the screen is not replaced by
 * another one without the reader typing.
 */
export const ghostTextMachine = setup({
  types: {
    context: {} as GhostTextContext,
    events: {} as GhostTextEvent,
  },
  actions: {
    recordRequest: assign({
      requestId: ({ event }) => (event.type === "trigger" ? event.requestId : null),
      text: "",
    }),
    recordToken: assign({
      text: ({ context, event }) =>
        event.type === "token" ? context.text + event.token : context.text,
    }),
    endRequest: assign({ requestId: null }),
    forgetSuggestion: assign({ requestId: null, text: "" }),
  },
}).createMachine({
  id: "ghost-text",
  initial: "idle",
  context: INITIAL_GHOST_TEXT_CONTEXT,
  states: {
    idle: {
      on: { type: "waiting" },
    },
    waiting: {
      on: {
        type: "waiting",
        trigger: { target: "streaming", actions: "recordRequest" },
      },
    },
    streaming: {
      on: {
        token: { actions: "recordToken" },
        complete: { target: "ready", actions: "endRequest" },
        fail: { target: "idle", actions: "forgetSuggestion" },
        type: "waiting",
        dismiss: { target: "idle", actions: "forgetSuggestion" },
        accept: { target: "idle", actions: "forgetSuggestion" },
      },
    },
    ready: {
      on: {
        type: "waiting",
        dismiss: { target: "idle", actions: "forgetSuggestion" },
        accept: { target: "idle", actions: "forgetSuggestion" },
      },
    },
  },
});

/** The actor of the machine. */
export type GhostTextActor = ActorRefFrom<typeof ghostTextMachine>;

let actor: GhostTextActor | null = null;

/**
 * The actor of the ghost text of the window.
 *
 * The workflow belongs to the window and not to a file: the window has one
 * provider, one model and one key, and the status bar shows one state. The
 * actor is created once and started when the first caller asks for it, so no
 * module starts a machine at import time.
 */
export function ghostTextActor(): GhostTextActor {
  if (!actor) {
    actor = createActor(ghostTextMachine);
    actor.start();
  }
  return actor;
}

/**
 * The state the status bar shows for the AI feature.
 */
export type AiConnectionState = "loading" | "ready" | "no-key";

/**
 * The state the status bar shows, from the workflow and from the key.
 *
 * A request that is about to go out and a request that runs are both work in
 * flight, so both show as loading. A window that is idle shows ready when the
 * provider has a key and no key when it has none.
 */
export function aiConnectionState(status: GhostTextStatus, hasKey: boolean): AiConnectionState {
  if (status === "waiting" || status === "streaming") return "loading";
  return hasKey ? "ready" : "no-key";
}
