import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";

import {
  aiCompletions,
  clearGhostText,
  setGhostText,
  type EditorView,
  type GhostTextTrigger,
} from "@arrow/editor-core";
import type { Extension } from "@codemirror/state";

import {
  cancelRequest,
  onAiComplete,
  onAiError,
  onAiToken,
  startCompletion,
  type AiProvider,
} from "../../lib/ai";
import { ghostTextActor } from "./ghostTextMachine";

/**
 * The ghost text of one editor pane.
 *
 * The hook drives the workflow of the suggestion: it starts the request when
 * the reader stops typing, it listens for the tokens that arrive, it puts the
 * text into the editor as it grows, and it ends the request through the one
 * cancel path of the shell.
 *
 * The engine owns the mechanics and the machine owns the lifecycle. The hook
 * is the only part that talks to both, and it talks to the shell through the
 * boundary of `apps/desktop/src/lib/ai.ts`.
 */

/** The characters of the document that go before the caret. */
const CONTEXT_BEFORE = 4000;

/** The instruction the model reads when it completes the code. */
const COMPLETION_PROMPT =
  "Complete the code at the end of the context. Answer with the completion and nothing else.";

/** The number of requests the window has started. */
let started = 0;

/** What the hook keeps outside React. */
interface GhostTextRuntime {
  /** The id of the request in flight, or null when no request runs. */
  requestId: string | null;
  /** The place of the caret when the request went out. */
  position: number;
  /** The function that takes the listeners of the request off the shell. */
  unlisten: (() => void) | null;
}

/** The options of the hook. */
export interface UseGhostTextOptions {
  /** The reference that holds the view of the editor. */
  readonly viewRef: RefObject<EditorView | null>;
  /** True when the pane is the one the reader sees. */
  readonly active: boolean;
  /** The provider the requests go to. */
  readonly provider: AiProvider;
  /** The model the requests go to. */
  readonly model: string;
  /** True when the shell asks for completions on its own. */
  readonly enabled: boolean;
}

/**
 * The ghost text of a pane.
 *
 * The hook answers with the extension the pane mounts on the editor. The
 * extension is built once and never built again: a new extension would give
 * the editor a new wait, and the reader would type forever without a
 * suggestion.
 */
export function useGhostText({
  viewRef,
  active,
  provider,
  model,
  enabled,
}: UseGhostTextOptions): Extension {
  const runtime = useRef<GhostTextRuntime>({ requestId: null, position: 0, unlisten: null });
  const facts = useRef({ active, provider, model, enabled });
  facts.current = { active, provider, model, enabled };
  const wasActive = useRef(false);

  /** Takes the suggestion out of the editor. */
  const clear = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: clearGhostText.of(null) });
  }, [viewRef]);

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

  /** The reader typed, so the suggestion of the old text is gone. */
  const onType = useCallback(() => {
    const current = facts.current;
    if (!current.active || !current.enabled) return;
    ghostTextActor().send({ type: "type" });
  }, []);

  /** The reader stopped typing, so a request goes out. */
  const onTrigger = useCallback(
    (trigger: GhostTextTrigger) => {
      const current = facts.current;
      if (!current.active || !current.enabled) return;

      const actor = ghostTextActor();
      if (actor.getSnapshot().value !== "waiting") return;

      started += 1;
      const requestId = `ghost-text-${started}`;

      // A new trigger replaces the request that was in flight, so the tokens
      // of the old one never reach the editor.
      endRequest();
      actor.send({ type: "trigger", requestId });
      runtime.current.requestId = requestId;
      runtime.current.position = trigger.position;

      void requestCompletion(requestId, trigger, current.provider, current.model, runtime, viewRef);
    },
    [endRequest, viewRef],
  );

  /** The reader took the suggestion with Tab. */
  const onAccept = useCallback(() => {
    endRequest();
    ghostTextActor().send({ type: "accept" });
  }, [endRequest]);

  /** The reader threw the suggestion away with Escape. */
  const onDismiss = useCallback(() => {
    const state = runtime.current;
    const running = state.requestId !== null;
    endRequest();
    ghostTextActor().send({ type: "dismiss" });
    return running;
  }, [endRequest]);

  // A pane that the reader leaves stops the request it started, so a stream
  // that belongs to another tab never paints a suggestion here.
  useEffect(() => {
    if (wasActive.current && !active) {
      endRequest();
      ghostTextActor().send({ type: "dismiss" });
      clear();
    }
    wasActive.current = active;
  }, [active, clear, endRequest]);

  // The request that runs when the pane goes away is ended with it.
  useEffect(() => () => endRequest(), [endRequest]);

  return useMemo(
    () => aiCompletions({ onTrigger, onType, onAccept, onDismiss }),
    [onAccept, onDismiss, onTrigger, onType],
  );
}

/**
 * Starts a request and puts the tokens into the editor as they arrive.
 *
 * The listeners go on the shell before the request starts, so the first token
 * of the stream is not missed. A request that the reader answered while the
 * listeners were going on is ended before it starts.
 */
async function requestCompletion(
  requestId: string,
  trigger: GhostTextTrigger,
  provider: AiProvider,
  model: string,
  runtime: { current: GhostTextRuntime },
  viewRef: RefObject<EditorView | null>,
): Promise<void> {
  const actor = ghostTextActor();

  const stopTokens = await onAiToken(requestId, (payload) => {
    if (runtime.current.requestId !== requestId) return;
    if (actor.getSnapshot().value !== "streaming") return;

    // The caret moved since the request went out, so the tokens belong to a
    // place the reader left. A suggestion of another place is a lie.
    const view = viewRef.current;
    if (!view) return;
    if (view.state.selection.main.head !== runtime.current.position) return;

    actor.send({ type: "token", token: payload.token });
    const text = actor.getSnapshot().context.text;
    if (text === "") return;
    view.dispatch({ effects: setGhostText.of({ text }) });
  });

  const stopComplete = await onAiComplete(requestId, () => {
    if (runtime.current.requestId !== requestId) return;
    runtime.current.requestId = null;
    runtime.current.unlisten?.();
    runtime.current.unlisten = null;
    if (actor.getSnapshot().value !== "streaming") return;
    actor.send({ type: "complete" });
  });

  const stopError = await onAiError(requestId, () => {
    if (runtime.current.requestId !== requestId) return;
    runtime.current.requestId = null;
    runtime.current.unlisten?.();
    runtime.current.unlisten = null;
    actor.send({ type: "fail" });
    const view = viewRef.current;
    if (view) view.dispatch({ effects: clearGhostText.of(null) });
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
    await startCompletion({
      requestId,
      provider,
      model,
      prompt: COMPLETION_PROMPT,
      context: trigger.before.slice(-CONTEXT_BEFORE),
    });
  } catch {
    if (runtime.current.requestId !== requestId) return;
    runtime.current.requestId = null;
    runtime.current.unlisten?.();
    runtime.current.unlisten = null;
    actor.send({ type: "fail" });
    const view = viewRef.current;
    if (view) view.dispatch({ effects: clearGhostText.of(null) });
  }
}
