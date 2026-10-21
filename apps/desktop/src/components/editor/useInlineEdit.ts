import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";

import {
  acceptInlineDiff,
  clearInlineDiff,
  inlineDiff,
  inlineEditRange,
  rejectInlineDiff,
  setInlineDiff,
  type EditorView,
} from "@arrow/editor-core";
import type { Extension } from "@codemirror/state";

import {
  cancelRequest,
  onAiComplete,
  onAiError,
  onAiToken,
  startInlineEdit,
  type AiProvider,
} from "../../lib/ai";
import {
  createInlineEditActor,
  type InlineEditActor,
  type InlineEditStatus,
} from "../../machines/inline-edit";
import { ghostTextActor } from "./ghostTextMachine";

/**
 * The inline edit of one editor pane.
 *
 * The hook drives the workflow of the edit: the reader asks for the prompt,
 * the instruction goes out to the shell, the tokens that arrive become the
 * diff in the document, and the reader takes the diff or throws it away.
 *
 * The engine owns the mechanics and the machine owns the lifecycle. The hook
 * is the only part that talks to both, and it talks to the shell through the
 * boundary of `apps/desktop/src/lib/ai.ts`.
 */

/** The number of requests the window has started. */
let started = 0;

/** Where the prompt bar sits on the screen. */
export interface InlineEditPosition {
  /** The distance from the top of the window. */
  readonly top: number;
  /** The distance from the left of the window. */
  readonly left: number;
}

/** What the hook keeps outside React. */
interface InlineEditRuntime {
  /** The id of the request in flight, or null when no request runs. */
  requestId: string | null;
  /** The first position of the range the request applies to. */
  from: number;
  /** The last position of the range the request applies to. */
  to: number;
  /** The text the request applies to. */
  original: string;
  /** The function that takes the listeners of the request off the shell. */
  unlisten: (() => void) | null;
}

/** The options of the hook. */
export interface UseInlineEditOptions {
  /** The reference that holds the view of the editor. */
  readonly viewRef: RefObject<EditorView | null>;
  /** True when the pane is the one the reader sees. */
  readonly active: boolean;
  /** The provider the requests go to. */
  readonly provider: AiProvider;
  /** The model the requests go to. */
  readonly model: string;
}

/** What the bar of the prompt needs to know. */
export interface InlineEditController {
  /** The extension the pane mounts on the editor. */
  readonly extension: Extension;
  /** The state the workflow is in. */
  readonly status: InlineEditStatus;
  /** The message of a failure, or null when nothing failed. */
  readonly error: string | null;
  /** Where the bar sits, or null when the bar is closed. */
  readonly position: InlineEditPosition | null;
  /** Open the prompt of the inline edit on the document of the pane. */
  readonly start: () => void;
  /** Send the instruction of the reader to the shell. */
  readonly submit: (instruction: string) => void;
  /** Leave the edit without taking it. */
  readonly cancel: () => void;
  /** Take the edit into the document. */
  readonly accept: () => void;
  /** Throw the edit away. */
  readonly reject: () => void;
}

/**
 * The inline edit of a pane.
 *
 * The hook answers with the extension the pane mounts on the editor and with
 * the actions the bar of the prompt runs. The extension is built once and
 * never built again: a new extension would give the editor a new workflow, and
 * the reader would press the command twice for one edit.
 */
export function useInlineEdit({
  viewRef,
  active,
  provider,
  model,
}: UseInlineEditOptions): InlineEditController {
  const actorRef = useRef<InlineEditActor | null>(null);
  if (!actorRef.current) actorRef.current = createInlineEditActor();
  const actor = actorRef.current;

  const runtime = useRef<InlineEditRuntime>({
    requestId: null,
    from: 0,
    to: 0,
    original: "",
    unlisten: null,
  });
  const facts = useRef({ active, provider, model });
  facts.current = { active, provider, model };
  const [position, setPosition] = useState<InlineEditPosition | null>(null);

  const status = useSyncExternalStore(
    (onChange) => {
      const subscription = actor.subscribe(() => onChange());
      return () => subscription.unsubscribe();
    },
    () => actor.getSnapshot().value as InlineEditStatus,
  );

  /** Ends the request in flight and takes its listeners off the shell. */
  const endRequest = useCallback(() => {
    const state = runtime.current;
    if (state.requestId !== null) {
      void cancelRequest(state.requestId);
      state.requestId = null;
    }
    state.unlisten?.();
    state.unlisten = null;
  }, []);

  /** Takes the diff off the screen of a view. */
  const clearDiff = useCallback((view: EditorView) => {
    view.dispatch({ effects: clearInlineDiff.of(null) });
  }, []);

  /** The reader asked for the prompt. */
  const start = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;

    const range = inlineEditRange(view.state);
    if (!range) return;

    // The suggestion of the ghost text leaves the screen, because the edit
    // takes its place and two answers on one document are one too many. The
    // selection that follows takes the suggestion away as well.
    ghostTextActor().send({ type: "dismiss" });

    view.dispatch({ selection: { anchor: range.from, head: range.to } });
    actor.send({
      type: "CMD_K",
      from: range.from,
      to: range.to,
      original: range.original,
    });

    const coords = view.coordsAtPos(range.from);
    if (!coords) return;
    setPosition({ top: coords.top, left: coords.left });
  }, [actor, viewRef]);

  /** The reader took the edit. */
  const acceptIn = useCallback(
    (view: EditorView): boolean => {
      if (actor.getSnapshot().value !== "reviewing") return false;

      // The edit may be gone already, when the text it applies to changed
      // under it. The workflow ends either way: a reader who answers a
      // question that is gone must not stay in it.
      const spec = acceptInlineDiff(view.state);
      if (spec) view.dispatch(spec);
      endRequest();
      actor.send({ type: "ACCEPT" });
      return true;
    },
    [actor, endRequest],
  );

  /** The reader threw the edit away, or left it before it was ready. */
  const rejectIn = useCallback(
    (view: EditorView): boolean => {
      const state = actor.getSnapshot().value;

      if (state === "reviewing") {
        const spec = rejectInlineDiff(view.state);
        if (spec) view.dispatch(spec);
        endRequest();
        actor.send({ type: "REJECT" });
        return true;
      }

      if (state === "prompting" || state === "streaming") {
        endRequest();
        clearDiff(view);
        actor.send({ type: "CANCEL" });
        return true;
      }

      return false;
    },
    [actor, clearDiff, endRequest],
  );

  /**
   * The text the edit applies to changed, so the edit left the screen.
   *
   * The edit belongs to the text it applies to, so a change of that text
   * takes the edit away. The workflow ends with it, so the bar of the prompt
   * does not wait for an answer that has no question any more.
   */
  const lost = useCallback(() => {
    const state = actor.getSnapshot().value;
    if (state !== "streaming" && state !== "reviewing") return;
    endRequest();
    actor.send({ type: "CANCEL" });
  }, [actor, endRequest]);

  /** The reader sent the instruction, so the request goes out. */
  const submit = useCallback(
    (instruction: string) => {
      const view = viewRef.current;
      if (!view) return;

      const context = actor.getSnapshot().context;
      if (context.original === "") return;

      started += 1;
      const requestId = `inline-edit-${started}`;

      // A new request replaces the one that was in flight, so the tokens of
      // the old one never reach the document.
      endRequest();
      actor.send({ type: "SUBMIT", instruction, requestId });
      runtime.current.requestId = requestId;
      runtime.current.from = context.from;
      runtime.current.to = context.to;
      runtime.current.original = context.original;

      void requestEdit({
        requestId,
        instruction,
        provider: facts.current.provider,
        model: facts.current.model,
        runtime,
        viewRef,
        actor,
      });
    },
    [actor, endRequest, viewRef],
  );

  /** The reader left the edit. */
  const cancel = useCallback(() => {
    const view = viewRef.current;
    endRequest();
    if (view) clearDiff(view);
    actor.send({ type: "CANCEL" });
    setPosition(null);
  }, [actor, clearDiff, endRequest, viewRef]);

  // A pane that the reader leaves stops the edit it started, so a stream that
  // belongs to another tab never paints a diff here.
  useEffect(() => {
    if (!active) {
      endRequest();
      actor.send({ type: "CANCEL" });
    }
  }, [active, actor, endRequest]);

  // The request that runs when the pane goes away is ended with it.
  useEffect(() => () => endRequest(), [endRequest]);

  // The bar sits above the selection while the workflow runs. A failure keeps
  // the bar on the screen, so the reader learns why the edit did not come.
  useEffect(() => {
    const failure = actor.getSnapshot().context.error;
    if (status === "idle" && !failure) setPosition(null);
  }, [actor, status]);

  // The editor takes the focus back when the bar is not asking for anything,
  // so the keys of the reader reach the document and not the body of the page.
  useEffect(() => {
    if (status === "idle" || status === "prompting") return;
    viewRef.current?.focus();
  }, [status, viewRef]);

  const extension = useMemo(
    () => inlineDiff({ onAccept: acceptIn, onReject: rejectIn, onLost: lost }),
    [acceptIn, rejectIn, lost],
  );

  return {
    extension,
    status,
    error: actor.getSnapshot().context.error,
    position,
    start,
    submit,
    cancel,
    accept: () => {
      const view = viewRef.current;
      if (view) acceptIn(view);
    },
    reject: () => {
      const view = viewRef.current;
      if (view) rejectIn(view);
    },
  };
}

/**
 * Starts a request and puts the tokens into the document as they arrive.
 *
 * The listeners go on the shell before the request starts, so the first token
 * of the stream is not missed. A request that the reader answered while the
 * listeners were going on is ended before it starts.
 */
async function requestEdit({
  requestId,
  instruction,
  provider,
  model,
  runtime,
  viewRef,
  actor,
}: {
  readonly requestId: string;
  readonly instruction: string;
  readonly provider: AiProvider;
  readonly model: string;
  readonly runtime: { current: InlineEditRuntime };
  readonly viewRef: RefObject<EditorView | null>;
  readonly actor: InlineEditActor;
}): Promise<void> {
  const stopTokens = await onAiToken(requestId, (payload) => {
    if (runtime.current.requestId !== requestId) return;
    if (actor.getSnapshot().value !== "streaming") return;

    actor.send({ type: "TOKEN", token: payload.token });
    const proposed = actor.getSnapshot().context.proposed;
    if (proposed === "") return;

    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: setInlineDiff.of({
        from: runtime.current.from,
        to: runtime.current.to,
        original: runtime.current.original,
        proposed,
      }),
    });
  });

  const stopComplete = await onAiComplete(requestId, () => {
    if (runtime.current.requestId !== requestId) return;
    runtime.current.requestId = null;
    runtime.current.unlisten?.();
    runtime.current.unlisten = null;
    if (actor.getSnapshot().value !== "streaming") return;
    actor.send({ type: "COMPLETE" });
  });

  const stopError = await onAiError(requestId, (payload) => {
    if (runtime.current.requestId !== requestId) return;
    runtime.current.requestId = null;
    runtime.current.unlisten?.();
    runtime.current.unlisten = null;
    actor.send({ type: "CANCEL", error: payload.error });
    const view = viewRef.current;
    if (view) view.dispatch({ effects: clearInlineDiff.of(null) });
  });

  runtime.current.unlisten = () => {
    stopTokens();
    stopComplete();
    stopError();
  };

  if (runtime.current.requestId !== requestId || actor.getSnapshot().value !== "streaming") {
    runtime.current.unlisten();
    runtime.current.unlisten = null;
    await cancelRequest(requestId);
    return;
  }

  try {
    await startInlineEdit({
      requestId,
      provider,
      model,
      instruction,
      selection: runtime.current.original,
    });
  } catch (error) {
    if (runtime.current.requestId !== requestId) return;
    runtime.current.requestId = null;
    runtime.current.unlisten?.();
    runtime.current.unlisten = null;
    actor.send({ type: "CANCEL", error: failureMessage(error) });
    const view = viewRef.current;
    if (view) view.dispatch({ effects: clearInlineDiff.of(null) });
  }
}

/**
 * The message of a failure of the shell.
 *
 * The shell answers a failure with a string and the browser throws an error,
 * so the message of the failure is read from both shapes. The message never
 * carries a key: the shell refuses a failure that names a secret.
 */
function failureMessage(error: unknown): string {
  if (typeof error === "string" && error !== "") return error;
  if (error instanceof Error && error.message !== "") return error.message;
  return "The request to the model failed.";
}
